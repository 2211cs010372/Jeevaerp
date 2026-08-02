import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decodeBase64DataUrl } from "@/lib/data-url";

export const dynamic = "force-dynamic";

/**
 * The browser tab icon, served as real image bytes.
 *
 * WHY A ROUTE AND NOT A FILE
 * --------------------------
 * The obvious alternative is writing the upload to /public/favicon.ico, which
 * does not survive a deploy on any serverless host - the same reason the logo
 * lives in a column (see HospitalConfig.logoDataUrl). The icon is therefore
 * stored as a data URI and decoded here.
 *
 * WHY NOT JUST PUT THE DATA URI IN THE <link> TAG
 * -----------------------------------------------
 * Browsers do accept `<link rel="icon" href="data:image/png;base64,...">`, but
 * it would mean the root layout reading the database on every single page
 * render of the public site just to emit a tab icon. Pointing the link at a
 * fixed URL keeps the layout static and moves the lookup to the one request
 * that actually needs it - which the browser then caches and stops asking for.
 *
 * WHEN NOTHING HAS BEEN UPLOADED
 * ------------------------------
 * Falls back to the shipped Jeeva mark rather than a 404. The precedence is
 * admin upload first, shipped mark second, and the browser's default never -
 * a hospital tab should carry the hospital's logo out of the box, before
 * anybody has been through Settings.
 *
 * The fallback is a redirect to the file rather than the bytes, because
 * /public is served by the CDN on a serverless host and is not reliably on the
 * lambda's filesystem. Redirecting also keeps this the ONLY <link rel="icon">
 * in the app: declaring the static file alongside this route in the layout's
 * `icons` array would leave the browser to pick between them by `sizes`, which
 * would silently beat an admin's uploaded icon.
 */
const FALLBACK_ICON = "/images/JEEVA%20LOGO%20ICON.png";

/** The shipped mark, with the same short cache the uploaded icon gets. */
const noIcon = (req: Request) =>
  NextResponse.redirect(new URL(FALLBACK_ICON, req.url), {
    status: 302,
    // Without this, every tab of every page re-asks where the icon lives.
    headers: { "Cache-Control": "public, max-age=300" },
  });

export async function GET(req: Request) {
  let dataUrl: string | null | undefined;
  try {
    const config = await prisma.hospitalConfig.findFirst({ select: { faviconDataUrl: true } });
    dataUrl = config?.faviconDataUrl;
  } catch {
    // A tab icon is decorative. Every page in the app references this URL, so a
    // database that is unreachable - or a schema that hasn't been migrated yet -
    // must degrade to "no icon" rather than serving a 500 on every page load.
    return noIcon(req);
  }
  if (!dataUrl) return noIcon(req);

  const decoded = decodeBase64DataUrl(dataUrl);
  if (!decoded) return noIcon(req);
  const { mime, bytes } = decoded;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      // Short max-age with a long stale window: an admin who changes the icon
      // wants to see it soon, and everyone else should never wait on this.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
