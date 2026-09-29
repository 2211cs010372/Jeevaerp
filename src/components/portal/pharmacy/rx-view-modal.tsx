"use client";

import { useState } from "react";
import { PrimaryButton, Pill } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { MobileScanModal } from "@/components/portal/ui/mobile-scan-modal";
import { api } from "@/lib/api-client";
import { RepeatConfirmDialog } from "@/components/portal/repeat-confirm-dialog";
import { repeatBlock, type RepeatBlock } from "@/lib/repeat-guard";
import { type PadLine } from "@/components/portal/pharmacy/scratchpad";

export interface RxItemData {
  medicineName: string;
  medicineId: string | null;
  qty: number;
  dosage: string | null;
}

export interface RxRecord {
  id: string;
  appointmentId?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  title?: string | null;
  doctorName?: string | null;
  status: string;
  sentToPharmacyAt?: string | null;
  dispensedAt?: string | null;
  createdAt?: string;
  patient: {
    id: string;
    displayId: string;
    fullName: string;
    phone: string;
    age?: number | null;
  };
  items: RxItemData[];
}

export interface RxViewModalProps {
  open: boolean;
  onClose: () => void;
  rx: RxRecord | null;
  allowDispense?: boolean;
  onDispenseSuccess?: () => void;
  onLoadToDispense?: (rx: RxRecord) => void;
}

export function RxViewModal({
  open,
  onClose,
  rx,
  allowDispense = false,
  onDispenseSuccess,
  onLoadToDispense,
}: RxViewModalProps) {
  // Image transformation state
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMobileScan, setShowMobileScan] = useState(false);

  // Dispensing state
  const [lines, setLines] = useState<PadLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The server's "this chit / these medicines were already billed". */
  const [repeat, setRepeat] = useState<{ block: RepeatBlock; message: string } | null>(null);

  if (!open || !rx) return null;

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleResetView = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const handleDispenseSubmit = async (confirmRepeat = false) => {
    if (!rx || !lines.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/pharmacy/dispense", {
        patientId: rx.patient.id,
        prescriptionUploadId: rx.id,
        items: lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty })),
        confirmRepeat: confirmRepeat || undefined,
      });
      setRepeat(null);
      if (onDispenseSuccess) onDispenseSuccess();
      onClose();
    } catch (err: any) {
      // Already billed - nothing was dispensed and no stock moved.
      const again = repeatBlock(err);
      if (again) { setRepeat({ block: again, message: err.message }); return; }
      setError(err?.message || "Could not complete dispensing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
        <div
          className={`surface flex w-full max-w-[1440px] flex-col overflow-hidden bg-white shadow-2xl transition-all ${
            isFullscreen ? "h-screen w-screen max-w-none rounded-none" : "h-[94vh] rounded-2xl"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4 bg-[var(--p-bg)]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]">
                <Icon name="file" size={20} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[16px] font-bold text-[var(--p-ink)]">{rx.patient.fullName}</h3>
                  <Pill tone={rx.status === "DISPENSED" ? "completed" : "waiting"}>
                    {rx.status === "DISPENSED" ? "Dispensed" : "Waiting"}
                  </Pill>
                </div>
                <p className="text-[12px] text-[var(--p-muted)]">
                  UHID: <span className="font-mono font-semibold">{rx.patient.displayId}</span> · Phone: {rx.patient.phone}
                  {rx.doctorName && ` · Doctor: ${rx.doctorName}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowMobileScan(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--p-blue)]/30 bg-[var(--p-blue-soft)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--p-blue-deep)] hover:bg-[var(--p-blue)]/20"
              >
                <Icon name="camera" size={14} /> Mobile QR Scan
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--p-ink)] hover:bg-[var(--p-bg)]"
              >
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
              {onLoadToDispense && (
                <button
                  type="button"
                  onClick={() => {
                    onLoadToDispense(rx);
                    onClose();
                  }}
                  className="btn-primary rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm"
                >
                  ⚡ Load to Dispense Counter
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--p-muted)] hover:bg-slate-100 hover:text-slate-900"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Main Dual-Pane Content */}
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1.2fr_1fr]">
            {/* LEFT PANE: Prescription Scan Viewer (White/Light Theme) */}
            <div className="flex flex-col border-r border-[var(--p-border)] bg-slate-100/70 text-[var(--p-ink)]">
              {/* Viewer Controls */}
              <div className="flex items-center justify-between border-b border-[var(--p-border)] px-4 py-2.5 bg-white">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--p-border)] bg-white text-[var(--p-ink)] font-bold hover:bg-slate-50"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <span className="text-[12px] font-mono text-[var(--p-muted)] w-12 text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--p-border)] bg-white text-[var(--p-ink)] font-bold hover:bg-slate-50"
                    title="Zoom Out"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={handleRotate}
                    className="flex h-8 px-2.5 items-center justify-center rounded-md border border-[var(--p-border)] bg-white text-[12px] text-[var(--p-ink)] hover:bg-slate-50 font-medium"
                    title="Rotate 90deg"
                  >
                    🔄 Rotate
                  </button>
                  <button
                    type="button"
                    onClick={handleResetView}
                    className="flex h-8 px-2.5 items-center justify-center rounded-md border border-[var(--p-border)] bg-white text-[12px] text-[var(--p-muted)] hover:text-[var(--p-ink)]"
                  >
                    Reset
                  </button>
                </div>
                {rx.fileUrl && (
                  <a
                    href={rx.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-[var(--p-blue)] font-medium hover:underline"
                  >
                    Open Full Image ↗
                  </a>
                )}
              </div>

              {/* Image Preview Container */}
              <div className="relative flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100/50">
                {rx.fileUrl ? (
                  <div
                    className="transition-transform duration-150 ease-out flex items-center justify-center"
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: "center center",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={rx.fileUrl}
                      alt="Prescription Scan"
                      className="max-h-[75vh] max-w-full rounded-xl shadow-md border border-[var(--p-border)] object-contain bg-white"
                    />
                  </div>
                ) : rx.appointmentId ? (
                  <div className="flex flex-col items-center justify-center text-center p-8">
                    <Icon name="file" size={48} className="text-slate-400 mb-3" />
                    <p className="text-[var(--p-ink)] font-semibold text-[15px]">Digital OPD Consultation Sheet</p>
                    <p className="text-[var(--p-muted)] text-[13px] mt-1 mb-4">No scan photo uploaded; generated directly from doctor consultation notes.</p>
                    <a
                      href={`/print/opd/${rx.appointmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary rounded-lg px-4 py-2 text-[13px] font-semibold text-white shadow-sm"
                    >
                      Print / View OPD Sheet ↗
                    </a>
                  </div>
                ) : (
                  <div className="text-[var(--p-muted)] text-[13px]">No prescription image available.</div>
                )}
              </div>
            </div>

            {/* RIGHT PANE: Prescribed Items & Details */}
            <div className="flex flex-col overflow-y-auto p-6 bg-white">
              <div className="mb-4 flex items-center justify-between border-b border-[var(--p-border)] pb-3">
                <h4 className="text-[14px] font-semibold text-[var(--p-ink)]">Prescribed Items &amp; Dosages</h4>
                <span className="badge">{rx.items.length} items</span>
              </div>

              {rx.items.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[var(--p-muted)]">No typed items attached to this prescription scan.</p>
              ) : (
                <div className="space-y-3 mb-6">
                  {rx.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-3.5"
                    >
                      <div>
                        <div className="text-[13.5px] font-semibold text-[var(--p-ink)]">{item.medicineName}</div>
                        {item.dosage && (
                          <div className="text-[12px] text-[var(--p-muted)] mt-0.5">
                            Dosage: <span className="font-mono font-medium text-[var(--p-ink)]">{item.dosage}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="rounded-full bg-[var(--p-blue-soft)] px-3 py-1 text-[12px] font-bold text-[var(--p-blue-deep)]">
                          Qty: {item.qty}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {allowDispense && (
                <div className="mt-auto border-t border-[var(--p-border)] pt-4">
                  {error && <div className="mb-3 text-[12.5px] font-medium text-rose-600">{error}</div>}
                  <PrimaryButton onClick={() => handleDispenseSubmit()} disabled={busy} full>
                    {busy ? "Processing..." : "Dispense & Bill"}
                  </PrimaryButton>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <MobileScanModal
        open={showMobileScan}
        onClose={() => setShowMobileScan(false)}
        onScanComplete={() => {
          setShowMobileScan(false);
        }}
        title="Rx Mobile Scanner"
        subtitle="Scan paper prescription with smartphone camera"
      />
      {repeat && (
        <RepeatConfirmDialog
          block={repeat.block} message={repeat.message} busy={busy}
          onConfirm={() => { void handleDispenseSubmit(true); }}
          onClose={() => setRepeat(null)}
        />
      )}
    </>
  );
}
