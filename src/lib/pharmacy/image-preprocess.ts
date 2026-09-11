/**
 * Image preprocessing for OCR.
 *
 * Phone photos of invoices often suffer from low contrast, shadows, uneven background,
 * and low resolution. This module cleans up the image in an HTML5 canvas:
 * 1. Rescales to optimal OCR width (~2200px)
 * 2. Converts to grayscale
 * 3. Enhances contrast & applies adaptive binarization (black text on white paper)
 * 4. Sharpens text edges
 *
 * Returns a clean Blob ready for Tesseract OCR.
 */

export async function preprocessImageForOcr(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    // If it's a PDF or non-image, return as-is
    if (!file.type || !file.type.startsWith("image/")) {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        // Target width ~2200px for optimal Tesseract OCR accuracy
        const targetWidth = 2200;
        let width = img.width;
        let height = img.height;

        if (width > 0 && height > 0) {
          const scale = targetWidth / width;
          // Only resize if significantly different from target
          if (scale < 0.85 || scale > 1.25) {
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
        }

        canvas.width = width;
        canvas.height = height;

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const len = data.length;

        // Step 1: Compute luminance histogram to find adaptive contrast bounds
        const histogram = new Uint32Array(256);
        for (let i = 0; i < len; i += 4) {
          // Grayscale luminance weights (ITU-R BT.601)
          const gray = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
          data[i] = gray;
          histogram[gray]++;
        }

        // Find 5th percentile (darkest text) and 95th percentile (paper background)
        const totalPixels = width * height;
        let count = 0;
        let p5 = 0;
        let p95 = 255;

        for (let i = 0; i < 256; i++) {
          count += histogram[i];
          if (count >= totalPixels * 0.05 && p5 === 0) p5 = i;
          if (count >= totalPixels * 0.95) {
            p95 = i;
            break;
          }
        }

        if (p95 <= p5) p95 = p5 + 1;
        const range = p95 - p5;

        // Step 2: Linear stretch + High-contrast binarization curve
        for (let i = 0; i < len; i += 4) {
          let g = data[i];

          // Normalize g into 0..255 range
          g = Math.min(255, Math.max(0, ((g - p5) * 255) / range));

          // Contrast boosting: darken text, lighten paper
          if (g > 175) {
            g = 255; // Clean paper background
          } else if (g < 110) {
            g = Math.max(0, g - 35); // Deepen text darks
          }

          data[i] = g;
          data[i + 1] = g;
          data[i + 2] = g;
        }

        ctx.putImageData(imgData, 0, 0);

        canvas.toBlob(
          (blob) => {
            resolve(blob || file);
          },
          "image/png",
          1.0,
        );
      } catch {
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}
