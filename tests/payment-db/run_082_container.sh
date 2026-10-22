#!/usr/bin/env bash
# 082 (solo-operator mode) container run. Host side (WSL), drives ONE existing isolated container.
#   bash tests/payment-db/run_082_container.sh <container-id> <source-db-at-078> <out-dir>
# Refuses unless the container has NetworkMode none, no port bindings, is not privileged, and only loopback inside.
# Never touches <source-db-at-078>. Builds flexsoar_082_pre (078+079+080+081+081b), then a fresh flexsoar_payment_v2_test per
# scenario. Migrations run as postgres; 83 runs as supabase_admin with the 00_target_guard marker.
# Staging/production: postgres is a SET+INHERIT member of the six payment_v2 roles (059 ran with createrole_self_grant='set, inherit').
# A replay built as supabase_admin lacks that; this runner mirrors it (cluster-local to the isolated container) and says so.
set -u
C=${1:?container}; SRC=${2:?source db}; OUT=${3:?out dir}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
mkdir -p "$OUT"; exec > >(tee "$OUT/run.log") 2>&1
fail(){ echo "T082_RUN_STOP: $*"; exit 1; }

iso=$(docker inspect "$C" --format '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{.State.Running}}') || fail "inspect"
echo "isolation: $iso"
[[ $iso == 'none|{}|false|true' ]] || fail "container is not network-none/no-ports/unprivileged/running"
lo=$(docker exec "$C" sh -c "ip -o addr | awk '{print \$2}' | sort -u | tr '\n' ' '")
[[ $lo == 'lo ' ]] || fail "interfaces other than lo: $lo"

T=/tmp/t082; docker exec "$C" sh -c "rm -rf $T && mkdir -p $T"
for f in 00_target_guard.sql 01_fixtures.sql 83_solo_mode.sql; do docker cp "$HERE/$f" "$C:$T/$f" >/dev/null; done
for f in 079_review_approval_is_not_authentication.sql 080_post_079_cleanup.sql 081_revoke_public_set_card_visibility.sql 081b_retire_prelaunch_test_item.sql 082_payment_v2_solo_operator_mode.sql; do
  [[ $(tr -cd '\r' < "$REPO/supabase/migrations/$f" | wc -c) == 0 ]] || fail "CR in $f"
  docker cp "$REPO/supabase/migrations/$f" "$C:$T/$f" >/dev/null
  echo "sha256 $(sha256sum "$REPO/supabase/migrations/$f" | cut -c1-64) $f"
done

adm(){ docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "${2:-postgres}" -Atc "$1"; }
mig(){ local db=$1 f=$2 label=$3; docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$db" -f "$T/$f" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc $(grep -E 'ERROR|NOTICE|COMMIT|ROLLBACK' "$OUT/$label.log" | sed 's/^psql:[^ ]* //' | tr '\n' ' ')"; return $rc; }
fresh(){ adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null && adm "CREATE DATABASE flexsoar_payment_v2_test TEMPLATE $1 OWNER postgres" >/dev/null || fail "fresh db"; }
t83(){ local label=$1; docker exec -e PGOPTIONS='-c payment_v2.test_identity=synthetic-payment-v2-only' "$C" \
  psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -h 127.0.0.1 -U supabase_admin -d flexsoar_payment_v2_test \
  -At -f "$T/83_solo_mode.sql" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc"; grep -E 'T083|ERROR' "$OUT/$label.log" | sed 's/^psql:[^ ]* //;s/^NOTICE: *//;s/^/   /'; return $rc; }

m=$(adm "SELECT count(*) FROM pg_auth_members WHERE member='postgres'::regrole AND roleid='payment_v2_owner'::regrole AND inherit_option AND set_option")
if [[ $m != 1 ]]; then
  echo "mirroring staging: GRANT the six payment_v2 roles TO postgres WITH INHERIT TRUE, SET TRUE (isolated container only)"
  adm "GRANT payment_v2_owner,payment_v2_issuer,payment_v2_verifier,payment_v2_settler,payment_v2_executor,payment_v2_notifier TO postgres WITH INHERIT TRUE, SET TRUE GRANTED BY supabase_admin" >/dev/null || fail "role mirror"
fi

for db in flexsoar_payment_v2_test flexsoar_082_pre flexsoar_082_pre081; do adm "DROP DATABASE IF EXISTS $db" >/dev/null; done
adm "CREATE DATABASE flexsoar_082_pre081 TEMPLATE $SRC OWNER postgres" >/dev/null || fail "pre081 copy"
mig flexsoar_082_pre081 079_review_approval_is_not_authentication.sql pre_079 || fail "079"
mig flexsoar_082_pre081 080_post_079_cleanup.sql pre_080 || fail "080"
adm "CREATE DATABASE flexsoar_082_pre TEMPLATE flexsoar_082_pre081 OWNER postgres" >/dev/null || fail "pre copy"
mig flexsoar_082_pre 081_revoke_public_set_card_visibility.sql pre_081 || fail "081"
mig flexsoar_082_pre 081b_retire_prelaunch_test_item.sql pre_081b || fail "081b"

rc_all=0
expect_refused(){ local label=$1 want=$2
  mig flexsoar_payment_v2_test 082_payment_v2_solo_operator_mode.sql "$label"; local rc=$?
  if [[ $rc == 3 ]] && grep -q "$want" "$OUT/$label.log"; then echo "   PASS 082 refused: $want"; else echo "   FAIL 082 not refused as expected ($label)"; rc_all=1; fi
  [[ $(adm "SELECT to_regclass('payment_v2.governance_mode') IS NULL" flexsoar_payment_v2_test) == t ]] && echo "   PASS nothing created" || { echo "   FAIL objects left behind"; rc_all=1; }; }

fresh flexsoar_082_pre081; expect_refused refuse_without_081 '081 is not applied'
fresh flexsoar_082_pre
adm "INSERT INTO payment_v2.networks(id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units)
 SELECT gen_random_uuid(),k,k,k,k,k,k,k,k,1,'MY-USDC-ESCROW-1',true,1,1 FROM (SELECT sha256(convert_to('t082-synthetic-network','UTF8')) k) s" flexsoar_payment_v2_test >/dev/null || fail "synthetic network"
expect_refused refuse_funding_enabled 'funding must be disabled on every network'

fresh flexsoar_082_pre
mig flexsoar_payment_v2_test 082_payment_v2_solo_operator_mode.sql apply_082 || fail "082"
mig flexsoar_payment_v2_test 082_payment_v2_solo_operator_mode.sql reapply_082; rc=$?
if [[ $rc == 3 ]] && grep -q 'is not the expected body' "$OUT/reapply_082.log"; then echo "   PASS re-run refused by preguard"; else echo "   FAIL re-run not refused"; rc_all=1; fi
[[ $(adm "SELECT count(*) FROM payment_v2.configuration_history WHERE entity='governance_mode'" flexsoar_payment_v2_test) == 1 ]] && echo "   PASS refused re-run left one audited mode row" || { echo "   FAIL audit rows"; rc_all=1; }
t83 suite_83 && grep -q '^T083|SUITE_PASS$' "$OUT/suite_83.log" || { echo "   FAIL suite 83"; rc_all=1; }
[[ $(grep -c 'T083|PASS' "$OUT/suite_83.log") == 18 ]] && echo "   PASS 18 stages" || { echo "   FAIL stage count"; rc_all=1; }
adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null
[[ $rc_all == 0 ]] && echo T082_RUN_PASS || echo T082_RUN_FAIL; exit $rc_all
