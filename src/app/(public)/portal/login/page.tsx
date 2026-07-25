import type { Metadata } from "next";
import { PortalLogin } from "@/components/booking/portal-login";

export const metadata: Metadata = { title: "Patient portal" };

export default function PortalLoginPage() {
  return (
    // Same pine/porcelain skin the profile uses, so signing in and landing
    // feel like one place rather than two products.
    <div className="portal relative flex min-h-screen flex-col justify-center overflow-hidden px-5 pb-20 pt-[136px]" data-portal="admin">
      {/* ambient: one soft bloom, and a faint trace running under the card */}

      <div className="relative z-10 mx-auto w-full max-w-[440px]">
        <PortalLogin />
      </div>
    </div>
  );
}
