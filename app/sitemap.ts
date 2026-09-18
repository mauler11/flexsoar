import type { MetadataRoute } from "next";

const BASE = "https://flexsoar.net";

// Static public routes only. Card/profile pages are intentionally excluded
// for launch — they change daily and would go stale; revisit with a
// DB-driven sitemap once inventory is stable.
const STATIC_ROUTES = [
  "/",
  "/market",
  "/list",
  "/about",
  "/terms",
  "/privacy",
  "/contact",
  "/socials",
  "/sign-in",
  "/sign-up",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_ROUTES.map((path) => ({
    url: `${BASE}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "/market" ? "daily" : "monthly",
    priority: path === "/" || path === "/market" ? 1 : 0.6,
  }));
}
