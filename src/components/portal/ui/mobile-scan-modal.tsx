"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Icon } from "./icons";

export interface MobileScanModalProps {
  open: boolean;
  onClose: () => void;
  onScanComplete: (imageBase64: string) => void;
  title?: string;
  subtitle?: string;
}

export function MobileScanModal({
  open,
  onClose,
  onScanComplete,
  title = "Mobile QR Scanner",
  subtitle = "Scan with your phone camera to snap & upload prescription/invoice photo",
}: MobileScanModalProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "waiting" | "uploaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const startSession = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/v1/pharmacy/mobile-scan", { method: "POST" });
      if (!res.ok) throw new Error("Failed to initialize mobile scan session");
      const data = await res.json();
      setSessionId(data.sessionId);
      const appOrigin = window.location.origin;
      setQrUrl(`${appOrigin}/pharmacy/mobile-scan/${data.sessionId}`);
      setStatus("waiting");
    } catch (err: any) {
      setError(err?.message || "Could not start mobile scan session");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (open) {
      startSession();
    } else {
      setSessionId(null);
      setQrUrl(null);
      setStatus("loading");
    }
  }, [open, startSession]);

  useEffect(() => {
    if (!open || !sessionId || status !== "waiting") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/pharmacy/mobile-scan?sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "uploaded" && data.imageBase64) {
            setStatus("uploaded");
            onScanComplete(data.imageBase64);
            onClose();
          }
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [open, sessionId, status, onScanComplete, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[var(--p-border)] flex flex-col items-center text-center relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-[var(--p-muted)] hover:text-[var(--p-ink)] rounded-full hover:bg-slate-100 transition-colors"
        >
          ✕
        </button>

        <div className="w-12 h-12 rounded-2xl bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)] flex items-center justify-center mb-3">
          <Icon name="camera" size={24} />
        </div>

        <h3 className="text-lg font-bold text-[var(--p-ink)] mb-1">{title}</h3>
        <p className="text-xs text-[var(--p-muted)] mb-6">{subtitle}</p>

        {status === "loading" && (
          <div className="py-12 flex flex-col items-center">
            <div className="w-8 h-8 border-4 border-[var(--p-blue)] border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="text-xs text-[var(--p-muted)]">Generating QR code...</p>
          </div>
        )}

        {status === "error" && (
          <div className="py-8 flex flex-col items-center">
            <p className="text-sm text-[var(--p-rose)] mb-4">{error}</p>
            <button
              onClick={startSession}
              className="btn-primary px-4 py-2 text-xs font-semibold rounded-lg text-white"
            >
              Retry
            </button>
          </div>
        )}

        {status === "waiting" && qrUrl && (
          <div className="flex flex-col items-center w-full">
            <div className="p-4 bg-white rounded-xl shadow-xs border border-[var(--p-border)] mb-4 flex items-center justify-center">
              {/* QR Code image generated via quick chart API or SVG */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                  qrUrl
                )}`}
                alt="Mobile Scan QR Code"
                className="w-48 h-48 object-contain"
              />
            </div>

            <div className="flex items-center gap-2 text-[var(--p-blue)] text-xs font-semibold mb-2">
              <span className="w-2 h-2 rounded-full bg-[var(--p-blue)] animate-ping"></span>
              <span>Waiting for smartphone scan...</span>
            </div>

            <p className="text-[11px] text-[var(--p-muted)] max-w-xs mb-4">
              Open smartphone camera, scan QR code above, take photo of paper prescription &amp; tap Upload.
            </p>

            <div className="w-full pt-3 border-t border-[var(--p-border)] flex justify-between items-center text-xs text-[var(--p-muted)]">
              <span>Session ID: <code className="font-mono font-semibold text-[var(--p-ink)]">{sessionId?.slice(0, 8)}</code></span>
              <button
                onClick={startSession}
                className="text-[var(--p-blue)] hover:underline font-medium"
              >
                Refresh QR
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
