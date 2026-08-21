-- 022_drop_legacy_settlement.sql
--
-- RUN 018 THROUGH 021 FIRST.
--
-- 019c added p_credit_cents to fn_purchase_card and fn_purchase_card_core with
-- CREATE OR REPLACE. Postgres keys functions on name plus argument types, so a
-- different arity is a new overload, not a replacement. The original
-- three-argument bodies from 002/017 survived.
--
-- That is not merely untidy. Postgres resolves an exact-arity match ahead of
-- filling defaults, so every three-argument call - which is what the Stripe
-- webhook makes - has been silently routing to the pre-019c body: the one with
-- the inverted payout_method = 'credit' guard, no split settlement, and no
-- identity check on the FSC leg. Four- and five-argument callers got the new
-- code. Two settlement paths, chosen by argument count.
--
-- Drop the old pair. The five-argument versions from 021 are the only ones
-- left, and a three-argument call now binds to them by default-filling, which
-- is the intended behaviour.
--
-- Safe to re-run.

begin;

drop function if exists fn_purchase_card(uuid, uuid, text);
drop function if exists fn_purchase_card_core(uuid, uuid, text);

-- Anything that slipped through as a four-argument overload as well.
drop function if exists fn_purchase_card(uuid, uuid, text, bigint);
drop function if exists fn_purchase_card_core(uuid, uuid, text, bigint);


-- Fail loudly rather than leaving an ambiguous call surface behind.
do $$
declare
  v_card integer;
  v_core integer;
begin
  select count(*) into v_card
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_purchase_card';

  select count(*) into v_core
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_purchase_card_core';

  if v_card <> 1 then
    raise exception 'expected exactly 1 fn_purchase_card, found %', v_card;
  end if;
  if v_core <> 1 then
    raise exception 'expected exactly 1 fn_purchase_card_core, found %', v_core;
  end if;
end $$;


-- Grants do not survive a drop of the overload they were attached to; the
-- five-argument grants from 021 are unaffected, but re-assert them so this
-- file is self-sufficient if replayed out of order.
grant  execute on function fn_purchase_card(uuid, uuid, text, bigint, uuid) to authenticated;
revoke execute on function fn_purchase_card_core(uuid, uuid, text, bigint, uuid) from anon;
revoke execute on function fn_purchase_card_core(uuid, uuid, text, bigint, uuid) from authenticated;

comment on function fn_purchase_card(uuid, uuid, text, bigint, uuid) is
  'The only settlement entry point. Do not add an overload: an arity variant '
  'wins over default-filling, so a second signature silently becomes a second '
  'settlement path. Extend by adding defaulted parameters AND dropping the '
  'previous arity in the same migration.';

commit;
