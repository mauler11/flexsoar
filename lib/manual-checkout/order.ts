import { randomBytes } from 'node:crypto';

export const MANUAL_PAYMENT_INSTRUCTIONS = "Include your order reference. We confirm payment in our own account before collecting your pair. Screenshots are not proof of payment. Full refund if the pair fails authentication or the seller doesn't deliver within 5 days.";
export const SELLER_HELD_DISCLOSURE = 'Held by the seller. FlexSoar collects and authenticates every pair before your card transfers. Full refund if it fails authentication or isn\'t delivered to us.';
export const LISTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ISO 3166-1 alpha-2. Keep country codes rather than accepting arbitrary markup.
const COUNTRIES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));
export interface ManualOrderContact { name: string; email: string; phone: string; country: string }

export function validateContact(value: unknown): ManualOrderContact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid order request');
  const field = (key: string, max: number): string => {
    const raw: unknown = Reflect.get(value, key);
    if (typeof raw !== 'string' || raw.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) throw new Error(`Invalid ${key}`);
    return raw.normalize('NFC').trim();
  };
  const name = field('name', 100);
  const email = field('email', 254);
  const phone = field('phone', 32);
  const country = field('country', 2).toUpperCase();
  if (name.length < 2) throw new Error('Enter your name');
  if (!/^[^\s<>@,;:"\\]+@[^\s<>@,;:"\\]+\.[A-Za-z]{2,63}$/.test(email)) throw new Error('Invalid email');
  if (!/^\+?[0-9 ()-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) throw new Error('Invalid phone');
  if (!COUNTRIES.has(country)) throw new Error('Invalid shipping country (use a two-letter country code)');
  return { name, email, phone, country };
}

/** 40 cryptographically random bits, RFC 4648 base32, no modulo bias. */
export function orderReference(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, buffer = 0, output = 'FS-';
  for (const byte of randomBytes(5)) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(buffer >>> bits) & 31]; }
  }
  return output;
}

export interface ManualOrderEmail extends ManualOrderContact {
  reference: string; userId: string; listingId: string; item: string; priceCents: number;
  address: string; qrUrl: string;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function manualOrderMessages(order: ManualOrderEmail) {
  const price = `RM ${(order.priceCents / 100).toFixed(2)}`;
  const details = `Reference: ${order.reference}\nItem: ${order.item}\nPrice: ${price}\nName: ${order.name}\nEmail: ${order.email}\nPhone: ${order.phone}\nShipping country: ${order.country}`;
  const support = `${details}\nUser ID: ${order.userId}\nListing ID: ${order.listingId}\nOrder request only. No reservation, payment verification or ownership transfer has occurred.`;
  const buyer = `${details}\n\n${MANUAL_PAYMENT_INSTRUCTIONS}\n\nDuitNow QR: ${order.qrUrl}\nUSDC (Solana): ${order.address}\nDo not send SOL or USDC on another network. Contact support to confirm the USDC amount against the MYR price before sending.\nThis request does not reserve the pair. Wait for FlexSoar to confirm availability before paying.`;
  return {
    support: { subject: `Manual order request ${order.reference}`, text: support, html: `<pre style="white-space:pre-wrap">${escapeHtml(support)}</pre>` },
    buyer: { subject: `Your FlexSoar order request ${order.reference}`, text: buyer, html: `<pre style="white-space:pre-wrap">${escapeHtml(buyer)}</pre><p>DuitNow QR</p><img src="${escapeHtml(order.qrUrl)}" alt="DuitNow payment QR" width="320" />` },
  };
}
