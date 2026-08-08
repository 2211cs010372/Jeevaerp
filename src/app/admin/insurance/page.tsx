"use client";

import { useState } from "react";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { ClaimsBoard } from "@/components/portal/insurance/claims-board";
import { InsuranceAnalytics } from "@/components/portal/insurance/insurance-analytics";

/**
 * The proprietor's view of the insurance book - two questions, two tabs.
 *
 * MONEY first, and it is the default. An owner opening this screen is asking
 * "what is this costing me and when do I get paid", not "what is the status of
 * claim 47" - the desk asks that, and it has its own portal. The claims list is
 * the same board the desk works from (see ClaimsBoard) and is one click away.
 */
export default function AdminInsurancePage() {
  const [tab, setTab] = useState<"MONEY" | "CLAIMS">("MONEY");

  if (tab === "CLAIMS") {
    return (
      <>
        <div className="mx-auto w-full px-6 pt-5">
          <Tabs tab={tab} setTab={setTab} />
        </div>
        <ClaimsBoard apiBase="/admin/insurance" />
      </>
    );
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Insurance</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-[var(--p-muted)]">
          What has been claimed, what insurers agreed to, and what has actually been paid.
        </p>
        <div className="mt-4"><Tabs tab={tab} setTab={setTab} /></div>
      </div>
      <div data-rise><InsuranceAnalytics /></div>
    </PortalScroll>
  );
}

function Tabs({ tab, setTab }: { tab: "MONEY" | "CLAIMS"; setTab: (t: "MONEY" | "CLAIMS") => void }) {
  return (
    <div className="inline-flex gap-1 rounded-md border border-[var(--p-border)] bg-white p-1">
      {([["MONEY", "Money"], ["CLAIMS", "Claims"]] as const).map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`rounded px-4 py-1.5 text-[12.5px] font-semibold transition-colors ${
            tab === k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
