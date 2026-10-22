#!/usr/bin/env bash
# 080 (post-079 cleanup) container run. Host side (WSL), drives ONE existing isolated container with docker exec.
#   bash tests/payment-db/run_080_container.sh <container-id> <source-db-at-078> <out-dir>
# Refuses unless the container has NetworkMode none, no port bindings, is not privileged, and only loopback inside.
# Never touches <source-db-at-078>: it is only a CREATE DATABASE template. Creates flexsoar_080_base (078 + 079) and,
# per scenario, a fresh flexsoar_payment_v2_test copied from it (the name 00_target_guard.sql requires).
# Migrations run as postgres (as on Supabase); tests as supabase_admin with the 00_target_guard marker.
# Scenarios: nonadmin, enrolled (080 must refuse atomically), main (080 applies; 81 asserts; a re-run is refused).
set -u
C=${1:?container}; SRC=${2:?source db}; OUT=${3:?out dir}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
mkdir -p "$OUT"; exec > >(tee "$OUT/run.log") 2>&1
fail(){ echo "T080_RUN_STOP: $*"; exit 1; }

iso=$(docker inspect "$C" --format '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{.State.Running}}') || fail "inspect"
echo "isolation: $iso"
[[ $iso == 'none|{}|false|true' ]] || fail "container is not network-none/no-ports/unprivileged/running"
lo=$(docker exec "$C" sh -c "ip -o addr | awk '{print \$2}' | sort -u | tr '\n' ' '")
[[ $lo == 'lo ' ]] || fail "interfaces other than lo: $lo"

T=/tmp/t080; docker exec "$C" sh -c "rm -rf $T && mkdir -p $T"
for f in 00_target_guard.sql 80_cleanup_setup.sql 81_cleanup_assert.sql 82_cleanup_refused_unchanged.sql; do docker cp "$HERE/$f" "$C:$T/$f" >/dev/null; done
for f in 079_review_approval_is_not_authentication.sql 080_post_079_cleanup.sql; do
  [[ $(tr -cd '\r' < "$REPO/supabase/migrations/$f" | wc -c) == 0 ]] || fail "CR in $f"
  docker cp "$REPO/supabase/migrations/$f" "$C:$T/$f" >/dev/null
  echo "sha256 $(sha256sum "$REPO/supabase/migrations/$f" | cut -c1-64) $f"
done

adm(){ docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d postgres -Atc "$1"; }
mig(){ local db=$1 f=$2 label=$3; docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$db" -f "$T/$f" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc $(grep -E 'ERROR|NOTICE|COMMIT|ROLLBACK' "$OUT/$label.log" | sed 's/^psql:[^ ]* //' | tr '\n' ' ')"; return $rc; }
tst(){ local f=$1 label=$2; shift 2; docker exec -e PGOPTIONS='-c payment_v2.test_identity=synthetic-payment-v2-only' "$C" \
  psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY "$@" -h 127.0.0.1 -U supabase_admin -d flexsoar_payment_v2_test \
  -At -f "$T/$f" > "$OUT/$label.log" 2>&1; local rc=$?
  echo "== $label rc=$rc"; grep -E '^(BEFORE|AFTER|REFUSED)\||T080|ERROR' "$OUT/$label.log" | sed 's/^/   /'; return $rc; }
fresh(){ adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null && adm "CREATE DATABASE flexsoar_payment_v2_test TEMPLATE flexsoar_080_base OWNER postgres" >/dev/null || fail "fresh db"; }

adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null; adm "DROP DATABASE IF EXISTS flexsoar_080_base" >/dev/null
adm "CREATE DATABASE flexsoar_080_base TEMPLATE $SRC OWNER postgres" >/dev/null || fail "base copy"
mig flexsoar_080_base 079_review_approval_is_not_authentication.sql base_079 || fail "079 on base"

rc_all=0
for sc in nonadmin enrolled; do
  fresh
  tst 80_cleanup_setup.sql "setup_$sc" -v scenario=$sc || fail "setup $sc"
  mig flexsoar_payment_v2_test 080_post_079_cleanup.sql "apply_080_$sc"; rc=$?
  want=$([[ $sc == nonadmin ]] && echo 'stamped by a non-admin user' || echo 'enrolled in payment_v2.inventory')
  if [[ $rc == 3 ]] && grep -q "$want" "$OUT/apply_080_$sc.log"; then echo "   PASS 080 refused ($want)"; else echo "   FAIL 080 not refused as expected"; rc_all=1; fi
  tst 82_cleanup_refused_unchanged.sql "unchanged_$sc" || rc_all=1
done

fresh
tst 80_cleanup_setup.sql setup_main -v scenario=main || fail "setup main"
tst 82_cleanup_refused_unchanged.sql unchanged_main_before_080 || rc_all=1
mig flexsoar_payment_v2_test 080_post_079_cleanup.sql apply_080_main || fail "080 main"
grep -q 'moved 2 seller-review stamp' "$OUT/apply_080_main.log" && echo "   PASS NOTICE moved 2" || { echo "   FAIL moved-count NOTICE"; rc_all=1; }
tst 81_cleanup_assert.sql assert_main || rc_all=1
mig flexsoar_payment_v2_test 080_post_079_cleanup.sql reapply_080_main; rc=$?
if [[ $rc == 3 ]] && grep -q 'already carries the 080 fragment' "$OUT/reapply_080_main.log"; then echo "   PASS re-run refused by preguard"; else echo "   FAIL re-run not refused"; rc_all=1; fi
tst 81_cleanup_assert.sql assert_main_after_rerun || rc_all=1
if diff <(grep -E '^(PASS|AFTER)' "$OUT/assert_main.log") <(grep -E '^(PASS|AFTER)' "$OUT/assert_main_after_rerun.log") >/dev/null; then
  echo "   PASS state identical after the refused re-run ($(grep -cE '^PASS' "$OUT/assert_main.log") PASS lines)"; else echo "   FAIL state differs after re-run"; rc_all=1; fi
[[ $rc_all == 0 ]] && echo T080_RUN_PASS || echo T080_RUN_FAIL; exit $rc_all
