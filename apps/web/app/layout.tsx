import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@open2talk/call-react/styles.css";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://open2talk.cosmerg.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "open2talk: password-gated video calls",
  description:
    "Open-source video calls with screen and audio sharing. No accounts, no database: a link plus a room name and password. Web, desktop, Android and iOS.",
  referrer: "no-referrer",
  openGraph: {
    title: "open2talk",
    description: "Video calls that only open with the password. No accounts, no database.",
    url: siteUrl,
    siteName: "open2talk",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0f12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
