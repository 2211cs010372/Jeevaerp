"use client";

/**
 * THE LAST BOUNDARY. Catches a failure in the ROOT layout itself - the one place
 * every other error.tsx cannot help, because they all render inside it.
 *
 * This file replaces the root layout when it fires, which means it must supply
 * its own <html> and <body>. It also means none of the app's CSS is guaranteed
 * to have loaded: if the failure was in the layout, the fonts and theme it pulls
 * in are exactly what did not run. So everything here is INLINE STYLE and system
 * fonts on purpose. A boundary that needs a stylesheet to be readable is not a
 * boundary - it is one more thing that can fail at the moment nothing else is
 * working.
 *
 * No brand colours, no logo, no imports beyond React. This should be the most
 * boring file in the repository and should almost never be seen.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#ffffff" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            color: "#0b1220",
          }}
        >
          <div style={{ maxWidth: "440px", textAlign: "center" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>
              The application didn&apos;t start
            </h1>
            <p style={{ fontSize: "14px", lineHeight: 1.6, color: "#5a6478", marginTop: "12px" }}>
              Nothing has been lost. Reload to try again — if it keeps happening, the
              system needs looking at, and the reference below is what identifies it.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: "22px",
                border: "none",
                borderRadius: "8px",
                background: "#0b1220",
                color: "#ffffff",
                padding: "11px 22px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            {error.digest && (
              <p style={{ fontSize: "12px", color: "#5a6478", marginTop: "22px" }}>
                Reference{" "}
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  {error.digest}
                </span>
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
