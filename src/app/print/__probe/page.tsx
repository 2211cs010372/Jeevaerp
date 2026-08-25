"use client";

// TEMPORARY - visual probe for bill pagination. Delete after verifying.
import { InvoiceDoc, type Invoice } from "@/components/print/invoice-sheet";

const N = 34;
const NAMES = [
  "Amoxycillin + Clavulanic Acid 625mg Tablet",
  "Pantoprazole 40mg IV Injection",
  "Paracetamol 650mg Tab",
  "Ondansetron 4mg/2ml Inj",
  "Normal Saline 0.9% 500ml IV Fluid with a deliberately long trailing name to force a two-line wrap",
  "Metformin SR 500mg",
];

const items = Array.from({ length: N }, (_, i) => ({
  description: `${NAMES[i % NAMES.length]} [B:BN${1000 + i}]`,
  hsnSac: "3004",
  qty: (i % 4) + 1,
  unitPrice: (12.5 + i).toFixed(2),
  amount: ((12.5 + i) * ((i % 4) + 1)).toFixed(2),
  gstRatePct: "12",
}));

const sub = items.reduce((s, it) => s + Number(it.amount), 0);

const inv: Invoice = {
  id: "probe", receiptNo: "PH/26-27/00841", source: "PHARMACY", status: "PAID",
  createdAt: new Date().toISOString(), billDate: null,
  patient: { displayId: "JH-004512", fullName: "Ramulamma Bandari", phone: "9704691308", address: "H.No 3-12-9, Balasamudram, Hanamkonda", age: 62, gender: "FEMALE" },
  items,
  subtotal: sub.toFixed(2), discountAmount: "0.00", taxableAmount: sub.toFixed(2),
  cgstAmount: (sub * 0.06).toFixed(2), sgstAmount: (sub * 0.06).toFixed(2),
  totalAmount: (sub * 1.12).toFixed(2), amountPaid: (sub * 1.12).toFixed(2),
  advanceAdjusted: "0.00", balanceDue: "0.00",
  payer: "SELF_PAY", payerName: null,
  payments: [{ mode: "CASH", amount: (sub * 1.12).toFixed(2), reference: null, createdAt: new Date().toISOString() }],
  hospital: {
    legalName: "Jeeva Multispeciality Hospital", addressLine: "# 1-8-81, Sai Nagar, Beside Swimming Pool",
    city: "Hanamkonda", state: "Telangana", stateCode: "36", pincode: "506 001",
    gstin: "36ABCDE1234F1Z5", phone: "9704691308", logoDataUrl: null, invoiceFooterNote: null,
  },
  buyer: null, eInvoice: null,
};

export default function Probe() {
  return <InvoiceDoc inv={inv} />;
}
