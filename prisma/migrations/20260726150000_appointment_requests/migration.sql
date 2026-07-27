-- Callback requests raised from the public website.
--
-- The slot-booking path already on the site asks a patient to commit to an
-- exact minute before they have spoken to anyone. Many will not, and ring the
-- desk instead - at which point the website did nothing. This captures the
-- smallest useful intent: a name, a verified number, and who they want to see.
--
-- Deliberately its own table, not an Appointment with a "pending" status:
--   * an Appointment holds a slot, a fee snapshot and an OP number, none of
--     which exist yet here;
--   * every count, queue and day-close figure in the system reads Appointment,
--     and a pending row would quietly inflate all of them.
--
-- No Patient row is written by this flow. An unverified enquiry must never
-- enter the master patient index.

CREATE TYPE "AppointmentRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'BOOKED', 'CLOSED');

CREATE TABLE "AppointmentRequest" (
    "id"            TEXT NOT NULL,
    "refNo"         TEXT NOT NULL,
    "patientName"   TEXT NOT NULL,
    "phone"         TEXT NOT NULL,
    "doctorId"      TEXT,
    "preferredDate" DATE,
    "note"          TEXT,
    "status"        "AppointmentRequestStatus" NOT NULL DEFAULT 'NEW',
    "appointmentId" TEXT,
    "handledNote"   TEXT,
    "handledById"   TEXT,
    "handledAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress"     TEXT,

    CONSTRAINT "AppointmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentRequest_refNo_key" ON "AppointmentRequest"("refNo");
-- One request can never spawn two visits.
CREATE UNIQUE INDEX "AppointmentRequest_appointmentId_key" ON "AppointmentRequest"("appointmentId");
-- The desk reads this as "oldest NEW first", all day.
CREATE INDEX "AppointmentRequest_status_createdAt_idx" ON "AppointmentRequest"("status", "createdAt");
-- Spotting a repeat caller before ringing back.
CREATE INDEX "AppointmentRequest_phone_idx" ON "AppointmentRequest"("phone");

ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_handledById_fkey"
    FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
