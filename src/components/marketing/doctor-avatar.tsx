"use client";

import { useEffect, useRef, useState } from "react";

/** Doctor photo with a graceful initials fallback if the image is missing. */
export function DoctorAvatar({ name, image, className = "" }: { name: string; image?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const initials = name.replace(/^Dr\.?\s*/i, "").split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  // A 404 can land before hydration, so onError alone would miss it.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setBroken(true);
  }, []);

  if (!image || broken) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-[var(--teal)] to-[var(--teal-lift)] font-bold tracking-wide text-white ${className}`} aria-label={name}>
        {initials}
      </div>
    );
  }
  return <img ref={ref} src={image} alt={name} onError={() => setBroken(true)} loading="lazy" className={`object-cover ${className}`} />;
}
