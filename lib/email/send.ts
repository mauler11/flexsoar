import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'FlexSoar <noreply@flexsoar.net>';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'info@flexsoar.net';
const SUPPORT_PHONE = process.env.SUPPORT_PHONE ?? '+601128375246';

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

export interface SubmissionApprovedEmailInput {
  consignorEmail: string;
  consignorHandle: string;
  shoeBrand: string;
  shoeModel: string;
  shoeColorway: string;
  shoeSizeUs: number;
  listingUrl: string;
}

export interface CardSoldEmailInput {
  consignorEmail: string;
  consignorHandle: string;
  shoeBrand: string;
  shoeModel: string;
  shoeColorway: string;
  shoeSizeUs: number;
  salePriceCents: number;
  dueBy: string;
  listingUrl: string;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDueBy(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function buildSubmissionApprovedEmail(input: SubmissionApprovedEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { consignorHandle, shoeBrand, shoeModel, shoeColorway, shoeSizeUs, listingUrl } = input;

  const subject = `Your submission is live: ${shoeBrand} ${shoeModel} ${shoeColorway} (US ${shoeSizeUs})`;

  const html = `
<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 24px;">
    <p>Hi ${consignorHandle},</p>
    <p>Your submission has been approved and is now live on the FlexSoar market.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Shoe</td>
        <td style="padding: 8px 0;">${shoeBrand} ${shoeModel} ${shoeColorway}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Size</td>
        <td style="padding: 8px 0;">US ${shoeSizeUs}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Listing</td>
        <td style="padding: 8px 0;"><a href="${listingUrl}" style="color: #0066cc;">${listingUrl}</a></td>
      </tr>
    </table>
    <p>The listing is public and can be purchased immediately.</p>
    <p>— FlexSoar</p>
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
    <p style="font-size: 12px; color: #666;">Questions? Contact ${SUPPORT_EMAIL}</p>
  </body>
</html>
  `.trim();

  const text = `
Hi ${consignorHandle},

Your submission has been approved and is now live on the FlexSoar market.

Shoe: ${shoeBrand} ${shoeModel} ${shoeColorway}
Size: US ${shoeSizeUs}
Listing: ${listingUrl}

The listing is public and can be purchased immediately.

— FlexSoar
Questions? Contact ${SUPPORT_EMAIL}
  `.trim();

  return { subject, html, text };
}

export function buildCardSoldEmail(input: CardSoldEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { consignorHandle, shoeBrand, shoeModel, shoeColorway, shoeSizeUs, salePriceCents, dueBy, listingUrl } = input;

  const subject = `Your card sold — ship within 48 hours: ${shoeBrand} ${shoeModel} ${shoeColorway} (US ${shoeSizeUs})`;

  const formattedPrice = formatPrice(salePriceCents);
  const formattedDueBy = formatDueBy(dueBy);

  const html = `
<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 24px;">
    <p>Hi ${consignorHandle},</p>
    <p><strong>Your card has sold.</strong> The physical shoes must now reach FlexSoar within 48 hours.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Shoe</td>
        <td style="padding: 8px 0;">${shoeBrand} ${shoeModel} ${shoeColorway}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Size</td>
        <td style="padding: 8px 0;">US ${shoeSizeUs}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Sale price</td>
        <td style="padding: 8px 0;">${formattedPrice}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Deadline (UTC)</td>
        <td style="padding: 8px 0;">${formattedDueBy}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: 600;">Listing</td>
        <td style="padding: 8px 0;"><a href="${listingUrl}" style="color: #0066cc;">${listingUrl}</a></td>
      </tr>
    </table>
    <h3 style="margin-top: 24px; font-size: 16px;">What you must do</h3>
    <ol style="padding-left: 20px;">
      <li>Arrange and pay for tracked shipping to FlexSoar using J&T Express or an equivalent tracked courier. <strong>You cover the shipping cost</strong> — FlexSoar does not pay for consignor-to-vault shipping (Terms section 4.6).</li>
      <li>Ship the shoes so they are in the courier's system <strong>before the deadline above</strong>.</li>
      <li>Provide the tracking number to FlexSoar (you will receive a follow-up with instructions on where to submit it).</li>
    </ol>
    <h3 style="margin-top: 24px; font-size: 16px;">If you do not ship in time</h3>
    <p>If the shoes do not reach us by the deadline:</p>
    <ul style="padding-left: 20px;">
      <li>The sale is cancelled and the buyer is refunded in full.</li>
      <li>The Card is destroyed.</li>
      <li>Your pending payout is cancelled.</li>
      <li>Your account is restricted and your other live listings are removed.</li>
    </ul>
    <p>This is not a warning — it is the automatic consequence (Terms section 4.5).</p>
    <h3 style="margin-top: 24px; font-size: 16px;">Why tracking matters</h3>
    <p>If you ship within 48 hours <strong>with tracking</strong> and the courier loses the parcel, FlexSoar absorbs the loss (Terms section 4.5). Without tracking, you bear the loss. Tracking is required — not optional.</p>
    <h3 style="margin-top: 24px; font-size: 16px;">Questions about courier or drop-off?</h3>
    <p>Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> or call/WhatsApp ${SUPPORT_PHONE}.</p>
    <p>— FlexSoar</p>
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
    <p style="font-size: 12px; color: #666;">This is a transactional email about your sale. You cannot opt out while you have an active listing.</p>
  </body>
</html>
  `.trim();

  const text = `
Hi ${consignorHandle},

Your card has sold. The physical shoes must now reach FlexSoar within 48 hours.

Shoe: ${shoeBrand} ${shoeModel} ${shoeColorway}
Size: US ${shoeSizeUs}
Sale price: ${formattedPrice}
Deadline (UTC): ${formattedDueBy}
Listing: ${listingUrl}

What you must do:
1. Arrange and pay for tracked shipping to FlexSoar using J&T Express or an equivalent tracked courier. You cover the shipping cost — FlexSoar does not pay for consignor-to-vault shipping (Terms section 4.6).
2. Ship the shoes so they are in the courier's system before the deadline above.
3. Provide the tracking number to FlexSoar (you will receive a follow-up with instructions on where to submit it).

If you do not ship in time:
- The sale is cancelled and the buyer is refunded in full.
- The Card is destroyed.
- Your pending payout is cancelled.
- Your account is restricted and your other live listings are removed.
This is not a warning — it is the automatic consequence (Terms section 4.5).

Why tracking matters:
If you ship within 48 hours with tracking and the courier loses the parcel, FlexSoar absorbs the loss (Terms section 4.5). Without tracking, you bear the loss. Tracking is required — not optional.

Questions about courier or drop-off?
Contact ${SUPPORT_EMAIL} or call/WhatsApp ${SUPPORT_PHONE}.

— FlexSoar
This is a transactional email about your sale. You cannot opt out while you have an active listing.
  `.trim();

  return { subject, html, text };
}

async function sendEmailWithLogging(
  to: string,
  subject: string,
  html: string,
  text: string,
  context: string,
): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const client = getResend();
    const result = await client.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
    });

    if (result.error) {
      console.error(`[email] ${context} — Resend error for ${to}:`, result.error);
      return { success: false, error: result.error.message };
    }

    console.log(`[email] ${context} — sent to ${to}, id: ${result.data?.id}`);
    return { success: true, id: result.data?.id };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`[email] ${context} — exception for ${to}:`, message);
    return { success: false, error: message };
  }
}

export async function sendSubmissionApprovedEmail(
  input: SubmissionApprovedEmailInput,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const { subject, html, text } = buildSubmissionApprovedEmail(input);
  return sendEmailWithLogging(
    input.consignorEmail,
    subject,
    html,
    text,
    'submission_approved',
  );
}

export async function sendCardSoldEmail(
  input: CardSoldEmailInput,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const { subject, html, text } = buildCardSoldEmail(input);
  return sendEmailWithLogging(
    input.consignorEmail,
    subject,
    html,
    text,
    'card_sold_48h',
  );
}