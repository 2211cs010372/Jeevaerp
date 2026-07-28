/**
 * Decoding the base64 data URIs this system stores images in.
 *
 * Branding images (the logo, the browser tab icon) live in the database as data
 * URIs rather than files, because a file written to /public does not survive a
 * deploy on a serverless host. Anything that has to hand those back to a browser
 * as real bytes - with a real Content-Type - comes through here.
 */

export interface DecodedDataUrl {
  mime: string;
  bytes: Buffer;
}

/**
 * Split a base64 data URI into its media type and its bytes.
 *
 * Returns null rather than throwing on anything malformed. Every caller is
 * serving a decorative asset, and the useful response to "this isn't a valid
 * image" is a 404, not a 500 on a page that was otherwise fine.
 *
 * Only `;base64,` form is accepted, which matches what the admin validators let
 * into the column in the first place - percent-encoded data URIs would need
 * different decoding and nothing here ever writes one.
 */
export function decodeBase64DataUrl(dataUrl: string | null | undefined): DecodedDataUrl | null {
  if (!dataUrl) return null;

  // The `s` flag matters: a base64 payload is long and some encoders wrap it,
  // so the body may legitimately contain newlines.
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;

  const [, mime, b64] = match;
  // Buffer.from is lenient - it stops at the first invalid character rather than
  // throwing - so an empty or junk payload is caught by the length check, not by
  // an exception that never comes.
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return null;

  return { mime, bytes };
}
