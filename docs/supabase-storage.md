# Supabase Storage setup

File uploads (prescription scans, lab reports, doctor portraits) live in Supabase
Storage. Cloudinary is gone — its delivery URL is public and guessable, which is
the wrong shape for a patient's health record.

This is a one-time setup per environment.

## 1. Create the buckets

Set the keys first (step 2), then:

```bash
npm run storage:setup
```

It creates whatever is missing, leaves whatever exists alone, and is safe to
re-run. With `SUPABASE_SERVICE_ROLE_KEY` it also sets each bucket's public/private
flag and there is nothing else to do. With only S3 keys it creates both buckets
private — "public" is a Supabase concept that the S3 protocol has no way to
express — and prints the one dashboard toggle left for `doctor-photos`.

It also refuses to stay quiet if `patient-records` is public, and switches it back.

To do it by hand instead: Dashboard → **Storage** → **New bucket**.

| Bucket            | Public? | Holds                                            |
| ----------------- | ------- | ------------------------------------------------ |
| `patient-records` | **No**  | Prescription scans, lab reports (PHI)            |
| `doctor-photos`   | **Yes** | Doctor portraits for the public directory        |

`patient-records` **must stay private**. Nothing reads it directly: the bytes are
streamed by `/api/v1/files/prescriptions/[key]` only after that route has checked
the caller is clinical staff or the patient the file belongs to. Flipping the
bucket to public would republish every scan on a guessable URL and undo the whole
point of the gate.

No row-level-security policies are needed on either bucket. The server holds the
service-role key, which bypasses RLS, and no browser ever talks to Storage
directly.

## 2. Set the environment variables

Set **one** of the two credential blocks. Both reach the same buckets, and the
app prefers S3 when both are present.

### (a) S3 protocol — Dashboard → Storage → S3 connection

```
SUPABASE_URL=https://fcxlfpcgtgfmmiqcsyoe.supabase.co
SUPABASE_S3_ACCESS_KEY_ID=<access key id>
SUPABASE_S3_SECRET_ACCESS_KEY=<secret access key>
SUPABASE_S3_REGION=ap-south-1
SUPABASE_PHI_BUCKET=patient-records
SUPABASE_PUBLIC_BUCKET=doctor-photos
```

The endpoint (`https://<project>.storage.supabase.co/storage/v1/s3`) is derived
from `SUPABASE_URL`, so it is not configured separately — the two have to agree,
and a hand-typed mismatch fails at upload with an opaque signing error. Override
it with `SUPABASE_S3_ENDPOINT` only if a project genuinely needs a different host.

The secret access key is shown **once**, when the key pair is created. If it is
lost, create a new pair and delete the old one.

### (b) Native — Dashboard → Project Settings → API

```
SUPABASE_URL=https://fcxlfpcgtgfmmiqcsyoe.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<the service_role key, NOT the publishable one>
SUPABASE_PHI_BUCKET=patient-records
SUPABASE_PUBLIC_BUCKET=doctor-photos
```

### Either way

These are secrets. None may carry a `NEXT_PUBLIC_` prefix — that compiles the
value into the browser bundle, and each of them bypasses row-level security, so a
leaked one lets anybody read every patient's scans. `npm run preflight` blocks a
deploy if it finds a public copy. Do not commit them. On Vercel, add them under
Project → Settings → Environment Variables, marked for Production and Preview.

## 3. Verify

Upload a prescription scan from the reception portal, then open it from the
patient's record. If the file opens for staff and a signed-out browser gets a 401
from `/api/v1/files/prescriptions/…`, both halves are working.

## What happens without the key

`storeFile()` falls back to writing under `storage/prescriptions/` on local disk.
That is deliberate so a developer can run the app with no Supabase account. It is
**not** viable in production on Vercel or any other serverless host: the
filesystem is ephemeral, so uploaded records disappear at the next deploy or cold
start. The app logs an error at startup-of-first-upload when it detects this in
production.

## Existing files

Records uploaded before this change are on local disk. `readStoredFile()` checks
Supabase first and falls back to disk, so those keep opening without a migration.
The stored URL shape (`/api/v1/files/prescriptions/<key>`) did not change.

## Why both protocols are supported

They are two doors into one room. S3 uses `@aws-sdk/client-s3` against
`https://<project>.storage.supabase.co/storage/v1/s3`; the native path uses
`@supabase/supabase-js` against the REST API. Nothing above `src/lib/storage.ts`
can tell which one ran — the stored URL, the auth gate and the public image URL
are identical either way.

Keeping both means the hospital can use whichever credential it already has, and
that an S3-compatible tool (`rclone`, a backup runner, any S3 SDK) can read the
same buckets directly without a second setup.
