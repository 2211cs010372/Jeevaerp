-- ERROR LOG: a 500 at the billing counter stops being invisible.
--
-- Every API route in this app funnels through handler() in src/lib/api.ts, and
-- its last branch used to be `console.error` plus a generic 500 body. On a
-- serverless host that console line is somewhere nobody reads, so a crash at the
-- front desk at 7 PM reached the operator as an angry phone call with no stack
-- trace attached, or not at all.
--
-- WHY A TABLE HERE AND NOT A HOSTED ERROR SERVICE. An unhandled error in a
-- hospital system carries patient data by construction: the request path holds a
-- UHID, a Prisma uniqueness error quotes the phone number that collided, a
-- validation message echoes what the receptionist typed. Shipping that to a
-- third-party cloud makes every crash a small disclosure of health data, which
-- is a DPDP question nobody wants to answer for one 50-bed hospital. The
-- hospital already owns this Postgres; its crashes belong inside it.
--
-- ONE ROW PER DISTINCT BUG, NOT PER OCCURRENCE. `fingerprint` is a hash of the
-- error's shape (name + normalized route + message with digits blanked), unique
-- so a crash inside a hot loop increments `count` instead of writing 40,000 rows
-- and turning one incident into two.
--
-- WHAT IS DELIBERATELY ABSENT: no request body, no headers beyond user-agent,
-- and `route` holds the collapsed shape (/patients/:id) rather than the filled
-- path. Redaction happens at capture time in errors.service.ts, because every
-- reader downstream - the admin viewer, a CSV export, a support screenshot -
-- reads this stored string and none of them can put back what was never taken.
--
-- Additive only. No existing table is touched, so this is safe to apply to a
-- live database and safe to roll back by dropping the table.

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 500,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "fingerprint" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- The uniqueness that makes grouping work. captureError() relies on it: it runs
-- updateMany-then-create rather than upsert, so two requests crashing on the
-- same fingerprint in the same millisecond lose one increment instead of
-- throwing a P2002 out of the error handler.
-- CreateIndex
CREATE UNIQUE INDEX "ErrorLog_fingerprint_key" ON "ErrorLog"("fingerprint");

-- The admin viewer's only two queries: unresolved-newest-first, and the
-- everything-newest-first view behind ?resolved=1.
-- CreateIndex
CREATE INDEX "ErrorLog_resolvedAt_lastSeenAt_idx" ON "ErrorLog"("resolvedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ErrorLog_lastSeenAt_idx" ON "ErrorLog"("lastSeenAt");
