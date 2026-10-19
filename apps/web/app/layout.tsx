import type { Metadata, Viewport } from "next";
import "@open2talk/call-react/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "open2talk",
  description: "Private, password-gated video calls. No accounts, no database.",
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#0d0f12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
