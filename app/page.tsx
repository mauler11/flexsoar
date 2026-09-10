/**
 * app/page.tsx
 *
 * The landing page is gone: flexsoar.net opens straight into the market.
 * This redirect keeps every existing "/" link (logo, footer, OAuth
 * fallbacks) working against the canonical /market route.
 */
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/market");
}
