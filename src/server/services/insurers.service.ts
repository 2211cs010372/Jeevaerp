import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import { INSURERS, BUILT_IN_KIND, insurerKey, mergeInsurers, type InsurerKind } from "@/lib/insurers";
import type { AuthUser } from "@/lib/auth/types";

/**
 * THE INSURER LIST, AS THE HOSPITAL ACTUALLY KEEPS IT.
 *
 * Every "Insurer / TPA" box in the building reads one list - reception's
 * admission form, the insurance desk's ward view, the claim form - and it was a
 * hardcoded array. Adding a TPA needed a developer, a commit and a deploy, so
 * the desk did the only thing left to it and typed the name free-hand, a little
 * differently every time. The analytics board then showed one insurer as three.
 *
 * TWO SOURCES, ONE ANSWER. The hardcoded names are the FLOOR and stay in
 * src/lib/insurers.ts; the Insurer table is what the hospital adds on top and
 * what it switches off. `mergeInsurers` is the rule that puts them together and
 * lives in lib, next to the list, so the three screens that depend on it do not
 * each have to run a database to be sure of it.
 */

/** One line of the manage screen. Built-ins have no row until somebody hides one. */
export interface InsurerCatalogueRow {
  name: string;
  kind: InsurerKind;
  active: boolean;
  /** Ships with the app. Cannot be deleted or renamed - only switched off. */
  builtIn: boolean;
  /** The stored row, when one exists. Null for an untouched built-in. */
  id: string | null;
}

/**
 * The flat list of names every suggestion box shows.
 *
 * Read on the admission form, which is the one screen in this hospital that must
 * never be slow and never be empty - so a failure here is NOT thrown. The
 * hardcoded list is returned instead: a receptionist with a patient on a trolley
 * needs a box that works, not an error explaining why it doesn't.
 */
export async function suggestedInsurers(): Promise<string[]> {
  try {
    const rows = await prisma.insurer.findMany({ select: { name: true, active: true } });
    return mergeInsurers(rows);
  } catch {
    return [...INSURERS];
  }
}

/** Both lists side by side, for the screen that curates them. */
export async function insurerCatalogue(): Promise<InsurerCatalogueRow[]> {
  const rows = await prisma.insurer.findMany({ orderBy: { name: "asc" } });
  const stored = new Map(rows.map((r) => [insurerKey(r.name), r]));

  // Built-ins first, in the order they are written - that order is roughly how
  // often a hospital meets them, and a list sorted alphabetically instead would
  // bury Star Health under Acko.
  const out: InsurerCatalogueRow[] = INSURERS.map((name) => {
    const r = stored.get(insurerKey(name));
    return {
      name,
      kind: (r?.kind as InsurerKind) ?? BUILT_IN_KIND[name] ?? "COMPANY",
      // No row means nobody has touched it, and an untouched built-in is on.
      active: r ? r.active : true,
      builtIn: true,
      id: r?.id ?? null,
    };
  });

  for (const r of rows) {
    if (INSURERS.some((n) => insurerKey(n) === insurerKey(r.name))) continue;
    out.push({ name: r.name, kind: r.kind as InsurerKind, active: r.active, builtIn: false, id: r.id });
  }
  return out;
}

/**
 * Add a name the hospital deals with and this app had never heard of.
 *
 * A NAME ALREADY ON THE LIST IS NOT AN ERROR WORTH SHOWING when the only thing
 * wrong with it is that somebody switched it off - that is the desk asking for
 * exactly what it wants, said in the wrong order. It comes back on instead.
 * A name that is already there AND already on is a real duplicate, and refusing
 * it is what stops the list growing "Star Health" twice in two spellings.
 */
export async function addInsurer(
  actor: AuthUser,
  input: { name: string; kind: InsurerKind },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InsurerCatalogueRow> {
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "Type a name");

  const existing = await prisma.insurer.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    if (existing.active) throw new ApiError(409, `${existing.name} is already on the list`);
    const back = await prisma.insurer.update({
      where: { id: existing.id },
      data: { active: true, kind: input.kind },
    });
    await logAudit(actor, {
      action: "INSURER_REACTIVATED", targetTable: "Insurer", targetId: back.id,
      meta: { name: back.name }, ...ctx,
    });
    return { name: back.name, kind: back.kind as InsurerKind, active: true, builtIn: false, id: back.id };
  }

  const builtIn = INSURERS.find((n) => insurerKey(n) === insurerKey(name));
  if (builtIn) throw new ApiError(409, `${builtIn} is already on the list`);

  const row = await prisma.insurer.create({
    data: { name, kind: input.kind, createdById: actor.id },
  });
  await logAudit(actor, {
    action: "INSURER_ADDED", targetTable: "Insurer", targetId: row.id,
    meta: { name: row.name, kind: row.kind }, ...ctx,
  });
  return { name: row.name, kind: row.kind as InsurerKind, active: true, builtIn: false, id: row.id };
}

/**
 * Switch a name on or off - and it is addressed BY NAME, not by id.
 *
 * A built-in has no row to point an id at until the moment somebody hides it, so
 * an id-shaped API would have needed a second endpoint for exactly half the
 * list. Upserting on the name covers both: hiding a built-in writes the row that
 * says so, hiding one of the hospital's own updates the row it already has.
 *
 * NOTHING ALREADY BILLED IS TOUCHED. Admissions and claims keep the insurer's
 * name as a plain string, snapshotted when it was typed - switching a name off
 * changes what is suggested tomorrow and nothing that already happened. The
 * stays it is on stay exactly where they are.
 */
export async function setInsurerActive(
  actor: AuthUser,
  input: { name: string; active: boolean; kind?: InsurerKind },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<InsurerCatalogueRow> {
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "Which name?");

  const builtIn = INSURERS.find((n) => insurerKey(n) === insurerKey(name));
  const existing = await prisma.insurer.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (!existing && !builtIn) throw new ApiError(404, "That name is not on the list");

  const kind = input.kind ?? (existing?.kind as InsurerKind) ?? (builtIn ? BUILT_IN_KIND[builtIn] : "COMPANY");
  const row = existing
    ? await prisma.insurer.update({ where: { id: existing.id }, data: { active: input.active, kind } })
    : await prisma.insurer.create({
        data: { name: builtIn!, kind, active: input.active, createdById: actor.id },
      });

  await logAudit(actor, {
    action: input.active ? "INSURER_REACTIVATED" : "INSURER_HIDDEN",
    targetTable: "Insurer", targetId: row.id,
    meta: { name: row.name, builtIn: Boolean(builtIn) }, ...ctx,
  });
  return {
    name: row.name, kind: row.kind as InsurerKind, active: row.active,
    builtIn: Boolean(builtIn), id: row.id,
  };
}
