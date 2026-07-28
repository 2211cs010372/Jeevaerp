import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * TRANSACTION TIMEOUTS, RAISED ON PURPOSE.
 *
 * Prisma defaults an interactive transaction to 5 s, with 2 s to acquire a
 * connection. Both are generous on a local database and far too tight against a
 * managed one over the public internet: measured against this project's Supabase
 * instance, a single round trip runs ~1.2 s median and spikes past 4.8 s. Four
 * sequential statements - which is a SMALL transaction here; admitting a patient
 * does about that, receiving a 20-line invoice does far more - then blows the
 * default and Prisma aborts with "Transaction already closed".
 *
 * That failure mode is the bad one: the work is rolled back AFTER the caller
 * believed it was underway, so a receptionist sees an error on a patient who was
 * half-admitted. Raising the ceiling does not make anything slower - a
 * transaction that finishes in 200 ms still finishes in 200 ms - it only stops a
 * slow network from being reported as a data error.
 *
 * This is a ceiling, not a target. If a transaction genuinely needs 20 s, the
 * transaction is wrong; see procurement.service's goods receipt, which does per
 * line work inside its transaction and is the first thing that will hit this.
 */
export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    transactionOptions: {
      maxWait: 10_000,  // time allowed to get a connection from the pool
      timeout: 20_000,  // time allowed for the transaction body itself
    },
  });

if (process.env.NODE_ENV !== "production") global.__prisma = prisma;
