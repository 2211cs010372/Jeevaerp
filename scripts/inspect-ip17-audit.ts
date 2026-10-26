/** READ-ONLY. Recent audit + notes on IP00017 and its IPD invoice. */
import { prisma } from "../src/lib/prisma";
async function main() {
  const a = await prisma.admission.findFirstOrThrow({ where: { ipNumber: "JMH2026IP00017" }, select: { id: true, invoices: { select: { id: true } } } });
  const ids = [a.id, ...a.invoices.map((i) => i.id)];
  const logs = await prisma.auditLog.findMany({ where: { targetId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 15, select: { action: true, createdAt: true, meta: true, actorUser: { select: { name: true } } } });
  console.log(JSON.stringify(logs, null, 2));
  const notes = await prisma.admissionNote.findMany({ where: { admissionId: a.id }, orderBy: { createdAt: "desc" }, take: 5, select: { body: true, createdAt: true } });
  console.log(JSON.stringify(notes, null, 2));
}
main().finally(() => prisma.$disconnect());
