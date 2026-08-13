-- 015_sku_art_guard.sql
--
-- Guards skus.art_url against silent overwrites.
--
-- Art is stored per SKU, so every card of a model+colourway renders the same
-- image. Changing art_url on a SKU that already has art therefore changes the
-- appearance of cards users already own. That must be a deliberate act, not a
-- side effect of an ordinary SKU update.
--
-- The rule:
--   null      -> value    allowed  (first art, the normal path)
--   value     -> same     allowed  (no-op)
--   value     -> other    blocked
--   value     -> null     blocked
--
-- Blocked transitions must go through fn_replace_sku_art(), which requires an
-- admin session. The trigger is not RLS, so it also stops service-role writes
-- and anything reaching the table outside lib/api/contract.ts.

-- ---------------------------------------------------------------------------
-- 1. The guard
-- ---------------------------------------------------------------------------

create or replace function fn_guard_sku_art_url()
returns trigger
language plpgsql
as $$
begin
  if old.art_url is not null
     and coalesce(current_setting('flexsoar.allow_art_replace', true), 'off') <> 'on'
  then
    raise exception
      using errcode = '42501',
            message = format(
              'sku %s already has art_url; replacement must go through fn_replace_sku_art()',
              old.id
            );
  end if;

  return new;
end;
$$;

comment on function fn_guard_sku_art_url() is
  'Blocks changes to a non-null skus.art_url unless flexsoar.allow_art_replace '
  'is set for the transaction. Only fn_replace_sku_art() sets it.';

drop trigger if exists trg_guard_sku_art_url on skus;

create trigger trg_guard_sku_art_url
  before update on skus
  for each row
  when (old.art_url is distinct from new.art_url)
  execute function fn_guard_sku_art_url();

-- ---------------------------------------------------------------------------
-- 2. The sanctioned replacement path
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER on purpose: skus_admin_write (fn_is_admin() on USING and
-- WITH CHECK) stays in force, so RLS remains the guard exactly as it is for
-- upsertSku. fn_require_admin() is called for a clear error rather than a
-- silent zero-row update. Service-role has no auth.uid() and is refused.
--
-- Pass p_art_url => null to clear a SKU's art.

create or replace function fn_replace_sku_art(
  p_sku_id  uuid,
  p_art_url text
)
returns skus
language plpgsql
set search_path = public
as $$
declare
  v_row skus;
begin
  perform fn_require_admin();

  perform set_config('flexsoar.allow_art_replace', 'on', true);

  update skus
     set art_url = p_art_url
   where id = p_sku_id
  returning * into v_row;

  perform set_config('flexsoar.allow_art_replace', 'off', true);

  if v_row.id is null then
    raise exception
      using errcode = 'P0002',
            message = format('sku %s not found, or not yours to update', p_sku_id);
  end if;

  return v_row;
end;
$$;

comment on function fn_replace_sku_art(uuid, text) is
  'Deliberate replacement of a SKU''s pixel art. Admin session only. Changes '
  'the rendered art on every existing card of this SKU.';

revoke execute on function fn_replace_sku_art(uuid, text) from public, anon;
grant  execute on function fn_replace_sku_art(uuid, text) to authenticated;
