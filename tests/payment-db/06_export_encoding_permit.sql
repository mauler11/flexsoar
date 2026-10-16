-- Real SQL authorize_attempt output with immutable source fields; fixtures roll back.
\ir 00_target_guard.sql
BEGIN;
\ir 01_fixtures.sql
CREATE TEMP TABLE encoding_fixture AS SELECT pg_temp.fixture(0::smallint) AS f;
SELECT jsonb_build_object('actual',encode(a.permit,'hex'),'model',jsonb_build_object(
'mode',s.mode,'domain',encode(n.genesis,'hex'),'program',encode(n.program,'hex'),'config',encode(n.config,'hex'),
'saleId',encode(s.sale_commitment,'hex'),'card',encode(v.card_commitment,'hex'),'pair',encode(v.pair_commitment,'hex'),
'attempt',encode(a.attempt_commitment,'hex'),'beneficiary',encode(a.beneficiary,'hex'),'policy',encode(p.digest,'hex'),
'buyer',encode(a.buyer_wallet,'hex'),'seller',encode(a.seller_wallet,'hex'),'treasury',encode(n.treasury,'hex'),
'mint',encode(n.mint,'hex'),'tokenProgram',encode(n.token_program,'hex'),'buyerToken',encode(a.buyer_token,'hex'),
'sellerToken',encode(a.seller_token,'hex'),'treasuryToken',encode(a.treasury_token,'hex'),'refundToken',encode(a.refund_token,'hex'),
'issuer',encode(n.issuer,'hex'),'generation',s.generation::text,'revision',s.revision::text,'custodyVersion',s.custody_version::text,
'authorityEpoch',n.authority_epoch::text,'total',a.total_units::text,'net',a.net_units::text,'fee',a.fee_units::text,'validFrom',a.valid_from::text,'expiresAt',a.expires_at::text))
FROM encoding_fixture f JOIN payment_v2.attempts a ON a.id=(f.f->>'attempt')::uuid JOIN payment_v2.sales s ON s.id=a.sale_id
JOIN payment_v2.networks n ON n.id=s.network_id JOIN payment_v2.inventory v ON v.card_id=s.card_id JOIN payment_v2.policies p ON p.version=a.policy_version;
ROLLBACK;
