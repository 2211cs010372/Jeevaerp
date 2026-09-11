"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

/**
 * Mobile invoice capture page.
 *
 * Opened by scanning the QR code on the desktop's "Scan with Mobile" popup.
 * No login, no portal chrome, no sidebar — just a big camera button and a
 * progress bar. The token in the query string is the only credential needed,
 * and it permits exactly one image upload to a temporary buffer that the
 * desktop picks up.
 *
 * Deliberately minimal: this page runs on a pharmacist's personal phone, on a
 * cellular connection, in a busy storeroom. The less it loads, the faster it
 * works.
 */

type Stage = "ready" | "uploading" | "done" | "error";

export default function MobileScanPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-[#f0fdf4]">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#0d9488]/20 border-t-[#0d9488]" />
      </div>
    }>
      <MobileScanInner />
    </Suspense>
  );
}

function MobileScanInner() {
  const params = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const sessionId = params.sessionId;
  const token = search.get("t") ?? "";

  const [stage, setStage] = useState<Stage>("ready");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setStage("uploading");
      setError("");

      // Show a preview while uploading
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);

      try {
        const form = new FormData();
        form.append("file", file);

        const res = await fetch(
          `/api/v1/pharmacy/mobile-scan/${sessionId}/upload?t=${encodeURIComponent(token)}`,
          { method: "POST", body: form },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Upload failed (${res.status})`);
        }

        setStage("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setStage("error");
      }
    },
    [sessionId, token],
  );

  return (
    <div className="flex min-h-dvh flex-col items-center bg-gradient-to-b from-[#f0fdf4] to-[#f8fafc]">
      {/* Header */}
      <header className="w-full px-5 pb-3 pt-safe-top">
        <div className="pt-6 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0d9488] text-white shadow-md">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
          </div>
          <h1 className="text-[18px] font-bold tracking-tight text-[#0f172a]">
            Scan Invoice
          </h1>
          <p className="mt-1 text-[13px] text-[#64748b]">
            Jeeva Multispeciality Hospital — Pharmacy
          </p>
        </div>
      </header>

      {/* Body */}
      <main className="flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 pb-10">
        {stage === "ready" && (
          <div className="w-full space-y-5 text-center">
            <div className="rounded-2xl border-2 border-dashed border-[#0d9488]/30 bg-white/80 px-6 py-10 shadow-sm backdrop-blur">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#0d9488]/10">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <h2 className="text-[16px] font-semibold text-[#0f172a]">
                Take a photo of the invoice
              </h2>
              <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-relaxed text-[#64748b]">
                Use your phone camera to capture the distributor&apos;s bill. 
                Hold it flat and make sure all text is readable.
              </p>

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-6 inline-flex items-center gap-2.5 rounded-xl bg-[#0d9488] px-7 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-[#0d9488]/25 transition-all active:scale-[0.97]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Open Camera
              </button>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                }}
              />

              <p className="mt-4 text-[11px] text-[#94a3b8]">
                Or select an existing photo from your gallery
              </p>
              <button
                type="button"
                onClick={() => {
                  // Remove capture attribute to allow gallery pick
                  if (fileRef.current) {
                    fileRef.current.removeAttribute("capture");
                    fileRef.current.click();
                    // Restore for next time
                    setTimeout(() => fileRef.current?.setAttribute("capture", "environment"), 500);
                  }
                }}
                className="mt-1 text-[13px] font-medium text-[#0d9488] underline underline-offset-2"
              >
                Choose from gallery
              </button>
            </div>
          </div>
        )}

        {stage === "uploading" && (
          <div className="w-full space-y-5 text-center">
            {preview && (
              <div className="mx-auto w-[200px] overflow-hidden rounded-xl border border-[#e2e8f0] shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Invoice preview" className="w-full" />
              </div>
            )}
            <div className="space-y-3">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-[3px] border-[#0d9488]/20 border-t-[#0d9488]" />
              <p className="text-[14px] font-semibold text-[#0f172a]">
                Uploading invoice…
              </p>
              <p className="text-[12px] text-[#64748b]">
                Hold on, sending the image to the desk
              </p>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="w-full space-y-4 text-center">
            {preview && (
              <div className="mx-auto w-[160px] overflow-hidden rounded-xl border border-[#e2e8f0] opacity-60 shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Invoice preview" className="w-full" />
              </div>
            )}
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0d9488]/10">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-[17px] font-bold text-[#0f172a]">
              Invoice sent!
            </h2>
            <p className="text-[13px] leading-relaxed text-[#64748b]">
              The image is being read on the desk now.<br />
              You can close this page.
            </p>
          </div>
        )}

        {stage === "error" && (
          <div className="w-full space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e11d48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 className="text-[17px] font-bold text-[#0f172a]">
              Upload failed
            </h2>
            <p className="text-[13px] leading-relaxed text-red-600">
              {error}
            </p>
            <button
              type="button"
              onClick={() => { setStage("ready"); setPreview(null); }}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#0d9488] px-6 py-3 text-[14px] font-semibold text-white shadow-lg shadow-[#0d9488]/25 active:scale-[0.97]"
            >
              Try again
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full pb-safe-bottom">
        <p className="pb-4 text-center text-[11px] text-[#94a3b8]">
          This page expires in 10 minutes
        </p>
      </footer>
    </div>
  );
}
