# Lab billing moves to reception; the lab orders and tests

Date: 2026-09-28 · Status: approved in chat, implementing

## Goal

Money for lab tests is taken at **reception only**, on one screen with the same
three ways in as the pharmacy counter: **OP patient / Inpatient / New walk-in**.
The **labs portal orders and performs tests** and never takes money.

## Reception → "Lab tests" (the billing screen)

- Patient step with three tabs: OP patient (search), Inpatient (occupied beds),
  New walk-in (name + mobile, registered on submit).
- For the chosen patient: their **unbilled** tests (ordered earlier, usually by
  the lab) can be ticked onto the bill; more tests can be added from the
  catalogue - those are ordered as the bill is raised, so they reach the lab
  queue.
- OP patient: link to a completed visit and pre-tick the doctor's **advised**
  tests (the existing nav badge keeps working). Referring doctor when no visit.
- Bill aside: discount, payment (split tenders), or raise it unpaid.
- **Inpatient, like pharmacy:** pay now at reception, or leave the lab bill due
  at discharge. The bill is linked to the stay either way.
- One server call: `POST /labs/walk-in`.

## Labs portal

- Nav: Dashboard, Test queue, Order tests, Test catalog, Test prices, Patients.
  **Billing, Invoices and Day close are removed** (pages deleted).
- Order tests: no bill/payment. OP / walk-in orders stay unbilled until
  reception bills them. An inpatient order still raises its lab bill due at
  discharge automatically, so nothing is missed at the discharge desk.
- Dashboard: no revenue, collections or billing links; the unbilled count stays
  as information.

## Server permissions (LAB_TECH)

Removed from money writes: `POST /labs/bill`, `POST /billing/payment`,
`POST /billing/settle-dues`, `PATCH /billing/invoice/:id`,
`POST /billing/invoice/:id/cancel`, `POST /billing/consultation`,
`GET /labs/day-close`, `GET /reception/day-close`. `POST /labs/walk-in` rejects a
`bill` from a LAB_TECH. Ordering, results, reports, catalogue, prices and bill
view/print are unchanged. RECEPTIONIST and ADMIN are unchanged.

## Service changes (labs.service)

- `orderTests` gains `skipStayBill` - the caller bills the stay itself.
- `billLabTests` bills an inpatient's tests onto the stay (admission-linked
  invoice, payments optional); tests from two different stays, or a stay and an
  outpatient visit, are refused on one bill.
- `walkInOrder` accepts `appointmentId` + `fromAdvised`, refuses a bill from a
  LAB_TECH, and with a bill always orders with `skipStayBill` and bills with
  the tenders given (none = due).

## Existing data

Bills the lab already raised keep their dues; reception's Billing page already
lists and collects LAB bills. Past lab-counter payments stay in admin day close.

## Testing

Service tests (Prisma mocked) for the LAB_TECH refusal and the stay rule;
typecheck + full vitest. No writes to the live database.
