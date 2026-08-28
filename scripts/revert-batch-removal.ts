/**
 * REVERT: a stock "Remove" that shouldn't have happened.
 *
 * The Remove button on the stock page posts a negative ADJUSTMENT - it does not
 * delete the batch. So the batch row is still there and the fix is a matching
 * positive ADJUSTMENT, not an UPDATE on the ledger. A stock ledger that can be
 * edited is not a ledger: anyone auditing this batch later must see the
 * write-off, see the reversal, and see why.
 *
 *   npx tsx scripts/revert-batch-removal.ts             # dry run
 *   EXECUTE=1 npx tsx scripts/revert-batch-removal.ts   # apply
 */
import { prisma } from "../src/lib/prisma";

const EXECUTE = process.env.EXECUTE === "1";
const BATCH_NO = process.env.BATCH_NO ?? "T260849";
/** Only to confirm we are looking at the right shelf item. */
const MED_HINT = process.env.MED_HINT ?? "cogvit";
/** Stamped into the reversal so a second run cannot double-credit the shelf. */
const MARK = "Reversal of stock removal";

const money = (v: unknown) => (v == null ? "-" : `Rs ${Number(v).toFixed(2)}`);
const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

async function main() {
  const batches = await prisma.stockBatch.findMany({
    where: { batchNo: { equals: BATCH_NO, mode: "insensitive" } },
    select: {
      id: true, batchNo: true, quantity: true, expiryDate: true, mrp: true, purchasePrice: true,
      pack: true, packSize: true, freeQty: true, createdAt: true, updatedAt: true,
      medicine: { select: { id: true, name: true, unit: true } },
      supplier: { select: { name: true } },
      transactions: {
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, qty: true, reason: true, refId: true, createdAt: true,
                  performedBy: { select: { name: true, email: true } } },
      },
    },
  });

  if (!batches.length) { console.log(`No batch numbered "${BATCH_NO}" exists.`); return; }

  const hit = batches.filter((b) => b.medicine.name.toLowerCase().includes(MED_HINT.toLowerCase()));
  if (hit.length !== 1) {
    console.log(`Expected exactly one "${MED_HINT}" batch numbered ${BATCH_NO}, found ${hit.length} (of ${batches.length} with that number):`);
    for (const b of batches) console.log(`  ${b.medicine.name}  qty=${b.quantity}  supplier=${b.supplier.name}  id=${b.id}`);
    return;
  }
  const b = hit[0];

  console.log(`${b.medicine.name}   batch ${b.batchNo}   ${b.supplier.name}`);
  console.log(`  on the shelf : ${b.quantity} ${b.medicine.unit}s     expiry ${b.expiryDate.toISOString().slice(0, 10)}`);
  console.log(`  pack ${b.pack ?? "-"} (packSize ${b.packSize}, free ${b.freeQty})   MRP ${money(b.mrp)}   cost ${money(b.purchasePrice)}`);
  console.log(`  received ${when(b.createdAt)}, last touched ${when(b.updatedAt)}\n`);

  console.log("LEDGER");
  let running = 0;
  for (const t of b.transactions) {
    running += t.qty;
    const who = t.performedBy?.name ?? t.performedBy?.email ?? "?";
    console.log(`  ${when(t.createdAt)}  ${t.type.padEnd(16)} ${String(t.qty).padStart(6)}  -> ${String(running).padStart(6)}  ${who}`);
    if (t.reason) console.log(`      ${t.reason}${t.refId ? `   [${t.refId}]` : ""}`);
  }
  console.log(`  ledger total ${running} vs shelf ${b.quantity}  ${running === b.quantity ? "OK" : "!! MISMATCH"}\n`);

  const audits = await prisma.auditLog.findMany({
    where: { targetTable: "StockBatch", targetId: b.id },
    orderBy: { createdAt: "desc" }, take: 10,
    select: { action: true, meta: true, createdAt: true, ipAddress: true,
              actorUser: { select: { name: true, email: true, role: true } } },
  });
  console.log("AUDIT");
  for (const a of audits) {
    console.log(`  ${when(a.createdAt)}  ${a.action.padEnd(16)} ${a.actorUser?.email ?? "?"} (${a.actorUser?.role ?? "-"})  ${JSON.stringify(a.meta)}`);
  }

  // ---- what to reverse ----------------------------------------------------
  const removals = b.transactions.filter((t) => t.type === "ADJUSTMENT" && t.qty < 0);
  if (!removals.length) { console.log("\nNo negative ADJUSTMENT on this batch - nothing was removed this way."); return; }
  const removal = removals[removals.length - 1];

  const already = b.transactions.find((t) => t.type === "ADJUSTMENT" && t.qty === -removal.qty && (t.reason ?? "").includes(MARK));
  if (already) { console.log(`\nAlready reversed at ${when(already.createdAt)} (+${already.qty}). Nothing to do.`); return; }

  const qty = -removal.qty;
  console.log(`\nREVERSE  ${when(removal.createdAt)}  ${removal.qty} ${b.medicine.unit}s  "${removal.reason ?? ""}"`);
  console.log(`  shelf ${b.quantity} -> ${b.quantity + qty} ${b.medicine.unit}s`);

  const actor = await prisma.user.findFirst({
    where: { role: "ADMIN", email: "mallesh@gmail.com" }, select: { id: true, name: true, email: true },
  }) ?? await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, name: true, email: true } });
  if (!actor) throw new Error("No ADMIN user to attribute the correction to");
  console.log(`  posted as ${actor.email}`);

  if (!EXECUTE) { console.log("\nDRY RUN - nothing written. Set EXECUTE=1 to apply."); return; }

  const reason = `${MARK} of ${when(removal.createdAt)} (${removal.qty} ${b.medicine.unit}s, "${removal.reason ?? "no reason recorded"}"). `
               + `The stock was never off the shelf; the removal was entered in error.`;

  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: the shelf may have moved since the print above.
    const now = await tx.stockBatch.findUniqueOrThrow({ where: { id: b.id }, select: { quantity: true } });
    await tx.stockBatch.update({ where: { id: b.id }, data: { quantity: now.quantity + qty } });
    await tx.stockTransaction.create({
      data: { batchId: b.id, type: "ADJUSTMENT", qty, reason, performedById: actor.id },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id, action: "STOCK_ADJUSTED", targetTable: "StockBatch", targetId: b.id,
        meta: { delta: qty, reason, revertOf: removal.id, medicine: b.medicine.name, batchNo: b.batchNo, source: "revert-batch-removal script" },
      },
    });
  });

  const after = await prisma.stockBatch.findUniqueOrThrow({
    where: { id: b.id },
    select: { quantity: true, transactions: { select: { qty: true } } },
  });
  const ledger = after.transactions.reduce((s, t) => s + t.qty, 0);
  console.log(`\n=== VERIFY ===\n  shelf ${after.quantity} ${b.medicine.unit}s   ledger ${ledger}  ${ledger === after.quantity ? "OK" : "!! MISMATCH"}`);
}

main().finally(() => prisma.$disconnect());
