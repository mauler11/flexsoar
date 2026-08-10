-- tier_bands are USD cents. Corrects the ringgit-shaped values in 001.
update tier_bands set min_cents = 0,     max_cents = 6000   where tier = 1;
update tier_bands set min_cents = 6000,  max_cents = 12000  where tier = 2;
update tier_bands set min_cents = 12000, max_cents = 25000  where tier = 3;
update tier_bands set min_cents = 25000, max_cents = 50000  where tier = 4;
update tier_bands set min_cents = 50000, max_cents = null   where tier = 5;

-- Re-tier any existing cards against the corrected bands.
update cards c set tier = fn_tier_for_price(s.market_price_cents)
from skus s
where s.id = c.sku_id and fn_tier_for_price(s.market_price_cents) is not null;