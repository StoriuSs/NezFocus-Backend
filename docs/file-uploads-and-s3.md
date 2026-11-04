# File Uploads, S3, and Presigned URLs

A complete guide to how this starter handles file uploads, why the architecture is shaped the way it is, what the two valid upload patterns are, and how to decide between them.

## Table of contents

- [The two upload architectures](#the-two-upload-architectures)
  - [Architecture A — Proxy through backend](#architecture-a--proxy-through-backend)
  - [Architecture B — Direct upload via presigned URL](#architecture-b--direct-upload-via-presigned-url)
  - [Decision matrix — which to pick when](#decision-matrix--which-to-pick-when)
- [What "presigned URL" actually means](#what-presigned-url-actually-means)
  - [Presigned PUT (upload)](#presigned-put-upload)
  - [Presigned GET (download)](#presigned-get-download)
  - [The crypto, briefly](#the-crypto-briefly)
- [Reading files: public bucket vs. presigned GET URLs](#reading-files-public-bucket-vs-presigned-get-urls)
- [Downloads vs. inline previews](#downloads-vs-inline-previews)
  - [Two ways to set Content-Disposition](#two-ways-to-set-content-disposition)
  - [Frontend patterns](#frontend-patterns)
  - [Cost and bandwidth implications](#cost-and-bandwidth-implications)
  - [Range requests, partial downloads, and resumable downloads](#range-requests-partial-downloads-and-resumable-downloads)
- [How the starter is wired](#how-the-starter-is-wired)
  - [The shape: ports and adapters](#the-shape-ports-and-adapters)
  - [IStorageService interface](#istorageservice-interface)
  - [S3 implementation](#s3-implementation)
  - [Local implementation](#local-implementation)
- [What the code looks like end-to-end](#what-the-code-looks-like-end-to-end)
  - [Proxy upload (what the starter ships with)](#proxy-upload-what-the-starter-ships-with)
  - [Direct upload (presigned PUT) — not shipped, sketched](#direct-upload-presigned-put--not-shipped-sketched)
- [S3 bucket setup checklist](#s3-bucket-setup-checklist)
- [CORS for direct browser ↔ S3 traffic](#cors-for-direct-browser--s3-traffic)
- [Orphaned objects and cleanup](#orphaned-objects-and-cleanup)
- [Common gotchas](#common-gotchas)

---

## The two upload architectures

When a user uploads a file in a web app, the bytes have to get from the browser to S3 (or whatever your object store is). There are exactly two valid ways to do this. The starter ships with the first by default.

### Architecture A — Proxy through backend

```
Browser →  POST /api/v1/users/me/avatar  → NestJS  → S3.putObject() → store key in DB
Browser ←  img src=https://...           ← NestJS  ← S3 (presigned GET URL)
```

The browser sends multipart/form-data to your backend. The backend's NestJS handler receives the bytes, validates them, optionally transforms them (resize an image, strip EXIF, scan for malware), then calls `S3Client.send(PutObjectCommand)` to upload the bytes to S3. Done in one HTTP round trip from the client's perspective.

**Pros:**
- Simpler frontend — just a `multipart/form-data` POST. No AWS SDK in the browser.
- Server controls everything. Validate MIME type, resize images, strip EXIF, scan for malware, enforce per-user quotas — all before the file lands in S3.
- AWS credentials never touch the client.
- Easier to add features later (thumbnails, watermarking, transcoding) — you already have the bytes server-side.

**Cons:**
- Double bandwidth on your server. A 5 MB photo travels client → your VPS → S3. You pay for that bandwidth twice on the VPS side (in + out).
- Server memory pressure on large files. NestJS holds the buffer in memory (with `memoryStorage()` from multer) or streams to disk first. A 100 MB video from 50 concurrent users will OOM your container.
- Request timeouts. Nginx has a default `proxy_read_timeout 60s`. A user on slow internet uploading a 50 MB file can blow past that and Nginx drops the connection mid-upload.
- Doesn't scale horizontally. If you ever have 10 app instances, every upload funnels through one of them.

### Architecture B — Direct upload via presigned URL

```
Browser →  POST /api/v1/uploads/presign        → NestJS returns ~3 KB JSON with a signed PUT URL
Browser →  PUT https://bucket.s3.../key?...    → S3 directly (the entire file)
Browser →  POST /api/v1/uploads/confirm        → NestJS records the key in DB
```

The backend never touches the file bytes. It only signs a URL that says "the holder of this URL may PUT one object to this exact key, with this content-type, within the next N minutes." S3 enforces the signature.

**Pros:**
- Server bandwidth = ~3 KB regardless of file size. A 50 MB upload uses 0.006% of the bandwidth on your VPS vs. proxying.
- No server memory pressure. Files never touch Node's process.
- Scales horizontally for free. File goes Browser → S3 over AWS's global edge.
- Faster for users far from your VPS. S3 has endpoints near most users.
- No request timeouts. Browser ↔ S3 isn't constrained by Nginx.

**Cons:**
- More moving parts. Two API calls (presign + confirm) instead of one POST.
- Frontend handles upload progress / retry / chunking. You need a small upload library on the frontend.
- Validation moves to "after the fact." You can't reject a file mid-upload because you never see it. Options: enforce constraints via S3 conditions in the presign (e.g. `Content-Length` range), or accept-then-validate in the `/confirm` endpoint.
- Risk of orphaned objects. If the browser uploads to S3 but never calls `/confirm` (closed tab, crash), you have an S3 object with no DB record. Needs a cleanup job (S3 lifecycle policy or a scheduled task).
- CORS configuration required. S3 bucket needs a policy allowing `PUT` from your frontend origin.

### Decision matrix — which to pick when

| Scenario | Choose |
|---|---|
| Small files (< 5 MB), infrequent uploads (avatars, single product photos) | **Proxy** — simpler, no real downside at this size |
| Large files (video, archives, original-resolution images) | **Direct** — proxying is wasteful and risky |
| You need server-side validation/transformation before the file persists | **Proxy** — you have the bytes in hand |
| You're scaling to many concurrent users or many app instances | **Direct** — backend offload is the whole point |
| Mobile/PWA users on slow connections | **Direct** — fewer hops, S3's global edge helps |
| Your team is small and you're optimizing for "ship it" velocity | **Proxy** — fewer concepts to get right |

**Default of this starter: proxy.** That's what the avatar endpoint demonstrates. Switch specific endpoints (e.g. a "deliverables" endpoint for large files) to direct uploads when the trade-off flips.

---

## What "presigned URL" actually means

A "presigned URL" is a regular S3 URL with cryptographic signature query parameters appended. The signature says "the bearer of this URL is authorized to perform exactly this S3 operation on exactly this object, until exactly this timestamp." S3 validates the signature on every request.

There are two flavors of presigned URLs you'll use:

### Presigned PUT (upload)

`https://bucket.s3.region.amazonaws.com/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=...&X-Amz-Expires=900`

A browser holding this URL can `PUT` exactly one object to that exact key within 15 minutes. Used for **direct uploads** (Architecture B).

### Presigned GET (download)

Same URL shape but signed for a `GetObject` operation. A browser holding this URL can `GET` that one object within the TTL. Used for **serving private bucket contents to the browser** — including image renders, file downloads, video playback, anything you'd ordinarily need a public bucket for.

This is what the starter uses in `IStorageService.getSignedReadUrl()`. When `GET /api/v1/users/me` returns the user's avatar URL, it's a presigned GET URL with a 1-hour TTL, not a raw S3 URL.

### The crypto, briefly

Generating a presigned URL is **pure local computation** — your backend doesn't make any API call to S3 to generate one. It signs a canonical request string with your AWS secret access key using HMAC-SHA256, encodes the signature into query parameters, and hands the URL back. S3 doesn't know the URL exists until the browser actually uses it.

Implications:
- Generating a signed URL is essentially free. You can do it on every response without worrying about quotas or latency.
- The TTL is enforced by S3 at validation time. A 1-hour URL is valid for 1 hour from when you signed it, not 1 hour from when the browser first uses it.
- You can't "revoke" a signed URL. Once handed out, it's valid for its TTL. If you need revocation, rotate your IAM keys or use short TTLs and re-sign on every request.

---

## Reading files: public bucket vs. presigned GET URLs

When the frontend renders `<img src={user.avatarUrl} />`, the URL has to resolve to actual image bytes. Two ways to make that work:

**Option 1: Public-read bucket.** Bucket policy grants `s3:GetObject` to anonymous requests for some or all of the bucket. The raw S3 URL `https://bucket.s3.region.amazonaws.com/key` works. Simple, CDN-friendly. **Anyone who knows or guesses the URL can fetch the object.**

**Option 2: Private bucket + presigned GET URLs.** Bucket stays private (the default). Every time the backend returns an object reference to the frontend, it wraps the stored key with a fresh presigned GET URL. The browser uses that URL; S3 validates the signature and serves the bytes.

The starter is wired for option 2 — `IStorageService.getSignedReadUrl()` exists exactly for this. `getPublicUrl()` still exists for cases where a public bucket genuinely makes sense (e.g., static brand assets), but private + signed is the default pattern.

**Why default to private?**
- Avatars are mildly sensitive (face data). Documents, IDs, contracts, gig deliverables are *very* sensitive.
- Public buckets are footguns. Once "make this prefix public" is a pattern in the codebase, the temptation to apply it broadly is real, and one mistake exposes sensitive data.
- Presigned URLs cost essentially nothing to generate (pure local crypto, see above).

**Trade-off:** signed URLs change every time you refresh the user object, so they bust browser caches more aggressively. For avatars this is usually fine; for high-traffic images, use a longer TTL (max 7 days for v4 signatures) or put CloudFront in front of the bucket and serve signed CloudFront URLs instead.

---

## Downloads vs. inline previews

A user clicking "View" on a file vs. clicking "Download" is the **same S3 operation from S3's perspective**. Both are a single `GET` to the object key. Same auth check, same egress cost, same bandwidth, same response time. S3 doesn't know or care whether the client wants to render or save.

The difference is purely client-side, driven by the HTTP `Content-Disposition` header that S3 sends back with the bytes:

| Response header | Browser behavior |
|---|---|
| `Content-Disposition: inline` (or absent) | Render in-page if the `Content-Type` is something the browser can display (image, PDF, video, plain text). Otherwise fall back to download. |
| `Content-Disposition: attachment; filename="delivery.zip"` | Trigger "Save As" dialog. Suggested filename comes from the header. |

The header is defined in [RFC 6266](https://datatracker.ietf.org/doc/html/rfc6266). For filenames with non-ASCII characters (Vietnamese, Japanese, emoji), use the `filename*=UTF-8''...` form:

```
Content-Disposition: attachment; filename="delivery.zip"; filename*=UTF-8''b%C3%A1o-c%C3%A1o.pdf
```

The plain `filename=` is the ASCII fallback for old clients; `filename*=` is what modern browsers actually use.

### Two ways to set Content-Disposition

**1. Bake it into the object metadata at upload time.**

```ts
await s3.send(new PutObjectCommand({
    Bucket,
    Key,
    Body,
    ContentType: 'application/zip',
    ContentDisposition: 'attachment; filename="delivery.zip"'
}))
```

S3 stores this with the object. Every future GET returns it. **Permanent.** Use this when the file's role never changes — e.g., a file that will always be downloaded, never previewed.

**2. Override at presign time, per request.**

```ts
const command = new GetObjectCommand({
    Bucket,
    Key,
    ResponseContentDisposition: 'attachment; filename="delivery.zip"'
})
const url = await getSignedUrl(s3, command, { expiresIn: 3600 })
```

The object's stored metadata is unchanged. S3 returns the override only for responses fetched via *that specific signed URL*. **Per-request.** Use this when the same file might be inline in some contexts and download in others — the common case for marketplace-style apps.

The starter exposes the per-request form via `SignedUrlOptions.responseContentDisposition` in `IStorageService.getSignedReadUrl()`. Don't bake disposition into the object unless you're certain it never needs to change.

### Frontend patterns

**Pattern A — anchor with `download` attribute.**

```tsx
<a href={signedUrl} download="delivery.zip">Download</a>
```

The HTML `download` attribute *suggests* a filename to the browser. **It only works if the resource is same-origin.** Cross-origin URLs (and a presigned S3 URL is cross-origin to your app) ignore the `download` attribute entirely — the browser falls back to whatever `Content-Disposition` the response says. So for cross-origin downloads, **always set `ResponseContentDisposition` on the presigned URL**.

**Pattern B — programmatic download via `fetch` + `Blob`.**

```ts
async function download(url: string, filename: string) {
    const res = await fetch(url)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.click()
    URL.revokeObjectURL(blobUrl)
}
```

Works around the cross-origin `download` attribute limitation. Downside: the entire file loads into browser memory before the save dialog appears. Fine for small files; a problem for >100 MB.

**Pattern C — backend-streamed download endpoint.**

Some teams prefer to never expose S3 URLs to the browser at all, even signed ones. Instead, the frontend hits `GET /api/v1/files/{id}/download`, and the backend streams the file through with the right headers. This adds bandwidth cost on your backend (same downside as proxy upload), but gives you full control — audit logging, rate limiting, on-the-fly transformations (watermarking, transcoding). Not the default in this starter, but a reasonable choice for downloads that need stricter control.

Sketch:

```ts
@Get('files/:id/download')
async download(@Param('id') id: string, @Res() res: Response) {
    const file = await this.fileRepo.findOrFail(id)
    // Auth + permission check here
    const stream = await this.s3.send(new GetObjectCommand({ Bucket, Key: file.key }))
    res.set({
        'Content-Type': file.mimetype,
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Content-Length': file.size,
    })
    return (stream.Body as Readable).pipe(res)
}
```

### Cost and bandwidth implications

- **One view → one S3 GET → one egress charge.** Doesn't matter if the user previews or saves; same cost.
- **One view *then* one download = two GETs.** Browser caching does not help across them because the two presigned URLs have different signatures (different query params → different cache key). If you're cost-sensitive on egress, generate the download URL with `ResponseContentDisposition` from the start so users don't preview-then-download.
- **For frequent reads (avatar appearing 50 times on a page), put CloudFront in front.** CloudFront caches at the edge and pays S3 once per cache miss, not per browser request. The Browser → CloudFront edge is also faster than Browser → S3 for users far from the bucket's region.

### Range requests, partial downloads, and resumable downloads

S3 supports HTTP `Range` requests natively. Browsers use them automatically for video `<video src>` (seek support) and some download managers use them to resume interrupted downloads. **Nothing to configure** — works through presigned URLs out of the box.

What does NOT work out of the box:

- **Resumable *uploads* from the browser.** That requires multipart upload coordination, which is its own large topic (different API: `CreateMultipartUpload` → presign each `UploadPart` → `CompleteMultipartUpload`). The starter doesn't ship this; add it if/when you need to upload files >100 MB reliably.

---

## How the starter is wired

### The shape: ports and adapters

The starter uses hexagonal architecture. Storage is accessed through a port (interface) so the application code doesn't know whether it's hitting S3, local disk, or a mock:

```
Application layer
  └── StoragePort (interface)
          ↑ implemented by
  └── UploadStorage (in infrastructure/adapters)
          └── delegates to → UploadService (the shared, framework-aware service)
                                  └── delegates to → IStorageService
                                                          ├── S3StorageService     (prod)
                                                          └── LocalStorageService  (dev)
```

The split exists because the **application layer** (CQRS handlers, domain logic) shouldn't depend on `multer`, AWS SDK, or anything framework-y. So:

- `StoragePort` is the narrow application-facing interface. Only what handlers need.
- `IStorageService` is the broader infrastructure interface. Has multer types, S3 client awareness, etc.
- The adapter is the seam between them.

### IStorageService interface

```ts
export interface IStorageService {
    uploadFile(file: Express.Multer.File, options?: UploadOptions): Promise<UploadedFile>
    uploadBuffer(buffer: Buffer, filename: string, mimetype: string, options?: UploadOptions): Promise<UploadedFile>
    deleteFile(filePath: string): Promise<void>
    getFile(filePath: string): Promise<Buffer>
    fileExists(filePath: string): Promise<boolean>
    getPublicUrl(filePath: string): string
    getSignedReadUrl(filePath: string, options?: SignedUrlOptions): Promise<string>
}
```

Both `S3StorageService` and `LocalStorageService` implement this. The DI container picks one based on `STORAGE_TYPE` (`s3` or `local`).

### S3 implementation

`getSignedReadUrl` uses `@aws-sdk/s3-request-presigner`:

```ts
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

async getSignedReadUrl(filePath: string, options?: SignedUrlOptions): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.extractS3Key(filePath),
        ResponseContentDisposition: options?.responseContentDisposition
    })
    return getSignedUrl(this.s3Client, command, {
        expiresIn: options?.expiresIn ?? 3600 // 1 hour default
    })
}
```

That's the whole thing. The signature is computed locally; no API call to S3.

### Local implementation

For dev, signed URLs make no sense — files are served by the local NestJS static handler (or local nginx) at `/uploads/...`. So `getSignedReadUrl` just delegates to `getPublicUrl`:

```ts
async getSignedReadUrl(filePath: string): Promise<string> {
    return this.getPublicUrl(filePath)
}
```

The options are silently ignored. This keeps the interface uniform — controllers can call `getSignedReadUrl` everywhere without branching on environment.

---

## What the code looks like end-to-end

### Proxy upload (what the starter ships with)

**1. Controller** (`POST /api/v1/users/me/avatar`, in [`users.controller.ts`](../src/modules/users/presentation/http/users.controller.ts); Swagger decorators left out):

```ts
@Post('me/avatar')
@HttpCode(HttpStatus.OK)
@Idempotent('10m') // a retry with the same Idempotency-Key replays the first answer
@UseInterceptors(
    FileInterceptor('avatar', {
        storage: memoryStorage(),
        // Checked by multer while the body streams in: an oversized file is
        // refused before it is buffered into memory.
        limits: { fileSize: UPLOAD_LIMITS.maxFileSizeBytes, files: 1 }
    })
)
async uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(
        new ParseFilePipe({
            fileIsRequired: true,
            validators: [
                new MaxFileSizeValidator({ maxSize: UPLOAD_LIMITS.maxFileSizeBytes + 1 }),
                // The declared type is the client's claim; sharp checks the real format later.
                new FileTypeValidator({ fileType: /^image\/(jpeg|jpg|png|webp|gif)$/ })
            ]
        })
    )
    file: Express.Multer.File
) {
    const result: UploadAvatarResult = await this.commandBus.execute(
        new UploadAvatarCommand(user.id, file.buffer, file.originalname)
    )
    // toAvatarUrl → ResolveAvatarUrlQuery → StoragePort.getReadUrl → a presigned GET URL on S3
    return createResponse(/* ... */, {
        avatarUrl: await this.toAvatarUrl(result.upload.key),
        width: result.upload.width,
        height: result.upload.height,
        uploadedAt: new Date().toISOString()
    })
}
```

The route needs an `Idempotency-Key` header (see [idempotency.md](./idempotency.md)). The limits are in [upload-module.md](./upload-module.md).

**2. Command handler** ([`upload-avatar.handler.ts`](../src/modules/users/application/commands/upload-avatar/upload-avatar.handler.ts)):

```ts
async execute(command: UploadAvatarCommand): Promise<UploadAvatarResult> {
    const uploadedFile = await this.storage.uploadAvatar(command.fileBuffer, command.originalName, command.userId)

    // Swap the avatar and learn which key it replaced, in one statement.
    // If the swap doesn't happen, delete the new file: nothing will reference it.
    let replaced
    try {
        replaced = await this.userRepo.replaceAvatar(command.userId, uploadedFile.key)
    } catch (error) {
        await this.storage.deleteFile(uploadedFile.key).catch(() => undefined)
        throw error
    }
    if (!replaced) {
        // The account was deleted while the image was being processed.
        await this.storage.deleteFile(uploadedFile.key).catch(() => undefined)
        throw new UserNotFoundError(command.userId)
    }

    const { user, previousAvatarKey } = replaced
    if (previousAvatarKey) {
        this.eventBus.publish(new AvatarUploadedEvent(user.id, previousAvatarKey)) // old file → file-cleanup queue
    }
    this.eventBus.publish(new UserProfileUpdatedEvent(user.id)) // the auth module refreshes its cached user
    return { user, upload: uploadedFile }
}
```

`replaceAvatar` is one `UPDATE` that locks the row and returns the key it replaced, so two uploads at once can't both think they replaced the same old file (see [race-conditions-and-locks.md](./race-conditions-and-locks.md)).

**3. Storage adapter calls into UploadService → S3StorageService:**

```ts
async uploadBuffer(buffer, filename, mimetype, options) {
    // avatars/avatar-<userId>-<timestamp>-<random>.webp
    const uniqueSuffix = `${Date.now()}-${randomUUID().split('-')[0]}`
    const s3Key = `${options.subDirectory}/${options.filenamePrefix}-${uniqueSuffix}.${extension}`
    await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: mimetype
    }))
    return { /* ...UploadedFile shape, including `key: s3Key` */ }
}
```

**4. Returning the file later (e.g. `GET /api/v1/users/me`):**

```ts
// The controller asks the application layer, as for anything else
private toAvatarUrl(key: string | null | undefined): Promise<string | null> {
    return this.queryBus.execute(new ResolveAvatarUrlQuery(key))
}

// ResolveAvatarUrlHandler, in application/queries/resolve-avatar-url/
async execute({ key }: ResolveAvatarUrlQuery): Promise<string | null> {
    return key ? this.storage.getReadUrl(key) : null
}

// UploadStorage, the adapter: presigned on S3; on local storage the
// /uploads/... path, on the API's base URL
async getReadUrl(key: string): Promise<string> {
    const url = await this.uploadService.getSignedReadUrl(key)
    return getFullUrl(url, this.config.get<string>('app.baseUrl')) ?? url
}
```

The DB stores the bare key (`avatars/avatar-<userId>-<timestamp>-<random>.webp`), and every response that shows the avatar gets a fresh URL for it. `StoragePort.getReadUrl` always answers an absolute URL; the adapter maps it to `IStorageService.getSignedReadUrl`.

### Direct upload (presigned PUT) — not shipped, sketched

If you ever need to add a direct-upload endpoint (e.g. for large deliverables), the shape is:

**1. Presign endpoint:**

```ts
@Post('uploads/presign')
async presign(@Body() dto: PresignRequestDto, @CurrentUser() user) {
    const key = `deliverables/${user.id}/${randomUUID()}-${dto.filename}`
    const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: dto.contentType,
        // Optional: enforce constraints
        // ContentLengthRange: [0, 100 * 1024 * 1024],  // max 100 MB
    })
    const url = await getSignedUrl(this.s3Client, command, { expiresIn: 900 })
    return { url, key }
}
```

**2. Browser PUTs the file:**

```ts
await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type }
})
```

**3. Confirm endpoint:**

```ts
@Post('uploads/confirm')
async confirm(@Body() dto: { key: string }, @CurrentUser() user) {
    // Verify the object actually exists in S3
    const exists = await this.storage.fileExists(dto.key)
    if (!exists) throw new BadRequestException('Upload not found')
    // Persist the key in DB, e.g. on a Delivery entity
    return this.commandBus.execute(new RecordDeliveryCommand(user.id, dto.key))
}
```

The starter doesn't ship a direct-upload endpoint — it would just be example clutter. Add one when you have a use case that justifies the extra complexity.

---

## S3 bucket setup checklist

For a new bucket in production (click-by-click for AWS S3 and Cloudflare R2, with a least-privilege policy: [setup/storage-s3-r2.md](./setup/storage-s3-r2.md)):

- [ ] **Private bucket.** "Block all public access" enabled. Default for new buckets.
- [ ] **IAM user with scoped permissions.** Create a dedicated IAM user for the app. Attach a policy granting only `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the specific bucket. Never use root credentials.
- [ ] **Access keys stored in `.env.production`.** Never committed.
- [ ] **Versioning.** Enable bucket versioning. Cheap, lets you recover from accidental deletes / overwrites. Use a lifecycle rule to expire old versions after 30 days.
- [ ] **Server-side encryption.** SSE-S3 (free, AWS-managed keys) at minimum. SSE-KMS if you have compliance reasons.
- [ ] **Lifecycle policy for orphans.** If using direct uploads, add a rule to delete objects in `uploads/temp/*` after 24 hours (catches files where `/confirm` was never called).
- [ ] **CORS policy.** Only needed for direct uploads (browser → S3). See next section.
- [ ] **Bucket logging.** Enable access logs to a separate logging bucket for audit trail.

---

## CORS for direct browser ↔ S3 traffic

Direct uploads need a CORS policy on the bucket. Minimal config:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["PUT", "GET", "HEAD"],
        "AllowedOrigins": ["https://app.example.com"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```

- `PUT` lets the browser upload via presigned URLs.
- `GET` is only needed if the browser fetches from S3 via fetch/XHR (e.g., progress monitoring). For `<img src>` tags, CORS is not required.
- `AllowedOrigins` should be your real frontend domain(s). Avoid `*` in production unless the bucket is genuinely public.
- `ExposeHeaders: ETag` lets the browser see the uploaded object's ETag (useful for multipart upload coordination).

For **proxy uploads** (the starter's default), no CORS policy is needed on S3 — only your backend talks to S3, and backend→S3 calls don't trigger CORS.

---

## Orphaned objects and cleanup

Four sources of orphaned objects:

1. **Direct upload abandoned.** Browser PUT to S3 succeeded but `/confirm` never called. Mitigation: lifecycle rule expires `uploads/temp/*` after 24 hours; the `/confirm` endpoint moves confirmed objects to a permanent prefix. (Not relevant to the starter, which ships no direct upload.)
2. **DB write failed after upload.** Backend uploaded to S3 then the Postgres update failed. The starter's `UploadAvatarHandler` handles this: when `replaceAvatar` throws, or finds no account (deleted while the image was processed), it deletes the file it just uploaded (step 2 above).
3. **A new avatar replaced an old one.** `AvatarUploadedEvent` carries the old key; `CleanupOldAvatarHandler` queues its deletion on the `file-cleanup` queue, which retries if storage is briefly down.
4. **User deleted their account.** Handled, through events:

   ```
   POST /api/v1/auth/account/delete            (auth module: checks the proof)
     → DeleteAccountCommand                    (users module: soft-deletes the row, in one statement)
       → AccountDeletedEvent(userId, avatarUrl)
         → CleanupAccountAvatarHandler         (queues the avatar's deletion)
           → file-cleanup job                  (deletes the file from S3 or local disk)
   ```

   The handlers are in [`src/modules/users/application/events/handlers/`](../src/modules/users/application/events/handlers/). One gap remains: the event is published after the soft delete commits, so a crash in between loses it, and the file stays. The later retention sweep clears the key from the row, not the file ([extensions.md](./extensions.md#transactional-outbox), [account-deletion.md](./account-deletion.md)). With local storage the gap matters more, because `/uploads` is served without auth.

---

## Common gotchas

**1. "Returned a 403 from a presigned URL."**
- Most common cause: clock skew. AWS signatures are timestamp-sensitive (±15 min tolerance). If your container's clock drifts, signatures get rejected. Use `chronyd` or ensure NTP is running on the host.
- Second most common: IAM user lacks `s3:GetObject` on the bucket. Check the IAM policy.

**2. "Image renders fine in dev but broken in prod."**
- Dev uses `LocalStorageService` which serves files via raw `/uploads/...` paths. Prod uses `S3StorageService` which requires presigned URLs because the bucket is private. If your controller is using `getPublicUrl` instead of `getSignedReadUrl`, prod will 403. **Always use `getSignedReadUrl` when serving file references back to the frontend.**

**3. "Direct uploads fail with CORS error."**
- Bucket CORS policy not set, or `AllowedOrigins` doesn't include your frontend's exact origin (scheme + host + port). Check the browser console for the exact origin being blocked.

**4. "Presigned URL is huge — 2 KB of query string."**
- That's normal for v4 signatures. They include a long SHA256 hash plus credential and timestamp metadata. Don't try to "clean it up" — every character is load-bearing.

**5. "Want shorter URLs for sharing."**
- Don't use raw presigned URLs for sharing. Instead, store a short token (e.g. UUID) in your DB pointing to the S3 key + an expiry. Generate a fresh presigned URL on the redirect endpoint when the user hits the short URL.

**6. "S3 bills are higher than expected."**
- Egress is what costs. Every time a user views an image, that's one GET = bytes-out. Even small images at scale add up. If egress is dominant, consider CloudFront in front of S3 (CDN caching brings egress down hard).
- Storage itself is cheap (~$0.023/GB/month for S3 Standard).

**7. "I want to add server-side encryption per-object."**
- Pass `ServerSideEncryption: 'AES256'` to `PutObjectCommand`. Or enable default encryption on the bucket — then it applies to all uploads with no code change.

**8. "Uploads to R2 / B2 / RustFS fail with a checksum error."**
- Since 3.729 the AWS SDK adds a CRC32 checksum to every upload. AWS accepts it; S3-compatible stores have refused it. The starter handles this for you: whenever `AWS_S3_ENDPOINT` is set (any non-AWS store), the client sends and checks checksums only where the API requires them (`requestChecksumCalculation: 'WHEN_REQUIRED'` in [`s3-storage.service.ts`](../src/shared/infrastructure/storage/services/s3-storage.service.ts)). No extra env var is needed. If you still see it, check that `AWS_S3_ENDPOINT` is really set in the env file the app reads.
