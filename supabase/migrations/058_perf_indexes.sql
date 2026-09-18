-- 058_perf_indexes.sql — hot-path indexes missing from 001..057
create index if not exists orders_listing_id_idx on public.orders (listing_id);
create index if not exists orders_card_id_idx on public.orders (card_id);
create index if not exists orders_txn_id_idx on public.orders (txn_id);
create index if not exists ledger_entries_platform_asset_idx on public.ledger_entries (is_platform, asset);
create index if not exists redemptions_user_id_idx on public.redemptions (user_id, requested_at desc);
create index if not exists items_consignment_id_idx on public.items (consignment_id, created_at);
create index if not exists consignments_consignor_id_idx on public.consignments (consignor_id);
create index if not exists consignment_events_consignment_id_idx on public.consignment_events (consignment_id);
create index if not exists items_status_created_idx on public.items (status, created_at);
create index if not exists listings_status_price_idx on public.listings (status, price_cents);
create index if not exists trade_offers_open_offered_idx on public.trade_offers (offered_card_id) where status = 'open';
create index if not exists trade_offers_open_requested_idx on public.trade_offers (requested_card_id) where status = 'open';
create index if not exists vault_intakes_card_id_idx on public.vault_intakes (card_id);
create index if not exists credit_holds_offer_id_idx on public.credit_holds (offer_id);
create index if not exists credit_holds_order_id_idx on public.credit_holds (order_id);