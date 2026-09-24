import type { NextConfig } from "next";

/**
 * Security headers — required for the Privy production checklist
 * ("Secure your app": CSP + X-Frame-Options). Directives follow Privy's
 * own CSP guidance (auth.privy.io iframe + WalletConnect + Turnstile),
 * adapted for Next.js (inline runtime scripts/styles) and our runtime:
 *
 * Deliberate pragmatic spots (tighten post-launch, not pre-launch):
 * - frame-src ends with `https:` — the card on-ramp loads provider
 *   iframes (MoonPay/Stripe/Meld vary by region) whose hosts we cannot
 *   enumerate without breaking funding. http:/data: frames stay blocked.
 * - connect-src ends with `https: wss:` — same reason for provider APIs
 *   and wallet RPCs. `frame-ancestors 'none'` + XFO DENY still kill
 *   clickjacking outright, which is what the checklist is really after.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com https:",
  "connect-src 'self' https://auth.privy.io https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https: wss:",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    // Client router cache: repeat visits (back button, re-toggled filters)
    // render instantly from cache instead of flashing loading.tsx. Server
    // data still revalidates per cached.ts TTLs — this only skips the
    // client round-trip while the entry is fresh.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          // No framing of FlexSoar anywhere — matches frame-ancestors 'none'
          // above; the pair covers modern + legacy browsers.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
