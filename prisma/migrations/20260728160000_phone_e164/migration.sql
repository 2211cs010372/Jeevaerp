-- EVERY MOBILE GAINS ITS COUNTRY CODE.
--
-- Numbers were stored as bare ten digits ("9876543210"). They are now stored in
-- E.164 ("+919876543210"), which is what lib/phone.ts writes and matches on.
--
-- WHY THIS IS SAFE TO RUN ON LIVE DATA
--
-- 1. It only rewrites values that ARE Indian mobiles - ten digits starting 6-9.
--    A sentinel like the system.online booking account ("0000000000") and any
--    landline or half-entered number is left exactly as it was. Manufacturing
--    "+910000000000" would invent a number that looks real and is not.
--
-- 2. It is idempotent. Anything already carrying a "+" is skipped, so re-running
--    it - or deploying it twice - cannot produce "+91+919876543210".
--
-- 3. User.phone is UNIQUE. Prefixing every row by the same constant preserves
--    that: two numbers that were distinct before are still distinct after.
--
-- WHAT STILL READS THE OLD SHAPE
--
-- Nothing is required to. Lookups go through phoneVariants() (lib/phone.ts),
-- which matches "+919876543210", "919876543210" and "9876543210" together - so
-- a row this migration deliberately skipped, or one written by an older client
-- mid-deploy, is still found. Failing to find an existing patient would let the
-- booking flow create a duplicate record, and a split history is a clinical
-- safety problem rather than untidy data.

UPDATE "Patient"
   SET "phone" = '+91' || "phone"
 WHERE "phone" ~ '^[6-9][0-9]{9}$';

UPDATE "Patient"
   SET "alternatePhone" = '+91' || "alternatePhone"
 WHERE "alternatePhone" ~ '^[6-9][0-9]{9}$';

UPDATE "User"
   SET "phone" = '+91' || "phone"
 WHERE "phone" ~ '^[6-9][0-9]{9}$';

UPDATE "AppointmentRequest"
   SET "phone" = '+91' || "phone"
 WHERE "phone" ~ '^[6-9][0-9]{9}$';

UPDATE "Supplier"
   SET "phone" = '+91' || "phone"
 WHERE "phone" ~ '^[6-9][0-9]{9}$';

-- Otp rows are short-lived (minutes) and are matched by exact phone. Migrating
-- them keeps any code that is in flight at deploy time verifiable, instead of
-- stranding a patient who is holding a message they cannot use.
UPDATE "Otp"
   SET "phone" = '+91' || "phone"
 WHERE "phone" ~ '^[6-9][0-9]{9}$';
