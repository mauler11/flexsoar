#!/usr/bin/env bash
# 081 (fn_set_card_visibility EXECUTE) container run. Host side (WSL), drives ONE existing isolated container with docker exec.
#   bash tests/payment-db/run_081_container.sh <container-id> <source-db-at-078> <out-dir>
# Refuses unless the container has NetworkMode none, no port bindings, is not privileged, and only loopback inside.
# Never touches <source-db-at-078>: it is only a CREATE DATABASE template. Builds flexsoar_081_pre080 (078+079) and
# flexsoar_081_base (078+079+080), then fresh flexsoar_payment_v2_test copies (the name 00_target_guard.sql requires).
# Migrations run as postgres (as on Supabase); tests as supabase_admin with the 00_target_guard marker.
set -u
C=${1:?container}; SRC=${2:?source db}; OUT=${3:?out dir}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
mkdir -p "$OUT"; exec > >(tee "$OUT/run.log") 2>&1
fail(){ echo "T081_RUN_STOP: $*"; exit 1; }

iso=$(docker inspect "$C" --format '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{.State.Running}}') || fail "inspect"
echo "isolation: $iso"
[[ $iso == 'none|{}|false|true' ]] || fail "container is not network-none/no-ports/unprivileged/running"
lo=$(docker exec "$C" sh -c "ip -o addr | awk '{print \$2}' | sort -u | tr '\n' ' '")
[[ $lo == 'lo ' ]] || fail "interfaces other than lo: $lo"

T=/tmp/t081; docker exec "$C" sh -c "rm -rf $T && mkdir -p $T"
for f in 00_target_guard.sql 84_card_visibility_acl.sql; do docker cp "$HERE/$f" "$C:$T/$f" >/dev/null; done
for f in 079_review_approval_is_not_authentication.sql 080_post_079_cleanup.sql 081_revoke_public_set_card_visibility.sql; do
  [[ $(tr -cd '\r' < "$REPO/supabase/migrations/$f" | wc -c) == 0 ]] || fail "CR in $f"
  docker cp "$REPO/supabase/migrations/$f" "$C:$T/$f" >/dev/null
  echo "sha256 $(sha256sum "$REPO/supabase/migrations/$f" | cut -c1-64) $f"
done

adm(){ docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d postgres -Atc "$1"; }
mig(){ local db=$1 f=$2 label=$3; docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$db" -f "$T/$f" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc $(grep -E 'ERROR|NOTICE|COMMIT|ROLLBACK' "$OUT/$label.log" | sed 's/^psql:[^ ]* //' | tr '\n' ' ')"; return $rc; }
tst(){ local label=$1; shift; docker exec -e PGOPTIONS='-c payment_v2.test_identity=synthetic-payment-v2-only' "$C" \
  psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY "$@" -h 127.0.0.1 -U supabase_admin -d flexsoar_payment_v2_test \
  -At -f "$T/84_card_visibility_acl.sql" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc"; grep -E '^(ACL|PROBE|PASS)|T084|ERROR' "$OUT/$label.log" | sed 's/^/   /'; return $rc; }
fresh(){ adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null && adm "CREATE DATABASE flexsoar_payment_v2_test TEMPLATE $1 OWNER postgres" >/dev/null || fail "fresh db"; }

for db in flexsoar_payment_v2_test flexsoar_081_base flexsoar_081_pre080; do adm "DROP DATABASE IF EXISTS $db" >/dev/null; done
adm "CREATE DATABASE flexsoar_081_pre080 TEMPLATE $SRC OWNER postgres" >/dev/null || fail "pre080 copy"
mig flexsoar_081_pre080 079_review_approval_is_not_authentication.sql pre080_079 || fail "079"
adm "CREATE DATABASE flexsoar_081_base TEMPLATE flexsoar_081_pre080 OWNER postgres" >/dev/null || fail "base copy"
mig flexsoar_081_base 080_post_079_cleanup.sql base_080 || fail "080"

rc_all=0
# Negative: 081 on a database without 080 is refused atomically.
fresh flexsoar_081_pre080
mig flexsoar_payment_v2_test 081_revoke_public_set_card_visibility.sql apply_081_without_080; rc=$?
if [[ $rc == 3 ]] && grep -q '080 is not applied' "$OUT/apply_081_without_080.log"; then echo "   PASS 081 refused without 080"; else echo "   FAIL 081 not refused without 080"; rc_all=1; fi
tst unchanged_without_080 -v phase=before || rc_all=1

# Main: before, apply, after, re-run refused, after again identical.
fresh flexsoar_081_base
tst before -v phase=before || rc_all=1
mig flexsoar_payment_v2_test 081_revoke_public_set_card_visibility.sql apply_081 || fail "081"
tst after -v phase=after || rc_all=1
mig flexsoar_payment_v2_test 081_revoke_public_set_card_visibility.sql reapply_081; rc=$?
if [[ $rc == 3 ]] && grep -q 'no longer grants EXECUTE to PUBLIC' "$OUT/reapply_081.log"; then echo "   PASS re-run refused by preguard"; else echo "   FAIL re-run not refused"; rc_all=1; fi
tst after_rerun -v phase=after || rc_all=1
if diff <(grep -E '^(ACL|PROBE|PASS)' "$OUT/after.log") <(grep -E '^(ACL|PROBE|PASS)' "$OUT/after_rerun.log") >/dev/null; then
  echo "   PASS state identical after the refused re-run"; else echo "   FAIL state differs after re-run"; rc_all=1; fi
adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null
[[ $rc_all == 0 ]] && echo T081_RUN_PASS || echo T081_RUN_FAIL; exit $rc_all
