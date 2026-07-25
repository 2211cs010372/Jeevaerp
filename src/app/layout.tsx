import type { Metadata } from "next";
import { Bricolage_Grotesque, Fraunces, Geist, Geist_Mono, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

/* The staff portals' type system - Geist for the UI, Geist Mono for data
   (IDs, prices, timings). The modern-software sans, scoped to .portal so the
   public marketing site keeps its own display faces. */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

/* The portals' heading face (.font-serif-p) - italic included, since the
   reception theme leans on the serif italic accent. */
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const TITLE = "Jeeva Multispeciality Hospital - Hanamkonda";
const DESCRIPTION =
  "Your health, our care. Multispeciality hospital in Hanamkonda: 24/7 emergency, specialized doctors, in-house diagnostics and pharmacy.";

export const metadata: Metadata = {
  // Absolute base for canonicals and OG images. Without it, relative OG URLs
  // are dropped by most scrapers - which is most of how this site gets shared.
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s - Jeeva Multispeciality Hospital" },
  description: DESCRIPTION,
  applicationName: "Jeeva",
  keywords: [
    "hospital in Hanamkonda", "multispeciality hospital Warangal", "emergency hospital Hanamkonda",
    "paediatrician Hanamkonda", "gynaecologist Hanamkonda", "cardiologist Warangal",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Jeeva Multispeciality Hospital",
    locale: "en_IN",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
  formatDetection: { telephone: true, address: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${instrument.variable} ${plexMono.variable} ${fraunces.variable} ${geist.variable} ${geistMono.variable}`}
    >
      
      <body>{children}</body>
    </html>
  );
}
