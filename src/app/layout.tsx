import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Mono, Fraunces, Geist, Geist_Mono, Instrument_Sans, Instrument_Serif, Montserrat } from "next/font/google";
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

/* The homepage hero's pair - Instrument Serif for the headline, Montserrat for
   everything around it. Scoped by variable, not set globally: the rest of the
   public site still reads --font-display / --font-sans. Instrument Serif ships
   one weight (400), which is the point - the headline is large enough not to
   need a heavier one. */
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  /* DM Mono ships THREE weights and no more: 300, 400, 500. There is no 600 and
     no 700 - Google Fonts answers a request for them with a 200 and simply
     omits them, so nothing fails loudly and the browser quietly synthesises the
     missing weight by smearing the 500. That matters here because the printed
     bill sets its figures in mono and asks for 600 (and 700 on the Amount
     column); see the note in detailed-bill-sheet / invoice-sheet. */
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
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
    // Without this, most scrapers (WhatsApp, Facebook, Telegram) can't build
    // a card and fall back to showing the bare domain instead of the
    // hospital name - this is what fixes a shared link showing "domain.com".
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.jpg"],
  },
  robots: { index: true, follow: true },
  formatDetection: { telephone: true, address: true },
  // The tab icon an admin uploaded under Settings. A fixed same-origin path, so
  // this stays a static metadata object - the database lookup happens inside the
  // route, once, and is then cached by the browser. Serves a 404 until somebody
  // uploads one, which leaves the browser's own default mark in place.
  // "shortcut" covers older browsers that ignore "icon", and "apple" is what
  // shows up when someone adds the site to an iPhone home screen.
  icons: {
    icon: [{ url: "/api/v1/public/favicon", type: "image/x-icon" }],
    shortcut: [{ url: "/api/v1/public/favicon" }],
    apple: [{ url: "/api/v1/public/favicon" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${instrument.variable} ${instrumentSerif.variable} ${montserrat.variable} ${dmMono.variable} ${fraunces.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}