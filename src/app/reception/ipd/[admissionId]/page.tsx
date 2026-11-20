"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { SvgArrow } from "@/components/portal/ui/svg-arrow";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { DischargeSummaryForm } from "@/components/portal/ipd/discharge-summary-form";
import { CorrectStayDialog, type StayLeg } from "@/components/portal/ipd/correct-stay-dialog";
import { CorrectChargeDialog, chargeDateLabel } from "@/components/portal/ipd/correct-charge-dialog";
import { EditAdvanceDialog } from "@/components/portal/ipd/edit-advance-dialog";
import { ConvertToSelfPayDialog } from "@/components/portal/ipd/convert-to-self-pay-dialog";
import { api, ApiClientError } from "@/lib/api-client";
import { RepeatConfirmDialog } from "@/components/portal/repeat-confirm-dialog";
import { repeatBlock, type RepeatBlock } from "@/lib/repeat-guard";
import { bedLabel } from "@/lib/beds";
import { EditBillDialog, useBillEditing, type BillEditSavedInfo } from "@/components/portal/billing/edit-bill-dialog";
import { PatientHistoryPanel } from "@/components/portal/ipd/patient-history-panel";
import { ForgottenBillsPanel } from "@/components/portal/ipd/forgotten-bills-panel";
import { ChangeDoctorDialog } from "@/components/portal/ipd/change-doctor-dialog";

/** One row of the hospital's published rate card. See prisma ServiceCharge. */
interface ServiceCharge {
  id: string; name: string; group: string; category: string;
  price: string; gstRatePct: string; perDay: boolean;
}
const SERVICE_GROUP_LABEL: Record<string, string> = {
  IP_CHARGE: "Inpatient charges",
  SURGERY_OPEN: "Surgery - open",
  SURGERY_LAPAROSCOPIC: "Surgery - laparoscopic",
  OTHER: "Other",
};

/**
 * Modern ElevenLabs Light Studio Searchable Rate Card Selection List
 */
function RateCardSelect({
  services,
  selectedId,
  onPick,
  onRemove,
  onSelectNone,
}: {
  services: ServiceCharge[];
  selectedId?: string | null;
  onPick: (id: string) => void;
  onRemove: () => void;
  onSelectNone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedService = useMemo(() => {
    return services.find((s) => s.id === selectedId) ?? null;
  }, [services, selectedId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return services;
    const q = search.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (SERVICE_GROUP_LABEL[s.group] && SERVICE_GROUP_LABEL[s.group].toLowerCase().includes(q)) ||
        s.category.toLowerCase().includes(q)
    );
  }, [services, search]);

  const groups = useMemo(() => {
    return Object.keys(SERVICE_GROUP_LABEL)
      .filter((g) => filtered.some((x) => x.group === g))
      .map((g) => ({
        key: g,
        label: SERVICE_GROUP_LABEL[g],
        items: filtered.filter((x) => x.group === g),
      }));
  }, [filtered]);

  return (
    <div className={`relative mb-3 ${open ? "z-30" : ""}`} ref={containerRef}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--p-muted)]">
          Pick from the rate card
        </label>
        {selectedService && (
          <span className="text-[11px] text-[var(--p-muted)] truncate max-w-[260px]">
            Selected: <span className="font-medium text-[var(--p-ink)]">{selectedService.name}</span>
          </span>
        )}
      </div>

      {/* Modern Studio Combobox Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group flex h-10 w-full items-center justify-between rounded-xl border bg-white px-3.5 text-left transition-all ${
          open
            ? "border-[#111111] ring-2 ring-black/5 shadow-sm"
            : "border-[var(--p-border)] hover:border-[#111111]/40 shadow-xs"
        }`}
      >
        <span className="flex items-center gap-2.5 truncate text-[13.5px]">
          <Icon name="search" size={15} className="shrink-0 text-[var(--p-muted)]" />
          <span className={selectedService ? "text-[var(--p-ink)] font-medium" : "text-[var(--p-muted)]"}>
            {selectedService ? selectedService.name : "Choose a service from rate card, or type one below…"}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0 pl-2">
          {selectedService && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title="Remove selected service"
              className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] font-medium text-[#737373] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 transition-colors"
            >
              <span className="text-[10px]">✕</span> Remove
            </button>
          )}
          <span className="rounded-md bg-[#f5f5f4] px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-[#737373]">
            {services.length} services
          </span>
          <svg
            className={`h-4 w-4 text-[var(--p-muted)] transition-transform duration-200 ${open ? "rotate-180 text-[var(--p-ink)]" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {/* Floating Studio Selection Dropdown */}
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-[100] w-full overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.18)] animate-in fade-in zoom-in-95 duration-150">
          {/* Studio Search Bar */}
          <div className="flex items-center gap-2.5 border-b border-[var(--p-border)] bg-[#fafafa] px-3.5 py-2.5">
            <Icon name="search" size={15} className="shrink-0 text-[var(--p-muted)]" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter services by name, category or code…"
              className="w-full bg-transparent text-[13px] text-[var(--p-ink)] placeholder-[var(--p-muted)] outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-[11px] font-semibold text-[var(--p-muted)] hover:text-[var(--p-ink)]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Select None / Clear Option */}
          <div className="p-1 border-b border-[var(--p-border)]/50 bg-[#fafafa]/50">
            <button
              type="button"
              onClick={() => {
                onSelectNone();
                setOpen(false);
                setSearch("");
              }}
              className="group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-rose-50/60"
            >
              <span className="flex items-center gap-2 text-[12.5px] font-medium text-[#737373] group-hover:text-rose-700">
                <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[10px] text-[#737373] group-hover:border-rose-300 group-hover:text-rose-600">
                  ✕
                </span>
                <span>Select none (Clear selection)</span>
              </span>
              {selectedId && (
                <span className="text-[11px] font-medium text-rose-600">Deselect</span>
              )}
            </button>
          </div>

          {/* Grouped Service Options List */}
          <div className="max-h-72 overflow-y-auto p-1.5 divide-y divide-[var(--p-border)]/50 [scrollbar-width:thin]">
            {groups.length === 0 ? (
              <div className="py-8 text-center text-[12.5px] text-[var(--p-muted)]">
                No services found matching &quot;{search}&quot;
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.key} className="py-1.5 first:pt-0 last:pb-0">
                  <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--p-muted)]">
                    {group.label}
                  </div>
                  <div className="space-y-0.5 mt-0.5">
                    {group.items.map((x) => {
                      const isPicked = selectedId === x.id;
                      return (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => {
                            onPick(x.id);
                            setOpen(false);
                            setSearch("");
                          }}
                          className={`group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors ${
                            isPicked ? "bg-[#f5f5f4] font-medium" : "hover:bg-[#f5f5f4]"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-3">
                            <span className="block truncate text-[13px] font-medium text-[var(--p-ink)] group-hover:text-black">
                              {x.name}
                            </span>
                            <span className="block text-[11px] text-[var(--p-muted)]">
                              {x.category}
                            </span>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="inline-flex items-center gap-1 rounded-md bg-[#fafafa] group-hover:bg-white px-2 py-0.5 font-mono text-[12px] font-semibold text-[var(--p-ink)] border border-[var(--p-border)] shadow-xs">
                              ₹{Number(x.price).toLocaleString("en-IN")}
                              {x.perDay && (
                                <span className="font-sans text-[10px] font-normal text-[var(--p-muted)]">/day</span>
                              )}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface Charge {
  id: string; category: string; description: string; qty: number;
  unitPrice: string; gstRatePct: string; amount: string;
  addedBy: string; createdAt: string; fromPharmacy: boolean;
}
interface Sheet {
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    /** Null while they are still in a bed. */
    dischargedAt: string | null;
    wardName: string; bedNo: string; dailyCharge: string; gstRatePct: string;
    attendantName: string | null; attendantPhone: string | null; attendantRelation: string | null;
    payerType: string; insurer: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number; bedTotal: string; charges: Charge[]; chargesTotal: string; grandTotal: string;
  nurseTotal: string; nursePerDay: string;
  /** False since the per-day nursing fee was withdrawn. True only on a stay
   *  already billed for it, which keeps its row. See ipd.service. */
  nursingApplies: boolean;
  /** Append-only chronology - see AdmissionNote. Never edited in place. */
  notes: { id: string; body: string; kind: "NURSING" | "DISCHARGE"; authorName: string | null; createdAt: string }[];
  /** One row per bed occupied. Two rows = they were transferred mid-stay. */
  legs: StayLeg[];
  /** Nights no bed line covers, because a bed was capped and the rest has not
   *  been raised as a charge yet. 0 on an ordinary stay. See ipd.service. */
  uncoveredDays: number;
  advanceTotal: string;
  /** Each deposit slip taken on this stay - listed so any can be reprinted. */
  advances: (Advance & { takenAt: string })[];
  /** Pharmacy and lab bills for this stay that are still unpaid. Separate
   *  documents from the discharge bill - this is where they surface. */
  outstandingBills: { id: string; receiptNo: string; source: string; total: string; paid: string; due: string; createdAt: string }[];
  outstandingTotal: string;
  /** Cashless stays only: pharmacy and lab going to the insurer, counted in the
   *  total rather than chased at a counter. Empty on a self-paying stay. */
  claimBills: { id: string; receiptNo: string; source: string; total: string; createdAt: string }[];
  claimBillsTotal: string;
  claimTotal: string;
  balance: string;
  /** EVERY counter bill on the stay, paid ones included - what the tab lists.
   *  outstandingBills drops a bill as soon as it is settled; this does not, so
   *  a medicine paid for at the pharmacy window still shows what the stay cost. */
  counterBills: {
    id: string; receiptNo: string; source: string;
    total: string; paid: string; due: string;
    status: "PAID" | "PART" | "DUE"; payer: string; createdAt: string;
  }[];
  counterPaidTotal: string;
}
interface Med { id: string; name: string; unit: string; inStock: number; }
/** One deposit slip. `receiptNo` is what the family quotes at discharge. */
interface Advance { id: string; receiptNo: string; amount: string; mode: string; reference: string | null; }

const CATEGORIES = [
  { k: "PROCEDURE", label: "Procedure" },
  { k: "DOCTOR_VISIT", label: "Doctor round" },
  { k: "NURSING", label: "Nursing" },
  { k: "OXYGEN", label: "Oxygen" },
  { k: "INVESTIGATION", label: "Investigation" },
  { k: "CONSUMABLE", label: "Consumables" },
  { k: "OTHER", label: "Other" },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.k, c.label]));
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export default function AdmissionSheetPage() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** The server's "already on the bill" refusal, and how to go ahead anyway. */
  const [repeat, setRepeat] = useState<{ block: RepeatBlock; message: string; retry: () => void } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);

  // ── CORRECTING A BILL RAISED AGAINST THIS STAY ──
  //
  // The pharmacy and the lab raise their own invoices against an admission, and
  // this screen is where the ward actually looks at them - so it is where a
  // wrong one gets noticed. Until now it could only print them.
  //
  // Gated by HospitalConfig.billEditingEnabled like the rest of reception; the
  // server enforces it inside updateInvoice, this only draws the button.
  const { canEdit } = useBillEditing();
  const [editingBillId, setEditingBillId] = useState<string | null>(null);

  // ── THE THREE FIGURES THAT WERE NOT LINES ──
  //
  // Bed, nursing and the day count are the biggest numbers on the sheet and were
  // the only ones with no edit path - see CorrectStayDialog. Reached from the two
  // rows themselves, because that is where somebody notices they are wrong.
  const [correctOpen, setCorrectOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  /** The insurer refused - the stay and its bills become the family's. */
  const [rejectOpen, setRejectOpen] = useState(false);
  /** The tab line whose date is being corrected - see CorrectChargeDialog. */
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  /** The deposit slip being corrected - see EditAdvanceDialog. */
  const [editingAdvanceId, setEditingAdvanceId] = useState<string | null>(null);

  // add-charge form
  const [cat, setCat] = useState("PROCEDURE");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [gst, setGst] = useState("0");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  // Line form undo/redo history
  type LineFormState = {
    cat: string;
    desc: string;
    qty: string;
    price: string;
    gst: string;
    selectedServiceId: string | null;
  };
  const [lineHistory, setLineHistory] = useState<LineFormState[]>([
    { cat: "PROCEDURE", desc: "", qty: "1", price: "", gst: "0", selectedServiceId: null },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [lastRemovedCharge, setLastRemovedCharge] = useState<Charge | null>(null);
  const [lastRemovedBillItem, setLastRemovedBillItem] = useState<{
    invoiceId: string;
    receiptNo?: string;
    item: { description: string; qty: number; unitPrice: string; gstRatePct: string; hsnSac: string | null };
  } | null>(null);

  // Discard confirmation popup state
  const [discardModalOpen, setDiscardModalOpen] = useState(false);

  function pushLineHistory(nextState: LineFormState) {
    setLineHistory((prev) => {
      const curr = prev[historyIndex];
      if (
        curr &&
        curr.cat === nextState.cat &&
        curr.desc === nextState.desc &&
        curr.qty === nextState.qty &&
        curr.price === nextState.price &&
        curr.gst === nextState.gst &&
        curr.selectedServiceId === nextState.selectedServiceId
      ) {
        return prev;
      }
      const sliced = prev.slice(0, historyIndex + 1);
      return [...sliced, nextState];
    });
    setHistoryIndex((prev) => prev + 1);
  }

  async function handleUndo() {
    // 1. Restoring a bill item removed from a pharmacy or counter bill
    if (lastRemovedBillItem) {
      setBusy(true);
      setErr(null);
      try {
        const { invoice } = await api.get<{ invoice: any }>(`/billing/invoice/${lastRemovedBillItem.invoiceId}`);
        const lines = (invoice.items || []).map((i: any) => ({
          description: i.description,
          qty: i.qty,
          unitPrice: Number(i.unitPrice),
          gstRatePct: Number(i.gstRatePct),
          hsnSac: i.hsnSac ?? undefined,
        }));
        lines.push({
          description: lastRemovedBillItem.item.description,
          qty: lastRemovedBillItem.item.qty,
          unitPrice: Number(lastRemovedBillItem.item.unitPrice),
          gstRatePct: Number(lastRemovedBillItem.item.gstRatePct),
          hsnSac: lastRemovedBillItem.item.hsnSac ?? undefined,
        });
        await api.patch(`/billing/invoice/${lastRemovedBillItem.invoiceId}`, {
          lines,
          trimPaymentsToTotal: true,
        });
        setFlash(`Restored "${lastRemovedBillItem.item.description}" to bill.`);
        setLastRemovedBillItem(null);
        await load();
        loadHistory();
      } catch (e) {
        setErr(e instanceof ApiClientError ? e.message : "Could not restore bill item.");
      } finally {
        setBusy(false);
      }
      return;
    }

    // 2. Restoring a charge removed from the stay running tab
    if (lastRemovedCharge) {
      setBusy(true);
      setErr(null);
      try {
        await api.post(`/ipd/admissions/${admissionId}/charges`, {
          category: lastRemovedCharge.category,
          description: lastRemovedCharge.description,
          qty: lastRemovedCharge.qty,
          unitPrice: Number(lastRemovedCharge.unitPrice),
          gstRatePct: Number(lastRemovedCharge.gstRatePct),
        });
        setFlash(`Restored "${lastRemovedCharge.description}" to the tab.`);
        setLastRemovedCharge(null);
        await load();
      } catch (e) {
        setErr(e instanceof ApiClientError ? e.message : "Could not restore charge.");
      } finally {
        setBusy(false);
      }
      return;
    }

    // 3. Line form field history
    if (historyIndex > 0) {
      const prevIdx = historyIndex - 1;
      const target = lineHistory[prevIdx];
      setHistoryIndex(prevIdx);
      setCat(target.cat);
      setDesc(target.desc);
      setQty(target.qty);
      setPrice(target.price);
      setGst(target.gst);
      setSelectedServiceId(target.selectedServiceId);
      return;
    }
  }

  function handleRedo() {
    if (historyIndex < lineHistory.length - 1) {
      const nextIdx = historyIndex + 1;
      const target = lineHistory[nextIdx];
      setHistoryIndex(nextIdx);
      setCat(target.cat);
      setDesc(target.desc);
      setQty(target.qty);
      setPrice(target.price);
      setGst(target.gst);
      setSelectedServiceId(target.selectedServiceId);
    }
  }

  function commitLineField(updates: Partial<LineFormState>) {
    const next: LineFormState = {
      cat: updates.cat ?? cat,
      desc: updates.desc ?? desc,
      qty: updates.qty ?? qty,
      price: updates.price ?? price,
      gst: updates.gst ?? gst,
      selectedServiceId: updates.selectedServiceId !== undefined ? updates.selectedServiceId : selectedServiceId,
    };
    pushLineHistory(next);
  }

  function discardLineChanges() {
    setCat("PROCEDURE");
    setDesc("");
    setQty("1");
    setPrice("");
    setGst("0");
    setSelectedServiceId(null);
    pushLineHistory({
      cat: "PROCEDURE",
      desc: "",
      qty: "1",
      price: "",
      gst: "0",
      selectedServiceId: null,
    });
    setDiscardModalOpen(false);
  }

  function handleRequestDiscard() {
    if (desc.trim() || price || selectedServiceId) {
      setDiscardModalOpen(true);
    } else {
      discardLineChanges();
    }
  }

  // The hospital's published rate card - the boards on the wall, in a dropdown.
  const [services, setServices] = useState<ServiceCharge[]>([]);
  useEffect(() => {
    api.get<{ services: ServiceCharge[] }>("/ipd/services").then((r) => setServices(r.services)).catch(() => {});
  }, []);

  /** Fill the line from the rate card, leaving every box editable. */
  function pickService(id: string) {
    const svc = services.find((x) => x.id === id);
    if (!svc) return;
    const nextQty = svc.perDay && sheet ? String(sheet.days) : "1";
    const nextPrice = String(Number(svc.price));
    const nextGst = String(Number(svc.gstRatePct));
    setDesc(svc.name);
    setCat(svc.category);
    setPrice(nextPrice);
    setGst(nextGst);
    setQty(nextQty);
    setSelectedServiceId(id);
    pushLineHistory({
      cat: svc.category,
      desc: svc.name,
      qty: nextQty,
      price: nextPrice,
      gst: nextGst,
      selectedServiceId: id,
    });
  }

  // nursing / observation notes
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  // IP prescription
  // ── TRANSFER ── General → ICU. Until now the only way was discharge+readmit,
  //    which splits one stay into two bills.
  const [xferOpen, setXferOpen] = useState(false);
  const [xferWards, setXferWards] = useState<{ id: string; name: string; dailyCharge: string; gstRatePct: string; beds: { id: string; bedNo: string }[] }[]>([]);
  const [xferBed, setXferBed] = useState("");
  const [xferReason, setXferReason] = useState("");

  // ── ADVANCE ── the deposit. Every hospital takes one.
  const [advOpen, setAdvOpen] = useState(false);
  const [advAmt, setAdvAmt] = useState("");
  const [advMode, setAdvMode] = useState<"CASH" | "UPI" | "CARD" | "NETBANKING">("CASH");
  /** The slip just issued - held so the desk can print it straight away. */
  const [advTaken, setAdvTaken] = useState<Advance | null>(null);

  async function openTransfer() {
    setXferOpen(true);
    try {
      const r = await api.get<{ wards: typeof xferWards }>(`/ipd/admissions/${admissionId}/transfer`);
      setXferWards(r.wards);
      setXferBed(r.wards[0]?.beds[0]?.id ?? "");
    } catch { setXferWards([]); }
  }

  async function doTransfer() {
    if (!xferBed) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ toWard: string; toBed: string; newDailyCharge: string }>(
        `/ipd/admissions/${admissionId}/transfer`,
        { toBedId: xferBed, reason: xferReason.trim() || undefined }
      );
      setFlash(`Moved to ${r.toWard} · ${r.toBed}. Billed at ₹${r.newDailyCharge}/day from today - the days already spent keep their old rate.`);
      setXferOpen(false); setXferReason("");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not transfer."); }
    finally { setBusy(false); }
  }

  /**
   * Remove a transfer that was entered by mistake.
   *
   * Only the newest leg can come off, and that is the only safe one: the legs
   * chain end-to-end, so pulling one out of the middle would leave a hole in
   * the days that no arithmetic closes. The chronology keeps both the move and
   * its removal - somebody did move this patient in the system, and a record
   * that can be edited to say otherwise is not a record.
   */
  async function doUndoTransfer() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ movedBackTo: string }>(`/ipd/admissions/${admissionId}/transfer/undo`, {});
      setFlash(`Transfer removed. Back in ${r.movedBackTo} - the bed charge is recalculated.`);
      setUndoOpen(false);
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not remove the transfer."); }
    finally { setBusy(false); }
  }

  async function doAdvance() {
    if (!(Number(advAmt) > 0)) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ totalAdvance: string; advance: Advance }>(`/ipd/admissions/${admissionId}/advance`, {
        amount: Number(advAmt), mode: advMode,
      });
      // The family is standing at the counter having just handed over cash. The
      // receipt has to be one click away from here, not buried in a sub-page.
      setAdvTaken(r.advance);
      setFlash(`Advance taken · receipt ${r.advance.receiptNo}. ₹${r.totalAdvance} held against this stay - it comes off the discharge bill.`);
      setAdvOpen(false); setAdvAmt("");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not record the advance."); }
    finally { setBusy(false); }
  }

  const [rxOpen, setRxOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [meds, setMeds] = useState<Med[]>([]);
  const [rxItems, setRxItems] = useState<{ name: string; medicineId: string | null; qty: string; dosage: string }[]>([
    { name: "", medicineId: null, qty: "1", dosage: "" },
  ]);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── LABS ── order tests straight onto the room tab.
  const [labCatalog, setLabCatalog] = useState<{ id: string; name: string; code: string | null; price: string }[]>([]);
  const [labsOpen, setLabsOpen] = useState(false);
  /** The shared discharge summary - the same record the insurance desk edits. */
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [labPick, setLabPick] = useState<Set<string>>(new Set());
  const [labQuery, setLabQuery] = useState("");

  // ── HISTORY ── owned by PatientHistoryPanel, which fetches it itself. The
  // page keeps only a token: every existing `loadHistory()` call site still
  // means "the record changed, read it again", it just says so by bumping a
  // number instead of holding the data.
  const [historyToken, setHistoryToken] = useState(0);
  const loadHistory = useCallback(() => setHistoryToken((n) => n + 1), []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSheet(await api.get<Sheet>(`/ipd/admissions/${admissionId}/sheet`)); }
    catch (e) { setErr(e instanceof ApiClientError ? e.message : "Couldn't load the sheet."); }
    finally { setLoading(false); }
  }, [admissionId]);
  useEffect(() => { load(); }, [load]);

  // Nothing to seed - the box is always empty, because it adds an entry rather
  // than editing the stay's notes. What has already been written is history.

  useEffect(() => {
    api.get<{ medicines: Med[] }>("/pharmacy/medicines").then((r) => setMeds(r.medicines)).catch(() => {});
    api.get<{ catalog: { id: string; name: string; code: string | null; price: string }[] }>("/labs/catalog").then((r) => setLabCatalog(r.catalog)).catch(() => {});
  }, []);

  const labPickTotal = useMemo(() => labCatalog.filter((c) => labPick.has(c.id)).reduce((s, c) => s + Number(c.price), 0), [labCatalog, labPick]);

  /** @param confirmRepeat  pressed "order again" in the "just ordered" dialog. */
  async function orderLabs(confirmRepeat = false) {
    if (!sheet || labPick.size === 0) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/labs/tests/order", { patientId: sheet.admission.patient.id, catalogIds: [...labPick], confirmRepeat: confirmRepeat || undefined });
      setRepeat(null);
      setFlash(`${labPick.size} test${labPick.size === 1 ? "" : "s"} ordered - charged to the room and queued for the lab.`);
      setLabsOpen(false); setLabPick(new Set()); setLabQuery("");
      await load(); loadHistory();
    } catch (e) {
      // Ordered minutes ago - nothing was ordered; the dialog shows that bill.
      const again = repeatBlock(e);
      if (again) { setRepeat({ block: again, message: (e as Error).message, retry: () => { void orderLabs(true); } }); return; }
      setRepeat(null);
      setErr(e instanceof ApiClientError ? e.message : "Could not order the tests.");
    }
    finally { setBusy(false); }
  }

  async function saveNotes() {
    if (!notes.trim()) return;
    setSavingNotes(true); setErr(null);
    try {
      await api.post(`/ipd/admissions/${admissionId}/notes`, { body: notes.trim() });
      setNotes(""); setNotesDirty(false);
      setFlash("Note added to the stay.");
      await load();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not add the note."); }
    finally { setSavingNotes(false); }
  }

  const lineTotal = useMemo(() => (Number(qty || 0) * Number(price || 0)).toFixed(2), [qty, price]);

  /** @param confirmRepeat  pressed "Add it again" in the "just added" dialog. */
  async function addCharge(confirmRepeat = false) {
    if (!desc.trim() || !price) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/ipd/admissions/${admissionId}/charges`, {
        category: cat, description: desc.trim(),
        qty: Number(qty || 1), unitPrice: Number(price), gstRatePct: Number(gst || 0),
        confirmRepeat: confirmRepeat || undefined,
      });
      setRepeat(null);
      setFlash(`₹${money(lineTotal)} added to the tab.`);
      setDesc(""); setQty("1"); setPrice(""); setGst("0"); setSelectedServiceId(null);
      pushLineHistory({
        cat: "PROCEDURE",
        desc: "",
        qty: "1",
        price: "",
        gst: "0",
        selectedServiceId: null,
      });
      await load();
    } catch (e) {
      // The same line went on minutes ago - nothing was added.
      const again = repeatBlock(e);
      if (again) { setRepeat({ block: again, message: (e as Error).message, retry: () => { void addCharge(true); } }); return; }
      setRepeat(null);
      setErr(e instanceof ApiClientError ? e.message : "Could not add the charge.");
    }
    finally { setBusy(false); }
  }

  async function removeCharge(c: Charge) {
    setBusy(true); setErr(null);
    try {
      await api.del(`/ipd/charges/${c.id}`);
      setLastRemovedCharge(c);
      setFlash(`Removed "${c.description}". Click Undo to restore.`);
      await load();
    }
    catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not remove it."); }
    finally { setBusy(false); }
  }

  /** IP prescription: the doctor's round produced a chit. The scan is optional -
   *  typing the medicines and sending to pharmacy is enough on its own. */
  async function uploadRx(send: boolean) {
    if (!sheet) return;
    const items = rxItems
      .filter((r) => r.name.trim())
      .map((r) => ({ medicineName: r.name.trim(), medicineId: r.medicineId ?? undefined, qty: Number(r.qty || 1), dosage: r.dosage.trim() || undefined }));
    if (!file && items.length === 0) { setErr("Attach a scan, or type at least one medicine."); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      fd.append("patientId", sheet.admission.patient.id);
      fd.append("admissionId", sheet.admission.id);
      fd.append("items", JSON.stringify(items));
      if (send) fd.append("sendNow", "1");

      const res = await fetch("/api/v1/reception/prescriptions", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new ApiClientError(res.status, (await res.json().catch(() => ({}))).error ?? "Upload failed");

      setFlash(send
        ? "Sent to the pharmacy - the medicines will be charged to this room, not to the patient at the counter."
        : "Prescription saved to the stay.");
      setRxOpen(false); setFile(null); setRxItems([{ name: "", medicineId: null, qty: "1", dosage: "" }]);
      await load(); loadHistory();
    } catch (e) { setErr(e instanceof ApiClientError ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

  if (loading) {
    return (
      <PortalScroll>
        <div className="space-y-5 animate-pulse">
          {/* Exact Replica of Top Patient Banner */}
          <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-52 rounded-md bg-[#ececec]" />
                  <div className="h-5 w-24 rounded-full bg-[#f0f0f0]" />
                </div>
                <div className="h-4 w-96 max-w-full rounded bg-[#f5f5f4]" />
                <div className="h-3.5 w-64 rounded bg-[#f5f5f4]" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="h-9 w-28 rounded-lg border border-[#e5e5e5] bg-white" />
                <div className="h-9 w-28 rounded-lg border border-[#e5e5e5] bg-white" />
                <div className="h-9 w-32 rounded-lg border border-[#e5e5e5] bg-white" />
                <div className="h-9 w-28 rounded-lg bg-[#f0f0f0]" />
              </div>
            </div>
          </div>

          {/* Exact Replica of Section Placements (2 Columns: Main Left + Sticky Right Rail) */}
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            {/* Left Column Sections */}
            <div className="space-y-5">
              {/* 1. The Running Tab Section */}
              <div className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-28 rounded bg-[#e5e5e5]" />
                    <div className="h-4 w-12 rounded-full bg-[#e5e5e5]" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-6 w-20 rounded-md bg-[#e5e5e5]" />
                    <div className="h-6 w-20 rounded-md bg-[#e5e5e5]" />
                    <div className="h-6 w-24 rounded-md bg-[#e5e5e5]" />
                    <div className="h-6 w-24 rounded-md bg-[#111111]/20" />
                  </div>
                </div>

                <div className="divide-y divide-[#f0f0f0] overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
                  {/* Bed Line */}
                  <div className="flex items-center justify-between bg-[#fafafa] px-4 py-3">
                    <div className="space-y-1.5">
                      <div className="h-4 w-48 rounded bg-[#e5e5e5]" />
                      <div className="h-3 w-64 rounded bg-[#f0f0f0]" />
                    </div>
                    <div className="h-5 w-20 rounded bg-[#e5e5e5]" />
                  </div>
                  {/* Charges / Invoices Lines */}
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-4 w-4 rounded-full bg-[#f0f0f0]" />
                        <div className="space-y-1">
                          <div className="h-4 w-40 rounded bg-[#ececec]" />
                          <div className="h-3 w-56 rounded bg-[#f5f5f4]" />
                        </div>
                      </div>
                      <div className="h-4 w-16 rounded bg-[#ececec]" />
                    </div>
                  ))}
                  {/* Add Charge input row */}
                  <div className="bg-[#fafafa] p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="h-8 rounded-lg bg-white border border-[#e5e5e5]" />
                      <div className="h-8 rounded-lg bg-white border border-[#e5e5e5]" />
                      <div className="h-8 rounded-lg bg-white border border-[#e5e5e5]" />
                      <div className="h-8 rounded-lg bg-[#111111]/20" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Nursing & Observation Notes Section */}
              <div className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="space-y-1">
                    <div className="h-4 w-44 rounded bg-[#e5e5e5]" />
                    <div className="h-3 w-60 rounded bg-[#e5e5e5]/70" />
                  </div>
                  <div className="h-4 w-14 rounded-full bg-[#e5e5e5]" />
                </div>
                <div className="space-y-3 rounded-lg border border-[#e5e5e5] bg-white p-3.5">
                  <div className="border-l-2 border-[#e5e5e5] pl-2.5 space-y-1.5">
                    <div className="flex gap-2">
                      <div className="h-3 w-24 rounded bg-[#f0f0f0]" />
                      <div className="h-3 w-28 rounded bg-[#ececec]" />
                    </div>
                    <div className="h-4 w-full rounded bg-[#f5f5f4]" />
                  </div>
                  <div className="h-14 w-full rounded-lg border border-[#e5e5e5] bg-white" />
                  <div className="flex justify-end">
                    <div className="h-8 w-24 rounded-lg bg-[#111111]/20" />
                  </div>
                </div>
              </div>

              {/* 3. Patient History Tabs Section */}
              <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)] space-y-3">
                <div className="flex gap-4 border-b border-[#f0f0f0] pb-2">
                  <div className="h-4 w-20 rounded bg-[#e5e5e5]" />
                  <div className="h-4 w-24 rounded bg-[#f0f0f0]" />
                  <div className="h-4 w-24 rounded bg-[#f0f0f0]" />
                </div>
                <div className="space-y-2">
                  <div className="h-8 w-full rounded-lg bg-[#fafafa]" />
                  <div className="h-8 w-full rounded-lg bg-[#fafafa]" />
                </div>
              </div>
            </div>

            {/* Right Column: Sticky Running Total / Final Bill Aside */}
            <aside className="h-fit overflow-hidden rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <div className="px-3 py-2">
                <div className="h-4 w-28 rounded bg-[#e5e5e5]" />
              </div>
              <div className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
                <div className="space-y-3 p-3.5">
                  <div className="flex justify-between">
                    <div className="h-4 w-24 rounded bg-[#f5f5f4]" />
                    <div className="h-4 w-16 rounded bg-[#ececec]" />
                  </div>
                  <div className="flex justify-between">
                    <div className="h-4 w-28 rounded bg-[#f5f5f4]" />
                    <div className="h-4 w-16 rounded bg-[#ececec]" />
                  </div>
                  <div className="flex justify-between border-t border-[#f0f0f0] pt-2.5">
                    <div className="h-4 w-24 rounded bg-[#e5e5e5]" />
                    <div className="h-5 w-20 rounded bg-[#111111]/40" />
                  </div>
                  {/* Still to pay box */}
                  <div className="rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-3 flex justify-between items-center">
                    <div className="h-4 w-20 rounded bg-[#e5e5e5]" />
                    <div className="h-5 w-24 rounded bg-[#111111]/50" />
                  </div>
                  <div className="h-3 w-full rounded bg-[#f5f5f4]" />
                </div>
                <div className="border-t border-[#e5e5e5] bg-[#fafafa] p-3.5">
                  <div className="h-9 w-full rounded-lg bg-[#111111]/30" />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </PortalScroll>
    );
  }
  if (!sheet) return <PortalScroll><p className="py-24 text-center text-[14px] text-[var(--p-rose)]">{err ?? "Not found."}</p></PortalScroll>;

  const a = sheet.admission;
  const discharged = a.status !== "ADMITTED";
  /** Days the BED bills - the stay, less anything a desk has capped off it. */
  const bedDaysBilled = sheet.days - sheet.uncoveredDays;
  /** Read off the sheet rather than copied into state, so a reload behind the
   *  open dialog cannot leave it showing a line that has since changed. */
  const editingCharge = sheet.charges.find((c) => c.id === editingChargeId) ?? null;
  const editingAdvance = sheet.advances.find((x) => x.id === editingAdvanceId) ?? null;

  return (
    <PortalScroll>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[21px] font-semibold tracking-tight text-[#111111]">{a.patient.fullName}</h1>
            <span className="rounded-full border border-[#e5e5e5] bg-[#f5f5f4] px-2.5 py-0.5 text-[12px] font-medium text-[#111111] tabular-nums">{a.ipNumber}</span>
            {discharged && <span className="rounded-full border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#737373]">Discharged</span>}
          </div>
          <p className="mt-1.5 text-[13.5px] text-[#737373]">
            <span className="font-medium text-[#404040] tabular-nums">{a.patient.displayId}</span> · <b className="font-medium text-[#111111]">{bedLabel(a.wardName, a.bedNo)}</b> ·
            Dr. {a.doctor.name} ({a.doctor.department})
            {" · "}
            <button
              type="button"
              onClick={() => setDoctorOpen(true)}
              title="Change the attending doctor on this admission"
              className="font-medium text-[#111111] underline decoration-[#d4d4d4] underline-offset-2 hover:decoration-[#111111]"
            >
              Change doctor
            </button>
          </p>
          {/* THE STAY'S DATES, WHERE SOMEBODY ACTUALLY LOOKS FOR THEM.
              The admission date was on this screen nowhere at all, and the only
              way to correct it was the Edit button on the BED CHARGES row -
              which is where the arithmetic belongs, but not where anybody looks
              for a date. The commonest correction on this page is a patient
              admitted at 11pm and typed in the next morning, and finding it
              should not depend on knowing that the bed-rate dialog also owns
              the clock.

              SAME DIALOG, SECOND DOOR - and deliberately not a second editor.
              The day count, every bed leg and, on a discharged stay, the
              re-issued invoice all move with these dates. A lighter "just the
              date" form here would be a way to change the bill without seeing
              what it did to it, which is the whole thing CorrectStayDialog's
              live preview exists to prevent. */}
          <p className="mt-0.5 text-[13px] text-[#737373]">
            Admitted <b className="font-medium text-[#111111]">{chargeDateLabel(a.admittedAt)}</b>
            {a.dischargedAt && (
              <> · Discharged <b className="font-medium text-[#111111]">{chargeDateLabel(a.dischargedAt)}</b></>
            )}
            {" · "}
            <button
              onClick={() => setCorrectOpen(true)}
              title="Correct the stay's dates - the day count, the bed lines and the bill move with them"
              className="font-medium text-[#111111] underline decoration-[#d4d4d4] underline-offset-2 hover:decoration-[#111111]"
            >
              Edit dates
            </button>
          </p>
          {a.reason && <p className="mt-0.5 text-[13px] text-[#737373]">Reason: {a.reason}</p>}
          {a.attendantName && (
            <p className="mt-0.5 text-[13px] text-[#737373]">
              Attendant: <b className="font-medium text-[#111111]">{a.attendantName}</b>
              {a.attendantRelation && ` (${a.attendantRelation})`}
              {a.attendantPhone && <> · <a href={`tel:${a.attendantPhone}`} className="font-medium text-[#111111] underline decoration-[#d4d4d4] underline-offset-2 tabular-nums">{a.attendantPhone}</a></>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!discharged && (
            <button onClick={() => setAdvOpen(true)}
              title="The deposit. Comes off the discharge bill."
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
              <Icon name="rupee" size={14} /> Take advance
            </button>
          )}
          {!discharged && (
            <button onClick={openTransfer}
              title="Move them to another bed. The bill keeps each leg at its own rate."
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
              <Icon name="bed" size={14} /> Transfer bed
            </button>
          )}
          {!discharged && (
            <button onClick={() => setRxOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
              <Icon name="file" size={14} /> Add prescription
            </button>
          )}
          {!discharged && (
            <button onClick={() => setLabsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
              <Icon name="flask" size={14} /> Order labs
            </button>
          )}
          {/* WRITE it here; the neighbour PRINTS it. Two separate acts on the
              same record - and neither is the discharge-and-bill button, which
              closes the stay and frees the bed. */}
          {/* Only on a stay still pointed at an insurer. Once converted the
              stay is self-pay and there is nothing left to refuse.

              THE LABEL IS THE INSTRUCTION, not a status. "Insurance rejected"
              read like a button that recorded a fact, and a desk pressing it to
              note a refusal got a stay silently rebilled to the family. It says
              what it will DO now, and the dialog behind it spells out all four
              consequences before anything moves. */}
          {a.payerType === "INSURANCE" && (
            /* A BADGE, NOT A BUTTON - and it is still clickable.
               Sized and shaped like StatusPill because that is what the desk's
               eye is trained on for "where does this stay stand", and this IS a
               statement about the stay before it is an action. The hover fill is
               what stops it reading as decoration: a badge that does something
               has to say so before it is pressed, not after. */
            <button onClick={() => setRejectOpen(true)}
              title="The insurer refused - mark the claim rejected and move this stay and its bills onto the family as cash"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--p-rose-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-rose)] ring-1 ring-[var(--p-rose)]/30 transition-colors hover:bg-[var(--p-rose)] hover:text-white hover:ring-[var(--p-rose)]">
              <Icon name="alert" size={12} /> Rejected — convert to cash
            </button>
          )}
          <button onClick={() => setSummaryOpen(true)}
            title="Write or edit this stay's discharge summary. The insurance desk edits the same record."
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
            <Icon name="file" size={14} /> Discharge summary
          </button>
          <a href={`/print/discharge/${a.id}`} target="_blank" rel="noopener noreferrer"
            title={discharged ? "Print the discharge summary for this stay" : "Interim summary - the discharge document, as it stands"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
            <Icon name="printer" size={14} /> Print summary
          </a>
          <Link href="/ipd/inpatients" className="group inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-[#f5f5f4] px-3.5 py-2 text-[13px] font-medium text-[#111111] transition-colors hover:border-[#111111] hover:bg-white">
            <SvgArrow size={13} direction="left" className="transition-transform group-hover:-translate-x-0.5" />
            <span>Inpatients</span>
          </Link>
        </div>
      </div>

      {flash && (
        <div data-rise className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[14px] text-[var(--p-cyan-deep)]">
          <span className="flex items-center gap-2">
            <Icon name="check" size={15} />
            <span>{flash}</span>
            {(lastRemovedCharge || lastRemovedBillItem) && (
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={busy}
                className="ml-2 inline-flex items-center gap-1 rounded bg-[var(--p-cyan-deep)] px-2.5 py-1 text-[12px] font-semibold text-white shadow-2xs transition hover:opacity-90 disabled:opacity-50"
              >
                <Icon name="undo" size={12} /> Undo
              </button>
            )}
          </span>
          <span className="flex items-center gap-2">
            {/* The money has just changed hands - the slip belongs here, next to
                the confirmation, not two clicks away. */}
            {advTaken && (
              <a href={`/print/advance/${advTaken.id}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-cyan-deep)] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90">
                <Icon name="receipt" size={13} /> Print advance receipt
              </a>
            )}
            <button onClick={() => { setFlash(null); setAdvTaken(null); }}>✕</button>
          </span>
        </div>
      )}
      {err && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{err}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
        {/* THE TAB */}
        <section data-rise className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[12.5px] font-semibold text-[#111111]">Running tab</h3>
              <span className="rounded-full border border-[#e5e5e5] bg-white px-2 py-0.2 text-[10.5px] font-medium text-[#737373] tabular-nums">
                {sheet.charges.length + (sheet.counterBills?.length ?? 0) + 1 + (sheet.nursingApplies ? 1 : 0)} lines
              </span>
              <div className="flex items-center gap-1 border-l border-[#e5e5e5] pl-2 ml-1">
                <button
                  type="button"
                  onClick={() => void handleUndo()}
                  disabled={historyIndex <= 0 && !lastRemovedCharge}
                  title="Undo last change (Ctrl+Z)"
                  className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111] disabled:opacity-30 disabled:pointer-events-none shadow-xs"
                >
                  <Icon name="undo" size={12} />
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={historyIndex >= lineHistory.length - 1}
                  title="Redo change (Ctrl+Y)"
                  className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111] disabled:opacity-30 disabled:pointer-events-none shadow-xs"
                >
                  <Icon name="redo" size={12} />
                  <span>Redo</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <a href={`/print/tab/${a.id}`} target="_blank" rel="noopener noreferrer"
                title="Print the running tab as it stands — a dated statement of position, not a bill"
                className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
                <Icon name="printer" size={12} /> Print tab
              </a>
              
              {/* Separate Print Labs Button */}
              <a href={`/print/bills/${a.id}?source=LAB`} target="_blank" rel="noopener noreferrer"
                title="Print only laboratory invoices raised against this stay"
                className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
                <Icon name="flask" size={12} /> Print labs
              </a>

              {/* Separate Print Pharmacy Button */}
              <a href={`/print/bills/${a.id}?source=PHARMACY`} target="_blank" rel="noopener noreferrer"
                title="Print only pharmacy invoices raised against this stay"
                className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
                <Icon name="pill" size={12} /> Print pharmacy
              </a>

              {/* Print All Bills */}
              <a href={`/print/bills/${a.id}`} target="_blank" rel="noopener noreferrer"
                title="Print every bill raised against this stay — ward, pharmacy and lab, each as its own invoice"
                className="inline-flex items-center gap-1 rounded-md border border-[#111111] bg-[#111111] px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-[#262626]">
                <Icon name="receipt" size={12} /> Print all bills
              </a>

              {a.payerType === "SELF_PAY" && (
                <a href={`/print/services-bill/${a.id}`} target="_blank" rel="noopener noreferrer"
                  title="The self-pay bill — hospital services only, discounted"
                  className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111]">
                  <Icon name="receipt" size={12} /> Services bill
                </a>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
          <div className="divide-y divide-[#f0f0f0]">
            {/* bed is always line 1 */}
            <div className="bg-[#fafafa] px-4 py-2.5 rounded-t-lg">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#111111]">
                    Bed charges{sheet.legs.length > 1 ? ` · ${sheet.legs.length} Ward Stays` : ` · ${bedLabel(a.wardName, a.bedNo)}`}
                  </div>
                  {sheet.legs.length <= 1 ? (
                    <div className="text-[11.5px] text-[#737373]">
                      {bedDaysBilled} day{bedDaysBilled === 1 ? "" : "s"} × ₹{money(a.dailyCharge)}
                      {Number(a.gstRatePct) > 0 && ` · ${a.gstRatePct}% GST`}
                    </div>
                  ) : (
                    <div className="mt-1 space-y-0.5">
                      {sheet.legs.map((leg) => (
                        <div key={leg.id} className="text-[11.5px] text-[#525252] flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-[#111111]">{leg.wardName}</span>
                          <span>·</span>
                          <span>{leg.days} day{leg.days === 1 ? "" : "s"} × ₹{money(leg.dailyCharge)}</span>
                          <span className="text-[#737373]">(₹{money(leg.total)})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {sheet.uncoveredDays > 0 && (
                    <div className="mt-0.5 text-[11px] font-medium text-amber-700">
                      Capped — {sheet.uncoveredDays} more day{sheet.uncoveredDays === 1 ? "" : "s"} not on bed line.
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#111111] tabular-nums">₹{money(sheet.bedTotal)}</span>
                  <button onClick={() => setCorrectOpen(true)}
                    title="Correct the bed rate, ward, or split across stays"
                    className="rounded border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] font-medium text-[#404040] hover:border-[#111111] transition-colors">
                    Edit
                  </button>
                </div>
              </div>
            </div>

            {/* NURSING - WITHDRAWN AS A SERVICE, and so drawn on no stay
                admitted since. A stay from before the withdrawal keeps its row:
                it was billed for nursing, the invoice in the family's hand says
                so, and a tab that silently dropped the line would disagree with
                the document it is supposed to explain. */}
            {sheet.nursingApplies && (
              <div className="flex items-center justify-between gap-3 bg-[var(--p-bg)] px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">Nursing care</span>
                    <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">Assigned</span>
                  </div>
                  <div className="text-[12px] text-[var(--p-muted)]">
                    {sheet.days} day{sheet.days === 1 ? "" : "s"} × ₹{money(sheet.nursePerDay)} · charged automatically
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[14px] font-bold text-[var(--p-ink)]">₹{money(sheet.nurseTotal)}</span>
                  <button onClick={() => setCorrectOpen(true)}
                    title="Correct the nursing rate, the bed rate or the stay's dates"
                    className="rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                    Edit
                  </button>
                </div>
              </div>
            )}

            {/* ── ON A CLAIM, THE OTHER COUNTERS' BILLS ARE ON THIS TAB TOO ──
                Pharmacy and lab raise their own invoices against the stay. For a
                self-paying family those are three bills settled at three
                counters and they belong in the dues block, not here. For a
                cashless one they are all one claim - so they sit on the running
                tab, where the ward looks to see what the stay has cost.

                NOT EDITABLE AS TAB LINES - the amount shown here is another
                document's total, and repricing a dispense on this tab would
                decouple the bill from the stock that left the shelf. What Edit
                opens is that document itself, through the same dialog the
                pharmacy and lab counters use, so a correction lands on the bill
                that owns the lines rather than on a summary of it. */}
            {/* ── EVERY COUNTER BILL ON THIS STAY, PAID OR NOT ──
                One list, not two. This used to render `claimBills` (the
                insurer's) and then `outstandingBills` (what was still owed),
                and between them they had a hole: a bill that had been PAID was
                in neither, so a medicine settled at the pharmacy window dropped
                off the ward's tab the moment the money was taken. The tab is
                the one screen that shows what a stay has cost, and it was
                showing less than the stay had cost.

                So it now lists them all and marks each with where it stands.
                Nothing here is EDITABLE as a tab line - the amount is another
                document's total, and Edit opens that document. */}
            {(sheet.counterBills ?? []).map((b) => {
              const onClaim = b.payer === "INSURANCE";
              const tone = onClaim
                ? { bg: "bg-[var(--p-blue-soft)]/40", chip: "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]", amt: "text-[var(--p-ink)]", btn: "text-[var(--p-blue)] hover:border-[var(--p-blue)]" }
                : b.status === "PAID"
                  ? { bg: "bg-[var(--p-bg)]", chip: "bg-[var(--p-teal-soft)] text-[var(--p-teal)]", amt: "text-[var(--p-muted)]", btn: "text-[var(--p-teal)] hover:border-[var(--p-teal)]" }
                  : { bg: "bg-[var(--p-amber-soft)]/50", chip: "bg-[var(--p-amber-soft)] text-[#8a6414]", amt: "text-[#8a6414]", btn: "text-[var(--p-teal)] hover:border-[var(--p-teal)]" };
              const label = onClaim ? "On the claim" : b.status === "PAID" ? "Paid" : b.status === "PART" ? "Part paid" : "Due";
              const note = onClaim
                ? "billed to the insurer, not collected here"
                : b.status === "PAID"
                  ? "already collected at the counter"
                  : b.status === "PART"
                    ? `₹${money(b.paid)} collected, ₹${money(b.due)} still due`
                    : "settled at Billing, not on the discharge bill";
              return (
                <div key={b.id} className={`flex items-center justify-between gap-3 px-5 py-3 ${tone.bg}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-[var(--p-ink)]">
                        {b.source === "PHARMACY" ? "Pharmacy dispense" : b.source === "LAB" ? "Laboratory tests" : "Other charges"}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${tone.chip}`}>{label}</span>
                    </div>
                    <div className="text-[12px] text-[var(--p-muted)]">
                      Bill <span className="font-mono">{b.receiptNo}</span> · {note}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* A settled bill shows what it COST, struck through as owed
                        money it is not; an open one shows what is still due. */}
                    <span className={`font-mono text-[14px] font-semibold ${tone.amt}`}>
                      ₹{money(onClaim || b.status === "PAID" ? b.total : b.due)}
                    </span>
                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer"
                      title="View & print this bill"
                      className={`rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium ${tone.btn}`}>
                      Bill
                    </a>
                    {canEdit && (
                      <button onClick={() => setEditingBillId(b.id)}
                        title={Number(b.paid) > 0
                          ? `Correct this bill — ₹${money(b.paid)} already collected`
                          : "Correct this bill's date, lines or amount"}
                        className={`rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium ${tone.btn}`}>
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {sheet.charges.length === 0 && (sheet.counterBills ?? []).length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">
                Nothing else on the tab yet. Add procedures, oxygen, doctor rounds below -
                pharmacy medicines land here automatically.
              </p>
            ) : sheet.charges.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-[var(--p-ink)]">{c.description}</span>
                    {c.fromPharmacy && (
                      <span className="shrink-0 rounded bg-[var(--p-cyan-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-cyan-deep)]">Pharmacy</span>
                    )}
                  </div>
                  <div className="text-[12px] text-[var(--p-muted)]">
                    {CAT_LABEL[c.category] ?? c.category} · {c.qty} × ₹{money(c.unitPrice)}
                    {Number(c.gstRatePct) > 0 && ` · ${c.gstRatePct}% GST`} · {c.addedBy}
                  </div>
                  {/* WHEN IT WAS GIVEN - the date the printed tab puts against
                      this line, and until now the one thing on the row nobody
                      could fix. A morning's work keyed in at 4pm printed as four
                      days of treatment under one timestamp. */}
                  <div className="text-[12px] text-[var(--p-muted)]">{chargeDateLabel(c.createdAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money(c.amount)}</span>
                  {/* Edit sits where Edit sits on the pharmacy and lab rows
                      above, and opens a dialog like they do. Still there after
                      discharge, deliberately: that is when somebody reads the
                      printed sheet and notices. The dialog itself says which
                      corrections re-issue the discharge bill and which do not -
                      see updateAdmissionCharge. */}
                  {!c.fromPharmacy && (
                    <button onClick={() => setEditingChargeId(c.id)}
                      title="Correct this line - the rate, the qty, or the date it was given"
                      className="rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                      Edit
                    </button>
                  )}
                  <button onClick={() => removeCharge(c)} disabled={busy}
                    title={discharged ? "Remove this line from the stay (re-issues final bill)" : "Remove this line"}
                    className="rounded-lg border border-[var(--p-border)] px-2 py-1 text-[12px] text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* add a charge */}
          <div className="border-t border-[var(--p-border)] bg-[var(--p-bg)] p-5 rounded-b-lg">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                Add to the tab {discharged && <span className="text-amber-800 font-medium normal-case tracking-normal">(discharged stay: re-issues final invoice)</span>}
              </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleUndo()}
                    disabled={historyIndex <= 0 && !lastRemovedCharge && !lastRemovedBillItem}
                    title={lastRemovedBillItem ? "Undo bill item removal" : lastRemovedCharge ? "Undo charge removal" : "Undo line change"}
                    className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] hover:border-[#111111] hover:text-[#111111] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <Icon name="undo" size={12} />
                    <span>Undo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRedo}
                    disabled={historyIndex >= lineHistory.length - 1}
                    title="Redo line change"
                    className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#404040] hover:border-[#111111] hover:text-[#111111] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <Icon name="redo" size={12} />
                    <span>Redo</span>
                  </button>
                  {(desc.trim() || price || selectedServiceId) && (
                    <button
                      type="button"
                      onClick={handleRequestDiscard}
                      title="Clear and reset line"
                      className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[11.5px] font-medium text-[#737373] hover:border-rose-300 hover:text-rose-600 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* THE RATE CARD, ahead of the free-text boxes.
                  Typing a description and a price by hand is how the same
                  procedure got billed at three different rates by three shifts,
                  and how the board on the wall and the bill at the desk drifted
                  apart with nobody able to say which was right. Picking fills
                  both; the boxes below stay editable for the genuinely one-off. */}
              {services.length > 0 && (
                <RateCardSelect
                  services={services}
                  selectedId={selectedServiceId}
                  onPick={pickService}
                  onRemove={handleRequestDiscard}
                  onSelectNone={handleRequestDiscard}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <Field label="What"><select className={fld} value={cat} onChange={(e) => { setCat(e.target.value); commitLineField({ cat: e.target.value }); }}>
                    {CATEGORIES.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                  </select></Field>
                </div>
                <div className="sm:col-span-4">
                  <Field label="Description" required><input className={fld} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => commitLineField({ desc })} placeholder="Dressing change, ECG, night nursing…" /></Field>
                </div>
                <Field label="Qty"><input className={fld} value={qty} inputMode="numeric" onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} onBlur={() => commitLineField({ qty })} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Rate (₹)" required><input className={fld} value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} onBlur={() => commitLineField({ price })} /></Field>
                </div>
                <Field label="GST %"><input className={fld} value={gst} inputMode="decimal" onChange={(e) => setGst(e.target.value.replace(/[^\d.]/g, ""))} onBlur={() => commitLineField({ gst })} /></Field>
                <div className="flex items-end sm:col-span-2">
                  <button onClick={() => addCharge()} disabled={busy || !desc.trim() || !price}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-40">
                    {busy ? <Spinner /> : <Icon name="plus" size={14} />} Add ₹{money(lineTotal)}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-[#737373]">
                Most hospital services are GST-exempt - leave it 0 unless your CA says otherwise.
              </p>
            </div>
          </div>
        </section>

        {/* FORGOTTEN BILLS - pharmacy/lab billed as OP while this patient was
            in the bed (a stay entered late). Put back on the stay from here. */}
        <ForgottenBillsPanel admissionId={a.id} ipNumber={a.ipNumber} admittedAt={a.admittedAt} dischargedAt={a.dischargedAt} reloadToken={historyToken}
          onLinked={() => { void load(); loadHistory(); }} />

        {/* NURSING / OBSERVATION NOTES - shift handover text, not billed */}
        <section data-rise className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <div>
              <h3 className="text-[12.5px] font-semibold text-[#111111]">Nursing &amp; observation notes</h3>
              <p className="mt-0.5 text-[11px] text-[#737373]">Shift handover - vitals, intake, how the night went.</p>
            </div>
            <span className="shrink-0 rounded-full border border-[#e5e5e5] bg-white px-2 py-0.2 text-[10.5px] font-medium text-[#737373] tabular-nums">
              {sheet.notes.length} {sheet.notes.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <div className="rounded-lg border border-[#e5e5e5] bg-white p-3.5">
            {/* The chronology. A correction is a NEW entry saying what it
                corrects - the same as on paper, and the reason there is no
                edit button on any of these rows. */}
            {sheet.notes.length > 0 ? (
              <ol className="mb-3 flex flex-col gap-2.5">
                {sheet.notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-[#e5e5e5] pl-2.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[10.5px] tabular-nums text-[#737373]">
                        {new Date(n.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-[11px] font-semibold text-[#111111]">
                        {n.authorName ?? "Author not recorded"}
                      </span>
                      {n.kind === "DISCHARGE" && (
                        <span className="rounded bg-[#f5f5f4] px-1.5 py-0.2 text-[9.5px] font-medium uppercase tracking-wide text-[#737373]">On discharge</span>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#404040]">{n.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mb-3 text-[12.5px] text-[#737373]">No notes recorded on this stay yet.</p>
            )}

            {!discharged && (
              <>
                <textarea
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
                  rows={2}
                  placeholder="e.g. 08:00 - BP 130/80, afebrile, tolerating orals."
                  className="w-full resize-y rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12.5px] leading-relaxed text-[#111111] outline-none focus:border-[#111111]" />
                <div className="mt-2.5 flex items-center justify-end gap-2.5">
                  {notesDirty && <button onClick={() => { setNotes(""); setNotesDirty(false); }} className="text-[12px] font-medium text-[#737373] hover:text-[#111111]">Clear</button>}
                  <button onClick={saveNotes} disabled={savingNotes || !notes.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-40">
                    {savingNotes ? <><Spinner /> Adding…</> : <><Icon name="check" size={13} /> Add note</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* PATIENT HISTORY - billings, lab reports, prescriptions (like the profile) */}
        {/* Extracted so the insurance desk gets the same record on its own
            stay page - see PatientHistoryPanel. */}
        <PatientHistoryPanel
          admissionId={admissionId}
          canEdit={canEdit}
          onEditBill={setEditingBillId}
          reloadToken={historyToken}
        />
        </div>

        {/* TOTAL */}
        <aside data-rise className="h-fit overflow-hidden rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)] lg:sticky lg:top-20">
          <div className="px-3 py-2">
            <h3 className="text-[12.5px] font-semibold text-[#111111]">{discharged ? "Final bill" : "Running total"}</h3>
          </div>
          <div className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
          <div className="space-y-2 p-3.5">
            {/* Each leg of the stay, priced at the rate it actually carried. Two
                rows here means the patient was moved - and the bill says so. */}
            {sheet.legs.length > 1 ? (
              sheet.legs.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-[14px]">
                  <span className="min-w-0 text-[var(--p-muted)]">
                    <span className="text-[var(--p-ink)]">{bedLabel(l.wardName, l.bedNo)}</span>
                    <span className="ml-1 text-[12px]">({l.days}d × ₹{money(l.dailyCharge)})</span>
                    {l.current && <span className="ml-1 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--p-blue)]">now</span>}
                    {l.current && i > 0 && !discharged && (
                      <button onClick={() => setUndoOpen(true)} disabled={busy}
                        title="Entered by mistake? Send them back to the previous bed and take this leg off the bill."
                        className="ml-1.5 align-middle rounded border border-[var(--p-border)] px-1.5 py-[1px] text-[10px] font-semibold text-[var(--p-muted)] transition hover:border-[var(--p-rose)] hover:text-[var(--p-rose)] disabled:opacity-40">
                        Remove
                      </button>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[var(--p-ink)]">₹{money(l.total)}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-[var(--p-muted)]">Bed ({sheet.days}d)</span>
                <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.bedTotal)}</span>
              </div>
            )}

            {sheet.nursingApplies && (
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-[var(--p-muted)]">Nursing ({sheet.days}d × ₹{money(sheet.nursePerDay)})</span>
                <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.nurseTotal)}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-[14px]">
              <span className="text-[var(--p-muted)]">Charges ({sheet.charges.length})</span>
              <span className="font-mono text-[var(--p-ink)]">₹{money(sheet.chargesTotal)}</span>
            </div>

            {/* PHARMACY AND LAB ARE BILLED SEPARATELY, and are itemised on the
                tab above. This is the WARNING, not a second copy of the list:
                the figure that blocks a discharge, and why. */}
            {sheet.outstandingBills?.length > 0 && (
              <div className="rounded-lg border border-[var(--p-amber)]/35 bg-[var(--p-amber-soft)] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-wide text-[#8a6414]">
                    Due separately ({sheet.outstandingBills.length})
                  </span>
                  <span className="font-mono text-[14px] font-bold text-[#8a6414]">₹{money(sheet.outstandingTotal)}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#8a6414]">
                  Not part of the discharge bill and not in the total below. Collect them on
                  <b> Billing</b>, where this patient&apos;s bills settle in one payment - the lab
                  window takes no money. Discharge is blocked until they are.
                </p>
              </div>
            )}

            {/* The claim's pharmacy and lab are ON THE TAB above, not in their
                own box down here - they are part of what the stay cost, and a
                second list of the same figures would just invite a reader to
                check whether the two agree. This total already includes them. */}
            <div className="flex items-center justify-between border-t border-[var(--p-border)] pt-3">
              <span className="text-[14px] font-semibold text-[var(--p-ink)]">Total so far</span>
              <span className="font-mono text-[18px] font-bold text-[var(--p-ink)]">₹{money(sheet.claimTotal ?? sheet.grandTotal)}</span>
            </div>
            {Number(sheet.claimBillsTotal ?? 0) > 0 && (
              <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
                Includes ₹{money(sheet.claimBillsTotal)} of pharmacy and lab billed to the insurer.
                None of it is collected at a counter.
              </p>
            )}

            {/* The deposit. Reception took this money - it must be visible, or
                they'll ask the family for the full total at discharge. */}
            {Number(sheet.advanceTotal) > 0 && (
              <>
                <div className="flex items-center justify-between text-[14px]">
                  <span className="text-[var(--p-muted)]">Advance already taken</span>
                  <span className="font-mono font-semibold text-[var(--p-cyan-deep)]">−₹{money(sheet.advanceTotal)}</span>
                </div>
                {/* Every slip, reprintable. The flash banner is gone the moment
                    the page reloads, and families lose bits of paper. */}
                {sheet.advances.length > 0 && (
                  <div className="space-y-1 rounded-lg border border-[var(--p-border)] px-3 py-2">
                    {sheet.advances.map((adv) => (
                      <div key={adv.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate text-[var(--p-muted)]">
                          <span className="font-mono">{adv.receiptNo ?? "Not numbered"}</span>
                          {" · "}₹{money(adv.amount)}{" · "}{adv.mode}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {/* Correcting the slip, not reissuing it - the receipt
                              number and the family's copy stay as they are. */}
                          {canEdit && (
                            <button onClick={() => setEditingAdvanceId(adv.id)}
                              className="font-semibold text-[var(--p-muted)] hover:text-[var(--p-ink)] hover:underline">Edit</button>
                          )}
                          <a href={`/print/advance/${adv.id}`} target="_blank" rel="noopener noreferrer"
                            className="font-semibold text-[var(--p-teal)] hover:underline">Print</a>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between rounded-xl border border-[#e5e5e5] bg-[#f5f5f4] px-3.5 py-2.5">
                  <span className="text-[13.5px] font-semibold text-[#111111]">Still to pay</span>
                  <span className="text-[19px] font-semibold tracking-tight text-[#111111] tabular-nums">₹{money(sheet.balance)}</span>
                </div>
                {Number(sheet.advanceTotal) > Number(sheet.grandTotal) && (
                  <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[12px] leading-relaxed text-[#8a6414]">
                    <b>The advance is larger than the bill.</b> ₹{money(String(Number(sheet.advanceTotal) - Number(sheet.grandTotal)))} must
                    be <b>refunded</b> at discharge - not kept.
                  </p>
                )}
              </>
            )}
            <p className="text-[12px] leading-relaxed text-[#737373]">
              {discharged
                ? "This stay is closed. The invoice was raised at discharge."
                : "Bed charges grow each day. GST is applied per line at discharge - the room and a 12% syrup aren't taxed the same."}
            </p>
          </div>
          {!discharged && (
            <div className="border-t border-[#e5e5e5] bg-[#fafafa] p-4">
              <Link href="/ipd/inpatients"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#111111] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#262626]">
                <Icon name="receipt" size={14} /> Discharge &amp; bill
              </Link>
              <p className="mt-2 text-center text-[11.5px] text-[#737373]">Everything above goes on one invoice.</p>
            </div>
          )}
          </div>
        </aside>
      </div>

      {/* IP PRESCRIPTION */}
      {rxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="surface flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Prescription for {a.patient.fullName}</h3>
                <p className="text-[13px] text-[var(--p-muted)]">{a.ipNumber} · Dr. {a.doctor.name}&apos;s round</p>
              </div>
              <button onClick={() => setRxOpen(false)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>

            <div className="flex-1 w-full space-y-4 overflow-y-auto p-6">
              <div className="w-full" >
                <p className="mb-1.5  text-[13px] font-medium text-[var(--p-text)]">Scan of the chit <span className="text-[var(--p-muted)]">(optional)</span></p>
                <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <div className="flex items-center gap-2">
                  <button onClick={() => fileRef.current?.click()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--p-border-strong)] px-4 py-6 text-[14px] text-[var(--p-muted)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="file" size={16} />
                    {file ? <span className="font-medium text-[var(--p-ink)]">{file.name}</span> : "PDF, JPG or PNG - up to 10MB, or skip and just type the medicines"}
                  </button>
                  {file && <button onClick={() => setFile(null)} className="shrink-0 rounded-lg border border-[var(--p-border)] px-2.5 py-2 text-[12px] text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">Clear</button>}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[13px] font-medium text-[var(--p-text)]">Type the medicines</p>
                <div className="space-y-2">
                  {rxItems.map((r, i) => {
                    const match = meds.find((m) => m.name.toLowerCase() === r.name.trim().toLowerCase());
                    return (
                      <div key={i} className="flex gap-2">
                        <div className="relative flex-1">
                          <input list={`meds-${i}`} className="w-full min-w-[350px] rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]" value={r.name} placeholder="Medicine name"
                            onChange={(e) => {
                              const v = e.target.value;
                              const m = meds.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
                              const next = [...rxItems];
                              next[i] = { ...next[i], name: v, medicineId: m?.id ?? null };
                              setRxItems(next);
                            }} />
                          <datalist id={`meds-${i}`}>
                            {meds.map((m) => <option key={m.id} value={m.name}>{m.inStock} {m.unit}s in stock</option>)}
                          </datalist>
                          {r.name.trim() && (
                            <span className={`absolute right-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${match ? "bg-[var(--p-cyan)]" : "bg-[var(--p-amber)]"}`}
                              title={match ? "In the catalog - pharmacy gets it pre-filled" : "Free text - pharmacy will type it"} />
                          )}
                        </div>
                        <input className={`${fld} w-16`} value={r.qty} inputMode="numeric" placeholder="Qty"
                          onChange={(e) => { const n = [...rxItems]; n[i] = { ...n[i], qty: e.target.value.replace(/\D/g, "") }; setRxItems(n); }} />
                        <input className={`${fld} w-32`} value={r.dosage} placeholder="1-0-1"
                          onChange={(e) => { const n = [...rxItems]; n[i] = { ...n[i], dosage: e.target.value }; setRxItems(n); }} />
                        <button onClick={() => setRxItems(rxItems.filter((_, j) => j !== i))} disabled={rxItems.length === 1}
                          className="rounded-lg border border-[var(--p-border)] px-2 text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)] disabled:opacity-30">✕</button>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setRxItems([...rxItems, { name: "", medicineId: null, qty: "1", dosage: "" }])}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--p-blue)]">
                  <Icon name="plus" size={12} /> Another medicine
                </button>
              </div>

              <p className="rounded-lg bg-[var(--p-cyan-soft)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--p-cyan-deep)]">
                <b>This patient is admitted</b>, so the pharmacy will <b>charge the medicines to this room</b> instead of
                taking money at the counter. They&apos;ll appear on the tab and settle in the discharge bill.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setRxOpen(false)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
              <button onClick={() => uploadRx(false)} disabled={busy || (!file && !rxItems.some((r) => r.name.trim()))}
                className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] disabled:opacity-40">
                Save only
              </button>
              <button onClick={() => uploadRx(true)} disabled={busy || (!file && !rxItems.some((r) => r.name.trim()))}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Sending…</> : <><Icon name="check" size={15} /> Send to pharmacy</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── ORDER LABS ─────────── */}
      {labsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setLabsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Order lab tests</h3>
                <p className="text-[13px] text-[var(--p-muted)]">{a.ipNumber} · {a.patient.fullName}</p>
              </div>
              <button onClick={() => setLabsOpen(false)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>
            <div className="border-b border-[var(--p-border)] px-6 py-3">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3 py-2">
                <span className="text-[var(--p-muted)]"><Icon name="search" size={15} /></span>
                <input value={labQuery} onChange={(e) => setLabQuery(e.target.value)} placeholder="Search tests…" className="w-full bg-transparent text-sm text-[var(--p-ink)] outline-none" autoFocus />
              </div>
            </div>
            <div className="flex-1 divide-y divide-[var(--p-border)] overflow-y-auto">
              {labCatalog.filter((c) => c.name.toLowerCase().includes(labQuery.trim().toLowerCase())).map((c) => {
                const on = labPick.has(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => setLabPick((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                    className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left hover:bg-[var(--p-bg)]">
                    <span className="flex items-center gap-3">
                      <span className={`grid h-5 w-5 place-items-center rounded border ${on ? "border-[var(--p-blue)] bg-[var(--p-blue)] text-white" : "border-[var(--p-border-strong)]"}`}>{on && <Icon name="check" size={12} />}</span>
                      <span><span className="block text-[14px] font-medium text-[var(--p-ink)]">{c.name}</span>{c.code && <span className="block font-mono text-[11px] text-[var(--p-muted)]">{c.code}</span>}</span>
                    </span>
                    <span className="font-mono text-[13px] text-[var(--p-ink)]">₹{money(c.price)}</span>
                  </button>
                );
              })}
              {labCatalog.length === 0 && <p className="px-6 py-8 text-center text-[13px] text-[var(--p-muted)]">No tests in the catalog.</p>}
            </div>
            <p className="mx-6 my-3 rounded-lg bg-[var(--p-cyan-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--p-cyan-deep)]">
              Charged to the room - no money at the lab counter. The test is queued for the lab; its report uploads from the Labs portal and shows on the discharge summary.
            </p>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--p-border)] p-5">
              <span className="text-[13px] text-[var(--p-muted)]">{labPick.size} selected · <span className="font-mono font-semibold text-[var(--p-ink)]">₹{money(labPickTotal)}</span></span>
              <div className="flex gap-2">
                <button onClick={() => setLabsOpen(false)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
                <button onClick={() => orderLabs()} disabled={busy || labPick.size === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  {busy ? <><Spinner /> Ordering…</> : <><Icon name="flask" size={15} /> Order &amp; charge room</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── TRANSFER ───────────
          The bill keeps EACH LEG at its own rate. Three days in General then four
          in ICU is billed as exactly that - not seven days at whichever rate
          happened to be last. */}
      {/* ─────────── UNDO A TRANSFER ─────────── */}
      {undoOpen && sheet && sheet.legs.length > 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setUndoOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-md overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Remove this transfer</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                For a move that was entered by mistake - not for a patient who really did change beds.
              </p>
            </div>

            <div className="space-y-3 p-5 text-[13px] leading-relaxed text-[var(--p-text)]">
              <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-2.5">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-semibold text-[var(--p-ink)]">{bedLabel(sheet.legs[sheet.legs.length - 1].wardName, sheet.legs[sheet.legs.length - 1].bedNo)}</span>
                  <span className="text-[var(--p-muted)]">→</span>
                  <span className="font-semibold text-[var(--p-ink)]">{bedLabel(sheet.legs[sheet.legs.length - 2].wardName, sheet.legs[sheet.legs.length - 2].bedNo)}</span>
                </div>
                <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                  The bed they are in now goes back to free, and the earlier one is theirs again.
                </p>
              </div>

              <ul className="space-y-1.5 text-[12px] text-[var(--p-muted)]">
                <li>· The bed charge is recalculated on the earlier ward&apos;s rate for the whole stay.</li>
                <li>· The chronology keeps both the move and this removal. Nothing is erased.</li>
                <li>· Only the most recent move can be removed this way.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button onClick={() => setUndoOpen(false)} className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Keep it</button>
              <button onClick={doUndoTransfer} disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Removing…</> : <>Remove the transfer</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {xferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setXferOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-md overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Move to another bed</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                Currently {bedLabel(a.wardName, a.bedNo)}. Only free beds are offered.
              </p>
            </div>

            <div className="space-y-4 p-5">
              {xferWards.length === 0 ? (
                <p className="rounded-lg bg-[var(--p-bg)] px-4 py-3 text-[13px] text-[var(--p-muted)]">
                  No free beds anywhere in the hospital.
                </p>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">Where to?</label>
                    <select value={xferBed} onChange={(e) => setXferBed(e.target.value)}
                      className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]">
                      {xferWards.map((w) => (
                        <optgroup key={w.id} label={`${w.name} - ₹${Number(w.dailyCharge).toLocaleString("en-IN")}/day`}>
                          {w.beds.map((b) => <option key={b.id} value={b.id}>{bedLabel(w.name, b.bedNo)}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">Why? (optional)</label>
                    <input value={xferReason} onChange={(e) => setXferReason(e.target.value)}
                      placeholder="Condition worsened · needs monitoring"
                      className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--p-blue)]" />
                  </div>

                  <p className="rounded-lg bg-[var(--p-blue-soft)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--p-text)]">
                    <b>The days already spent keep their old rate.</b> The new ward&apos;s rate applies from
                    today onward, and the discharge bill shows both legs separately - which is what
                    actually happened, and what they should pay.
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button onClick={() => setXferOpen(false)} className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
              <button onClick={doTransfer} disabled={busy || !xferBed}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Moving…</> : <><Icon name="bed" size={14} /> Move them</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────── ADVANCE ─────────── */}
      {advOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAdvOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="surface w-full max-w-sm overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Take an advance</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                The deposit. It comes straight off the discharge bill.
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">Amount</label>
                <input value={advAmt} inputMode="decimal"
                  onChange={(e) => setAdvAmt(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="10000"
                  className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2.5 text-center font-mono text-[18px] font-semibold text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">How did they pay?</label>
                <div className="flex flex-wrap gap-2">
                  {(["CASH", "UPI", "CARD", "NETBANKING"] as const).map((m) => (
                    <button key={m} onClick={() => setAdvMode(m)}
                      className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                        advMode === m
                          ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white"
                          : "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)]"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <p className="rounded-lg bg-[var(--p-bg)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--p-muted)]">
                If the advance ends up larger than the final bill, the difference is
                <b className="text-[var(--p-ink)]"> refunded</b> - not kept.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button onClick={() => setAdvOpen(false)} className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
              <button onClick={doAdvance} disabled={busy || !(Number(advAmt) > 0)}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                {busy ? <><Spinner /> Recording…</> : <>Take ₹{Number(advAmt || 0).toLocaleString("en-IN")}</>}
              </button>
            </div>
          </div>
        </div>
      )}
      {summaryOpen && (
        <DischargeSummaryForm admissionId={a.id} onClose={() => setSummaryOpen(false)} />
      )}

      {/* The same dialog every other desk corrects a bill with. Both loads are
          refreshed on save: the running tab shows these bills' totals and the
          history tab lists them, so refreshing one would leave the other
          showing the figure that was just corrected. */}
      {editingBillId && (
        <EditBillDialog
          invoiceId={editingBillId}
          accent="teal"
          onClose={() => setEditingBillId(null)}
          onSaved={(info?: BillEditSavedInfo) => {
            setEditingBillId(null);
            if (info?.removedItems && info.removedItems.length > 0) {
              const last = info.removedItems[info.removedItems.length - 1];
              setLastRemovedBillItem({
                invoiceId: info.invoiceId,
                receiptNo: info.receiptNo,
                item: {
                  description: last.description,
                  qty: last.qty,
                  unitPrice: last.unitPrice,
                  gstRatePct: last.gstRatePct,
                  hsnSac: last.hsnSac,
                },
              });
              setFlash(`Removed "${last.description}". Click Undo to restore.`);
            }
            load();
            loadHistory();
          }}
        />
      )}

      {/* Bed rate, nursing rate and the stay's dates. Reloads the history too:
          on a discharged stay this re-issues the IPD invoice, which is one of
          the bills listed there. */}
      {rejectOpen && (
        <ConvertToSelfPayDialog
          admissionId={a.id}
          ipNumber={a.ipNumber}
          insurer={a.insurer}
          onClose={() => setRejectOpen(false)}
          onDone={(msg) => { setRejectOpen(false); setFlash(msg); load(); loadHistory(); }}
        />
      )}

      {doctorOpen && (
        <ChangeDoctorDialog
          admissionId={a.id}
          currentDoctor={{ name: a.doctor.name, department: a.doctor.department }}
          patientName={a.patient.fullName}
          ipNumber={a.ipNumber}
          onClose={() => setDoctorOpen(false)}
          onSaved={(newDocName) => {
            setDoctorOpen(false);
            setFlash(`Attending doctor updated to Dr. ${newDocName}.`);
            load();
            loadHistory();
          }}
        />
      )}

      {correctOpen && (
        <CorrectStayDialog
          admissionId={a.id}
          accent="teal"
          stay={{
            admittedAt: a.admittedAt,
            dischargedAt: a.dischargedAt,
            status: a.status,
            dailyCharge: a.dailyCharge,
            nursePerDay: sheet.nursePerDay,
            nursingApplies: sheet.nursingApplies,
            legs: sheet.legs,
          }}
          onClose={() => setCorrectOpen(false)}
          onSaved={(msg) => { setCorrectOpen(false); setFlash(msg); load(); loadHistory(); }}
        />
      )}

      {/* One tab line - its figures and its date. The history tab is reloaded
          too: repricing a discharged stay re-issues the IPD invoice, which is
          one of the bills listed there. */}
      {editingCharge && (
        <CorrectChargeDialog
          charge={editingCharge}
          admittedAt={a.admittedAt}
          dischargedAt={a.dischargedAt}
          discharged={discharged}
          accent="teal"
          onClose={() => setEditingChargeId(null)}
          onSaved={(msg) => { setEditingChargeId(null); setFlash(msg); load(); loadHistory(); }}
        />
      )}

      {/* One deposit slip - its amount, mode, reference and date. The history
          tab reloads too: a corrected deposit on a discharged stay re-adjusts
          the IPD invoice listed there. */}
      {editingAdvance && (
        <EditAdvanceDialog
          advance={editingAdvance}
          admittedAt={a.admittedAt}
          dischargedAt={a.dischargedAt}
          discharged={discharged}
          accent="teal"
          onClose={() => setEditingAdvanceId(null)}
          onSaved={(msg) => { setEditingAdvanceId(null); setFlash(msg); load(); loadHistory(); }}
        />
      )}
      {repeat && (
        <RepeatConfirmDialog
          block={repeat.block} message={repeat.message} busy={busy}
          onConfirm={() => repeat.retry()}
          onClose={() => setRepeat(null)}
        />
      )}

      {/* ─────────── DISCARD CONFIRMATION MODAL ─────────── */}
      {discardModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDiscardModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="surface w-full max-w-md overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[#111111]">Discard line edits?</h3>
                <p className="mt-0.5 text-[12px] text-[#737373]">
                  Unsaved procedure details on this line will be cleared.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDiscardModalOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-[#737373] hover:bg-[#f5f5f4] hover:text-[#111111] transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 p-5 text-[13px] text-[#404040]">
              {(desc || price || selectedServiceId) && (
                <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3 text-[12.5px] space-y-1">
                  {desc && (
                    <div><span className="text-[#737373]">Item:</span> <span className="font-medium text-[#111111]">{desc}</span></div>
                  )}
                  {price && (
                    <div><span className="text-[#737373]">Rate:</span> <span className="font-medium text-[#111111]">₹{price}</span> × {qty}</div>
                  )}
                  {selectedServiceId && (
                    <div className="text-[11.5px] text-[#737373]">Rate card selection will be removed.</div>
                  )}
                </div>
              )}
              <p className="text-[12.5px] text-[#737373]">
                Are you sure you want to discard your edits and reset the line? You can also undo this action later.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#e5e5e5] bg-[#fafafa] px-5 py-3">
              <button
                type="button"
                onClick={() => setDiscardModalOpen(false)}
                className="rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[12.5px] font-medium text-[#525252] hover:border-[#a3a3a3] hover:text-[#171717] transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setDiscardModalOpen(false)}
                className="rounded-lg border border-[#111111] bg-white px-3.5 py-2 text-[12.5px] font-medium text-[#111111] hover:bg-[#f5f5f4] transition-colors"
              >
                Continue edit
              </button>
              <button
                type="button"
                onClick={discardLineChanges}
                className="rounded-lg bg-rose-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-rose-700 transition-colors shadow-xs"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
