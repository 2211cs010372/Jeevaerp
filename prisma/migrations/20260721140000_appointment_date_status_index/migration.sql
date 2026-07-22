-- Reception counts/lists filter Appointment by (visitDate, status) with no
-- doctorId, which the existing (doctorId, visitDate, status) index can't serve.
CREATE INDEX "Appointment_visitDate_status_idx" ON "Appointment"("visitDate", "status");
