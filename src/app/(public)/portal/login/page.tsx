import type { Metadata } from "next";
import { PortalLogin } from "@/components/booking/portal-login";

export const metadata: Metadata = { title: "Patient portal" };

export default function PortalLoginPage() {
  return (
    // Same pine/porcelain skin the profile uses, so signing in and landing
    // feel like one place rather than two products.
    <div className="portal relative flex min-h-screen flex-col justify-center overflow-hidden px-5 pb-20 pt-[136px]" data-portal="admin">
      {/* ambient: one soft bloom, and a faint trace running under the card */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[220px] w-[620px] -translate-x-1/2 rounded-full opacity-60 blur-[150px]" style={{ background: "var(--p-teal-soft)" }} />
      <svg aria-hidden viewBox="0 0 560 100" preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 top-1 h-[220px] w-full -translate-y-1/2 opacity-[0.07]">
        <path
          d="M0 60H60c8 0 10-13 16-13s8 13 14 13h16l6 8 8-46 8 54 6-16h12c10 0 14-17 24-17s16 17 24 17h60c8 0 10-13 16-13s8 13 14 13h16l6 8 8-46 8 54 6-16h12c10 0 14-17 24-17s16 17 24 17h120"
          fill="none" stroke="var(--p-teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>

      <div className="absolute inset-0 z-10 mx-auto w-full max-w-[440px]">
        <PortalLogin />
      </div>
    </div>
  );
}
