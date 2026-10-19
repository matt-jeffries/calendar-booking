import type { Metadata } from "next";
import { getBookingConfig } from "@/lib/runtime-config";
import "./globals.css";

export function generateMetadata(): Metadata {
  const config = getBookingConfig();
  const description = `Choose an available time with ${config.name}. The calendar invitation includes a ${config.videoProvider} link and uses your local time.`;
  const image = config.branding.socialImageUrl ? [{ url: config.branding.socialImageUrl, width: 1200, height: 630, alt: `Book a meeting with ${config.name}` }] : undefined;
  return {
    metadataBase: new URL(config.publicOrigin),
    title: `Book time with ${config.firstName}`,
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", url: "/", siteName: `${config.name} — Booking`, locale: config.locale.replace("-", "_"), title: `Book a meeting with ${config.name}`, description, images: image },
    twitter: { card: image ? "summary_large_image" : "summary", title: `Book a meeting with ${config.name}`, description, images: config.branding.socialImageUrl ? [config.branding.socialImageUrl] : undefined },
    icons: { icon: config.branding.faviconUrl, shortcut: config.branding.faviconUrl, apple: config.branding.avatarUrl },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <body className="antialiased">{children}</body>
    </html>
  );
}
