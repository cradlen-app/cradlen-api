# `infrastructure/storage/`

Object storage for Cloudflare R2 (S3-compatible), used for attachments/scans —
currently investigation result files uploaded by patients.

`StorageService` (this folder is the only place the AWS SDK is imported):

- `createPresignedUploadUrl({ key, contentType })` — short-lived presigned PUT; the
  browser uploads bytes directly to R2 (the API never streams the binary).
- `createPresignedDownloadUrl(key)` — short-lived presigned GET; the bucket is private,
  so read paths mint these on demand from the stored object key.
- `headObject(key)` — confirm an upload landed and re-check size/content-type; null when
  the object does not exist.
- `deleteObject(key)` — cleanup.
- `assertAllowedContentType` / `assertWithinSizeLimit` — guards against the configured
  allowlist (`R2_ALLOWED_CONTENT_TYPES`) and size cap (`R2_MAX_UPLOAD_BYTES`).

Config: `@config/storage.config.ts` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optional `R2_ENDPOINT`, presign TTLs, upload limits).

**Ops:** the R2 bucket needs a CORS policy allowing the web origin to `PUT` (and `GET`
for direct downloads), configured in the Cloudflare dashboard.
