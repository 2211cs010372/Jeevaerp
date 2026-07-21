"use client";

import { Icon, type IconName } from "@/components/portal/ui/icons";
import { StaffLogin } from "@/components/portal/staff-login";

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: "calendar", title: "One connected system", desc: "OPD, IPD, pharmacy and labs share a single patient record." },
  { icon: "rupee", title: "Live money view", desc: "Billing, collections, beds and stock update as they happen." },
  { icon: "check", title: "Secure sign-in", desc: "One-time email codes or passwords, with full audit trails." },
  { icon: "users", title: "A desk for every role", desc: "Reception, doctors, labs, pharmacy and admin each see their own tools." },
];

export function AuthScreen({ portalName, portalKey = "reception" }: { portalName: string; portalKey?: string }) {
  return (
    <div className="portal min-h-screen relative overflow-hidden flex items-center justify-center p-4 sm:p-6 lg:p-8" data-portal={portalKey}>



      {/* Main Container Card: Strict Alignment Geometry */}
      <div className="relative z-10 w-full max-w-[1280px] min-h-[720px] grid lg:grid-cols-[1.05fr_1fr] bg-[var(--p-surface)] rounded-[24px] border border-[var(--p-border-strong)] shadow-[var(--p-shadow-lg)] overflow-hidden">

        {/* ==================== LEFT SIDE: DIGITAL ENGINE & FEATURES ==================== */}
        <div
          className="relative flex flex-col justify-between p-6 sm:p-10 xl:p-12 border-b lg:border-b-0 lg:border-r border-[var(--p-border)]"
          style={{ background: "linear-gradient(165deg, rgba(255,255,255,0.92), var(--p-bg))" }}
        >
          {/* Internal Graphic Element: Abstract Node Cross-hair */}
          <div className="absolute top-10 right-10 z-0 w-20 h-20 text-[var(--p-border-strong)] pointer-events-none hidden sm:block">
            <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none">
              <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="1" />
              <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeWidth="1" />
              <circle cx="50" cy="50" r="12" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx="50" cy="50" r="4" fill="var(--p-cyan)" />
            </svg>
          </div>
          {/* Background Decorative Element 1: Dynamic Structural Grid Pattern */}
          <div className="absolute inset-0 dotgrid opacity-30 pointer-events-none z-0" />

          {/* Background Decorative Element 2: Architectural Wave Lines */}
          <div className="absolute top-0 right-0 w-[50vw] h-full opacity-[0.12] text-[var(--p-blue)] pointer-events-none hidden lg:block z-0">
            <svg width="100%" height="100%" viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M100 800C300 700 400 400 800 300M200 800C400 710 500 450 800 380M50 800C200 680 300 350 800 220" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" />
              <circle cx="400" cy="400" r="6" fill="currentColor" />
              <circle cx="500" cy="450" r="4" fill="currentColor" />
              <circle cx="300" cy="350" r="5" fill="currentColor" />
            </svg>
          </div>

          {/* Background Decorative Element 3: Ambient Radial Glow Blooms */}
          <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-[var(--p-blue-soft)] opacity-50 blur-[140px] pointer-events-none z-0" />
          <div className="absolute -bottom-20 right-10 w-[500px] h-[500px] rounded-full bg-[var(--p-cyan-soft)] opacity-35 blur-[120px] pointer-events-none z-0" />

          {/* Top Panel: Header */}
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--p-blue)] text-white shadow-md shadow-[var(--p-blue-soft)]">
              <Icon name="stethoscope" size={18} />
            </span>
            <div>
              <span className="font-serif-p text-xl font-bold tracking-tight text-[var(--p-ink)]">Jeeva</span>
              <span className="ml-2 font-mono text-[10px] bg-[var(--p-blue-soft)] text-[var(--p-blue)] border border-[var(--p-blue-glow)] px-2 py-0.5 rounded-md uppercase tracking-wider font-semibold">
                {portalName}
              </span>
            </div>
          </div>

          {/* Center Panel: Typography Copy & Feature Grid */}
          <div className="my-auto py-8">
            <div className="max-w-lg">
              <h1 className="font-serif-p text-[32px] sm:text-[38px] font-semibold text-[var(--p-ink)] leading-[1.12] tracking-tight">
                The enterprise core<br />for clinical sync.
              </h1>
              <p className="mt-3.5 text-[14px] leading-relaxed text-[var(--p-text)] opacity-90">
                A unified database engine mapping point-of-care operations directly to active inventory, ledger books, and cross-departmental patient queues.
              </p>
            </div>

            <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div key={f.title} className="surface surface-hover p-4.5 z-10 rounded-xl flex flex-col justify-between min-h-[130px]">
                  <div>
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--p-bg)] text-[var(--p-blue)] border border-[var(--p-border)]">
                      <Icon name={f.icon} size={14} />
                    </span>
                    <p className="mt-3 text-[15px] font-semibold text-[var(--p-ink)] tracking-tight">{f.title}</p>
                    <p className="mt-1 text-[12px] font-normal leading-relaxed text-[var(--p-muted)]">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Panel: Micro Diagnostics Array Footer */}
          <div className="pt-5 border-t border-[var(--p-border)] flex items-center justify-between gap-4 font-mono text-[11px] text-[var(--p-muted)]">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--p-cyan)] animate-pulse" />
                <span className="font-medium text-[var(--p-ink)]">SYSTEM_GATEWAY_ONLINE</span>
              </div>
              <span className="hidden sm:inline opacity-30">|</span>
              <span className="hidden sm:inline">SECURE_SSL_TLS_1.3</span>
            </div>
            <div className="text-[10px] tracking-wider uppercase bg-[var(--p-border)] px-2 py-0.5 rounded text-[var(--p-text)]">
              Node // ERP_V2.4
            </div>
          </div>
        </div>

        {/* ==================== RIGHT SIDE: AUTHENTICATION INTERFACE ==================== */}
        <div className="relative flex flex-col justify-between p-6 sm:p-10 xl:p-12 bg-[var(--p-surface)]">

          {/* Subtle Structural Matrix Decorator */}
          <div className="absolute bottom-0 right-0 w-32 h-32 opacity-[0.04] text-[var(--p-ink)] pointer-events-none">
            <svg width="100%" height="100%" viewBox="0 0 100 100">
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="currentColor" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>

          {/* Top Panel: System Heartbeat Telemetry */}
          <div className="flex items-center justify-between border-b border-[var(--p-border)] pb-5">
            <div className="flex items-center gap-4">
              <svg width="110" height="20" viewBox="0 0 120 24" className="text-[var(--p-cyan)] opacity-85" aria-hidden>
                <path
                  d="M0 12 H40 l4 -6 4 6 6 0 3 -8 4 16 3 -8 3 0 H120"
                  stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
              <span className="font-mono text-[10px] tracking-widest text-[var(--p-muted)] uppercase hidden sm:inline"></span>
            </div>

            <span className="flex items-center gap-2 rounded-full border border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-1 shadow-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--p-cyan)] opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--p-cyan)]" />
              </span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--p-ink)]">Live Cluster</span>
            </span>
          </div>

          {/* Center Panel: Form Identity Interface */}
          <div className="my-auto dotgrid py-8 max-w-md w-full mx-auto" data-enter>
            <div className="mb-6">
              <h2 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)] tracking-tight">Staff Authentication</h2>
              <p className="text-[13px] text-[var(--p-muted)] mt-1">Provide signed authorization credentials to initialize your role session desktop.</p>
            </div>

            <div className="surface p-5 sm:p-2 rounded-xl bg-[#f0eee9] border border-[#f0eee9] ">
              <StaffLogin portalName={portalName} />
            </div>
          </div>

          {/* Bottom Panel: Verification Support Prompt */}
          <div className="border-t border-[var(--p-border)] pt-5">
            <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
              Authorized personnel access node only. Accounts and system access desks are initialized and audited at the central administrative unit terminal.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}