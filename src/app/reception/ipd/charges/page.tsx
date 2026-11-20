"use client";

/**
 * IPD RATE CARD & SERVICES MANAGEMENT
 *
 * Front Desk / Reception's view of the inpatient published rate card for procedures,
 * surgeries, doctor rounds, nursing, oxygen, equipment, and consumables.
 *
 * Mirrors the Lab Test Catalog workflow:
 * - Add new services to the rate card
 * - Edit service names, groups, categories, prices, GST rates, and per-day settings
 * - In-place price updates
 * - Deactivate / Retire services so past stay records and invoices remain intact
 * - Delete unused mistake entries with safety checks against AdmissionCharge
 * - Visual alerts for ₹0 unpriced orderable services
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { SvgArrow } from "@/components/portal/ui/svg-arrow";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { Pagination } from "@/components/portal/ui/pagination";
import { api, ApiClientError } from "@/lib/api-client";
import { useDebounce } from "@/lib/use-debounce";

interface ServiceItem {
  id: string;
  name: string;
  group: "IP_CHARGE" | "SURGERY_OPEN" | "SURGERY_LAPAROSCOPIC" | "OTHER";
  category: "PROCEDURE" | "DOCTOR_VISIT" | "NURSING" | "OXYGEN" | "INVESTIGATION" | "CONSUMABLE" | "PHARMACY" | "OTHER";
  price: string;
  gstRatePct: string;
  perDay: boolean;
  active: boolean;
}

const SERVICE_GROUP_LABELS: Record<string, string> = {
  IP_CHARGE: "Inpatient charges",
  SURGERY_OPEN: "Surgery - open",
  SURGERY_LAPAROSCOPIC: "Surgery - laparoscopic",
  OTHER: "Other",
};

const CATEGORY_LABELS: Record<string, string> = {
  PROCEDURE: "Procedure",
  DOCTOR_VISIT: "Doctor round",
  NURSING: "Nursing",
  OXYGEN: "Oxygen",
  INVESTIGATION: "Investigation",
  CONSUMABLE: "Consumables",
  PHARMACY: "Pharmacy",
  OTHER: "Other",
};

type ServiceGroupType = "IP_CHARGE" | "SURGERY_OPEN" | "SURGERY_LAPAROSCOPIC" | "OTHER";
type ChargeCategoryType = "PROCEDURE" | "DOCTOR_VISIT" | "NURSING" | "OXYGEN" | "INVESTIGATION" | "CONSUMABLE" | "PHARMACY" | "OTHER";

interface DraftService {
  id: string;
  name: string;
  group: ServiceGroupType;
  category: ChargeCategoryType;
  price: string;
  gstRatePct: string;
  perDay: boolean;
  active: boolean;
}

const blankService: DraftService = {
  id: "",
  name: "",
  group: "IP_CHARGE",
  category: "PROCEDURE",
  price: "",
  gstRatePct: "0",
  perDay: false,
  active: true,
};

type FilterType = "all" | "ip_charge" | "surgery_open" | "surgery_lap" | "per_day" | "unpriced" | "inactive";

export default function IpdChargesPage() {
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Search & Filter state
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 250);
  const [filter, setFilter] = useState<FilterType>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Modal edit/create state
  const [edit, setEdit] = useState<DraftService | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ services: ServiceItem[] }>("/ipd/services?all=1");
      setItems(res.services);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load IPD services rate card.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Derived counts
  const unpricedCount = useMemo(
    () => items.filter((i) => i.active && Number(i.price) === 0).length,
    [items]
  );
  const activeCount = useMemo(() => items.filter((i) => i.active).length, [items]);
  const retiredCount = useMemo(() => items.filter((i) => !i.active).length, [items]);
  const perDayCount = useMemo(() => items.filter((i) => i.active && i.perDay).length, [items]);

  // Filtering
  const filtered = useMemo(() => {
    const needle = debouncedQ.trim().toLowerCase();
    return items.filter((item) => {
      // Filter tab
      if (filter === "unpriced" && !(item.active && Number(item.price) === 0)) return false;
      if (filter === "inactive" && item.active) return false;
      if (filter === "ip_charge" && item.group !== "IP_CHARGE") return false;
      if (filter === "surgery_open" && item.group !== "SURGERY_OPEN") return false;
      if (filter === "surgery_lap" && item.group !== "SURGERY_LAPAROSCOPIC") return false;
      if (filter === "per_day" && !item.perDay) return false;

      // Search text
      if (!needle) return true;
      const groupName = (SERVICE_GROUP_LABELS[item.group] || "").toLowerCase();
      const catName = (CATEGORY_LABELS[item.category] || "").toLowerCase();
      return (
        item.name.toLowerCase().includes(needle) ||
        groupName.includes(needle) ||
        catName.includes(needle)
      );
    });
  }, [items, debouncedQ, filter]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filter, pageSize]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const pagedItems = useMemo(() => {
    return filtered.slice((page - 1) * pageSize, page * pageSize);
  }, [filtered, page, pageSize]);

  // Open modal
  const openModal = (item: ServiceItem | null) => {
    setError(null);
    setSaved(null);
    setConfirmDelete(false);
    if (!item) {
      setEdit({ ...blankService });
    } else {
      setEdit({
        id: item.id,
        name: item.name,
        group: item.group,
        category: item.category,
        price: item.price,
        gstRatePct: String(Number(item.gstRatePct)),
        perDay: item.perDay,
        active: item.active,
      });
    }
  };

  // Save (Create or Update)
  async function saveService() {
    if (!edit) return;
    if (!edit.name.trim()) {
      setError("Please enter a service name.");
      return;
    }
    const numPrice = Number(edit.price);
    if (isNaN(numPrice) || numPrice < 0) {
      setError("Please enter a valid price (₹0 or greater).");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post("/ipd/services", {
        id: edit.id || undefined,
        name: edit.name.trim(),
        group: edit.group,
        category: edit.category,
        price: numPrice,
        gstRatePct: Number(edit.gstRatePct || 0),
        perDay: edit.perDay,
        active: edit.active,
      });

      setSaved(edit.id ? `"${edit.name}" updated successfully.` : `"${edit.name}" added to rate card.`);
      setEdit(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save service charge.");
    } finally {
      setBusy(false);
    }
  }

  // Delete
  async function destroyService() {
    if (!edit?.id) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await api.del(`/ipd/services/${edit.id}`);
      setSaved(`"${edit.name}" deleted from the rate card.`);
      setEdit(null);
      setConfirmDelete(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not delete this service.");
      setConfirmDelete(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  const fld =
    "w-full rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13.5px] text-[#111111] outline-none transition focus:border-[#111111] focus:ring-1 focus:ring-[#111111]";

  const chip = (f: FilterType, label: string, count?: number) => (
    <button
      key={f}
      type="button"
      onClick={() => setFilter(f)}
      className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
        filter === f
          ? "border-[#111111] bg-[#111111] text-white"
          : "border-[#e5e5e5] bg-white text-[#737373] hover:border-[#a3a3a3] hover:text-[#111111]"
      }`}
    >
      {label}
      {count != null && count > 0 ? ` (${count})` : ""}
    </button>
  );

  return (
    <PortalScroll>
      {/* ── Studio Header & Section Tabs ── */}
      <div
        data-rise
        className="mb-5 overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[12px] font-medium text-[#737373]">
              <span>Front desk</span>
              <span className="text-[#d4d4d4]">/</span>
              <Link href="/ipd" className="hover:text-[#111111]">
                Admissions
              </Link>
              <span className="text-[#d4d4d4]">/</span>
              <span className="text-[#111111]">IPD charges</span>
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight text-[#111111]">
              IPD Services &amp; Rate Card
            </h1>
            <p className="mt-0.5 text-[13px] text-[#737373]">
              Counter tariffs for inpatient procedures, surgeries, nursing, oxygen, and daily charges.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/ipd"
              className="inline-flex items-center gap-2 rounded-[10px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#111111] transition hover:border-[#111111] shadow-2xs"
            >
              <Icon name="bed" size={14} />
              <span>Bed board</span>
            </Link>
            <button
              type="button"
              onClick={() => openModal(null)}
              className="btn-primary inline-flex items-center gap-2 rounded-[10px] bg-[#111111] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#262626] shadow-2xs"
            >
              <Icon name="plus" size={14} />
              <span>Add service</span>
            </button>
          </div>
        </div>

        {/* Section Navigation Tabs */}
        <div className="flex items-center justify-between border-t border-[#ececec] px-6">
          <nav className="flex items-center gap-6 text-[13px]" aria-label="IPD sections">
            <Link
              href="/ipd"
              className="border-b-2 border-transparent py-2.5 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap"
            >
              Bed board
            </Link>
            <Link
              href="/ipd/inpatients"
              className="border-b-2 border-transparent py-2.5 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap"
            >
              Inpatients list
            </Link>
            <span className="border-b-2 border-[#111111] py-2.5 font-medium text-[#111111] whitespace-nowrap">
              IPD charges
            </span>
            <Link
              href="/"
              className="border-b-2 border-transparent py-2.5 font-medium text-[#737373] transition-colors hover:text-[#111111] whitespace-nowrap"
            >
              Today
            </Link>
          </nav>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      <div data-rise className="mb-5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-[#737373]">
            Total services
          </span>
          <p className="mt-1 font-mono text-[22px] font-bold text-[#111111] tabular-nums">
            {items.length}
          </p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-[#737373]">
            Active &amp; billable
          </span>
          <p className="mt-1 font-mono text-[22px] font-bold text-emerald-700 tabular-nums">
            {activeCount}
          </p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-[#737373]">
            Daily charges
          </span>
          <p className="mt-1 font-mono text-[22px] font-bold text-blue-700 tabular-nums">
            {perDayCount}
          </p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-[#737373]">
            Retired
          </span>
          <p className="mt-1 font-mono text-[22px] font-bold text-[#737373] tabular-nums">
            {retiredCount}
          </p>
        </div>
      </div>

      {/* Alerts & Messages */}
      {error && (
        <div
          data-rise
          className="mb-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-500 hover:text-rose-800"
          >
            ✕
          </button>
        </div>
      )}
      {saved && (
        <div
          data-rise
          className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-800"
        >
          <span className="flex items-center gap-2">
            <Icon name="check" size={14} /> {saved}
          </span>
          <button
            type="button"
            onClick={() => setSaved(null)}
            className="text-emerald-600 hover:text-emerald-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* Unpriced Warning (Just like lab tests) */}
      {!loading && unpricedCount > 0 && (
        <div
          data-rise
          className="mb-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 text-[13px] text-amber-900 shadow-2xs"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-amber-200 text-amber-800 font-bold text-[12px]">
              !
            </span>
            <div>
              <strong>
                {unpricedCount} active service{unpricedCount === 1 ? "" : "s"} currently {unpricedCount === 1 ? "has" : "have"} no price (₹0).
              </strong>{" "}
              <span className="text-amber-800">
                A procedure at ₹0 adds ₹0 to the inpatient stay bill.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFilter("unpriced")}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1 text-[12px] font-semibold text-amber-900 hover:bg-amber-100/50"
          >
            Show unpriced
          </button>
        </div>
      )}

      {/* ── Search & Filter Row ── */}
      <div data-rise className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[240px] flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search service by name, group, or category…"
            className="w-full rounded-xl border border-[#e5e5e5] bg-white py-2 pl-9 pr-8 text-[13px] text-[#111111] outline-none transition focus:border-[#111111] shadow-2xs"
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]">
            <Icon name="search" size={14} />
          </span>
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1 text-xs text-[#737373] hover:text-[#111111]"
            >
              ✕
            </button>
          )}
        </div>

        {chip("all", "All", items.length)}
        {chip("ip_charge", "Inpatient charges")}
        {chip("surgery_open", "Open Surgery")}
        {chip("surgery_lap", "Lap Surgery")}
        {chip("per_day", "Daily (Per day)", perDayCount)}
        {chip("unpriced", "No price", unpricedCount)}
        {chip("inactive", "Retired", retiredCount)}
      </div>

      {/* ── Data Table ── */}
      <section
        data-rise
        className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[13.5px] text-[#737373]">
            <Spinner /> Loading rate card…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-[13.5px] text-[#737373]">
            {items.length === 0 ? "No services in the rate card yet. Click 'Add service' to get started." : "No services match this filter or search query."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#ececec] bg-[#fafafa] text-[11px] font-semibold uppercase tracking-wider text-[#737373]">
                  <th className="px-5 py-3">Service name</th>
                  <th className="py-3">Rate card board</th>
                  <th className="py-3">Claim category</th>
                  <th className="py-3 text-right">Price (₹)</th>
                  <th className="py-3 text-center">GST</th>
                  <th className="py-3 text-center">Billing mode</th>
                  <th className="py-3 text-center">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {pagedItems.map((item) => {
                  const isZero = item.active && Number(item.price) === 0;
                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors hover:bg-[#fcfcfc] ${
                        !item.active ? "opacity-55 bg-[#fdfdfd]" : ""
                      }`}
                    >
                      {/* Name */}
                      <td className="px-5 py-3 font-medium text-[#111111]">
                        <div className="flex items-center gap-2">
                          <span>{item.name}</span>
                          {item.perDay && (
                            <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                              per day
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Group */}
                      <td className="py-3 text-[12.5px] text-[#525252]">
                        <span className="rounded-md bg-[#f5f5f4] px-2 py-0.5 text-[11px] font-medium text-[#404040]">
                          {SERVICE_GROUP_LABELS[item.group] || item.group}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="py-3 text-[12.5px] text-[#525252]">
                        {CATEGORY_LABELS[item.category] || item.category}
                      </td>

                      {/* Price */}
                      <td
                        className={`py-3 text-right font-mono font-semibold tabular-nums text-[13.5px] ${
                          isZero ? "text-amber-700 bg-amber-50/50 px-2 rounded" : "text-[#111111]"
                        }`}
                      >
                        ₹{Number(item.price).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        {item.perDay && <span className="text-[11px] text-[#737373] font-normal"> /d</span>}
                      </td>

                      {/* GST */}
                      <td className="py-3 text-center">
                        {Number(item.gstRatePct) === 0 ? (
                          <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                            Exempt
                          </span>
                        ) : (
                          <span className="font-mono text-[12px] font-medium text-[#404040]">
                            {item.gstRatePct}%
                          </span>
                        )}
                      </td>

                      {/* Mode */}
                      <td className="py-3 text-center text-[12px] text-[#737373]">
                        {item.perDay ? (
                          <span className="text-blue-700 font-medium">Daily</span>
                        ) : (
                          <span>One-time</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 text-center">
                        {item.active ? (
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#8e8e8e]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#a3a3a3]" />
                            Retired
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openModal(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111111] hover:border-[#111111] hover:bg-[#fafafa] transition-colors"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="border-t border-[#ececec] p-2">
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="services"
            />
          </div>
        )}
      </section>

      {/* ── Add / Edit Modal (Just like lab tests) ── */}
      {edit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150"
          onClick={() => {
            if (!busy && !deleteBusy) setEdit(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="surface flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl animate-in zoom-in-95 duration-150"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
              <div>
                <h3 className="text-[15px] font-semibold text-[#111111]">
                  {edit.id ? "Edit service charge" : "Add service to rate card"}
                </h3>
                <p className="mt-0.5 text-[12px] text-[#737373]">
                  {edit.id
                    ? "Update counter rate, claim category, or active status."
                    : "Create a new entry on the hospital's published IP tariff."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEdit(null)}
                aria-label="Close"
                className="rounded-md p-1.5 text-[#737373] hover:bg-[#f5f5f4] hover:text-[#111111] transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 text-[13px]">
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-[12.5px] text-rose-700 leading-relaxed">
                  {error}
                </div>
              )}

              {confirmDelete && (
                <div className="rounded-xl border border-rose-300 bg-rose-50/90 p-4 text-[12.5px] text-rose-800 leading-relaxed space-y-2">
                  <p className="font-semibold text-rose-900">
                    Delete &quot;{edit.name}&quot; from the rate card permanently?
                  </p>
                  <p>
                    This permanently removes the service. If this service has ever been billed to an inpatient, the system will refuse deletion to protect past hospital audit trails. In that case, untick <strong>Active</strong> instead.
                  </p>
                </div>
              )}

              <Field label="Service Name" required>
                <input
                  className={fld}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  placeholder="e.g. Nebulisation, Laparoscopic Appendectomy, Oxygen…"
                  autoFocus={!edit.id}
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Rate Card Group" required>
                  <select
                    className={fld}
                    value={edit.group}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        group: e.target.value as DraftService["group"],
                      })
                    }
                  >
                    <option value="IP_CHARGE">Inpatient charges</option>
                    <option value="SURGERY_OPEN">Surgery - open</option>
                    <option value="SURGERY_LAPAROSCOPIC">Surgery - laparoscopic</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>

                <Field label="Claim / Billing Category" required>
                  <select
                    className={fld}
                    value={edit.category}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        category: e.target.value as DraftService["category"],
                      })
                    }
                  >
                    <option value="PROCEDURE">Procedure</option>
                    <option value="DOCTOR_VISIT">Doctor round / visit</option>
                    <option value="NURSING">Nursing</option>
                    <option value="OXYGEN">Oxygen</option>
                    <option value="INVESTIGATION">Investigation</option>
                    <option value="CONSUMABLE">Consumables</option>
                    <option value="PHARMACY">Pharmacy</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Price (₹)" required>
                  <input
                    className={`${fld} font-mono`}
                    value={edit.price}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        price: e.target.value.replace(/[^\d.]/g, ""),
                      })
                    }
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </Field>

                <Field label="GST Rate (%)">
                  <select
                    className={fld}
                    value={edit.gstRatePct}
                    onChange={(e) => setEdit({ ...edit, gstRatePct: e.target.value })}
                  >
                    <option value="0">0% (Exempt)</option>
                    <option value="5">5%</option>
                    <option value="12">12%</option>
                    <option value="18">18%</option>
                    <option value="28">28%</option>
                  </select>
                </Field>
              </div>

              {/* Checkboxes */}
              <div className="space-y-3 pt-1 border-t border-[#f0f0f0]">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={edit.perDay}
                    onChange={(e) => setEdit({ ...edit, perDay: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded accent-[#111111]"
                  />
                  <div>
                    <span className="font-medium text-[#111111]">
                      Charged per day of stay
                    </span>
                    <p className="text-[11.5px] text-[#737373]">
                      Enable for services that grow with length of stay (e.g. oxygen flow, monitor, ventilator).
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={edit.active}
                    onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded accent-[#111111]"
                  />
                  <div>
                    <span className="font-medium text-[#111111]">
                      Active (available in procedure picker)
                    </span>
                    <p className="text-[11.5px] text-[#737373]">
                      Unticking this retires the service. It disappears from the stay picker while existing patient invoices stay untouched.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-[#e5e5e5] px-6 py-3.5 bg-[#fafafa]">
              <div>
                {edit.id &&
                  (confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={destroyService}
                        disabled={deleteBusy}
                        className="rounded-lg bg-rose-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50 shadow-xs"
                      >
                        {deleteBusy ? (
                          <span className="flex items-center gap-1.5">
                            <Spinner /> Deleting…
                          </span>
                        ) : (
                          "Yes, delete for good"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-[12.5px] font-medium text-[#525252] hover:bg-[#f5f5f4]"
                      >
                        Keep it
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setConfirmDelete(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-[12.5px] font-medium text-[#737373] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    >
                      <Icon name="x" size={13} />
                      <span>Delete</span>
                    </button>
                  ))}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setEdit(null)}
                  className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#525252] hover:bg-[#f5f5f4] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveService}
                  disabled={busy}
                  className="btn-primary rounded-lg bg-[#111111] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#262626] disabled:opacity-50 transition-colors shadow-2xs"
                >
                  {busy ? (
                    <span className="flex items-center gap-1.5">
                      <Spinner /> Saving…
                    </span>
                  ) : edit.id ? (
                    "Save changes"
                  ) : (
                    "Add service"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
