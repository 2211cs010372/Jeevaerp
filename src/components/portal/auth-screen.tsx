"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { classifyHost } from "@/lib/auth/host";
import { Icon, type IconName } from "@/components/portal/ui/icons";
import { StaffLogin } from "@/components/portal/staff-login";

/**
 * The staff sign-in screen.
 *
 * Full-viewport split: the hospital on the left, the form on the right. The
 * photograph is the building the person is standing in, which is the fastest
 * possible answer to "am I at the right place" - and below lg it is dropped
 * entirely rather than stacked, because on a phone the only thing worth the
 * first screenful is the username box.
 *
 * The form column keeps the weight. Portal named above the card in type you can
 * read across a counter, the card itself holding everything you touch, and the
 * desk switcher demoted to chips at the foot - staff do land on the wrong
 * portal (a bookmark, a shared machine) and the URL bar is a poor way out, but
 * it is a footnote, not the hero.
 *
 * Colour comes from the portal's OWN tokens (portal-theme.css via .portal +
 * data-portal), so each desk's login is already tinted like the workspace
 * behind it and nothing here can drift from the app.
 */

const DESKS: { key: string; code: string; name: string; icon: IconName }[] = [
  { key: "reception", code: "OPD", name: "Front desk", icon: "users" },
  { key: "doctor", code: "CON", name: "Consulting room", icon: "stethoscope" },
  { key: "pharmacy", code: "PHR", name: "Pharmacy", icon: "pill" },
  { key: "labs", code: "LAB", name: "Laboratory", icon: "flask" },
  { key: "admin", code: "ADM", name: "Administration", icon: "building" },
];

/**
 * Where a desk's sign-in actually lives, for the host we are served from.
 *
 * The portals route two ways (lib/auth/host.ts): as subdomains on a real domain
 * and on localhost, and as path prefixes on *.vercel.app. A hardcoded
 * "/labs/login" is only correct in the second shape - in the first the
 * middleware reads it as a path UNDER the current portal and rewrites it to
 * /reception/labs/login, i.e. a 404. So this asks the same classifier the
 * middleware uses and builds an absolute cross-subdomain URL when that applies.
 *
 * Host is a browser-only fact, so until mount every chip falls back to the path
 * form - valid in path mode, corrected on hydration long before anyone clicks.
 */
function useDeskHref() {
  const [loc, setLoc] = useState<{ host: string; protocol: string } | null>(null);
  useEffect(() => setLoc({ host: window.location.host, protocol: window.location.protocol }), []);

  return (portal: string) => {
    if (!loc) return `/${portal}/login`;
    const { subdomainMode, rootDomain, port } = classifyHost(loc.host);
    if (!subdomainMode || !rootDomain) return `/${portal}/login`;
    return `${loc.protocol}//${portal}.${rootDomain}${port ? `:${port}` : ""}/login`;
  };
}

export function AuthScreen({ portalName, portalKey = "reception" }: { portalName: string; portalKey?: string }) {
  const deskHref = useDeskHref();
  const here = DESKS.find((d) => d.key === portalKey);

  return (
    <div className="portal authx min-h-[100dvh] relative lg:grid lg:grid-cols-[1fr_1fr] xl:grid-cols-[1.08fr_1fr]" data-portal={portalKey}>

      {/* The building, as one full-bleed layer under the whole grid. It is the
          root's child rather than the hero panel's so the crop is decided by
          the viewport instead of by a half-width column - the composition
          survives every screen ratio, and the form column's opaque background
          is what confines the photo to the left half. The hero panel above it
          is deliberately transparent (see .authx-hero); giving it a background
          paints over this and leaves a flat dark rectangle. */}
      <Image
        src="/images/hospital_banner1.png"
        alt="Jeeva Multispeciality Hospital, Hanamkonda"
        fill
        priority
        /* Sized for a FULL-VIEWPORT cover, not for the visible half. The layer
           spans 100vw x 100dvh, and object-cover on this 1.87:1 photo scales
           until the height fills - about 1690px of source on a 900px-tall
           screen. Asking for less served a 1341px variant that was then
           upscaled and rendered soft. 1717px is the source's own width, so
           this hint simply takes the whole thing and never upscales. */
        sizes="(min-width: 1024px) 1920px, 0px"
        className="object-cover absolute inset-0 authx-hero brightness-50 object-center"
      />
      

      {/* ==================== HERO ==================== */}
      <aside className=" bg-transparent relative hidden overflow-hidden lg:block">
        {/* Ink wash - the photograph is a backdrop, so it is pushed down until
            the type on top of it clears contrast without a box behind it. */}

        <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 text-white ring-1 ring-white/25 backdrop-blur-sm">
              <Icon name="stethoscope" size={20} />
            </span>
            <div className="leading-tight">
              <div className="text-[17px] font-semibold tracking-tight text-white">Jeeva</div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
                Hospital System
              </div>
            </div>
          </div>

          <div className="max-w-[30ch]">
            <h2 className="text-[clamp(2rem,3vw,2.8rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-white">
              One record.
              <br />
              Every desk.
            </h2>
            <p className="mt-4 max-w-[42ch] text-[14px] leading-relaxed text-white/70">
              Reception, consulting rooms, pharmacy, labs and administration all write to the same patient
              file. What one desk enters, the next desk already has.
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-[0.16em] text-white/55">
            <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
            Hanamkonda
          </div>
        </div>
      </aside>

      {/* ==================== FORM ==================== */}
      <div className=" relative flex min-h-[100dvh] bg-transparent flex-col items-center justify-center overflow-hidden px-5 py-10 sm:px-8 lg:min-h-0">


        {/* The glass panel IS the card - there is no second surface inside it
            (see .authx-card, deliberately stripped bare).

            The white is at 78%, not 20%. Everything inside is painted with the
            portal's ink tokens, which are near-black by design; at 20% over a
            darkened photograph that is dark-on-dark and the labels disappear.
            78% + a heavy blur still reads as glass - the building moves behind
            it as a soft wash of colour - while putting every piece of type back
            on a surface light enough to carry it. */}
        <main className="authx-glass relative z-10 w-full max-w-[480px] rounded-2xl p-8 sm:p-10">
          <div className="mb-6 flex flex-col items-center text-center lg:items-start lg:text-left">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--p-blue)] text-white shadow-[0_10px_28px_-10px_var(--p-blue-glow)] lg:hidden">
              <Icon name="stethoscope" size={20} />
            </span>
            <div className="mt-3 text-[15px] font-semibold tracking-tight text-[var(--p-ink)] lg:hidden">Jeeva</div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--p-border-strong)] bg-[var(--p-surface)] px-3 py-1 text-[12px] font-semibold text-[var(--p-blue)] shadow-[var(--p-shadow-sm)] lg:mt-0">
              {here && <Icon name={here.icon} size={13} />}
              {portalName}
            </div>
          </div>

          <div className="authx-card">
            <StaffLogin portalName={portalName} />
          </div>



          <p className="mt-6 max-w-[40ch] text-center text-[12px] leading-relaxed text-[var(--p-muted)] lg:text-left">
            Accounts are created by the hospital administrator. If your username isn&apos;t recognised, ask the
            front office to check your desk access.
          </p>
        </main>
      </div>
    </div>
  );
}
