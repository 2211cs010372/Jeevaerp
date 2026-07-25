import Image from "next/image";
import type { ReactNode } from "react";

/** Minimal line icons, one per department. Stroke inherits currentColor. */
const ICONS: Record<string, ReactNode> = {
  Cardiology: (
    <>
      <Image src="/images/Heart Care.png" alt=" " width={100} height={100} className="w-full  h-full" />
    </>
  ),
  Orthopaedics: (
    <>
      <Image src="/images/Orthopaedics.png" alt="" width={100} height={100} className="w-full h-full"  />

    </>
  ),
  Gynaecology: (
    <>
      <Image src="/images/Women Care.png" alt="" width={100} height={100} className="w-full h-full" />
    </>
  ),
  Paediatrics: (
    <>
      <Image src="/images/Paediatrics Care.png" alt="" width={100} height={100} className="w-full h-full" />
    </>
  ),
  "General Medicine": (
    <>
      <path d="M6 3.5v5a4.5 4.5 0 0 0 9 0v-5" />
      <path d="M10.5 12.9V16a4 4 0 0 0 8 0v-1.3" />
      <circle cx="18.5" cy="12.6" r="2.1" />
      <path d="M4.6 3.5h2.8M13.6 3.5h2.8" />
    </>
  ),
  Neurology: (
    <>
      <Image src="/images/Neurology.png" alt="" width={100} height={100} className="w-full h-full" />
    </>
  ),
  Dermatology: (
    <>
      <Image src="/images/Dermatology.png" alt="" width={100} height={100} className="w-full h-full" />
    </>
  ),
  ENT: (
    <>
      <Image src="/images/ENT.png" alt="" width={100} height={100} className="w-full h-full" />
    </>
  ),

  /* quick-need extras */
  Fever: (
    <>
      <path d="M10 4.5a2 2 0 0 1 4 0V13a4.5 4.5 0 1 1-4 0V4.5Z" />
      <path d="M12 9.5V16M16.8 5.5h2.7M16.8 8.5h1.7" />
    </>
  ),
  Prevention: (
    <>
      <path d="M12 3.2 19 6v5.1c0 4.4-2.9 7.4-7 8.7-4.1-1.3-7-4.3-7-8.7V6l7-2.8Z" />
      <path d="M12 8.5v6M9 11.5h6" />
    </>
  ),
};

export function DeptIcon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  return (
    <div
      className={className}
      aria-hidden
    >
      {ICONS[name] ?? <path d="M12 5v14M5 12h14" />}
    </div>
  );
}
