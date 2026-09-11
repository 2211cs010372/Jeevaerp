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
  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
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

    // ── PASS 1: FEW-SHOT EXTRACTION ──
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
        : `You are a high-precision pharmaceutical GST invoice OCR specialist.
Extract ALL header details and EVERY product row from this Indian pharma distributor tax invoice (e.g. S R MEDICALS, VISHWANATH PHARMA format).

HEADER fields to extract:
- "supplierName": company / distributor name (e.g. S R MEDICALS)
- "gstin": 15-character GSTIN (e.g. 36AWZPG5948E1ZX)
- "invoiceNo": tax invoice number (e.g. ROH1447)
- "invoiceDate": date string (DD/MM/YYYY)
- "netAmount": total invoice amount string (e.g. 4740.00)

ITEMS array where each item must contain:
- "medicine": full product name (e.g. AZIL KENZOL SOAP, ERNS LYNIX LOTION, WALB RABZOT L)
- "pack": pack size string (e.g. 75gm, 60ML, 10'S, 15'S)
- "qty": billed quantity string (e.g. 10.0 -> "10")
- "free": free quantity string (default "0")
- "batchNo": batch number string (e.g. K-035, PNC-015, 26030604, EHC124, AC250392)
- "mrp": MRP price string (e.g. 160.00, 140.00, 106.78, 93.50, 168.75)
- "expiry": expiry date string in MM/YY format (e.g. 01/28, 12/27, 05/27, 07/27)
- "rate": purchase rate / unit price string (e.g. 42.00, 35.00, 28.00, 32.00)
- "amount": line total amount string (e.g. 420.00, 350.00, 280.00, 320.00)
- "gst": GST percentage string (e.g. "5", "12", "18")
- "hsn": 8-digit HSN code string (e.g. 34011110, 30049011, 30049091)

Respond STRICTLY in valid JSON format:
{
  "header": { "supplierName": "S R MEDICALS", "gstin": "36AWZPG5948E1ZX", "invoiceNo": "ROH1447", "invoiceDate": "23/07/2026", "netAmount": "4740.00" },
  "items": [
    { "medicine": "AZIL KENZOL SOAP", "pack": "75gm", "qty": "10", "free": "0", "batchNo": "K-035", "mrp": "160.00", "expiry": "01/28", "rate": "42.00", "amount": "420.00", "gst": "5", "hsn": "34011110" }
  ]
}`;

    const parsed1 = await callGemini(apiKey, pass1Prompt, cleanBase64);

    // ── PASS 2: SELF-REFINEMENT & VERIFICATION PASS ──
    let finalParsed = parsed1;
    let passesRun = 1;

    if (mode === "invoice" && Array.isArray(parsed1?.items) && parsed1.items.length > 0) {
      try {
        const pass2Prompt = `You are a Senior Auditor verifying pharmaceutical OCR extraction.
Review the original invoice image and the following extracted JSON data:
${JSON.stringify(parsed1, null, 2)}

Perform a strict verification:
1. Ensure EVERY single product row printed on the invoice is included without missing any lines.
2. Verify arithmetic: Qty * Rate should equal Amount (e.g., 10 * 42.00 = 420.00).
3. Ensure Batch Numbers, Expiry dates (MM/YY), MRP, and HSN codes match the photo with 100% precision.
4. Correct any minor OCR noise or misread characters.

Return the final audited JSON with keys "header" and "items".
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
        const calcAmt = (!Number.isNaN(qtyNum) && !Number.isNaN(rateNum) && qtyNum > 0 && rateNum > 0)
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
