-- THE INSURER LIST THE HOSPITAL MAINTAINS ITSELF.
--
-- Every "Insurer / TPA" box in the building reads one list - reception's
-- admission form, the insurance desk's ward view, the claim form - and that
-- list was a hardcoded array in the source. Adding a TPA meant a developer, a
-- commit and a deploy, so the desk did the only thing left to it: typed the
-- name in free-hand, differently each time, and the analytics board grew three
-- rows for one insurer.
--
-- ADDITIVE ONLY. One new table, no column added to an existing one, no data
-- backfilled, no row rewritten. Nothing reads it until the code that merges it
-- with the hardcoded list ships, and nothing breaks if it stays empty forever -
-- the hardcoded list is deliberately kept as the floor, so a failed query or a
-- half-restored database can never leave a receptionist with an empty box while
-- a patient is being wheeled in.
--
-- "active" IS NOT A DELETE FLAG ONLY. A row carrying a name that is also in the
-- hardcoded list, with active = false, is how the hospital hides one of the
-- built-in suggestions - there is no row to delete for those, so hiding has to
-- be something a row says.
--
-- No foreign key on createdById, deliberately: a real relation would mean
-- altering the User table to carry the back-relation, which is a much larger
-- thing to do to a live database than adding one standalone table.

-- CreateTable
CREATE TABLE "Insurer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMPANY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insurer_pkey" PRIMARY KEY ("id")
);

-- One spelling per insurer. The service also compares case-insensitively before
-- it writes; this is the backstop that survives two desks saving at once.
-- CreateIndex
CREATE UNIQUE INDEX "Insurer_name_key" ON "Insurer"("name");

-- CreateIndex
CREATE INDEX "Insurer_active_idx" ON "Insurer"("active");
