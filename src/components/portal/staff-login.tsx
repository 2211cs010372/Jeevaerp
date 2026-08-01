"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * Staff sign-in. Two modes:
 *  - OTP (default): enter username (role.name) → 6-digit code sent to the
 *    registered email (prints to server console in dev). Only works if the
 *    username exists in the DB.
 *  - Password: username + password fallback.
 * On success the API returns an absolute redirectTo (the role's portal), so we
 * do a full navigation - the cookie is domain-wide and valid on arrival.
 *
 * This owns the whole right-hand column of the auth screen, heading included.
 * It used to render its own card, eyebrow and <h1> INSIDE a card the auth
 * screen had already drawn a heading on top of - three nested borders and two
 * competing titles. The screen now owns the layout; this owns the words, and
 * the words change with the step (asking for a code is a different moment from
 * arriving at work, and should not be sitting under "Good morning").
 */
export function StaffLogin({ portalName = "Staff" }: { portalName?: string }) {
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const [step, setStep] = useState<"username" | "code">("username");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Time-of-day greeting. Set after mount, never during render: the server has
     no idea what o'clock it is where this person is standing, and a hospital
     runs three shifts, so guessing wrong is the common case. Fades in rather
     than swapping text, so nobody sees it change its mind. */
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : "Good evening.");
  }, []);

  async function requestCode() {
    setError(null);
    if (username.trim().length < 3) { setError("Enter your username."); return; }
    setLoading(true);
    try {
      const { sentTo } = await api.post<{ sentTo: string }>("/auth/staff/otp/request", { username });
      setSentTo(sentTo); setStep("code");
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Something went wrong."); }
    finally { setLoading(false); }
  }

  async function verifyCode() {
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError("Enter the 6-digit code."); return; }
    setLoading(true);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/auth/staff/otp/verify", { username, code });
      window.location.assign(redirectTo || "/");
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Sign-in failed."); setLoading(false); }
  }

  async function passwordLogin() {
    setError(null);
    if (username.trim().length < 3 || !password) { setError("Enter username and password."); return; }
    setLoading(true);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/auth/staff/login", { username, password });
      window.location.assign(redirectTo || "/");
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Sign-in failed."); setLoading(false); }
  }

  function switchMode(next: "otp" | "password") {
    if (next === mode) return;
    setMode(next); setStep("username"); setError(null); setCode(""); setPassword("");
  }

  const onCode = mode === "otp" && step === "code";

  const label = "block font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--p-muted)]";
  const field = "mt-2.5 w-full border border-[var(--p-border-strong)] px-3.5 py-3 text-[15px] text-[var(--p-ink)]";
  const submit = "btn-primary mt-1 w-full py-3.5 text-[14px] font-semibold text-white disabled:opacity-50";
  const quiet =
    "font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--p-muted)] underline decoration-[var(--p-border-strong)] underline-offset-[5px] transition-colors hover:text-[var(--p-blue)] hover:decoration-[var(--p-blue)]";

  return (
    <div data-lift style={{ "--i": 3 } as React.CSSProperties}>
      <p className="eyebrow">{portalName}</p>

      {/* The heading is reserved at its own height so the greeting fading in
          never nudges the form down. */}
      <h1
        className="mt-3 min-h-[1.05em] text-[clamp(1.9rem,2.6vw,2.35rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--p-ink)]"
        style={{ fontFamily: "var(--font-bricolage)" }}
      >
        {onCode ? (
          "Check your email."
        ) : (
          <span className="transition-opacity duration-700" style={{ opacity: greeting ? 1 : 0 }}>
            {greeting ?? " "}
          </span>
        )}
      </h1>

      <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--p-muted)]">
        {onCode
          ? `We sent a 6-digit code to ${sentTo}. It works for the next 5 minutes.`
          : mode === "otp"
            ? "Enter your username and we'll email you a code to sign in."
            : "Enter your username and password to open your desk."}
      </p>

      {error && (
        <div
          role="alert"
          className="mt-6 border-l-2 border-[var(--p-rose)] bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]"
        >
          {error}
        </div>
      )}

      {mode === "otp" ? (
        step === "username" ? (
          <div className="mt-7 space-y-5">
            <div>
              <label className={label} htmlFor="login-username">Username</label>
              <input id="login-username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && requestCode()}
                placeholder="reception.ravi" autoComplete="username" autoFocus className={field} />
            </div>
            <button onClick={requestCode} disabled={loading} className={submit}>
              {loading ? "Sending…" : "Email me a code"}
            </button>
            <div className="pt-1">
              <button onClick={() => switchMode("password")} className={quiet}>Use a password instead</button>
            </div>
          </div>
        ) : (
          <div className="mt-7 space-y-5">
            <div>
              <label className={label} htmlFor="login-code">Six-digit code</label>
              <input id="login-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                placeholder="000000" inputMode="numeric" autoComplete="one-time-code" autoFocus
                className="mt-2.5 w-full border border-[var(--p-border-strong)] px-3.5 py-3.5 text-center font-mono text-[26px] tracking-[0.42em] text-[var(--p-ink)] placeholder:tracking-[0.42em]" />
            </div>
            <button onClick={verifyCode} disabled={loading} className={submit}>
              {loading ? "Verifying…" : "Sign in"}
            </button>
            <div className="pt-1">
              <button onClick={() => { setStep("username"); setCode(""); setError(null); }} className={quiet}>
                Use a different username
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="mt-7 space-y-5">
          <div>
            <label className={label} htmlFor="login-user2">Username</label>
            <input id="login-user2" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="reception.ravi" autoComplete="username" autoFocus className={field} />
          </div>
          <div>
            <label className={label} htmlFor="login-pass">Password</label>
            <input id="login-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passwordLogin()}
              placeholder="••••••••" autoComplete="current-password" className={field} />
          </div>
          <button onClick={passwordLogin} disabled={loading} className={submit}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <div className="pt-1">
            <button onClick={() => switchMode("otp")} className={quiet}>Email me a code instead</button>
          </div>
        </div>
      )}
    </div>
  );
}
