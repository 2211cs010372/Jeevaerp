-- THE REFERRING DOCTOR, AND THE DATE THE SAMPLE WAS ACTUALLY REGISTERED.
--
-- A lab test knew its doctor only through an Appointment. A sample given at
-- the lab window against an outside chit has no appointment, so every one of
-- those reports printed "Ref. Doctor: Self / walk-in" - for a patient who was
-- standing at the counter holding the referral in their hand.
--
-- referringDoctorId names that doctor without inventing a consultation: no OP
-- number is minted, nothing is billed, and a test raised off a real visit still
-- takes its doctor from the visit.
--
-- orderedAt is the date the DESK says the sample was registered. A sample taken
-- on Saturday evening and typed in on Monday printed "Registered On: Monday",
-- which is wrong on a document the patient carries to another hospital. It is a
-- SEPARATE column from createdAt on purpose - createdAt stays the untouched
-- record of when the row was written, so the day's takings, the queue order and
-- the audit trail all still read the real clock. NULL everywhere nobody has had
-- to correct anything, and the report falls back to createdAt.

ALTER TABLE "LabTest" ADD COLUMN "referringDoctorId" TEXT;
ALTER TABLE "LabTest" ADD COLUMN "orderedAt" TIMESTAMP(3);

ALTER TABLE "LabTest"
    ADD CONSTRAINT "LabTest_referringDoctorId_fkey"
    FOREIGN KEY ("referringDoctorId") REFERENCES "Doctor"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
