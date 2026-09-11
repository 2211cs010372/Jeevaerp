/**
 * Ephemeral in-memory store for mobile invoice scan sessions.
 *
 * A session lives for at most 10 minutes. It is created when the desktop clicks
 * "Scan with Mobile", consumed when the phone uploads an image, and polled by
 * the desktop until the image arrives or the session expires.
 *
 * No database, no disk, no patient data. The image is a photo of a distributor's
 * paper invoice - it enters the server as base64, rides in RAM for a few seconds
 * while the desktop picks it up, and is garbage-collected when the session is
 * reaped. Nothing persists.
 */

import crypto from "crypto";

interface ScanSession {
  /** Random token the phone must present to upload. */
  token: string;
  /** "waiting" until the phone uploads, then "uploaded". */
  status: "waiting" | "uploaded";
  /** Base64-encoded image, set once the phone uploads. */
  imageBase64: string | null;
  /** MIME type of the uploaded image. */
  imageMime: string | null;
  /** When this session was created - for TTL reaping. */
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const sessions = new Map<string, ScanSession>();

/** Remove expired sessions. Called lazily on every create/poll. */
function reap() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > TTL_MS) sessions.delete(id);
  }
}

/** Create a new session. Returns the session ID and the upload token. */
export function createSession(): { sessionId: string; token: string } {
  reap();
  const sessionId = crypto.randomBytes(12).toString("hex");   // 24-char hex
  const token = crypto.randomBytes(16).toString("hex");       // 32-char hex
  sessions.set(sessionId, {
    token,
    status: "waiting",
    imageBase64: null,
    imageMime: null,
    createdAt: Date.now(),
  });
  return { sessionId, token };
}

/** Poll a session's current state. Returns null if expired or unknown. */
export function getSession(sessionId: string): {
  status: "waiting" | "uploaded";
  imageBase64: string | null;
  imageMime: string | null;
} | null {
  reap();
  const s = sessions.get(sessionId);
  if (!s) return null;
  return { status: s.status, imageBase64: s.imageBase64, imageMime: s.imageMime };
}

/**
 * Upload an image into the session.
 * Returns `true` on success, `false` if the session is unknown/expired or the
 * token is wrong.
 */
export function uploadToSession(
  sessionId: string,
  token: string,
  imageBase64: string,
  imageMime: string,
): boolean {
  reap();
  const s = sessions.get(sessionId);
  if (!s || s.token !== token) return false;
  s.status = "uploaded";
  s.imageBase64 = imageBase64;
  s.imageMime = imageMime;
  return true;
}

/** Clean up after the desktop has consumed the image. */
export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}
