"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, ArrowRight, CornerDownLeft } from "lucide-react";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { searchDoctors } from "@/lib/doctor-search";
import { DOCTORS } from "@/lib/data";

/**
 * The header search, with live results.
 *
 * It used to be a plain box that navigated to /doctors?q=… on submit - two
 * page loads and a filtered grid before you learn whether the hospital even has
 * a cardiologist. Now the answer appears under the cursor, and Enter on a
 * highlighted consultant goes straight to their profile, which is the page
 * carrying their bookable slots.
 *
 * Keyboard is a first-class path, not an afterthought: ArrowUp/ArrowDown move,
 * Enter opens, Escape closes and returns focus to the input. Results carry
 * `role="option"` under a `role="listbox"` with `aria-activedescendant`, so a
 * screen reader announces the highlighted consultant as it changes.
 */

const MAX_RESULTS = 6;

export function DoctorSearchBox({
  onNavigate,
  variant = "desktop",
}: {
  /** Close the surrounding menu/drawer once the user goes somewhere. */
  onNavigate?: () => void;
  variant?: "desktop" | "mobile";
}) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const term = q.trim();
    if (term.length < 2) return [];           // one letter matches half the panel
    return searchDoctors(DOCTORS, term).slice(0, MAX_RESULTS);
  }, [q]);

  const total = searchDoctors(DOCTORS, q.trim()).length;
  const showPanel = open && q.trim().length >= 2;

  // A new query invalidates the old highlight - otherwise Enter opens whoever
  // happened to sit at that index for the previous term.
  useEffect(() => { setActive(-1); }, [q]);

  // Click-away. Pointerdown rather than click so it fires before the input's
  // own focus handling re-opens the panel.
  useEffect(() => {
    if (!showPanel) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [showPanel]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    onNavigate?.();
    router.push(href);
  };

  /** A highlighted consultant wins over the general search - if someone has
   *  arrowed down to a name, that name is what they meant. */
  function commit() {
    if (active >= 0 && matches[active]) return go(`/doctors/${matches[active].doctor.id}`);
    go(q.trim() ? `/doctors?q=${encodeURIComponent(q.trim())}` : "/doctors");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    commit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); return; }
    // Enter is handled here rather than left to the form's implicit submission.
    // Implicit submission depends on the form having exactly one input or a
    // submit button - the mobile variant has neither guarantee - and it does not
    // fire reliably across browsers and IMEs. This makes Enter deterministic.
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (!showPanel || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
    }
  }

  const mobile = variant === "mobile";

  return (
    <div ref={boxRef} className={`relative ${mobile ? "" : "mx-auto hidden max-w-[440px] flex-1 md:block"}`}>
      <form onSubmit={submit} role="search">
        <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search doctors, specialities…"
          aria-label="Search doctors and specialities"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          autoComplete="off"
          className={`w-full rounded-full border border-[var(--line-strong)] bg-[var(--bone)] py-2.5 pl-9 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:bg-white ${mobile ? "pr-4" : "pr-11"}`}
        />
        {!mobile && (
          <button type="submit" aria-label="Search" className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-[var(--teal)] text-white transition-colors hover:bg-[var(--teal-deep)]">
            <Search size={14} />
          </button>
        )}
      </form>

      {showPanel && (
        <div className={`${mobile ? "relative mt-2" : "absolute left-0 right-0 top-full z-50 mt-2"} overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow)]`}>
          {matches.length === 0 ? (
            <div className="px-4 py-5 text-center">
              <p className="text-[13px] font-semibold text-[var(--ink)]">No consultant matches “{q.trim()}”.</p>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                Try a speciality, a department, or what you need treated.
              </p>
            </div>
          ) : (
            <>
              <ul id={listId} role="listbox" aria-label="Matching doctors" className="max-h-[340px] overflow-y-auto py-1.5">
                {matches.map((m, i) => (
                  <li key={m.doctor.id} role="option" id={`${listId}-opt-${i}`} aria-selected={i === active}>
                    <Link
                      href={`/doctors/${m.doctor.id}`}
                      onClick={(e) => { e.preventDefault(); go(`/doctors/${m.doctor.id}`); }}
                      onMouseEnter={() => setActive(i)}
                      className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${i === active ? "bg-[var(--teal-soft)]" : "hover:bg-[var(--bone)]"}`}
                    >
                      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-[var(--line)]">
                        <DoctorAvatar name={m.doctor.name} image={m.doctor.image} className="h-full w-full text-[11px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{m.doctor.name}</span>
                        <span className="block truncate text-[11.5px] text-[var(--teal)]">{m.doctor.specialization}</span>
                        {/* Why this one matched, when it wasn't the name */}
                        {m.reason && (
                          <span className="block truncate text-[10.5px] text-[var(--muted)]">{m.reason}</span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">₹{m.doctor.fee}</span>
                      <ArrowRight size={13} className="shrink-0 text-[var(--muted)]" />
                    </Link>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => go(`/doctors?q=${encodeURIComponent(q.trim())}`)}
                className="flex w-full items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--bone)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--teal-soft)]"
              >
                <span className="text-[12px] font-semibold text-[var(--teal)]">
                  {total > matches.length ? `See all ${total} matches` : "Open in the full directory"}
                </span>
                <span className="flex items-center gap-1 text-[10.5px] text-[var(--muted)]">
                  <CornerDownLeft size={11} /> Enter
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
