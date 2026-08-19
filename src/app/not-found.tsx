import type { Metadata } from "next";
import "./(public)/site-theme.css";
import { Navbar } from "@/components/marketing/navbar";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { Footer } from "@/components/marketing/footer";
import { NotFoundPanel } from "@/components/marketing/not-found-panel";

export const metadata: Metadata = { title: "Page not found" };

/**
 * The app-wide 404, for URLs that match no route at all.
 *
 * This renders outside the (public) layout, so it carries the site shell
 * itself - otherwise a mistyped address drops someone onto an unbranded page
 * with no way back, which is where they leave.
 */
export default async function NotFound() {
  return (
    <div className="site">
      <Navbar doctors={await listPublicDoctors()} />
      <main>
        <NotFoundPanel />
      </main>
      <Footer />
    </div>
  );
}
