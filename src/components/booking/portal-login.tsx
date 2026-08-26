"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * Patient sign-in.
 *
 * The one thing a patient actually struggles with here is "where is my Jeeva
 * ID?". So the hero is not a headline - it's a drawing of the OP slip they are
 * holding, with the UHID line marked. Answer the question before it's asked.
 */

const SAFFRON = "#c77d33"; // the accent inked on Jeeva's printed stationery

export function PortalLogin() {
  const router = useRouter();
  const [step, setStep] = useState<"id" | "otp">("id");
  const [patientId, setPatientId] = useState("");
  const [otp, setOtp] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestOtp() {
    setError(null);
    if (!/^JMH\d{4}OP\d{5}$/.test(patientId.trim())) {
      setError("That doesn't look like a Jeeva ID. It reads like JMH2026OP00123.");
      return;
    }
    setLoading(true);
    try {
      const { sentTo } = await api.post<{ sentTo: string }>("/auth/otp/request", { patientId });
      setSentTo(sentTo);
      setStep("otp");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    if (!/^\d{6}$/.test(otp)) { setError("Enter all 6 digits of the code."); return; }
    setLoading(true);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/auth/otp/verify", { patientId, code: otp });
      router.push(redirectTo || "/portal/profile");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <div className="surface relative overflow-hidden rounded-[24px] border border-[var(--p-border-strong)] p-6 shadow-[var(--p-shadow-lg)] sm:p-9">
        {/* a quiet pulse in the corner - the hospital's shorthand, not decoration */}
        <svg aria-hidden viewBox="0 0 120 24" className="pointer-events-none absolute -right-2 top-6 h-6 w-32 opacity-[0.13]">
          <path d="M0 12h30l4-7 5 14 4-9 3 2h74" fill="none" stroke="var(--p-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <p className="font-mono text-[10.5px] uppercase tracking-[0.2em]" style={{ color: SAFFRON }}>Patient portal</p>

        {step === "id" ? (
          <>
            <h1 className="mt-3 font-serif-p text-[30px] font-semibold leading-[1.1] tracking-[-0.015em] text-[var(--p-ink)]">
              Sign in with your<br />Jeeva ID
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--p-muted)]">
              It&apos;s printed on the OP slip you were given at the front desk.
            </p>

            {/* ── the signature: your slip, with the line marked ── */}
            <OpSlip />

            <div className="mt-6">
              <label htmlFor="pid" className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--p-muted)]">Jeeva ID</label>
              <input
                id="pid"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && requestOtp()}
                placeholder="JMH2026OP00123"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="mt-2 w-full rounded-xl border border-[var(--p-border-strong)] bg-[var(--p-surface)] px-4 py-3.5 font-mono text-[16px] tracking-[0.08em] text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-teal)] focus:ring-2 focus:ring-[var(--p-teal-soft)]"
              />
            </div>

            {error && <Problem>{error}</Problem>}

            <button onClick={requestOtp} disabled={loading}
              className="mt-5 w-full rounded-full py-3.5 text-[14px] font-semibold text-white transition-opacity disabled:opacity-55"
              style={{ background: "var(--p-teal)" }}>
              {loading ? "Sending…" : "Send code"}
            </button>
            <p className="mt-3 text-center text-[12px] text-[var(--p-muted)]">
              We&apos;ll send a 6-digit code to the mobile number on your file.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-3 font-serif-p text-[30px] font-semibold leading-[1.1] tracking-[-0.015em] text-[var(--p-ink)]">
              Enter the code
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--p-muted)]">
              A 6-digit code went to <span className="font-semibold text-[var(--p-ink)]">{sentTo}</span>. It expires in 5 minutes.
            </p>

            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className="mt-7 w-full rounded-xl border border-[var(--p-border-strong)] bg-[var(--p-surface)] px-4 py-4 text-center font-mono text-[26px] tracking-[0.42em] text-[var(--p-ink)] outline-none transition-colors focus:border-[var(--p-teal)] focus:ring-2 focus:ring-[var(--p-teal-soft)]"
            />

            {error && <Problem>{error}</Problem>}

            <button onClick={verifyOtp} disabled={loading}
              className="mt-5 w-full rounded-full py-3.5 text-[14px] font-semibold text-white transition-opacity disabled:opacity-55"
              style={{ background: "var(--p-teal)" }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button onClick={() => { setStep("id"); setOtp(""); setError(null); }}
              className="mt-4 w-full text-center font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--p-muted)] transition-colors hover:text-[var(--p-teal)]">
              Use a different ID
            </button>
          </>
        )}
      </div>

      <p className="mt-5 text-center text-[12.5px] leading-relaxed text-[var(--p-muted)]">
        Can&apos;t find your ID? Ask at the front desk, or call{" "}
        <a href="tel:+918765432100" className="font-semibold text-[var(--p-teal)] hover:underline">+91 87 6543 2100</a>.
      </p>
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] leading-relaxed text-[var(--p-rose)]">
      {children}
    </div>
  );
}

/** The OP slip, drawn - with the UHID line marked so it can't be missed. */
function OpSlip() {
  return (
    <figure className="mt-6">
      <svg viewBox="0 0 320 132" className="w-full" role="img" aria-label="Your Jeeva ID is printed on the OP slip, on the line labelled UHID.">
        {/* slip body */}
        <rect x="8" y="8" width="248" height="116" rx="7" fill="var(--p-surface)" stroke="var(--p-border-strong)" strokeWidth="1.2" />
        {/* letterhead band */}
        <path d="M8 15a7 7 0 0 1 7-7h234a7 7 0 0 1 7 7v13H8z" fill="var(--p-teal)" opacity="0.10" />
        <text x="20" y="23" fontSize="8.5" fontFamily="var(--font-dm-mono, monospace)" letterSpacing="1.6" fill="var(--p-teal)">JEEVA · OP SLIP</text>
        {/* ruled detail lines */}
        <g stroke="var(--p-border)" strokeWidth="1.1" strokeLinecap="round">
          <path d="M20 44h96M20 56h74" />
          <path d="M20 96h150M20 108h104" />
        </g>
        {/* the marked line */}
        <rect x="14" y="66" width="176" height="22" rx="5" fill={SAFFRON} opacity="0.13" />
        <rect x="14.6" y="66.6" width="174.8" height="20.8" rx="4.4" fill="none" stroke={SAFFRON} strokeWidth="1.2" />
        <text x="22" y="81" fontSize="9" fontFamily="var(--font-dm-mono, monospace)" letterSpacing="1.2" fill="var(--p-muted)">UHID</text>
        <text x="60" y="81" fontSize="11" fontFamily="var(--font-dm-mono, monospace)" letterSpacing="1.1" fontWeight="700" fill="var(--p-ink)">JMH2026OP00123</text>
        {/* pointer across to the caption */}
        <path d="M192 77h44" fill="none" stroke={SAFFRON} strokeWidth="1.3" strokeDasharray="3 3" />
        <circle cx="238" cy="77" r="2.4" fill={SAFFRON} />
        <text x="248" y="73" fontSize="9.5" fontFamily="var(--font-geist, sans-serif)" fontWeight="600" fill={SAFFRON}>This is</text>
        <text x="248" y="85" fontSize="9.5" fontFamily="var(--font-geist, sans-serif)" fontWeight="600" fill={SAFFRON}>your ID</text>
      </svg>
    </figure>
  );
}
