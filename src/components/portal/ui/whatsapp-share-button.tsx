"use client";

import React from "react";
import { Icon } from "./icons";

export interface WhatsAppShareProps {
  phone: string;
  patientName?: string;
  type: "bill" | "prescription" | "lab_report" | "discharge";
  documentId: string;
  amount?: number | string;
  pdfUrl?: string;
  variant?: "button" | "icon";
  className?: string;
}

export function WhatsAppShareButton({
  phone,
  patientName = "Patient",
  type,
  documentId,
  amount,
  pdfUrl,
  variant = "button",
  className = "",
}: WhatsAppShareProps) {
  const cleanPhone = phone.replace(/\D/g, "");
  const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  let title = "Document";
  if (type === "bill") title = "Bill / Invoice";
  else if (type === "prescription") title = "Prescription";
  else if (type === "lab_report") title = "Lab Report";
  else if (type === "discharge") title = "Discharge Summary";

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const finalPdfUrl = pdfUrl ? (pdfUrl.startsWith("http") ? pdfUrl : `${appUrl}${pdfUrl}`) : `${appUrl}/print/${type}?id=${documentId}`;

  const messageText = `Dear ${patientName}, your ${title} (#${documentId})${
    amount ? ` for ₹${amount}` : ""
  } from Jeeva Hospital is ready.\n\nView/Download PDF: ${finalPdfUrl}\n\nThank you for choosing Jeeva Hospital!`;

  const waUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(messageText)}`;

  if (variant === "icon") {
    return (
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Share on WhatsApp"
        className={`inline-flex items-center justify-center p-2 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 transition-colors ${className}`}
      >
        <Icon name="share" className="w-4 h-4" />
      </a>
    );
  }

  return (
    <a
      href={waUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm transition-all ${className}`}
    >
      <Icon name="share" className="w-4 h-4" />
      <span>WhatsApp Share</span>
    </a>
  );
}
