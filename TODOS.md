# TODOS

Deferred work, with the reason it was deferred. Nothing here is forgotten,
nothing here is blocking the first hospital go-live.

Source: `/plan-ceo-review`, 2026-07-30, SCOPE REDUCTION mode.
Target customer for that review: single 50-bed hospital, no insurance handling,
staff workflow is mostly status updates.

---

## Deferred until nurses are day-one users

### NURSE role and ward-scoped portal
`Role` enum stops at RECEPTIONIST / DOCTOR / LAB_TECH / PHARMACIST / ADMIN, but
`ChargeCategory.NURSING` exists and a 50-bed IPD runs on nurses (vitals rounds,
drug administration, shift handover).

Deferred because it is the largest of the six go-live items and it is a workflow
gap, not a safety gap. The system is safe without it. The ward is just on paper.

**Promote to blocker the moment the answer to "will nurses log in on day one?"
is yes.** If nurses share the reception login instead, the audit trail added in
PR 3 is void for every ward action, which defeats the point of adding it.

**Answered 2026-08-02: no nurse logins at go-live.** Stays deferred, not a
blocker. The condition above is unchanged and still live - the day the hospital
puts nurses on the system, this comes back before they get a shared login.

Shape when it lands: `NURSE` in `Role`, ward-scoped guard in
`src/lib/auth/portal-guard.tsx`, a nursing portal with three screens only
(my ward's beds, record vitals, drug administration log). No more.

---

## Deferred until the second hospital is real

### Multi-tenancy
There is a single `HospitalConfig`. Every query assumes one hospital.

Deferred because tenancy is only worth paying for when tenant two exists. It is a
one-way door: retrofitting a tenant key across 45 models and 134 routes after a
year of production data is far more expensive than doing it before hospital two
signs. Revisit the moment a second hospital is in the pipeline, not after.

---

## Deferred pending a product question

### OT (operation theatre) register and scheduling
`ChargeCategory.PROCEDURE` bills procedures, but there is no OT register, no OT
scheduling, no OT consumables tracking.

Deferred because it is unknown whether the target hospital operates. If they are
medical-only this is dead scope. If they do surgery it is a real gap and moves up.
**Open question for the customer, not an engineering decision.**

**Answered 2026-08-02: OT was not in scope at the client meeting.** Dead scope
for this hospital, so nothing to build. Left in this file rather than deleted
because "they did not ask for it" is not the same as "they will never operate".

### MRD with ICD-10 coding
No diagnosis coding anywhere. Fine while insurance is out of scope.

Becomes mandatory for government schemes (CGHS, Ayushman) and for NABH. Worth
reserving the column shape before a year of uncoded discharge summaries exist.

---

## Dormant on purpose, do not delete

### Insurance claims
`InsuranceClaim`, `ClaimEvent`, `src/server/services/insurance.service.ts` (237
lines) and the admin claims UI are built and unused, because the first hospital
does not handle insurance.

Keep it. It is the upsell the day they add a scheme, and claim-stage tracking is
the same status-update interaction the staff already know. Deleting it to tidy up
would be throwing away paid-for inventory.

---

## Left out of PR 3 (login throttle) on purpose

### Pruning old LoginAttempt rows
`staffLogin` deletes a username's failures on a successful sign-in, so the table
stays small in normal use. What is never cleared is failures against usernames
that never succeed - a bot guessing `admin`, `root`, `test` leaves rows behind
forever. The `createdAt` index exists for the prune; the prune itself does not.

Deferred because it is housekeeping, not a security hole: the counts are all
windowed, so stale rows change no decision, they only take space. Worth a line in
the nightly job whenever one exists (the same place the backup will be scheduled).

---

## Left out of PR 4 (admission outcomes) on purpose

### No backfill of historical admissions
The seven existing stays stay `DISCHARGED`. That is the only honest thing to say
about them: nobody now knows whether one was really a LAMA, and guessing would put
invented clinical facts into a medico-legal record. Anything before this migration
means "closed, manner not recorded".

### Outcome is not yet a filter on the closed-stays list
The list shows the outcome per row and marks the exceptions, but there is no "show
me only the deaths this month" filter. Deferred until somebody asks: the audit log
can already answer it via `action = ADMISSION_CLOSED_EXPIRED`, which is where a
medico-legal query would look anyway.

---

## Left out of PR 1 (error monitoring) on purpose

### Push notification when a new crash appears
`/admin/errors` is a viewer. Somebody still has to open it, which means a crash on
a Sunday waits until Monday.

Deferred because the naive version is a foot-gun: "SMS on every 500" turns one bad
deploy into several hundred rupees of texts at 2am, and the hospital learns to
ignore the alerts. It needs a real design first: alert on a NEW fingerprint only,
never on a repeat; one message per hour maximum; quiet hours; and a daily digest
instead of a live ping for anything that is not new.

The parts already exist. `src/lib/sms.ts` and `src/lib/email.ts` send today, and
`captureError` in `src/server/services/errors.service.ts` already knows whether a
fingerprint is new (it is the branch that calls `create` rather than `updateMany`).

### Client-side error capture
PR 1 captures server crashes only, because that is where the invisible failure
was: a 500 at the billing counter with nobody watching the console.

A React render crash in the browser is a different failure and needs a different
mechanism (an `error.tsx` boundary plus an ingest endpoint). Deferred because the
ingest endpoint has to be unauthenticated to be useful, which makes it a spam
target, and that needs rate limiting designed before it is opened.

### Backup of uploaded files
`npm run backup` dumps the database. Patient documents on local disk
(`/storage`, see `src/lib/storage.ts`) and Cloudinary uploads are not in it.

Deferred because the hospital does not rely on uploaded scans yet. The day it
does, this becomes a go-live blocker for that feature, not a nice-to-have. Noted
in `docs/runbook-restore.md` under "What is not covered" so the gap is visible to
whoever runs a restore.

---

## Measurement debt

### Friction telemetry on status changes
If the product's real value is a shared source of truth, the thing that kills it
is data entry friction, not missing features. A stale bed board is a churned
customer who never tells you why.

Instrument taps-per-status-change on the three highest-frequency transitions
before adding any new feature:

1. Bed status change (`/api/v1/ipd/beds/status`)
2. Lab result ready (`src/server/services/labs.service.ts`)
3. Prescription dispensed (`src/server/services/pharmacy.service.ts`)
