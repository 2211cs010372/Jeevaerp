"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";

interface Doctor {
  id: string;
  name: string;
  department: string;
}

export function ChangeDoctorDialog({
  admissionId,
  currentDoctor,
  patientName,
  ipNumber,
  onClose,
  onSaved,
}: {
  admissionId: string;
  currentDoctor: { id?: string; name: string; department: string };
  patientName: string;
  ipNumber: string;
  onClose: () => void;
  onSaved: (doctorName: string) => void;
}) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(currentDoctor.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.get<{ doctors: Doctor[] }>("/reception/doctors")
      .then((res) => {
        if (!active) return;
        setDoctors(res.doctors || []);
        // If currentDoctor id wasn't matched, try to match by name
        if (!selectedDoctorId && currentDoctor.name) {
          const match = res.doctors.find((d) => d.name.toLowerCase() === currentDoctor.name.toLowerCase());
          if (match) setSelectedDoctorId(match.id);
        }
      })
      .catch((e) => {
        if (!active) return;
        setErr(e instanceof ApiClientError ? e.message : "Failed to load doctor list.");
      })
      .finally(() => {
        if (active) setLoadingDocs(false);
      });
    return () => {
      active = false;
    };
  }, [currentDoctor.name, selectedDoctorId]);

  async function handleSave() {
    if (!selectedDoctorId) {
      setErr("Please select a doctor.");
      return;
    }
    const chosen = doctors.find((d) => d.id === selectedDoctorId);
    if (!chosen) {
      setErr("Selected doctor is invalid.");
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/ipd/admissions/${admissionId}/doctor`, {
        doctorId: selectedDoctorId,
        reason: reason.trim() || undefined,
      });
      onSaved(chosen.name);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to update attending doctor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-doctor-title"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-4 bg-[#fafafa]">
          <div>
            <h2 id="change-doctor-title" className="text-[15px] font-semibold text-[#111111]">
              Change Attending Doctor
            </h2>
            <p className="mt-0.5 text-[12px] text-[#737373]">
              {patientName} · <span className="font-mono">{ipNumber}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-7 w-7 place-items-center rounded-lg text-[#737373] transition-colors hover:bg-[#e5e5e5] hover:text-[#111111]"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-700">
              {err}
            </div>
          )}

          {/* Current Doctor Info */}
          <div className="rounded-xl border border-[#e5e5e5] bg-[#f9fafb] p-3 text-[12.5px]">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#737373] block mb-1">
              Current Doctor on record
            </span>
            <div className="font-semibold text-[#111111] text-[13.5px]">
              Dr. {currentDoctor.name}
            </div>
            <div className="text-[#64748b] text-[12px] mt-0.5">
              Department: {currentDoctor.department || "General"}
            </div>
          </div>

          {/* New Doctor Selector */}
          <div>
            <label className="block text-[12.5px] font-medium text-[#111111] mb-1.5">
              New Attending Doctor <Req />
            </label>
            {loadingDocs ? (
              <div className="flex items-center gap-2 py-2 text-[12.5px] text-[#737373]">
                <Spinner /> Loading active doctors…
              </div>
            ) : (
              <select
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value)}
                className="w-full rounded-xl border border-[#d4d4d4] bg-white px-3 py-2 text-[13px] text-[#111111] shadow-2xs outline-none transition focus:border-[#111111] focus:ring-1 focus:ring-[#111111]"
              >
                <option value="">Select doctor…</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dr. {d.name} — {d.department}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-[11px] text-[#737373]">
              This updates the primary consultant on all future ward rounds, discharge documents, and billing statements.
            </p>
          </div>

          {/* Reason for change */}
          <div>
            <label className="block text-[12.5px] font-medium text-[#111111] mb-1.5">
              Reason for Change <span className="text-[#8e8e8e] font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Primary consultant handover, initial admission correction"
              className="w-full rounded-xl border border-[#d4d4d4] bg-white px-3 py-2 text-[13px] text-[#111111] shadow-2xs outline-none transition focus:border-[#111111] focus:ring-1 focus:ring-[#111111]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#e5e5e5] bg-[#fafafa] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#404040] transition-colors hover:border-[#111111] hover:text-[#111111] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || !selectedDoctorId || loadingDocs}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-40"
          >
            {busy ? <><Spinner /> Updating…</> : <><Icon name="check" size={13} /> Update Doctor</>}
          </button>
        </div>
      </div>
    </div>
  );
}
