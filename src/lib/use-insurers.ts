"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { INSURERS } from "@/lib/insurers";

/**
 * The insurer suggestions a box should offer - the hospital's own list.
 *
 * STARTS AT THE HARDCODED LIST AND UPGRADES. The admission form is the one
 * screen here that cannot be made to wait: a receptionist typing an insurer's
 * name while a patient is on a trolley needs suggestions from the first
 * keystroke, not from whenever the network answers. So the built-in names are
 * the initial state, not a loading placeholder, and the fetched list replaces
 * them a moment later.
 *
 * A FAILED FETCH SAYS NOTHING. There is nothing the receptionist could do about
 * it, the box still works with the built-in names, and every one of these fields
 * accepts a free-typed value anyway - an error banner over an admission form
 * would be pure noise at the exact wrong moment.
 */
export function useInsurers(): string[] {
  const [names, setNames] = useState<string[]>(() => [...INSURERS]);
  useEffect(() => {
    api.get<{ insurers: string[] }>("/insurers")
      .then((r) => { if (r.insurers?.length) setNames(r.insurers); })
      .catch(() => {});
  }, []);
  return names;
}
