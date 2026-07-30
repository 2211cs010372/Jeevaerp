"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { PRINT_CSS, PrintToolbar } from "@/components/print/stationery";
import { isClosed, OUTCOME_LABEL, type AdmissionStatusValue } from "@/lib/admission-outcome";

/* ── shape (mirrors dischargeSummaryData) ─────────────────────────────────── */
interface Data {
  hospital: { legalName: string; addressLine: string; city: string; state: string; pincode: string; gstin: string | null; phone: string | null; email: string | null } | null;
  generatedAt: string;
  admission: { ipNumber: string; status: string; admittedAt: string; dischargedAt: string | null; days: number; wardName: string; bedNo: string; reason: string | null; observations: string | null };
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; phone: string; address: string | null; city: string | null; bloodGroup: string | null; dob: string | null };
  doctor: { name: string; specialization: string; department: string };
  clinical: { diagnosis: string | null; advice: string | null; nextVisit: string | null; labsAdvised: string[] };
  medicines: { name: string; qty: number; dosage: string | null }[];
  investigations: { testName: string; status: string; reportReady: boolean; date: string }[];
  bill: {
    legs: { wardName: string; bedNo: string; dailyCharge: string; days: number; total: string; current: boolean }[];
    bedTotal: string; nurseTotal: string; nursePerDay: string;
    charges: { description: string; category: string; qty: number; unitPrice: string; amount: string }[];
    chargesTotal: string; grandTotal: string; advanceTotal: string; balance: string;
  };
}

const money = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const GENDER: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

export function DischargeSummary() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Data>(`/ipd/admissions/${admissionId}/discharge-summary`)
      .then(setD)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load the summary."));
  }, [admissionId]);

  if (error) return <div className="p-10 text-center text-[14px] text-[#8a3b2e]">{error}</div>;
  if (!d) return <div className="p-10 text-center text-[14px] text-[#5a6a66]">Preparing the discharge summary…</div>;

  const p = d.patient;
  const a = d.admission;
  const ageSex = [p.age != null ? `${p.age}y` : null, p.gender ? GENDER[p.gender] ?? p.gender : null].filter(Boolean).join(" · ") || "-";
  const hosp = d.hospital;
  // isClosed, not `=== "DISCHARGED"`. On the old check a stay that ended as LAMA
  // or EXPIRED printed with the "interim (still admitted)" banner across the top -
  // a summary that contradicted itself on the one document a relative keeps.
  const closed = isClosed(a.status);
  // Only an ordinary discharge is left unlabelled. Anything else has to say what
  // it was: this is the document that gets read years later, and a death filed as
  // a plain "Discharge Summary" is exactly the ambiguity to avoid.
  const outcomeNote =
    closed && a.status !== "DISCHARGED"
      ? OUTCOME_LABEL[a.status as AdmissionStatusValue]
      : null;

  return (
    <div className="print-stage">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS + EXTRA_CSS }} />
      <PrintToolbar title={`Discharge summary · ${a.ipNumber} · ${p.fullName}`} />

      <div id="print-sheet" className="ds">
        {/* ── masthead ── */}
        <header className="ds-head">
          <div>
            <h1 className="ds-hosp">{(hosp?.legalName ?? "Jeeva Multispeciality Hospital").toUpperCase()}</h1>
            <p className="ds-hosp-sub">
              {hosp ? `${hosp.addressLine}, ${hosp.city}, ${hosp.state} – ${hosp.pincode}` : "Hanamkonda, Telangana"}
              {hosp?.phone && ` · ☏ ${hosp.phone}`}
            </p>
          </div>
          <div className="ds-badge">
            <span className="ds-badge-k">Discharge Summary</span>
            <span className="ds-badge-v">{a.ipNumber}</span>
          </div>
        </header>
        <div className="ds-titlebar">
          DISCHARGE SUMMARY
          {!closed && <span className="ds-interim"> · interim (still admitted)</span>}
          {outcomeNote && <span className="ds-interim"> · {outcomeNote.toUpperCase()}</span>}
        </div>

        {/* ── patient / stay grid ── */}
        <section className="ds-info">
          <Info k="Patient" v={p.fullName} wide />
          <Info k="UHID" v={p.displayId} mono />
          <Info k="Age / Sex" v={ageSex} />
          <Info k="Blood group" v={p.bloodGroup ?? "-"} />
          <Info k="Phone" v={p.phone} mono />
          <Info k="Consultant" v={`${d.doctor.name}`} wide />
          <Info k="Department" v={d.doctor.department} />
          <Info k="Ward / Bed" v={`${a.wardName} · ${a.bedNo}`} />
          <Info k="Admitted" v={dateTime(a.admittedAt)} />
          <Info k={outcomeNote ?? "Discharged"} v={closed ? dateTime(a.dischargedAt) : "-"} />
          <Info k="Length of stay" v={`${a.days} day${a.days === 1 ? "" : "s"}`} />
          {p.address && <Info k="Address" v={[p.address, p.city].filter(Boolean).join(", ")} wide />}
        </section>

        {/* ── clinical narrative ── */}
        <Block title="Reason for admission">
          <p className="ds-body">{a.reason || "Not recorded."}</p>
        </Block>

        <Block title="Diagnosis">
          <p className="ds-body">{d.clinical.diagnosis || "Not recorded on the stay's prescriptions."}</p>
        </Block>

        <Block title="Course in hospital / observations">
          {a.observations
            ? <p className="ds-body ds-pre">{a.observations}</p>
            : <p className="ds-body ds-muted">No nursing / observation notes were recorded.</p>}
        </Block>

        {(d.investigations.length > 0 || d.clinical.labsAdvised.length > 0) && (
          <Block title="Investigations">
            {d.investigations.length > 0 && (
              <table className="ds-table">
                <thead><tr><th>Test</th><th>Date</th><th className="ds-r">Status</th></tr></thead>
                <tbody>
                  {d.investigations.map((t, i) => (
                    <tr key={i}>
                      <td>{t.testName}</td>
                      <td className="ds-mono">{date(t.date)}</td>
                      <td className="ds-r">{t.reportReady ? "Report ready" : t.status === "COMPLETED" ? "Completed" : "Pending"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.clinical.labsAdvised.length > 0 && (
              <p className="ds-body ds-sm"><b>Advised:</b> {d.clinical.labsAdvised.join(", ")}</p>
            )}
          </Block>
        )}

        <Block title="Medications">
          {d.medicines.length > 0 ? (
            <table className="ds-table">
              <thead><tr><th className="ds-idx">#</th><th>Medicine</th><th className="ds-r">Qty</th><th>Dosage</th></tr></thead>
              <tbody>
                {d.medicines.map((m, i) => (
                  <tr key={i}>
                    <td className="ds-idx ds-mono">{i + 1}</td>
                    <td>{m.name}</td>
                    <td className="ds-r ds-mono">{m.qty}</td>
                    <td className="ds-mono">{m.dosage ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="ds-body ds-muted">No medicines were recorded against this stay.</p>}
        </Block>

        <div className="ds-two">
          <Block title="Advice on discharge">
            <p className="ds-body">{d.clinical.advice || "-"}</p>
          </Block>
          <Block title="Follow-up">
            <p className="ds-body">{d.clinical.nextVisit || "As advised."}</p>
          </Block>
        </div>

        {/* ── billing summary ── */}
        <Block title="Billing summary">
          <table className="ds-table">
            <tbody>
              {d.bill.legs.length > 0 ? d.bill.legs.map((l, i) => (
                <tr key={i}>
                  <td>Bed · {l.wardName} · {l.bedNo} <span className="ds-muted">({l.days}d × {money(l.dailyCharge)})</span></td>
                  <td className="ds-r ds-mono">{money(l.total)}</td>
                </tr>
              )) : (
                <tr><td>Bed charges</td><td className="ds-r ds-mono">{money(d.bill.bedTotal)}</td></tr>
              )}
              <tr>
                <td>Nursing care <span className="ds-muted">({a.days}d × {money(d.bill.nursePerDay)})</span></td>
                <td className="ds-r ds-mono">{money(d.bill.nurseTotal)}</td>
              </tr>
              {d.bill.charges.map((c, i) => (
                <tr key={`c${i}`}>
                  <td>{c.description} <span className="ds-muted">({c.qty} × {money(c.unitPrice)})</span></td>
                  <td className="ds-r ds-mono">{money(c.amount)}</td>
                </tr>
              ))}
              <tr className="ds-total">
                <td>Grand total</td>
                <td className="ds-r ds-mono">{money(d.bill.grandTotal)}</td>
              </tr>
              {Number(d.bill.advanceTotal) > 0 && (
                <>
                  <tr><td>Advance received</td><td className="ds-r ds-mono">− {money(d.bill.advanceTotal)}</td></tr>
                  <tr className="ds-total"><td>{Number(d.bill.balance) > 0 ? "Balance payable" : "Settled"}</td><td className="ds-r ds-mono">{money(d.bill.balance)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </Block>

        {/* ── sign-off ── */}
        <footer className="ds-foot">
          <div>
            <p className="ds-note">
              Computer-generated discharge summary, printed {dateTime(d.generatedAt)}.
              Keep this for your records and carry it to every follow-up visit.
            </p>
          </div>
          <div className="ds-sign">
            <div className="ds-sign-line" />
            <div className="ds-sign-name">{d.doctor.name}</div>
            <div className="ds-sign-sub">{d.doctor.specialization} · {d.doctor.department}</div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Info({ k, v, wide, mono }: { k: string; v: string; wide?: boolean; mono?: boolean }) {
  return (
    <div className={`ds-cell${wide ? " ds-cell-wide" : ""}`}>
      <span className="ds-cell-k">{k}</span>
      <span className={`ds-cell-v${mono ? " ds-mono" : ""}`}>{v}</span>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ds-block">
      <h2 className="ds-block-t">{title}</h2>
      {children}
    </section>
  );
}

/* A layout of its own - not the OPD/invoice stationery. Ink stays within the
   print colour vars so it prints clean on any office laser. */
const EXTRA_CSS = `
  #print-sheet.ds { padding: 12mm 12mm 0; font-size: 11px; color: #1c2624; }
  .ds-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--pr-primary); }
  .ds-hosp { font-size: 18px; font-weight: 800; letter-spacing: .02em; color: var(--pr-primary); }
  .ds-hosp-sub { margin-top: 2px; font-size: 9.5px; color: #55635e; }
  .ds-badge { text-align: right; }
  .ds-badge-k { display: block; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: #7c8983; }
  .ds-badge-v { display: block; font-family: var(--font-plex-mono, monospace); font-size: 14px; font-weight: 700; color: #1c2624; }
  .ds-titlebar { margin-top: 10px; text-align: center; font-size: 13px; font-weight: 800; letter-spacing: .22em; color: var(--pr-primary); }
  .ds-interim { font-weight: 600; letter-spacing: .04em; color: #a06414; text-transform: none; }

  .ds-info { margin-top: 12px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: #dbe3e0; border: 1px solid #dbe3e0; border-radius: 6px; overflow: hidden; }
  .ds-cell { background: #fff; padding: 6px 9px; }
  .ds-cell-wide { grid-column: span 2; }
  .ds-cell-k { display: block; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #7c8983; }
  .ds-cell-v { display: block; margin-top: 1px; font-size: 11.5px; font-weight: 600; color: #1c2624; }
  .ds-mono { font-family: var(--font-plex-mono, monospace); }

  .ds-block { margin-top: 13px; break-inside: avoid; }
  .ds-block-t { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: var(--pr-primary); border-bottom: 1px solid #cfd8d4; padding-bottom: 3px; margin-bottom: 6px; }
  .ds-body { font-size: 11px; line-height: 1.5; color: #26302d; }
  .ds-pre { white-space: pre-wrap; }
  .ds-sm { margin-top: 6px; font-size: 10.5px; }
  .ds-muted { color: #7c8983; }
  .ds-two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

  .ds-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .ds-table th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: #7c8983; border-bottom: 1.5px solid #cfd8d4; padding: 3px 4px; }
  .ds-table td { padding: 4px 4px; border-bottom: 1px solid #e6ebe9; vertical-align: top; }
  .ds-r { text-align: right; }
  .ds-idx { width: 22px; color: #7c8983; }
  .ds-total td { font-weight: 800; color: var(--pr-primary); border-top: 1.5px solid var(--pr-primary); border-bottom: none; }

  .ds-foot { margin-top: 20px; padding-top: 10px; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
  .ds-note { font-size: 8.5px; color: #7c8983; max-width: 62%; line-height: 1.5; }
  .ds-sign { text-align: center; }
  .ds-sign-line { width: 170px; border-bottom: 1px solid #1c2624; }
  .ds-sign-name { margin-top: 3px; font-size: 11px; font-weight: 700; }
  .ds-sign-sub { font-size: 8.5px; color: #55635e; }
`;
