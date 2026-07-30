"use client";

import { useEffect, useRef, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * HOSPITAL SETTINGS - the things that used to need a developer.
 *
 * Two kinds of setting live here and they are kept visually apart on purpose:
 *
 *   IDENTITY   - what prints on a GST invoice. Getting this wrong is a
 *                compliance problem, so it reads like a form.
 *   BEHAVIOUR  - switches that change what a portal DOES. Getting these wrong is
 *                an operational problem, so each one says plainly what happens
 *                when it is off, and the risky ones say what they protect.
 *
 * Anything an admin can turn off here, somebody will turn off at 2 AM and forget.
 * That is why every switch is recorded in the audit log with a name against it.
 */

interface Config {
  legalName: string; addressLine: string; city: string; state: string;
  stateCode: string; pincode: string; gstin: string; phone: string; email: string;
  logoDataUrl: string | null;
  faviconDataUrl: string | null;
  brandName: string; tagline: string; invoiceFooterNote: string;
  expiryAlertDays: number;
  blockDischargeOnDues: boolean;
  onlineBookingEnabled: boolean;
  callbackRequestsEnabled: boolean;
  accountsTabEnabled: boolean;
  afterHoursOpEnabled: boolean;
  afterHoursOpStart: string;
  afterHoursOpEnd: string;
  afterHoursOpMultiplier: number;
}

const blank: Config = {
  legalName: "", addressLine: "", city: "", state: "", stateCode: "36", pincode: "",
  gstin: "", phone: "", email: "",
  logoDataUrl: null, faviconDataUrl: null, brandName: "Jeeva", tagline: "", invoiceFooterNote: "",
  expiryAlertDays: 90,
  blockDischargeOnDues: true,
  onlineBookingEnabled: true,
  callbackRequestsEnabled: true,
  accountsTabEnabled: true,
  afterHoursOpEnabled: true,
  afterHoursOpStart: "20:00",
  afterHoursOpEnd: "06:00",
  afterHoursOpMultiplier: 2,
};

/** Matches the server's cap. Rejected here too so a 3 MB photo fails instantly. */
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** Tighter than the logo - this one is drawn at 16px and fetched by every tab. */
const MAX_FAVICON_BYTES = 64 * 1024;
const FAVICON_TYPES = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/webp", "image/svg+xml"];

export default function SettingsPage() {
  const [f, setF] = useState<Config>({ ...blank });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);
  /** Whether the tab icon changed this session - drives the "reload" hint on save. */
  const [faviconTouched, setFaviconTouched] = useState(false);

  useEffect(() => {
    api.get<{ config: Partial<Config> | null }>("/admin/config")
      .then((r) => {
        if (!r.config) return;
        // Nulls from the database become empty strings for controlled inputs -
        // a null `value` makes React switch the field to uncontrolled mid-life.
        setF({
          ...blank,
          ...r.config,
          gstin: r.config.gstin ?? "", phone: r.config.phone ?? "", email: r.config.email ?? "",
          tagline: r.config.tagline ?? "", invoiceFooterNote: r.config.invoiceFooterNote ?? "",
          brandName: r.config.brandName || "Jeeva",
          // A Prisma Decimal arrives over JSON as a string ("2"), and the number
          // input plus the min/max check both want a real number.
          afterHoursOpMultiplier: Number(r.config.afterHoursOpMultiplier ?? blank.afterHoursOpMultiplier),
        });
      })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  /** One reader for both image slots - they differ only in limits and label. */
  function pickImage(
    file: File,
    opts: { key: "logoDataUrl" | "faviconDataUrl"; types: string[]; maxBytes: number; hint: string }
  ) {
    setError(null); setMsg(null);
    // Some browsers report an empty type for .ico - fall back to the extension
    // rather than rejecting a file that is perfectly valid.
    const type = file.type || (/\.ico$/i.test(file.name) ? "image/x-icon" : "");
    if (!opts.types.includes(type)) { setError(opts.hint); return; }
    if (file.size > opts.maxBytes) {
      setError(`That file is ${Math.round(file.size / 1024)} KB. Keep it under ${Math.round(opts.maxBytes / 1024)} KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let out = String(reader.result);
      // A .ico read by FileReader can come back as image/vnd.microsoft.icon or
      // with no type at all; the server's regex accepts a known list, so
      // normalise before it gets there rather than failing validation.
      if (!file.type && type === "image/x-icon") out = out.replace(/^data:[^;]*;/, "data:image/x-icon;");
      setF((p) => ({ ...p, [opts.key]: out }));
      if (opts.key === "faviconDataUrl") setFaviconTouched(true);
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsDataURL(file);
  }

  const pickLogo = (file: File) =>
    pickImage(file, {
      key: "logoDataUrl", types: LOGO_TYPES, maxBytes: MAX_LOGO_BYTES,
      hint: "Use a PNG, JPEG, WEBP or SVG image.",
    });
  const pickFavicon = (file: File) =>
    pickImage(file, {
      key: "faviconDataUrl", types: FAVICON_TYPES, maxBytes: MAX_FAVICON_BYTES,
      hint: "Use a PNG, ICO, WEBP or SVG image.",
    });

  async function save() {
    setSaving(true); setError(null); setMsg(null);
    try {
      // A null image means "none set". The server treats an ABSENT field as
      // "leave it alone" and an empty string as "remove it", so send "".
      await api.put("/admin/config", {
        ...f,
        logoDataUrl: f.logoDataUrl ?? "",
        faviconDataUrl: f.faviconDataUrl ?? "",
      });
      setMsg("Saved. Branding and switches apply across every portal immediately.");
      // The tab icon is cached by the browser, so a saved favicon doesn't appear
      // until something re-requests it. Say so rather than letting the admin
      // conclude the upload silently failed.
      if (faviconTouched) setMsg("Saved. Reload the page to see the new tab icon — browsers cache it.");
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not save."); }
    finally { setSaving(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
  const set = (k: keyof Config) => (v: string | number | boolean) => setF((p) => ({ ...p, [k]: v }));

  if (loading) return <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>;

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-teal)]">Admin console</p>
        <h1 className="mt-1 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Hospital settings</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
          Identity prints on every GST invoice. The switches below change how reception,
          the pharmacy, the wards and the public website actually behave — every change
          is recorded in the audit log.
        </p>
      </div>

      <div className="mx-auto max-w-3xl space-y-5">
        {/* ── BRANDING ───────────────────────────────────────────────────── */}
        <Card title="Branding" sub="The logo and name shown in every portal sidebar, on the sign-in screens, and at the top of every printed bill.">
          <div className="grid gap-5 p-6 sm:grid-cols-[132px_1fr]">
            <div>
              <div className="flex h-[132px] w-[132px] items-center justify-center overflow-hidden rounded-xl border border-dashed border-[var(--p-border-strong)] bg-[var(--p-bg)]">
                {f.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.logoDataUrl} alt="Hospital logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="px-3 text-center text-[11.5px] leading-snug text-[var(--p-muted)]">No logo set — the built-in mark is used</span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <input ref={fileRef} type="file" accept={LOGO_TYPES.join(",")} className="hidden"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) pickLogo(file); e.target.value = ""; }} />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border-strong)] bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--p-ink)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                  <Icon name="inbox" size={14} /> {f.logoDataUrl ? "Replace logo" : "Upload logo"}
                </button>
                {f.logoDataUrl && (
                  <button onClick={() => setF((p) => ({ ...p, logoDataUrl: null }))}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2 text-[13px] font-medium text-[var(--p-rose)] transition-colors hover:border-[var(--p-rose)]">
                    <Icon name="x" size={14} /> Remove
                  </button>
                )}
              </div>
              <p className="text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                PNG, JPEG, WEBP or SVG, under 512 KB. A square image looks right in the
                sidebar. Stored in the database rather than as a file, so it survives
                every deploy.
              </p>

              {/* ── Browser tab icon ──────────────────────────────────────────
                  Its own upload rather than reusing the logo: a letterhead
                  scaled to 16px is a grey smudge, and the hospital should get
                  to pick a mark that survives being that small. */}
              <div className="border-t border-[var(--p-border)] pt-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--p-border-strong)] bg-[var(--p-bg)]">
                    {f.faviconDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.faviconDataUrl} alt="Browser tab icon" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <Icon name="building" size={16} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-[var(--p-ink)]">Browser tab icon</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                      Shown in the browser tab and in bookmarks, on the public site and every portal.
                      PNG, ICO, WEBP or SVG, under 64 KB. Square, and simple enough to read at 16 pixels.
                    </p>
                    <input ref={faviconRef} type="file" accept={[...FAVICON_TYPES, ".ico"].join(",")} className="hidden"
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) pickFavicon(file); e.target.value = ""; }} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => faviconRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border-strong)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--p-ink)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                        <Icon name="inbox" size={13} /> {f.faviconDataUrl ? "Replace icon" : "Upload icon"}
                      </button>
                      {f.faviconDataUrl && (
                        <button onClick={() => { setF((p) => ({ ...p, faviconDataUrl: null })); setFaviconTouched(true); }}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--p-rose)] transition-colors hover:border-[var(--p-rose)]">
                          <Icon name="x" size={13} /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Brand name">
                  <input className={fld} value={f.brandName} maxLength={40}
                    onChange={(e) => set("brandName")(e.target.value)} placeholder="Jeeva" />
                </Field>
                <Field label="Tagline (optional)">
                  <input className={fld} value={f.tagline} maxLength={120}
                    onChange={(e) => set("tagline")(e.target.value)} placeholder="Multispeciality Hospital" />
                </Field>
              </div>
            </div>
          </div>
        </Card>

        {/* ── IDENTITY ───────────────────────────────────────────────────── */}
        <Card title="Legal identity" sub="Printed on every GST invoice. The GSTIN must be the hospital's real registration number.">
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <Field label="Legal name" span><input className={fld} value={f.legalName} onChange={(e) => set("legalName")(e.target.value)} /></Field>
            <Field label="Address" span><input className={fld} value={f.addressLine} onChange={(e) => set("addressLine")(e.target.value)} /></Field>
            <Field label="City"><input className={fld} value={f.city} onChange={(e) => set("city")(e.target.value)} /></Field>
            <Field label="State"><input className={fld} value={f.state} onChange={(e) => set("state")(e.target.value)} /></Field>
            <Field label="State code (Telangana = 36)"><input className={fld} value={f.stateCode} onChange={(e) => set("stateCode")(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
            <Field label="PIN code"><input className={fld} value={f.pincode} onChange={(e) => set("pincode")(e.target.value.replace(/\D/g, "").slice(0, 6))} /></Field>
            <Field label="GSTIN" span><input className={`${fld} font-mono`} value={f.gstin} onChange={(e) => set("gstin")(e.target.value.toUpperCase())} placeholder="36AACCA1234F1Z5" /></Field>
            <Field label="Phone"><input className={fld} value={f.phone} onChange={(e) => set("phone")(e.target.value)} /></Field>
            <Field label="Email"><input className={fld} value={f.email} onChange={(e) => set("email")(e.target.value)} /></Field>
            <Field label="Note printed at the foot of every bill (optional)" span>
              <textarea className={`${fld} min-h-[76px] resize-y`} value={f.invoiceFooterNote} maxLength={600}
                onChange={(e) => set("invoiceFooterNote")(e.target.value)}
                placeholder="Terms, refund policy, or a helpline number." />
            </Field>
          </div>
        </Card>

        {/* ── PHARMACY ───────────────────────────────────────────────────── */}
        <Card title="Pharmacy" sub="Controls the pharmacy portal's alerts screen and its dashboard counts.">
          <div className="p-6">
            <Field label="Warn about expiring stock this many days ahead">
              <div className="flex items-center gap-3">
                <input type="number" min={1} max={730} className={`${fld} max-w-[130px]`}
                  value={f.expiryAlertDays}
                  onChange={(e) => set("expiryAlertDays")(Number(e.target.value))} />
                <span className="text-[12.5px] text-[var(--p-muted)]">days</span>
              </div>
            </Field>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
              Was fixed at 90. A counter that reorders weekly wants a shorter horizon;
              one that buys in bulk twice a year wants far longer. Applies to both the
              alerts list and the &quot;expiring soon&quot; count on the dashboard, so the two
              can never disagree.
            </p>
          </div>
        </Card>

        {/* ── SMS ────────────────────────────────────────────────────────── */}
        <SmsCard />

        {/* ── WARDS ──────────────────────────────────────────────────────── */}
        <Card title="Wards & discharge" sub="Controls what reception is allowed to do at the point of discharge.">
          <Toggle
            checked={f.blockDischargeOnDues}
            onChange={(v) => set("blockDischargeOnDues")(v)}
            label="Block a discharge while pharmacy or lab bills are unpaid"
            on="Reception is refused the discharge and told exactly which bills are open. They can still override it deliberately — the override is recorded with their name."
            off="Discharges go through with money still owed. The bills stay open and visible, but nobody is stopped on the way out. Only turn this off if you collect dues after the patient has left."
            risky
          />
        </Card>

        {/* ── AFTER-HOURS OP ─────────────────────────────────────────────── */}
        <Card title="After-hours OP charges" sub="What a consultation costs once the OP clinic has closed for the day.">
          <Toggle
            checked={f.afterHoursOpEnabled}
            onChange={(v) => set("afterHoursOpEnabled")(v)}
            label="Charge the emergency rate outside clinic hours"
            on="Inside the window below, reception books the visit as an emergency and the consultation is charged at the multiplier. The desk can still change the amount if a different fee was agreed, and the change is recorded with their name."
            off="The clock never changes what an OP visit costs. Every consultation is charged the doctor's day fee, whatever the hour."
          />
          {f.afterHoursOpEnabled && (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Window starts">
                <input type="time" className={fld} value={f.afterHoursOpStart}
                  onChange={(e) => set("afterHoursOpStart")(e.target.value)} />
              </Field>
              <Field label="Window ends">
                <input type="time" className={fld} value={f.afterHoursOpEnd}
                  onChange={(e) => set("afterHoursOpEnd")(e.target.value)} />
              </Field>
              <Field label="Multiply the day fee by">
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={10} step={0.25} className={`${fld} max-w-[110px]`}
                    value={f.afterHoursOpMultiplier}
                    onChange={(e) => set("afterHoursOpMultiplier")(Number(e.target.value))} />
                  <span className="text-[12.5px] text-[var(--p-muted)]">×</span>
                </div>
              </Field>
            </div>
          )}
          {f.afterHoursOpEnabled && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
              An end time <b>earlier</b> than the start means the window crosses midnight — 20:00 to 06:00
              covers the 2 AM call-in, which is the visit that should never go out at a day fee.
              The multiplier scales <b>each doctor&apos;s own</b> fee, so a ₹500 physician and a ₹900
              specialist both double instead of both landing on one flat figure.
              A visit is priced by <b>its own</b> time: an 8:30 PM slot is after-hours whenever it was
              booked, and tomorrow&apos;s 9 AM slot is not, even if booked at midnight.
            </p>
          )}
        </Card>

        {/* ── PUBLIC WEBSITE ─────────────────────────────────────────────── */}
        <Card title="Public website" sub="What the hospital's website is allowed to do without anyone at the desk.">
          <Toggle
            checked={f.onlineBookingEnabled}
            onChange={(v) => set("onlineBookingEnabled")(v)}
            label="Accept online appointment bookings"
            on="Patients can pick a slot on the website and book it themselves after verifying their mobile."
            off="The booking form stops accepting bookings and tells callers to phone the hospital. Existing appointments are untouched."
          />
          <Toggle
            checked={f.callbackRequestsEnabled}
            onChange={(v) => set("callbackRequestsEnabled")(v)}
            label="Accept callback requests"
            on="Visitors can leave a name, mobile and preferred doctor. Requests queue up for reception to ring back."
            off="The callback form is closed. Requests already in the queue stay there."
          />
        </Card>

        {/* ── ADMIN CONSOLE ──────────────────────────────────────────────── */}
        <Card title="Admin console" sub="What appears in this console's own sidebar.">
          <Toggle
            checked={f.accountsTabEnabled}
            onChange={(v) => set("accountsTabEnabled")(v)}
            label={"Show the “Accounts & GST” tab"}
            on="The sidebar carries a tab for the Tally ledger export and e-invoice (IRN) registration."
            off="The tab is hidden. This only tidies the sidebar — the screen and its API stay reachable and admin-only, so a saved link still works. Turn it off if your CA doesn't use Tally and you raise no bills to GST-registered buyers."
          />
        </Card>

        {msg && <p className="rounded-lg bg-[var(--p-teal-soft)] px-4 py-2.5 text-[13px] text-[var(--p-teal-deep)]">{msg}</p>}
        {error && <p className="rounded-lg bg-[var(--p-rose-soft)] px-4 py-2.5 text-[13px] text-[var(--p-rose)]">{error}</p>}

        <div className="sticky bottom-0 rounded-xl border border-[var(--p-border)] bg-white/95 p-4 backdrop-blur">
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> Save settings</>}
          </PrimaryButton>
        </div>
      </div>
    </PortalScroll>
  );
}

/**
 * SMS health, and a way to prove it.
 *
 * "SMS is not working" is never actionable on its own. An account can hold a
 * valid key and full credits and still be refused a particular route - which is
 * exactly what happens on a Fast2SMS account that has not completed website
 * verification. So this shows the provider, the route, the wallet, and lets an
 * admin send one real message and read the provider's own words back.
 */
function SmsCard() {
  const [info, setInfo] = useState<{
    status: { configured: boolean; provider: string | null; otpRoute: string | null; templateReady: boolean };
    balance: { ok: true; wallet: string; smsCount: number } | { ok: false; error: string };
  } | null>(null);
  const [to, setTo] = useState("");
  const [route, setRoute] = useState<"q" | "otp" | "dlt">("q");
  const [templateId, setTemplateId] = useState("");
  const [senderId, setSenderId] = useState("");
  const [variables, setVariables] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; route: string; to: string; providerSaid: unknown; sentParams?: unknown } | null>(null);

  useEffect(() => {
    api.get<NonNullable<typeof info>>("/admin/sms-test").then(setInfo).catch(() => {});
  }, []);

  async function send() {
    setBusy(true); setResult(null);
    try {
      setResult(await api.post("/admin/sms-test", {
        phone: to, route,
        ...(route === "dlt" ? { templateId, senderId, variables } : {}),
      }));
    }
    catch (e) { setResult({ sent: false, route, to, providerSaid: e instanceof Error ? e.message : "Request failed" }); }
    finally { setBusy(false); }
  }

  const ROUTES: { key: "q" | "otp" | "dlt"; label: string; hint: string }[] = [
    { key: "q", label: "Quick SMS", hint: "Free text. No DLT, no website verification. Will not reach a number on DND." },
    { key: "otp", label: "OTP route", hint: "What patient logins use. Needs website verification on the Fast2SMS account." },
    { key: "dlt", label: "DLT template", hint: "Your registered template. Needs SMS_OTP_TEMPLATE to be set." },
  ];

  return (
    <Card title="SMS" sub="Whether codes and confirmations can actually leave the building — and a way to prove it without waiting for a patient to complain.">
      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Provider" value={info?.status.provider ?? "not configured"}
            tone={info?.status.configured ? "good" : "bad"} />
          <Stat label="OTPs are sent via" value={info?.status.otpRoute ? `route "${info.status.otpRoute}"` : "—"} />
          <Stat
            label="Wallet"
            value={info?.balance.ok ? `₹${info.balance.wallet} · ${info.balance.smsCount} SMS` : "unavailable"}
            tone={info?.balance.ok ? (info.balance.smsCount > 0 ? "good" : "bad") : undefined}
          />
        </div>

        <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
          <p className="text-[12.5px] font-semibold text-[var(--p-ink)]">Send a test message</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
            This sends a real SMS and spends one credit. Use your own number. The provider&apos;s
            exact reply is shown below — that is what says whether the problem is the key,
            the credits, or a route this account is not cleared for.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {ROUTES.map((r) => (
              <button key={r.key} onClick={() => setRoute(r.key)} title={r.hint}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  route === r.key
                    ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"
                    : "border-[var(--p-border)] bg-white text-[var(--p-text)] hover:border-[var(--p-teal)]"
                }`}>
                {r.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--p-muted)]">
            {ROUTES.find((r) => r.key === route)!.hint}
          </p>

          {route === "dlt" && (
            <div className="mt-3 grid gap-2 rounded-lg border border-[var(--p-border)] bg-white p-3 sm:grid-cols-3">
              {/* Typed here rather than read from env, so a template can be
                  PROVEN before it is committed and redeployed. */}
              <label className="block">
                <span className="block text-[11px] font-semibold text-[var(--p-text)]">Fast2SMS Message ID</span>
                <input value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                  placeholder="from DLT → your template"
                  className="mt-1 w-full rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-[var(--p-teal)]" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-[var(--p-text)]">Sender ID (header)</span>
                <input value={senderId} onChange={(e) => setSenderId(e.target.value.toUpperCase())}
                  placeholder="JEEVAH" maxLength={11}
                  className="mt-1 w-full rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-[var(--p-teal)]" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-[var(--p-text)]">Variables (pipe-separated)</span>
                <input value={variables} onChange={(e) => setVariables(e.target.value)}
                  placeholder="123456"
                  className="mt-1 w-full rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-[var(--p-teal)]" />
              </label>
              <p className="text-[11px] leading-relaxed text-[var(--p-muted)] sm:col-span-3">
                Values fill the template&apos;s <code>{"{#var#}"}</code> slots <b>in order</b>, and the
                provider does not check that order — a template written differently will send a
                confidently wrong message. One variable for an OTP template.
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={to} inputMode="numeric" maxLength={14} placeholder="10-digit mobile"
              onChange={(e) => setTo(e.target.value.replace(/[^\d+ ]/g, ""))}
              className="w-[190px] rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 font-mono text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]"
            />
            <button onClick={send} disabled={busy || to.replace(/\D/g, "").length < 10}
              className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
              {busy ? <Spinner /> : <Icon name="check" size={14} />} {busy ? "Sending…" : "Send test"}
            </button>
          </div>

          {result && (
            <div className={`mt-3 rounded-lg border px-4 py-3 ${
              result.sent
                ? "border-[var(--p-teal)]/30 bg-[var(--p-teal-soft)]"
                : "border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)]"
            }`}>
              <p className={`text-[13px] font-bold ${result.sent ? "text-[var(--p-teal-deep)]" : "text-[var(--p-rose)]"}`}>
                {result.sent
                  ? `Sent to ${result.to} on route "${result.route}" — check the handset.`
                  : `Not sent (route "${result.route}").`}
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--p-text)]">
{JSON.stringify(result.providerSaid, null, 2)}
              </pre>
              {!result.sent && result.sentParams != null && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-[var(--p-text)]">
                    what was sent
                  </summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-[var(--p-muted)]">
{JSON.stringify(result.sentParams, null, 2)}
                  </pre>
                </details>
              )}
              {!result.sent && (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-rose)]">
                  <b>996</b> complete website verification in the Fast2SMS dashboard (OTP Message
                  menu) · <b>412</b> the API key is wrong · <b>406</b> that sender ID / header is not
                  approved on this account · <b>995</b> that DLT template is not approved.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-[var(--p-border)] bg-white px-4 py-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</div>
      <div className={`mt-0.5 text-[13.5px] font-semibold ${
        tone === "good" ? "text-[var(--p-teal-deep)]" : tone === "bad" ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"
      }`}>{value}</div>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section data-rise className="surface overflow-hidden">
      <div className="border-b border-[var(--p-border)] px-6 py-4">
        <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">{title}</h2>
        <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-[var(--p-muted)]">{sub}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * A switch that says what it DOES, in both positions.
 *
 * "Block discharge on dues [x]" tells an admin nothing about what unticking it
 * costs them. The consequence of the state you are about to move to is the only
 * thing worth putting on screen, so both sentences are always written and the
 * live one is highlighted.
 */
function Toggle({
  checked, onChange, label, on, off, risky,
}: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; on: string; off: string; risky?: boolean;
}) {
  return (
    <div className="border-b border-[var(--p-border)] px-6 py-4 last:border-b-0">
      <label className="flex cursor-pointer items-start gap-3">
        <button
          type="button" role="switch" aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
            checked ? "bg-[var(--p-teal)]" : "bg-[var(--p-border-strong)]"
          }`}
        >
          <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[19px]" : "left-[3px]"}`} />
        </button>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-[var(--p-ink)]">{label}</span>
          <span className={`mt-1 block text-[12px] leading-relaxed ${checked ? "text-[var(--p-teal-deep)]" : "text-[var(--p-muted)]"}`}>
            <b>On:</b> {on}
          </span>
          <span className={`mt-0.5 block text-[12px] leading-relaxed ${
            !checked ? (risky ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]") : "text-[var(--p-muted)]"
          }`}>
            <b>Off:</b> {off}
          </span>
        </span>
      </label>
    </div>
  );
}
