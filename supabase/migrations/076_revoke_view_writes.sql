-- 076: founder-applied to the CLOUD in the Supabase SQL editor on 2026-10-21 (urgent).
-- public_profiles is an auto-updatable view running with owner rights; anon/authenticated held
-- INSERT/UPDATE/DELETE, bypassing users RLS. App only reads it. Same for items_proof_overdue.
revoke insert, update, delete, truncate, references, trigger
  on public.public_profiles, public.items_proof_overdue
  from public, anon, authenticated;
do $$ begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.public_profiles, public.items_proof_overdue from public, anon, authenticated';
  end if;
end $$;