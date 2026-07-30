-- LOGIN THROTTLE: the staff password endpoint stops being an unlimited guessing loop.
--
-- The patient OTP path has been attempt-capped and rate-limited per phone since it
-- shipped. The staff password path had neither, so the ADMIN account - the one
-- that can read every patient record in the hospital - could be guessed at over
-- the public internet as fast as bcrypt would answer.
--
-- TWO LIMITS, BECAUSE THERE ARE TWO ATTACKS. Per username stops a guessing loop
-- against one account. Per IP stops the same attacker spraying one likely
-- password across every username they can think of, which never trips a
-- per-username limit at all. Hence the two indexes below: each one serves the
-- count query for its own key, and the window scan is the leading range column.
--
-- FAILURES AGAINST UNKNOWN USERNAMES ARE RECORDED TOO. If only real accounts were
-- counted, a 429 would mean "this username exists", and the throttle would become
-- exactly the account enumeration oracle that staffLogin's constant-time password
-- comparison exists to prevent.
--
-- Successes are NOT stored here - those are StaffSession rows. This table only
-- ever holds failures, and staffLogin deletes a username's rows on a successful
-- sign-in, so it stays small: a few rows per bad morning, cleared by the next
-- good login.
--
-- New table only. Nothing existing is touched, and dropping it rolls the change
-- back completely (the app then behaves as it did before, unthrottled).

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- Serves the per-username count over the sliding window.
-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- Serves the per-IP count over the same window.
-- CreateIndex
CREATE INDEX "LoginAttempt_ipAddress_createdAt_idx" ON "LoginAttempt"("ipAddress", "createdAt");

-- For pruning rows that have aged out of every window.
-- CreateIndex
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");
