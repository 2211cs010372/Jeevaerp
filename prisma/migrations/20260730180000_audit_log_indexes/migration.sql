-- AUDIT LOG INDEXES: keep the searchable audit trail searchable at real volume.
--
-- The trail became queryable in the previous change, and the queries the admin page
-- actually issues were not covered by any existing index. AuditLog carried:
--
--   (targetTable, targetId)        for "everything about this record"
--   (actorUserId, createdAt)       for "everything this member of staff did"
--   (actorPatientId, createdAt)
--
-- but nothing on createdAt alone, which is what the DEFAULT view sorts by
-- (ORDER BY createdAt DESC, no filter) and what the date-range filter reads. Both
-- therefore sorted the whole table.
--
-- WHY IT MATTERS HERE AND NOT IN TESTING. At the ~300 rows a test database holds,
-- a full sort is instant and the omission is invisible. This hospital books 100-200
-- OP visits a day, and each visit writes roughly 6-12 audit rows across booking,
-- check-in, vitals, prescription, invoice, payment, dispensing and lab results.
-- That is about 40,000 rows a month, ~480,000 in the first year. The audit page
-- would have degraded from instant to several seconds within about six months, and
-- the natural reaction to a slow page is to stop opening it - which quietly costs
-- the hospital the one screen that answers medico-legal questions.
--
-- WHY NOW. Adding an index to an empty table is instant. Adding one to a table
-- with half a million rows takes a lock and real time. This lands before the first
-- production patient exists, which is the cheapest this change will ever be.
--
-- The action index carries createdAt as its second column so the filter and the
-- ordering are served by one index rather than a filter followed by a sort. It only
-- pays off for EXACT action matches, which is why buildAuditWhere now uses `equals`
-- for the dropdown's complete action names instead of a `contains` that no btree
-- index can serve.
--
-- Additive. No table is rewritten, no data changes, and dropping the two indexes
-- rolls it back completely.

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
