"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/api-client";
import { Icon } from "@/components/portal/ui/icons";
import { Req } from "@/components/portal/ui/form-atoms";

/**
 * Staff sign-in. Two modes:
 *  - OTP (default): enter username (role.name) → 6-digit code sent to the
 *    registered email (prints to server console in dev). Only works if the
 *    username exists in the DB.
 *  - Password: username + password fallback.
 * On success the API returns an absolute redirectTo (the role's portal), so we
 * do a full navigation - the cookie is domain-wide and valid on arrival.
 *
 * The affordances here are the ones a counter actually needs, and each exists
 * because its absence costs somebody a minute they do not have at 8:50am:
 *
 *  - the code SUBMITS ITSELF once six digits are in. Nobody types a one-time
 *    code and then wants to hunt for a button, and pasting it from a phone
 *    fills all six at once - so the paste is the submit.
 *  - RESEND is on a 30-second cooldown with the seconds shown. Without a resend
 *    a code that never arrived is a dead end; without the cooldown people press
 *    it four times and burn through the server's rate limit.
 *  - the password can be REVEALED. Staff share long generated passwords and
 *    type them wrong; a masked field with no way to check is how a real
 *    password becomes a support call.
 *  - errors are announced (role="alert") and sit directly above the control
 *    that caused them, not at the top of a card the eye has already left.
 */
export function StaffLogin({ portalName = "Staff" }: { portalName?: string }) {
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const [step, setStep] = useState<"username" | "code">("username");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  /** Guards the auto-submit so a re-render can't fire the same code twice. */
  const submittedCode = useRef<string | null>(null);

  // Resend cooldown, ticked down once a second while it is running.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function requestCode(resend = false) {
    setError(null);
    if (username.trim().length < 3) { setError("Enter your username."); return; }
    setLoading(true);
    try {
      const { sentTo } = await api.post<{ sentTo: string }>("/auth/staff/otp/request", { username });
      setSentTo(sentTo);
      setStep("code");
      setCooldown(30);
      if (resend) { setCode(""); submittedCode.current = null; }
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Something went wrong."); }
    finally { setLoading(false); }
  }

  const verifyCode = useCallback(async (value: string) => {
    if (!/^\d{6}$/.test(value)) { setError("Enter the 6-digit code."); return; }
    // Remember what we sent BEFORE awaiting: two renders can otherwise both
    // pass the guard and post the same code, which the server counts as a
    // second attempt and holds against the five it allows.
    submittedCode.current = value;
    setError(null);
    setLoading(true);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/auth/staff/otp/verify", { username, code: value });
      window.location.assign(redirectTo || "/");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Sign-in failed.");
      setLoading(false);
      // A rejected code is worth retyping - let the next six digits through.
      submittedCode.current = null;
    }
  }, [username]);

  /** Six digits in the box is the submit - typed or pasted. */
  function onCodeChange(raw: string) {
    const next = raw.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    if (next.length < 6) setError(null);
    if (next.length === 6 && !loading && submittedCode.current !== next) verifyCode(next);
  }

  async function passwordLogin() {
    setError(null);
    if (username.trim().length < 3 || !password) { setError("Enter your username and password."); return; }
    setLoading(true);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/auth/staff/login", { username, password });
      window.location.assign(redirectTo || "/");
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Sign-in failed."); setLoading(false); }
  }

  function switchMode(next: "otp" | "password") {
    if (next === mode) return;
    setMode(next); setStep("username"); setError(null); setCode(""); setPassword("");
    submittedCode.current = null;
  }

  const onCode = mode === "otp" && step === "code";

  const label = "block text-[12.5px] font-medium text-[var(--p-text)]";
  const field =
    "mt-1.5 h-[46px] w-full border border-[var(--p-border-strong)] px-3.5 text-[15px] text-[var(--p-ink)] placeholder:text-[var(--p-muted)]";
  const submit =
    "btn-primary mt-1 flex h-[46px] w-full items-center justify-center gap-2 text-[14.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60";
  const quiet =
    "text-[12.5px] font-medium text-[var(--p-muted)] transition-colors hover:text-[var(--p-blue)]";

  return (
    <div>
      <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[var(--p-ink)]">
        {onCode ? "Enter your code" : "Sign in"}
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--p-muted)]">
        {onCode ? (
          <>We sent a 6-digit code to <span className="font-medium text-[var(--p-text)]">{sentTo}</span>. It works for 5 minutes.</>
        ) : mode === "otp" ? (
          <>Enter your username and we&apos;ll email you a code.</>
        ) : (
          <>Enter your username and password to open the {portalName.toLowerCase()}.</>
        )}
      </p>

      {/* How you want to sign in - a segmented control, not a link buried under
          the button. Both routes are first-class (a shared counter machine uses
          the code, a doctor's own laptop uses the password), so both are on
          screen from the start. Hidden once a code is out: at that point there
          is one thing to do, and offering a mode switch mid-flow only invites
          throwing away a code that has already been emailed. */}
      {!onCode && (
        <div
          role="tablist"
          aria-label="Sign-in method"
          className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-1"
        >
          {([["otp", "SMS code"], ["password", "Password"]] as const).map(([m, t]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-md py-2 text-[12.5px] font-semibold transition-all ${
                mode === m
                  ? "bg-[var(--p-surface)] text-[var(--p-blue-deep)] shadow-[var(--p-shadow-sm)]"
                  : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 border-l-2 border-[var(--p-rose)] bg-[var(--p-rose-soft)] px-3 py-2.5 text-[12.5px] leading-snug text-[var(--p-rose)]"
        >
          <span className="mt-[1px] shrink-0"><Icon name="alert" size={14} /></span>
          <span>{error}</span>
        </div>
      )}

      {mode === "otp" ? (
        step === "username" ? (
          <div className="mt-5 space-y-4">
            <div>
              <label className={label} htmlFor="login-username">Username<Req /></label>
              <input
                id="login-username" value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && requestCode()}
                placeholder="reception.ravi" autoComplete="username" autoFocus  
                enterKeyHint="send" className={field}
              />
            </div>
            <button onClick={() => requestCode()} disabled={loading} className={submit}>
              {loading ? "Sending…" : <> Send SMS code <Icon name="chevron" size={15} /></>}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <label className={label} htmlFor="login-code">Six-digit code<Req /></label>
              <input
                id="login-code" value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="000000" inputMode="numeric" autoComplete="one-time-code" autoFocus
                aria-describedby="code-hint"
                className="mt-1.5 h-[54px] w-full border border-[var(--p-border-strong)] text-center font-mono text-[24px] tracking-[0.4em] text-[var(--p-ink)] placeholder:text-[var(--p-muted)] placeholder:opacity-40"
              />
              <p id="code-hint" className="mt-1.5 text-[11.5px] text-[var(--p-muted)]">
                {loading ? "Checking your code…" : "Signs you in as soon as all six digits are in."}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              <button
                onClick={() => { setStep("username"); setCode(""); setError(null); submittedCode.current = null; }}
                className={quiet}
              >
                ← Change username
              </button>
              <button
                onClick={() => requestCode(true)}
                disabled={cooldown > 0 || loading}
                className={`${quiet} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-[var(--p-muted)]`}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="mt-5 space-y-4">
          <div>
            <label className={label} htmlFor="login-user2">Username<Req /></label>
            <input
              id="login-user2" value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="reception.ravi" autoComplete="username" autoFocus className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="login-pass">Password<Req /></label>
            <div className="relative">
              <input
                id="login-pass" type={showPassword ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && passwordLogin()}
                placeholder="Your password" autoComplete="current-password"
                enterKeyHint="go" className={`${field} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute right-1 top-1.5 flex h-[38px] w-9 items-center justify-center rounded-md text-[var(--p-muted)] transition-colors hover:text-[var(--p-ink)]"
              >
                <Icon name={showPassword ? "x" : "search"} size={15} />
              </button>
            </div>
          </div>
          <button onClick={passwordLogin} disabled={loading} className={submit}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>
      )}
    </div>
  );
}
