import type { NextConfig } from "next";

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
};

export default nextConfig;
