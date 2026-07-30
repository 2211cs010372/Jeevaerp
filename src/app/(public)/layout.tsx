import "./site-theme.css";
import { Navbar } from "@/components/marketing/navbar";
import { SmoothScroll, ScrollProgress } from "@/components/marketing/smooth-scroll";
import { Footer } from "@/components/marketing/footer";

/**
 * The public shell.
 *
 * `.grain` puts a fixed film-grain overlay over everything - the one texture
 * in the system, and the reason porcelain reads as a printed surface instead
 * of an empty div. It sits above content but below the navbar's z-index and
 * is pointer-events:none, so it never intercepts a tap.
 *
 * The skip link is first in the DOM on purpose: this page opens with a
 * two-row navbar and a six-item mega menu, which is a long way to tab past
 * when you only came for the emergency number.
 */
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="site grain relative">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SmoothScroll />
      <ScrollProgress />
      <Navbar />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}
