#!/usr/bin/env bash
# 084 isolated replay: source database is the preserved 078 replay, all derived databases stay in this one container.
#   bash tests/payment-db/run_084_container.sh <container-id> <db-at-078> <out-dir>
set -u
C=${1:?container}; SRC=${2:?source db}; OUT=${3:?out dir}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
mkdir -p "$OUT"; exec > >(tee "$OUT/run.log") 2>&1
fail(){ echo "T084_RUN_STOP: $*"; exit 1; }

iso=$(docker inspect "$C" --format '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Privileged}}|{{.State.Running}}') || fail inspect
[[ $iso == 'none|{}|false|true' ]] || fail "container isolation is wrong: $iso"
links=$(docker exec "$C" ip -o link | wc -l)
[[ $links == 1 ]] || fail "container has $links network interfaces, expected loopback only"

T=/tmp/t084; docker exec "$C" sh -c "rm -rf $T && mkdir -p $T"
for f in 00_target_guard.sql 01_fixtures.sql 83_solo_mode.sql 88_seller_listing_floor.sql 89_wallet_enrollment_views.sql; do
 docker cp "$HERE/$f" "$C:$T/$f" >/dev/null || fail "copy $f"
done
for f in 079_review_approval_is_not_authentication.sql 080_post_079_cleanup.sql 081_revoke_public_set_card_visibility.sql 081b_retire_prelaunch_test_item.sql 082_payment_v2_solo_operator_mode.sql 083_payment_v2_seller_listing_floor.sql 084_payment_v2_wallet_enrollment_and_views.sql; do
 [[ $(tr -cd '\r' < "$REPO/supabase/migrations/$f" | wc -c) == 0 ]] || fail "CR in $f"
 docker cp "$REPO/supabase/migrations/$f" "$C:$T/$f" >/dev/null || fail "copy $f"
 echo "sha256 $(sha256sum "$REPO/supabase/migrations/$f" | cut -c1-64) $f"
done

adm(){ docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d "${2:-postgres}" -Atc "$1"; }
mig(){ local db=$1 f=$2 label=$3; docker exec "$C" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$db" -f "$T/$f" > "$OUT/$label.log" 2>&1; local rc=$?
 echo "== $label rc=$rc $(grep -E 'ERROR|NOTICE|COMMIT|ROLLBACK' "$OUT/$label.log" | sed 's/^psql:[^ ]* //' | tr '\n' ' ')"; return $rc; }
fresh(){ adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null && adm "CREATE DATABASE flexsoar_payment_v2_test TEMPLATE $1 OWNER postgres" >/dev/null || fail "fresh copy from $1"; }
suite(){ local label=$1 file=$2; docker exec -e PGOPTIONS='-c payment_v2.test_identity=synthetic-payment-v2-only' "$C" \
 psql -X -v ON_ERROR_STOP=1 -v payment_v2_test_ack=ISOLATED_SYNTHETIC_ONLY -h 127.0.0.1 -U supabase_admin -d flexsoar_payment_v2_test \
 -At -f "$T/$file" > "$OUT/$label.log" 2>&1; local rc=$?
 echo "== $label rc=$rc"; grep -E 'T08[389]|ERROR' "$OUT/$label.log" | sed 's/^psql:[^ ]* //;s/^NOTICE: *//;s/^/   /'; return $rc; }

[[ $(adm "SELECT to_regprocedure('public.fn_payment_v2_reconcile_event(uuid)') IS NOT NULL AND to_regclass('payment_v2.governance_mode') IS NULL" "$SRC") == t ]] || fail "source is not the expected 078 base"
[[ $(adm "SELECT count(*) FROM pg_auth_members WHERE member='postgres'::regrole AND roleid='payment_v2_owner'::regrole AND inherit_option AND set_option") == 1 ]] || fail "postgres lacks the required owner membership"
for db in flexsoar_payment_v2_test flexsoar_084_pre flexsoar_084_pre81b flexsoar_084_pre81 flexsoar_084_pre79; do adm "DROP DATABASE IF EXISTS $db" >/dev/null; done

# Build a fresh historical continuation without altering the preserved source database.
adm "CREATE DATABASE flexsoar_084_pre79 TEMPLATE $SRC OWNER postgres" >/dev/null || fail pre79
mig flexsoar_084_pre79 079_review_approval_is_not_authentication.sql apply_079 || fail 079
mig flexsoar_084_pre79 080_post_079_cleanup.sql apply_080 || fail 080
adm "CREATE DATABASE flexsoar_084_pre81 TEMPLATE flexsoar_084_pre79 OWNER postgres" >/dev/null || fail pre81
mig flexsoar_084_pre81 081_revoke_public_set_card_visibility.sql apply_081 || fail 081
mig flexsoar_084_pre81 081b_retire_prelaunch_test_item.sql apply_081b || fail 081b
adm "CREATE DATABASE flexsoar_084_pre81b TEMPLATE flexsoar_084_pre81 OWNER postgres" >/dev/null || fail pre81b
mig flexsoar_084_pre81b 082_payment_v2_solo_operator_mode.sql apply_082 || fail 082
mig flexsoar_084_pre81b 083_payment_v2_seller_listing_floor.sql apply_083 || fail 083

# Assert the funding-on refusal in a fresh copy and prove transaction rollback.
fresh flexsoar_084_pre81b
adm "INSERT INTO payment_v2.networks(id,genesis,program,config,mint,token_program,treasury,treasury_token,issuer,authority_epoch,policy_version,funding_enabled,max_trade_units,max_escrow_units)
 SELECT gen_random_uuid(),k,k,k,k,k,k,k,k,1,'MY-USDC-ESCROW-1',true,1,1 FROM (SELECT sha256(convert_to('t084-synthetic-network','UTF8')) k) s" flexsoar_payment_v2_test >/dev/null || fail funding_fixture
mig flexsoar_payment_v2_test 084_payment_v2_wallet_enrollment_and_views.sql refuse_funding; rc=$?
if [[ $rc != 3 ]] || ! grep -q '084: funding must be disabled on every network' "$OUT/refuse_funding.log"; then fail "funding-on preguard not refused"; fi
[[ $(adm "SELECT to_regprocedure('public.fn_payment_v2_enroll_wallet(uuid,uuid,bytea,bytea,bytea)') IS NULL" flexsoar_payment_v2_test) == t ]] || fail "refused migration left objects"

fresh flexsoar_084_pre81b
mig flexsoar_payment_v2_test 084_payment_v2_wallet_enrollment_and_views.sql apply_084 || fail 084
mig flexsoar_payment_v2_test 084_payment_v2_wallet_enrollment_and_views.sql refuse_reapply; rc=$?
if [[ $rc != 3 ]] || ! grep -q '084: one or more wallet/view RPCs already exist' "$OUT/refuse_reapply.log"; then fail "reapply preguard not refused"; fi

suite suite_83 83_solo_mode.sql && grep -q '^T083|SUITE_PASS$' "$OUT/suite_83.log" && [[ $(grep -c 'T083|PASS' "$OUT/suite_83.log") == 18 ]] || fail suite_83
suite suite_88 88_seller_listing_floor.sql && grep -q '^T088|SUITE_PASS$' "$OUT/suite_88.log" && [[ $(grep -c 'T088|PASS' "$OUT/suite_88.log") == 6 ]] || fail suite_88
suite suite_89 89_wallet_enrollment_views.sql && grep -q '^T089|SUITE_PASS$' "$OUT/suite_89.log" || fail suite_89
adm "DROP DATABASE IF EXISTS flexsoar_payment_v2_test" >/dev/null
echo T084_RUN_PASS
