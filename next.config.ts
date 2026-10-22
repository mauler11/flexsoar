import type { NextConfig } from "next";

/**
 * Security headers — required for the Privy production checklist
 * ("Secure your app": CSP + X-Frame-Options). Directives follow Privy's
 * own CSP guidance (auth.privy.io iframe + WalletConnect + Turnstile),
 * adapted for Next.js (inline runtime scripts/styles) and our runtime:
 *
 * connect-src/frame-src enumerate the browser and installed SDK origins.
 * Environment URLs contribute only their origin; paths and API keys never
 * become CSP sources. Other directives intentionally retain their policy.
 */
const isDev = process.env.NODE_ENV !== "production";

/** Optional deployment origins; malformed configured values fail at build time. */
function configuredOrigin(name: string): string[] {
  const value = process.env[name]?.trim();
  if (!value) return [];
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname.includes("*") || url.username || url.password) {
    throw new Error(`${name} must be an HTTPS URL with an explicit host`);
  }
  return [url.origin];
}

const supabaseOrigins = configuredOrigin("NEXT_PUBLIC_SUPABASE_URL");
const r2AccountId = process.env.R2_ACCOUNT_ID?.trim();
if (r2AccountId && !/^[a-f0-9]{32}$/i.test(r2AccountId)) {
  throw new Error("R2_ACCOUNT_ID must be a 32-character account ID");
}
const connectSources = [
  "'self'",
  ...supabaseOrigins,
  ...supabaseOrigins.map((origin) => origin.replace(/^https:/, "wss:")),
  "https://auth.privy.io",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://explorer-api.walletconnect.com",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "https://challenges.cloudflare.com",
  "https://api.devnet.solana.com",
  "https://api.mainnet-beta.solana.com",
  "https://solana-devnet.rpc.privy.systems",
  "https://solana-mainnet.rpc.privy.systems",
  "wss://solana-devnet.rpc.privy.systems",
  "wss://solana-mainnet.rpc.privy.systems",
  "https://api.moonpay.com",
  "https://api.relay.link",
  "https://api.testnets.relay.link",
  ...(r2AccountId ? [`https://${r2AccountId}.r2.cloudflarestorage.com`] : []),
];

const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-eval' is dev-only: React's dev reconciler needs eval() for
  // component stacks. Production bundles never eval — prod stays strict.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
  `connect-src ${connectSources.join(" ")}`,
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
          // Start HSTS at one day; after HTTPS/redirect monitoring, ramp to
          // one week, one month, then one year. Audit every subdomain before
          // considering includeSubDomains; evaluate preload separately later.
          { key: "Strict-Transport-Security", value: "max-age=86400" },
          // Listing photos use file inputs, with no capture or getUserMedia.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
