#!/usr/bin/env bash
# 081b (retire the pre-launch test item) container run. Host side (WSL), drives ONE existing isolated container.
#   bash tests/payment-db/run_081b_container.sh <container-id> <source-db-at-078> <out-dir>
# Refuses unless the container has NetworkMode none, no port bindings, is not privileged, and only loopback inside.
# Never touches <source-db-at-078>. Builds flexsoar_081b_pre081 (078+079+080) and flexsoar_081b_base (+081), then a fresh
# flexsoar_payment_v2_test per scenario. Migrations run as postgres; tests as supabase_admin with the 00_target_guard marker.
set -u
C=${1:?container}; SRC=${2:?source db}; OUT=${3:?out dir}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
mkdir -p "$OUT"; exec > >(tee "$OUT/run.log") 2>&1
fail(){ echo "T081B_RUN_STOP: $*"; exit 1; }

iso=$(docker inspect "$C" --format '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{.State.Running}}') || fail "inspect"
echo "isolation: $iso"
[[ $iso == 'none|{}|false|true' ]] || fail "container is not network-none/no-ports/unprivileged/running"
lo=$(docker exec "$C" sh -c "ip -o addr | awk '{print \$2}' | sort -u | tr '\n' ' '")
[[ $lo == 'lo ' ]] || fail "interfaces other than lo: $lo"

T=/tmp/t081b; docker exec "$C" sh -c "rm -rf $T && mkdir -p $T"
for f in 00_target_guard.sql 85_retire_test_item_setup.sql 86_retire_test_item_assert.sql 87_retire_test_item_unchanged.sql; do docker cp "$HERE/$f" "$C:$T/$f" >/dev/null; done
for f in 079_review_approval_is_not_authentication.sql 080_post_079_cleanup.sql 081_revoke_public_set_card_visibility.sql 081b_retire_prelaunch_test_item.sql; do
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
  echo "== $label rc=$rc"; grep -E '^(SETUP|CHANGED|UNCHANGED|PASS)|T08[567]|ERROR' "$OUT/$label.log" | sed 's/^/   /'; return $rc; }
fresh(){ adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null && adm "CREATE DATABASE flexsoar_payment_v2_test TEMPLATE $1 OWNER postgres" >/dev/null || fail "fresh db"; }

for db in flexsoar_payment_v2_test flexsoar_081b_base flexsoar_081b_pre081; do adm "DROP DATABASE IF EXISTS $db" >/dev/null; done
adm "CREATE DATABASE flexsoar_081b_pre081 TEMPLATE $SRC OWNER postgres" >/dev/null || fail "pre081 copy"
mig flexsoar_081b_pre081 079_review_approval_is_not_authentication.sql pre081_079 || fail "079"
mig flexsoar_081b_pre081 080_post_079_cleanup.sql pre081_080 || fail "080"
adm "CREATE DATABASE flexsoar_081b_base TEMPLATE flexsoar_081b_pre081 OWNER postgres" >/dev/null || fail "base copy"
mig flexsoar_081b_base 081_revoke_public_set_card_visibility.sql base_081 || fail "081"

rc_all=0
refused(){ local base=$1 variant=$2 want=$3
  fresh "$base"
  tst 85_retire_test_item_setup.sql "setup_$variant" -v variant=$variant || { echo "   FAIL setup $variant"; rc_all=1; return; }
  mig flexsoar_payment_v2_test 081b_retire_prelaunch_test_item.sql "apply_081b_$variant"; local rc=$?
  if [[ $rc == 3 ]] && grep -q "$want" "$OUT/apply_081b_$variant.log"; then echo "   PASS 081b refused ($variant): $want"; else echo "   FAIL 081b not refused as expected ($variant)"; rc_all=1; fi
  tst 87_retire_test_item_unchanged.sql "unchanged_$variant" || rc_all=1; }

refused flexsoar_081b_pre081 without_081 '081 is not applied'
refused flexsoar_081b_base intake_shipped 'vault intake state differs'
refused flexsoar_081b_base order_paid 'order state differs'
refused flexsoar_081b_base live_listing 'listing state differs'
refused flexsoar_081b_base card_active 'only card in pending_vault'
refused flexsoar_081b_base redemption 'redemption/trade/credit-hold/payment-v2 row'
refused flexsoar_081b_base not_reviewed 'is not in the expected state'
refused flexsoar_081b_base partial 'only 1 of the 5 named rows exist'

# Absent: none of the named rows (staging-like). 081b commits a no-op and every row stays identical.
fresh flexsoar_081b_base
tst 85_retire_test_item_setup.sql setup_absent -v variant=absent || { echo "   FAIL setup absent"; rc_all=1; }
mig flexsoar_payment_v2_test 081b_retire_prelaunch_test_item.sql apply_081b_absent; rc=$?
if [[ $rc == 0 ]] && grep -q 'all absent; nothing to retire' "$OUT/apply_081b_absent.log" && grep -q '^COMMIT' "$OUT/apply_081b_absent.log"; then echo "   PASS 081b no-op when the test item is absent"; else echo "   FAIL absent no-op"; rc_all=1; fi
tst 87_retire_test_item_unchanged.sql unchanged_absent || rc_all=1

fresh flexsoar_081b_base
tst 85_retire_test_item_setup.sql setup_main -v variant=main || fail "setup main"
tst 87_retire_test_item_unchanged.sql unchanged_main_before || rc_all=1
mig flexsoar_payment_v2_test 081b_retire_prelaunch_test_item.sql apply_081b_main || fail "081b main"
grep -q 'card retired (burned) and vault intake cancelled' "$OUT/apply_081b_main.log" && echo "   PASS NOTICE" || { echo "   FAIL NOTICE"; rc_all=1; }
tst 86_retire_test_item_assert.sql assert_main || rc_all=1
mig flexsoar_payment_v2_test 081b_retire_prelaunch_test_item.sql reapply_081b; rc=$?
if [[ $rc == 3 ]] && grep -q 'only card in pending_vault' "$OUT/reapply_081b.log"; then echo "   PASS re-run refused by preguard"; else echo "   FAIL re-run not refused"; rc_all=1; fi
tst 86_retire_test_item_assert.sql assert_main_after_rerun || rc_all=1
if diff <(grep -E '^(CHANGED|PASS)' "$OUT/assert_main.log") <(grep -E '^(CHANGED|PASS)' "$OUT/assert_main_after_rerun.log") >/dev/null; then
  echo "   PASS state identical after the refused re-run"; else echo "   FAIL state differs after re-run"; rc_all=1; fi
adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null
[[ $rc_all == 0 ]] && echo T081B_RUN_PASS || echo T081B_RUN_FAIL; exit $rc_all
