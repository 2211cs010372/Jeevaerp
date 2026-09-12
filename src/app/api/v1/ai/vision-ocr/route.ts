import { NextRequest, NextResponse } from "next/server";

export interface AiOcrPrescriptionItem {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface AiOcrInvoiceItem {
  medicine: string;
  pack: string;
  qty: string;
  free: string;
  batchNo: string;
  mrp: string;
  expiry: string;
  rate: string;
  amount: string;
  gst: string;
  hsn: string;
}

export interface AiOcrResponse {
  success: boolean;
  mode: "prescription" | "invoice";
  prescriptionItems?: AiOcrPrescriptionItem[];
  invoiceHeader?: {
    supplierName: string;
    gstin: string;
    invoiceNo: string;
    invoiceDate: string;
    netAmount: string;
  };
  invoiceItems?: AiOcrInvoiceItem[];
  error?: string;
  fallback?: boolean;
  passesRun?: number;
}

/** Call Gemini REST API helper */
async function callGemini(apiKey: string, promptText: string, cleanBase64: string): Promise<any> {
  const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];
  let lastErr = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: cleanBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.0,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        try {
          return JSON.parse(candidateText);
        } catch {
          const cleanedText = candidateText.replace(/```json/g, "").replace(/```/g, "").trim();
          return JSON.parse(cleanedText);
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Gemini API call failed");
}

export async function POST(req: NextRequest): Promise<NextResponse<AiOcrResponse>> {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        mode: "prescription",
        fallback: true,
        error: "GEMINI_API_KEY not configured",
      });
    }

    const body = await req.json();
    const { imageBase64, mode = "prescription" } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { success: false, mode, error: "imageBase64 is required" },
        { status: 400 }
      );
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    // ── PASS 1: UNIVERSAL FEW-SHOT EXTRACTION ──
    const pass1Prompt =
      mode === "prescription"
        ? `You are an expert medical AI OCR assistant. Analyze the image of a doctor's handwritten or printed prescription.
Extract ALL prescribed medications into a JSON object with key "items".
Each item must have:
- "name": full medicine name (expand medical abbreviations if obvious, e.g. PCM -> Paracetamol, Amox -> Amoxicillin)
- "dosage": e.g. "500mg", "650mg", "10ml", or ""
- "frequency": standard shorthand e.g. "OD", "BD", "TDS", "QID", "HS", "SOS", "STAT", "1-0-1", etc.
- "duration": e.g. "5 days", "1 week", etc.
- "instructions": e.g. "After food", "Before food", "At bedtime", etc.

Respond STRICTLY in valid JSON format:
{
  "items": [
    { "name": "PARACETAMOL 650MG", "dosage": "650mg", "frequency": "TDS", "duration": "5 days", "instructions": "After food" }
  ]
}`
        : `You are a world-class Universal Pharmaceutical GST Invoice AI Specialist.
Your task is to analyze ANY Indian pharma distributor tax invoice image (computerized, dot-matrix, thermal, multi-column, or printed bill) regardless of column order, table style, or distributor layout (e.g., Vishwanath Medical Stores, S R Medicals, Mahaveer, Balaji, Apollo, Sun Pharma, Cipla, Mankind, Micro Labs, etc.).

Analyze the visual structure of the document:
1. HEADER EXTRACTION:
- "supplierName": Distributor / Vendor company name at top header (e.g., VISHWANATH MEDICAL STORES).
- "gstin": 15-character GST identification number.
- "invoiceNo": Bill / Tax Invoice / Cash Memo number (e.g. RR8970).
- "invoiceDate": Invoice date (in DD/MM/YYYY format e.g. 23/07/2026).
- "netAmount": Total final bill amount payable at bottom (e.g. 14276.00).

2. ITEMS TABLE EXTRACTION:
Visually align columns regardless of order!
For EVERY single product row (SNO 1 to N), extract:
- "medicine": full product trade name + dosage form (e.g. "SMUTH SUS", "DULCOFLEX TAB", "CREMAFFIN SYP", "GLYCOMET GP 0.5 TAB").
- "pack": pack size string (e.g. "200ML", "15T", "5S", "15'S", "10'S", "10T").
- "qty": billed quantity (numeric or decimal e.g. "3", "10", "2.5").
- "free": bonus/free quantity (default "0", or decimal e.g. "0.5").
- "batchNo": exact batch string from the BATCH column (e.g. "MPB260688", "DLA26026", "SIH0887A", "48020919", "60002868"). Ignore manufacturer abbreviations (like ARIS, AVEN, U.S., BOOT, SUN, PFIZ) that may appear in an adjacent column!
- "mrp": Maximum Retail Price string (e.g. "181.88", "18.59", "295.00").
- "expiry": Expiry date formatted strictly as MM/YY or MM/YYYY (e.g. "01/28", "02/29", "04/28").
- "rate": Wholesale purchase rate / unit cost string (e.g. "138.57", "14.87", "225.00").
- "amount": Billed line total amount (e.g. "415.71", "148.70", "562.50").
- "gst": GST percentage number string without % sign (e.g. "5", "12", "18", "28").
- "hsn": HSN code string (e.g. "300490", "34011110").

STRICT GUARANTEES:
- Do NOT skip any product row! Extract ALL rows from item 1 to the last item.
- Do NOT combine lines or mistake manufacturer names for batch numbers.
- Verify math: Qty * Rate should match Amount.

Respond STRICTLY in valid JSON format:
{
  "header": { "supplierName": "VISHWANATH MEDICAL STORES", "gstin": "36AASFV8075E1ZJ", "invoiceNo": "RR8970", "invoiceDate": "23/07/2026", "netAmount": "14276.00" },
  "items": [
    { "medicine": "SMUTH SUS", "pack": "200ML", "qty": "3", "free": "0", "batchNo": "MPB260688", "mrp": "181.88", "expiry": "01/28", "rate": "138.57", "amount": "415.71", "gst": "5", "hsn": "300490" }
  ]
}`;

    const parsed1 = await callGemini(apiKey, pass1Prompt, cleanBase64);

    // ── PASS 2: ZERO-ERROR AUDITOR VERIFICATION PASS ──
    let finalParsed = parsed1;
    let passesRun = 1;

    if (mode === "invoice" && Array.isArray(parsed1?.items) && parsed1.items.length > 0) {
      try {
        const pass2Prompt = `You are a Senior Pharmaceutical Auditor conducting a Zero-Error Verification Audit.
Review the original invoice image and the Pass 1 extracted JSON:
${JSON.stringify(parsed1, null, 2)}

Audit Checklist:
1. ROW COUNT VERIFICATION: Count total rows on invoice image. Ensure EVERY single item row is present in the output array. If any row was missed, add it now.
2. COLUMN DISAMBIGUATION: Ensure batchNo is strictly the batch string, NOT the manufacturer code (ARIS, AVEN, U.S., SUN, PFIZ, BOOT, INTA, etc.).
3. ARITHMETIC VERIFICATION: Verify Qty * Rate = Amount for every row. Fix any OCR typos (e.g. misreading '0' as 'O', '1' as 'I', '8' as 'B').
4. EXPIRY DATE FORMAT: Ensure expiry is formatted as MM/YY or MM/YYYY.

Return the audited final JSON with keys "header" and "items".
Respond STRICTLY in valid JSON format.`;

        const parsed2 = await callGemini(apiKey, pass2Prompt, cleanBase64);
        if (Array.isArray(parsed2?.items) && parsed2.items.length >= parsed1.items.length) {
          finalParsed = parsed2;
          passesRun = 2;
        }
      } catch (err) {
        console.warn("Pass 2 refinement skipped, using Pass 1 results:", err);
      }
    }

    if (mode === "prescription") {
      const rawItems = Array.isArray(finalParsed?.items) ? finalParsed.items : [];
      const prescriptionItems: AiOcrPrescriptionItem[] = rawItems.map((it: any) => ({
        name: String(it.name || "").toUpperCase(),
        dosage: String(it.dosage || ""),
        frequency: String(it.frequency || "OD").toUpperCase(),
        duration: String(it.duration || "5 days"),
        instructions: String(it.instructions || "After food"),
      }));

      return NextResponse.json({
        success: true,
        mode: "prescription",
        prescriptionItems,
        passesRun,
      });
    } else {
      const header = finalParsed?.header || {};
      const rawItems = Array.isArray(finalParsed?.items) ? finalParsed.items : [];
      const invoiceItems: AiOcrInvoiceItem[] = rawItems.map((it: any) => {
        const qtyNum = parseFloat(String(it.qty || "0"));
        const rateNum = parseFloat(String(it.rate || "0"));
        const printedAmt = parseFloat(String(it.amount || "0"));
        const calcAmt = (!Number.isNaN(printedAmt) && printedAmt > 0)
          ? printedAmt.toFixed(2)
          : (!Number.isNaN(qtyNum) && !Number.isNaN(rateNum) && qtyNum > 0 && rateNum > 0)
            ? (qtyNum * rateNum).toFixed(2)
            : String(it.amount || "0");

        return {
          medicine: String(it.medicine || "").toUpperCase().trim(),
          pack: String(it.pack || "10s").trim(),
          qty: String(qtyNum || "0"),
          free: String(it.free || "0"),
          batchNo: String(it.batchNo || "").toUpperCase().trim(),
          mrp: String(it.mrp || "0").trim(),
          expiry: String(it.expiry || "").trim(),
          rate: String(rateNum || "0"),
          amount: calcAmt,
          gst: String(it.gst || "5").trim(),
          hsn: String(it.hsn || "").trim(),
        };
      });

      return NextResponse.json({
        success: true,
        mode: "invoice",
        passesRun,
        invoiceHeader: {
          supplierName: String(header.supplierName || "").trim(),
          gstin: String(header.gstin || "").trim(),
          invoiceNo: String(header.invoiceNo || "").trim(),
          invoiceDate: String(header.invoiceDate || "").trim(),
          netAmount: String(header.netAmount || "").trim(),
        },
        invoiceItems,
      });
    }
  } catch (err: any) {
    console.error("AI Vision OCR handler error:", err);
    return NextResponse.json({
      success: false,
      mode: "prescription",
      fallback: true,
      error: err?.message || "Unknown server error",
    });
  }
}
