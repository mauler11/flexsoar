-- ============================================================
-- FlexSoar — 010_item_photos.sql
-- Run in the Supabase SQL editor, "Run without RLS".
-- ============================================================
-- items.photos has existed since 001 and nothing has ever been able to
-- write it: 009 gave items read policies but no UPDATE policy, and none
-- of the RPCs accept photos. So the grading bench's photo viewer has
-- never had anything to view, and the rubric's eight-shot requirement
-- was unenforceable.
--
-- Photos are grading evidence. They freeze at mint for the same reason
-- the float does (008): a card carries an immutable copy of the grade,
-- and evidence that can change afterwards is not evidence.
-- ============================================================

create or replace function fn_set_item_photos(
  p_item_id uuid, p_photos jsonb)
returns void language plpgsql security definer as $$
declare
  v_item items%rowtype;
  v_url  text;
begin
  perform fn_require_admin();

  if jsonb_typeof(p_photos) <> 'array' then
    raise exception 'photos must be a JSON array, got %', jsonb_typeof(p_photos);
  end if;

  if jsonb_array_length(p_photos) > 24 then
    raise exception 'at most 24 photos per item, got %',
      jsonb_array_length(p_photos);
  end if;

  -- Every element must be a plain https URL string. Blocks objects,
  -- nulls, and any attempt to smuggle a data: or javascript: URI into
  -- something the admin UI will render.
  for v_url in select jsonb_array_elements_text(p_photos) loop
    if v_url !~ '^https://[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]+$' then
      raise exception 'photo entries must be https URLs, got %', v_url;
    end if;
  end loop;

  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'item % not found', p_item_id; end if;

  if exists (select 1 from cards where item_id = p_item_id) then
    raise exception 'item % is minted; its grading evidence is frozen', p_item_id;
  end if;

  update items set photos = p_photos where id = p_item_id;
end $$;

grant execute on function fn_set_item_photos(uuid, jsonb) to authenticated;
