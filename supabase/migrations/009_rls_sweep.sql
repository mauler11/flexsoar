-- ============================================================
-- FlexSoar — 009_rls_sweep.sql
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- 001 enabled RLS on five tables. Supabase grants anon and authenticated
-- full privileges on the public schema by default, so RLS is the ONLY
-- gate — every other table has been writable by anyone holding the anon
-- key, which ships in the client bundle by design.
--
-- Worst case: `update tier_bands set min_cents = 0 where tier = 5` makes
-- every subsequent mint Legendary. Second worst: inserting card_provenance
-- to forge an ownership history.
--
-- Also adds the fulfilment and catalog write paths track/admin is blocked
-- on (docs/handoff/admin.md).
--
-- Pattern throughout: enable RLS, then grant back only what a client
-- legitimately needs. SECURITY DEFINER functions and service-role are
-- unaffected — they bypass RLS entirely.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Reference data — readable by all, writable by nobody
-- ------------------------------------------------------------

alter table tier_bands enable row level security;
create policy tier_bands_read on tier_bands for select using (true);

alter table levels enable row level security;
create policy levels_read on levels for select using (true);

-- ------------------------------------------------------------
-- 2. Catalog — public read, admin write
-- ------------------------------------------------------------

alter table skus enable row level security;
create policy skus_read on skus for select using (true);
create policy skus_admin_write on skus for all
  using (fn_is_admin()) with check (fn_is_admin());

alter table sku_float_curve enable row level security;
create policy curve_read on sku_float_curve for select using (true);
create policy curve_admin_write on sku_float_curve for all
  using (fn_is_admin()) with check (fn_is_admin());

-- ------------------------------------------------------------
-- 3. Consignment — consignor sees their own, admin sees all
-- ------------------------------------------------------------

alter table consignments enable row level security;
create policy consignments_own_read on consignments for select
  using (consignor_id = fn_current_user_id());
create policy consignments_admin_read on consignments for select
  using (fn_is_admin());
create policy consignments_own_insert on consignments for insert
  with check (consignor_id = fn_current_user_id() and status = 'draft');

alter table consignment_events enable row level security;
create policy consignment_events_read on consignment_events for select
  using (
    fn_is_admin()
    or exists (
      select 1 from consignments c
      where c.id = consignment_id and c.consignor_id = fn_current_user_id()
    )
  );
-- No insert policy: only fn_advance_consignment writes here.

-- ------------------------------------------------------------
-- 4. Redemptions — owner sees their own, admin sees all
--    This is the read path app/admin/fulfilment was blocked on.
-- ------------------------------------------------------------

alter table redemptions enable row level security;
create policy redemptions_own_read on redemptions for select
  using (user_id = fn_current_user_id());
create policy redemptions_admin_read on redemptions for select
  using (fn_is_admin());
-- No insert/update policy: fn_redeem_card and fn_mark_shipped only.

-- ------------------------------------------------------------
-- 5. Provenance — public, because it is the point
-- ------------------------------------------------------------

alter table card_provenance enable row level security;
create policy provenance_read on card_provenance for select using (true);
-- No write policy: fn_mint_card and fn_purchase_card only. Without this,
-- anyone could forge an ownership chain through a top-level trader.

-- ------------------------------------------------------------
-- 6. Progression — self-read only, never client-writable
--    XP feeds rank_score -> level -> seller_fee_bps.
-- ------------------------------------------------------------

alter table xp_events enable row level security;
create policy xp_own_read on xp_events for select
  using (user_id = fn_current_user_id());

alter table level_snapshots enable row level security;
create policy level_snapshots_own_read on level_snapshots for select
  using (user_id = fn_current_user_id());

alter table subscriptions enable row level security;
create policy subscriptions_own_read on subscriptions for select
  using (user_id = fn_current_user_id());

alter table referrals enable row level security;
create policy referrals_own_read on referrals for select
  using (referrer_id = fn_current_user_id() or referee_id = fn_current_user_id());

-- ------------------------------------------------------------
-- 7. Watchlists — users own theirs outright
-- ------------------------------------------------------------

alter table watchlists enable row level security;
create policy watchlists_own_all on watchlists for all
  using (user_id = fn_current_user_id())
  with check (user_id = fn_current_user_id());

-- ------------------------------------------------------------
-- 8. Fulfilment write path
-- ------------------------------------------------------------

create or replace function fn_mark_shipped(
  p_redemption_id uuid, p_carrier text, p_tracking text)
returns void language plpgsql security definer as $$
declare v_red redemptions%rowtype;
begin
  perform fn_require_admin();

  select * into v_red from redemptions where id = p_redemption_id for update;
  if not found then raise exception 'redemption % not found', p_redemption_id; end if;
  if v_red.status = 'shipped' then
    raise exception 'redemption % is already shipped', p_redemption_id;
  end if;

  update redemptions set
    status          = 'shipped',
    carrier         = p_carrier,
    tracking_number = p_tracking,
    shipped_at      = now()
  where id = p_redemption_id;

  update items set status = 'shipped' where id = v_red.item_id;
end $$;

grant execute on function fn_mark_shipped(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 9. Sanity check — run this after and expect zero rows
-- ------------------------------------------------------------
-- select tablename from pg_tables t
--  where schemaname = 'public'
--    and not exists (
--      select 1 from pg_class c
--      where c.relname = t.tablename and c.relrowsecurity
--    );
