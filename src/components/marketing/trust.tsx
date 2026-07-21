"use client";

import Link from "next/link";
import { Reveal, CountUp } from "@/components/ui/reveal";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DEPARTMENTS, DOCTORS } from "@/lib/data";
import { ArrowUpRight } from "lucide-react";

/** 
 * North Star Health — Trust Component
 * ------------------------------------------------------------------
 * Bento-style trust section aligned with the North Star Health aesthetic:
 * warm #f0eee9 framing, deep #14181C dark accents, and #274472 navy branding.
 */
export function Trust() {
  const faces = DOCTORS.slice(0, 3);
  const remainingCount = Math.max(0, DOCTORS.length - 3);

  // Safe fallback access for the orbit graphic
  const centerDoc = DOCTORS[0] || { id: "1", name: "Doctor", image: "" };
  const orbitDoc1 = DOCTORS[1] || { id: "2", name: "Doctor", image: "" };
  const orbitDoc2 = DOCTORS[2] || { id: "3", name: "Doctor", image: "" };

  return (
    <section className="nsh-trust-root w-full bg-[#FFFFFF] px-3 py-10 sm:px-6 lg:px-8 lg:py-14">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');

        .nsh-trust-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-[1fr_2.4fr]">
        
        {/* Left Card: Midnight Navy Accent Bento Block */}
        <Reveal>
          <div className="group relative flex h-full min-h-[280px] flex-col justify-between overflow-hidden rounded-[1.75rem] bg-[#14181C] p-7 text-white ring-1 ring-black/10 transition-transform duration-300 hover:-translate-y-1 hover:shadow-xl">
            {/* Soft Ambient Radial Glow */}
            <div 
              className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#274472]/40 blur-2xl" 
              aria-hidden 
            />

            <div className="relative z-10">
              <div className="flex items-center justify-between">
                <p className="font-[family-name:var(--font-display)] text-5xl font-semibold tracking-tight text-white md:text-6xl">
                  <CountUp to={DEPARTMENTS.length} />
                </p>
                <span className="text-2xl font-light text-[#274472]">+</span>
              </div>
              <p className="mt-3 max-w-[210px] text-xs leading-relaxed text-white/75">
                specialized departments under one roof — most visits never leave the building
              </p>
            </div>
            
            {/* Minimalist Avatar Stack */}
            {faces.length > 0 && (
              <div className="relative z-10 mt-8 flex items-center isolate -space-x-2">
                {faces.map((d) => (
                  <DoctorAvatar 
                    key={d.id} 
                    name={d.name} 
                    image={d.image}
                    className="h-9 w-9 rounded-full border-2 border-[#14181C] text-[9px] shadow-sm transition-transform duration-200 group-hover:scale-105" 
                  />
                ))}
                {remainingCount > 0 && (
                  <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[#14181C] bg-[#274472] text-[10px] font-semibold text-white shadow-sm">
                    +{remainingCount}
                  </span>
                )}
              </div>
            )}
          </div>
        </Reveal>

        {/* Right Card: Soft Beige & Glassmorphic Canvas */}
        <Reveal delay={80}>
          <div className="relative overflow-hidden rounded-[1.75rem] bg-[#f0eee9] p-1.5 ring-1 ring-black/5 transition-all duration-300 hover:shadow-lg">
            <div className="grid h-full rounded-[1.35rem] bg-white/80 p-6 backdrop-blur-md md:grid-cols-[1.3fr_1fr_auto] md:items-center md:p-8">
              
              {/* Content Block */}
              <div className="flex flex-col justify-between h-full pr-2">
                <div>
                  <span className="rounded-full bg-[#274472]/10 px-3 py-1 text-[11px] font-semibold text-[#274472]">
                    Care Coordination
                  </span>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight text-[#14181C] sm:text-3xl">
                    Connect with our medical specialists
                  </h3>
                  <p className="mt-2 max-w-sm text-xs leading-relaxed text-[#14181C]/70">
                    Book a time with a dedicated doctor — your complete medical history is accessible on their screen when you sit down.
                  </p>
                </div>

                <Link 
                  href="/doctors" 
                  className="group inline-flex items-center gap-2 pt-6 text-xs font-semibold text-[#274472] transition-colors hover:text-[#14181C]"
                >
                  Meet the specialists
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#274472]/10 transition-colors group-hover:bg-[#14181C] group-hover:text-white">
                    <ArrowUpRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </Link>
              </div>

              {/* Orbit Graphic — Glassmorphic Avatar Layers */}
              <div aria-hidden className="relative mx-auto hidden h-[150px] w-[150px] md:block">
                {/* Outer Orbit Ring */}
                <div className="absolute inset-0 rounded-full border border-[#14181C]/10 animate-[spin_60s_linear_infinite]">
                  <span className="absolute right-3 top-5 h-2 w-2 rounded-full bg-[#274472]" />
                  <span className="absolute bottom-6 left-2 h-1.5 w-1.5 rounded-full bg-[#14181C]/40" />
                </div>
                
                {/* Inner Rings */}
                <span className="absolute inset-[20px] rounded-full border border-[#14181C]/5" />
                <span className="absolute inset-[40px] rounded-full border border-[#274472]/10" />
                
                {/* Floating Avatars */}
                <DoctorAvatar 
                  name={centerDoc.name} 
                  image={centerDoc.image} 
                  className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md text-[10px]" 
                />
                <DoctorAvatar 
                  name={orbitDoc1.name} 
                  image={orbitDoc1.image} 
                  className="absolute -top-1 left-5 h-8 w-8 rounded-full border border-white shadow-sm text-[8px]" 
                />
                <DoctorAvatar 
                  name={orbitDoc2.name} 
                  image={orbitDoc2.image} 
                  className="absolute bottom-1 right-1 h-8 w-8 rounded-full border border-white shadow-sm text-[8px]" 
                />
              </div>

              {/* Metrics Column */}
              <div className="mt-6 flex gap-8 border-t border-black/5 pt-6 sm:gap-12 md:mt-0 md:flex-col md:gap-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-3xl font-semibold text-[#14181C]">
                    <CountUp to={DOCTORS.length} suffix="+" />
                  </p>
                  <p className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wider text-[#14181C]/60">
                    experienced<br />doctors
                  </p>
                </div>
                <div>
                  <p className="font-[family-name:var(--font-display)] text-3xl font-semibold text-[#274472]">
                    <CountUp to={30} suffix="m" />
                  </p>
                  <p className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wider text-[#14181C]/60">
                    routine lab<br />turnaround
                  </p>
                </div>
              </div>

            </div>
          </div>
        </Reveal>
        
      </div>
    </section>
  );
}