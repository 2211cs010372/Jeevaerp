"use client";

import Image from "next/image";
import { DEPARTMENTS } from "@/lib/data";

/**
 * North Star Health - Department Ticker / Marquee Component
 * ------------------------------------------------------------------
 * Photo-enhanced ticker bar with continuous infinite scroll, 
 * glassmorphic department pills, and hover-to-pause interactions.
 */

// Keyframe animation for infinite horizontal loop
const tickerKeyframes = `
  @keyframes nsh-marquee {
    0% { transform: translateX(0%); }
    100% { transform: translateX(-50%); }
  }
  .animate-nsh-marquee {
    display: flex;
    width: max-content;
    animation: nsh-marquee 35s linear infinite;
  }
  .animate-nsh-marquee:hover {
    animation-play-state: paused;
  }
`;

export function Ticker() {
  // Duplicate array 3x to ensure seamless looping without visual gaps
  const tickerItems = [...DEPARTMENTS, ...DEPARTMENTS, ...DEPARTMENTS];

  return (
    <div className="nsh-ticker-root w-full overflow-hidden bg-[#FFFFFF] py-4">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;600;700&family=Inter:wght@400;500;600&display=swap');
        ${tickerKeyframes}

        .nsh-ticker-root {
          --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
          --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--font-body);
        }
      `}</style>

      {/* Marquee Container with edge mask fades */}
      <div className="relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="animate-nsh-marquee flex items-center gap-3 sm:gap-4">
          {tickerItems.map((dept, idx) => {
            // Support both object properties (`image` or fallback placeholder)
            const deptImage = dept.image  || `/images/dept-${(idx % 4) + 1}.avif`;

            return (
              <div
                key={`${dept.name}-${idx}`}
                className="group relative flex shrink-0 items-center gap-3 rounded-lg bg-[#f0eee9] p-1.5 pr-5 transition-all duration-300 hover:bg-[#e2dfd7] hover:shadow-md"
              >
                {/* Department Image Thumbnail */}
                <div className="relative h-24 w-25 overflow-hidden rounded-md bg-[#DCE7F0] ring-2 ring-white/80 shadow-sm shrink-0">
                  <Image
                    src={deptImage}
                    alt={dept.name}
                    fill
                    
                    className="object-cover w-full h-full object-center transition-transform duration-300 group-hover:scale-110"
                    onError={(e) => {
                      // Graceful fallback hide image on load failure
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>

                {/* Name & Specialty Tag */}
                <div className="flex items-start justify-start gap-2">
                  <span className="font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-[#14181C] tracking-tight whitespace-nowrap">
                    {dept.name}
                  </span>


                  {/* Plus Icon separator */}
                  <span className="ml-1 text-[13px] font-semibold text-[#274472]/60 group-hover:text-[#274472]">
                    +
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}