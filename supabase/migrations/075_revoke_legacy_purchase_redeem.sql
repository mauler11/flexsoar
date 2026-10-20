-- 075: founder-applied to the CLOUD project in the Supabase SQL editor on 2026-10-20 (emergency).
-- fn_purchase_card was SECURITY DEFINER and executable by authenticated, and its cash leg only
-- checked that settlement_ref was non-empty, so any signed-in user could take a listed card
-- through PostgREST. fn_redeem_card trusted a client-supplied fee. Idempotent: covers every overload.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fn_purchase_card','fn_purchase_card_core','fn_purchase_card_split','fn_redeem_card')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
    raise notice 'revoked %', r.f;
  end loop;
end $$;