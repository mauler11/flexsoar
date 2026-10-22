#!/usr/bin/env bash
# 083 (seller-signed listing floor) container run. Host side (WSL or Git Bash with MSYS_NO_PATHCONV=1), drives ONE existing
# isolated container. Same shape and same isolation rules as run_082_container.sh.
#   bash tests/payment-db/run_083_container.sh <container-id> <db-with-078..081b-applied> <out-dir>
# Refuses unless the container has NetworkMode none, no port bindings, is not privileged, and only loopback inside.
# Never touches <source-db>. Builds flexsoar_083_pre (source + 082), then a fresh flexsoar_payment_v2_test per scenario.
# Migrations run as postgres (SET+INHERIT member of the six payment_v2 roles, as on staging/production); the suites run as
# supabase_admin behind the 00_target_guard marker.
set -u
C=${1:?container}; SRC=${2:?source db}; OUT=${3:?out dir}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
mkdir -p "$OUT"; exec > >(tee "$OUT/run.log") 2>&1
fail(){ echo "T083_RUN_STOP: $*"; exit 1; }

iso=$(docker inspect "$C" --format '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{.State.Running}}') || fail "inspect"
echo "isolation: $iso"
[[ $iso == 'none|{}|false|true' ]] || fail "container is not network-none/no-ports/unprivileged/running"
lo=$(docker exec "$C" sh -c "ip -o addr | awk '{print \$2}' | sort -u | tr '\n' ' '")
[[ $lo == 'lo ' ]] || fail "interfaces other than lo: $lo"

T=/tmp/t083; docker exec "$C" sh -c "rm -rf $T && mkdir -p $T"
for f in 00_target_guard.sql 01_fixtures.sql 83_solo_mode.sql 88_seller_listing_floor.sql 10_contracts.sql 02_attestation_fixture.sql; do docker cp "$HERE/$f" "$C:$T/$f" >/dev/null; done
for f in 082_payment_v2_solo_operator_mode.sql 083_payment_v2_seller_listing_floor.sql; do
  [[ $(tr -cd '\r' < "$REPO/supabase/migrations/$f" | wc -c) == 0 ]] || fail "CR in $f"
  docker cp "$REPO/supabase/migrations/$f" "$C:$T/$f" >/dev/null
  echo "sha256 $(sha256sum "$REPO/supabase/migrations/$f" | cut -c1-64) $f"
done

adm(){ docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "${2:-postgres}" -Atc "$1"; }
mig(){ local db=$1 f=$2 label=$3; docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$db" -f "$T/$f" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc $(grep -E 'ERROR|NOTICE|COMMIT|ROLLBACK' "$OUT/$label.log" | sed 's/^psql:[^ ]* //' | tr '\n' ' ')"; return $rc; }
fresh(){ adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null && adm "CREATE DATABASE flexsoar_payment_v2_test TEMPLATE $1 OWNER postgres" >/dev/null || fail "fresh db"; }
suite(){ local label=$1 file=$2; docker exec -e PGOPTIONS='-c payment_v2.test_identity=synthetic-payment-v2-only' "$C" \
  psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -h 127.0.0.1 -U supabase_admin -d flexsoar_payment_v2_test \
  -At -f "$T/$file" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc"; grep -E 'T08[38]|ERROR' "$OUT/$label.log" | sed 's/^psql:[^ ]* //;s/^NOTICE: *//;s/^/   /'; return $rc; }

m=$(adm "SELECT count(*) FROM pg_auth_members WHERE member='postgres'::regrole AND roleid='payment_v2_owner'::regrole AND inherit_option AND set_option")
[[ $m == 1 ]] || fail "postgres is not a SET+INHERIT member of payment_v2_owner in this container (run_082_container.sh mirrors that first)"

for db in flexsoar_payment_v2_test flexsoar_083_pre flexsoar_083_pre082; do adm "DROP DATABASE IF EXISTS $db" >/dev/null; done
adm "CREATE DATABASE flexsoar_083_pre082 TEMPLATE $SRC OWNER postgres" >/dev/null || fail "source copy"
adm "CREATE DATABASE flexsoar_083_pre TEMPLATE flexsoar_083_pre082 OWNER postgres" >/dev/null || fail "pre copy"
mig flexsoar_083_pre 082_payment_v2_solo_operator_mode.sql pre_082 || fail "082"

rc_all=0
expect_refused(){ local label=$1 want=$2
  mig flexsoar_payment_v2_test 083_payment_v2_seller_listing_floor.sql "$label"; local rc=$?
  if [[ $rc == 3 ]] && grep -q "$want" "$OUT/$label.log"; then echo "   PASS 083 refused: $want"; else echo "   FAIL 083 not refused as expected ($label)"; rc_all=1; fi
  [[ $(adm "SELECT to_regclass('payment_v2.sale_listings') IS NULL" flexsoar_payment_v2_test) == t ]] && echo "   PASS nothing created" || { echo "   FAIL objects left behind"; rc_all=1; }; }

fresh flexsoar_083_pre082; expect_refused refuse_without_082 '082 is not applied'
fresh flexsoar_083_pre
adm "INSERT INTO payment_v2.networks(id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units)
 SELECT gen_random_uuid(),k,k,k,k,k,k,k,k,1,'MY-USDC-ESCROW-1',true,1,1 FROM (SELECT sha256(convert_to('t083-synthetic-network','UTF8')) k) s" flexsoar_payment_v2_test >/dev/null || fail "synthetic network"
expect_refused refuse_funding_enabled 'funding must be disabled on every network'

fresh flexsoar_083_pre
mig flexsoar_payment_v2_test 083_payment_v2_seller_listing_floor.sql apply_083 || fail "083"
mig flexsoar_payment_v2_test 083_payment_v2_seller_listing_floor.sql reapply_083; rc=$?
if [[ $rc == 3 ]] && grep -q 'seller-listing objects already exist' "$OUT/reapply_083.log"; then echo "   PASS re-run refused by preguard"; else echo "   FAIL re-run not refused"; rc_all=1; fi
[[ $(adm "SELECT count(*) FROM payment_v2.configuration_history WHERE entity='listing_policy'" flexsoar_payment_v2_test) == 1 ]] && echo "   PASS refused re-run left one audited policy row" || { echo "   FAIL audit rows"; rc_all=1; }
suite suite_88 88_seller_listing_floor.sql && grep -q '^T088|SUITE_PASS$' "$OUT/suite_88.log" || { echo "   FAIL suite 88"; rc_all=1; }
[[ $(grep -c 'T088|PASS' "$OUT/suite_88.log") == 6 ]] && echo "   PASS 6 stages" || { echo "   FAIL stage count"; rc_all=1; }
# Regression: the two existing suites that exercise the attempt/authorize path and the 082 rules run unchanged on top of 083.
suite suite_83 83_solo_mode.sql && grep -q '^T083|SUITE_PASS$' "$OUT/suite_83.log" || { echo "   FAIL suite 83 on top of 083"; rc_all=1; }
[[ $(grep -c 'T083|PASS' "$OUT/suite_83.log") == 18 ]] && echo "   PASS suite 83 still 18 stages" || { echo "   FAIL suite 83 stage count"; rc_all=1; }
adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null
[[ $rc_all == 0 ]] && echo T083_RUN_PASS || echo T083_RUN_FAIL; exit $rc_all
