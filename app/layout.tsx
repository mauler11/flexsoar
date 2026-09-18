import type { Metadata } from "next";
import LayoutProps from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://flexsoar.net"),
  title: {
    default: "FlexSoar — Tokenized Sneaker Market",
    template: "%s — FlexSoar",
  },
  description:
    "Buy, sell, and trade authenticated sneakers as digital Cards. Real shoes in the vault, fair prices on the market.",
  openGraph: {
    type: "website",
    siteName: "FlexSoar",
    title: "FlexSoar — Tokenized Sneaker Market",
    description:
      "Buy, sell, and trade authenticated sneakers as digital Cards. Real shoes in the vault, fair prices on the market.",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FlexSoar — Tokenized Sneaker Market",
    description:
      "Buy, sell, and trade authenticated sneakers as digital Cards.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
