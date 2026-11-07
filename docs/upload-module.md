# Upload Module

The Upload Module provides file upload functionality with **automatic image processing** using Sharp. It supports both local filesystem and AWS S3 storage backends.

## Overview

```
src/shared/infrastructure/storage/
├── upload.module.ts              # Module definition
├── upload.service.ts             # The facade the rest of the app uses
├── file-cleanup.consumer.ts      # Deletes superseded and orphaned files
├── interfaces/
│   └── storage.interface.ts      # Contracts and types
└── services/
    ├── image-processing.service.ts  # Sharp, with a concurrency cap
    ├── file-extension.ts            # Extension from the *checked* mime type
    ├── local-storage.service.ts     # Local filesystem storage
    └── s3-storage.service.ts        # S3-compatible storage
```

## Features

- **Automatic image optimization** - Converts images to WebP, strips EXIF metadata
- **Smart resizing** - Resizes images exceeding max dimensions while preserving aspect ratio
- **Dual storage support** - Local filesystem or AWS S3 (configurable via `STORAGE_TYPE` env)
- **File validation** - MIME type and file size validation
- **Unique filenames** - UUID-based naming to prevent collisions

## Usage

### Basic File Upload

```typescript
import { UploadService } from '@/shared/infrastructure/storage'

@Controller('files')
export class FilesController {
    constructor(private uploadService: UploadService) {}

    @Post('upload')
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
    async upload(@UploadedFile() file: Express.Multer.File) {
        return this.uploadService.uploadFile(file, {
            subDirectory: 'documents',
            maxFileSize: 10 * 1024 * 1024, // 10MB
            allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png']
        })
    }
}
```

### Upload with Image Processing

```typescript
// Automatically resize, convert to WebP, and strip EXIF data
const result = await this.uploadService.uploadFile(file, {
    subDirectory: 'images',
    imageProcessing: {
        convertToWebp: true, // Convert to WebP format
        quality: 80, // Compression quality (1-100)
        stripMetadata: true, // Remove EXIF/GPS data
        maxWidth: 1920, // Max width in pixels
        maxHeight: 1080 // Max height in pixels
    }
})
```

### Processed images

Decode, resize and re-encode with sharp, then store. What the image is for is
the caller's to say: the users module's avatar settings (JPG, PNG or WEBP by
decoded content, 512x512 max, WebP, quality 85) live in its adapter,
`upload-storage.adapter.ts`.

```typescript
const avatar = await this.uploadService.uploadImage(buffer, {
    processing: {
        inputFormats: ['jpeg', 'png', 'webp'], // AVATAR_FORMATS: no GIF
        convertToWebp: true,
        quality: 85,
        stripMetadata: true,
        maxWidth: 512,
        maxHeight: 512
    },
    subDirectory: 'avatars',
    filenamePrefix: `avatar-${userId}`,
    baseName: 'avatar'
})
// Returns: { key, url, filename, width, height, ... }
```

## API Reference

### UploadService

| Method                       | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `uploadFile(file, options?)` | Upload a file with optional image processing |
| `uploadImage(buffer, options)` | Process an image and store it, with the caller's size, format, folder and name |
| `deleteFile(key)`            | Delete a file from storage using its key     |
| `getPublicUrl(key)`          | Generate a public full URL from a file key   |
| `fileExists(filePath)`       | Check if file exists                         |
| `isValidImage(file)`         | Validate if file is a valid image            |

### UploadOptions

```typescript
interface UploadOptions {
    subDirectory?: string // e.g., 'avatars', 'documents'
    allowedMimeTypes?: string[] // e.g., ['image/jpeg', 'image/png']
    maxFileSize?: number // In bytes
    filenamePrefix?: string // Prefix for generated filename
    imageProcessing?: ImageProcessingOptions
}
```

### ImageProcessingOptions

```typescript
interface ImageProcessingOptions {
    convertToWebp?: boolean // Default: true
    quality?: number // Default: 80 (1-100)
    stripMetadata?: boolean // Default: true
    maxWidth?: number // Default: 2048
    maxHeight?: number // Default: 2048
    inputFormats?: readonly string[] // Decoded formats taken, narrower than the default list; else UPLOAD_INVALID_TYPE
}
```

### UploadedFile (Response)

```typescript
interface UploadedFile {
    filename: string // Generated filename
    originalName: string // Original upload filename
    key: string // Storage relative key (agnostic to S3 or Local)
    size: number // File size in bytes
    mimetype: string // MIME type
    url: string // Public URL or relative path
    width?: number // Image width (if processed)
    height?: number // Image height (if processed)
}
```

## Configuration

### Environment Variables

```bash
# Storage type: 'local' or 's3'
STORAGE_TYPE=local

# Local storage
UPLOAD_DEST=./uploads
MAX_FILE_SIZE=5242880  # 5MB in bytes: the storage layer's general ceiling (an avatar has its own 8 MB)

# Image processing (defaults shown; see "Limits" below)
MAX_IMAGE_PIXELS=40000000
IMAGE_PROCESSING_TIMEOUT_MS=15000
IMAGE_PROCESSING_CONCURRENCY=2
IMAGE_PROCESSING_QUEUE_LIMIT=10

# S3 storage (required when STORAGE_TYPE=s3)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name

# S3-compatible servers only (RustFS, MinIO, R2, Spaces) — leave unset for AWS
AWS_S3_ENDPOINT=              # where the app reaches storage
AWS_S3_PUBLIC_ENDPOINT=       # where browsers reach it; defaults to AWS_S3_ENDPOINT
AWS_S3_FORCE_PATH_STYLE=true  # defaults to true when an endpoint is set
```

Allowed image types are fixed in code (`UPLOAD_LIMITS` in `src/config/upload.config.ts`), not configured by env.

### Testing S3 locally with RustFS

`pnpm test:services:up` starts RustFS: the S3 API is on host port **9100**, and the web console on **9101** (http://localhost:9101/rustfs/console/, login `rustfsadmin` / `rustfsadmin123`). It also creates the bucket named in `AWS_S3_BUCKET` (the `rustfs-buckets` service, which runs once and exits). Buckets are private, and the API returns presigned URLs.

The endpoint depends on where the app runs:

| App runs | `AWS_S3_ENDPOINT` | `AWS_S3_PUBLIC_ENDPOINT` |
|---|---|---|
| In Docker (`pnpm docker:dev`) | `http://rustfs:9000` | `http://localhost:9100` |
| On the host (`pnpm start:dev`) | `http://localhost:9100` | (unset) |

Why two endpoints: inside a container, `localhost` is the container itself, so the app must use the Docker service name `rustfs`. Browsers can't resolve that name. A presigned URL cannot simply be rewritten to another host, because the host is part of the signature. So links are signed by a second client bound to `AWS_S3_PUBLIC_ENDPOINT`.

Common mistakes:
- **Port 9001 or 9101 is RustFS's web console, not the S3 API.** Using it fails with `ECONNREFUSED` or an HTML response.
- **`localhost` as the endpoint while the app runs in Docker** fails with `Failed to upload buffer to S3: connect ECONNREFUSED ::1:…`.
- **The bucket doesn't exist:** `NoSuchBucket`. `pnpm test:services:up` creates the one in `AWS_S3_BUCKET`; for another, create it in the console.
- **Credentials that are not RustFS's:** `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` must be its root user (`rustfsadmin` / `rustfsadmin123`, or `TEST_S3_ACCESS_KEY` / `TEST_S3_SECRET_KEY` if you changed them). `SignatureDoesNotMatch` or `InvalidAccessKeyId` otherwise.

### Serving Static Files (Local Storage)

The application serves uploaded files from the `/uploads` endpoint, out of the directory they are written to (`UPLOAD_DEST`, default `./uploads`). This is configured in [`src/bootstrap/configure-app.ts`](../src/bootstrap/configure-app.ts):

```typescript
app.useStaticAssets(path.resolve(configService.get<string>('upload.local.uploadDir')!), {
    prefix: '/uploads/'
})
```

**These files are public.** `/uploads/...` is served without authentication: anyone with the URL can fetch the file. File names hold a timestamp and eight random hex characters, so they are hard to guess, but a URL that was once shared keeps working for as long as the file exists. That is why deleting files nobody references matters (below), and why production should use a private S3 bucket with signed URLs ([file-uploads-and-s3.md](./file-uploads-and-s3.md#reading-files-public-bucket-vs-presigned-get-urls)).

## Image Processing Details

The `ImageProcessingService` uses [Sharp](https://sharp.pixelplumbing.com/) for high-performance image manipulation.

### What happens during processing:

1. **EXIF rotation** - Auto-rotates based on EXIF orientation, then strips metadata
2. **Smart resize** - Only resizes if image exceeds `maxWidth` or `maxHeight`
3. **Format conversion** - Converts to WebP for ~90% size reduction
4. **Quality optimization** - Applies lossy compression at specified quality

### Example size reduction:

| Original | Processed   | Reduction |
| -------- | ----------- | --------- |
| 5MB JPEG | ~200KB WebP | 96%       |
| 2MB PNG  | ~150KB WebP | 92%       |

### Limits

A small file can be a very large image. Every image is bounded before and while it is processed:

| Limit | Setting | Default | On breach |
|---|---|---|---|
| Upload size | the route's multer `fileSize` (an avatar: `AVATAR_MAX_BYTES`, 8MB); `MAX_FILE_SIZE` for a stored file | 8MB / 5MB | 413 |
| Decoded pixels | `MAX_IMAGE_PIXELS` | 40MP | 422 |
| Time per image | `IMAGE_PROCESSING_TIMEOUT_MS` | 15s | 422 |
| Images processed at once, per app instance | `IMAGE_PROCESSING_CONCURRENCY` | 2 | the rest wait |
| Images waiting for a slot | `IMAGE_PROCESSING_QUEUE_LIMIT` | 10 | 503 at once |
| Time waiting for a slot | `IMAGE_PROCESSING_TIMEOUT_MS` | 15s | 503 |

Why a concurrency limit, measured with 12 simultaneous 36MP uploads:

- **Memory.** Most images are shrunk while they are decoded and need little. An interlaced PNG cannot be: a 121KB file took ~150MB. Without a limit the app peaked at 692MB, over the production container's 512MB, where it is killed along with every request it was serving. With 2 at a time: 442MB.
- **The rest of the app.** sharp runs on Node's libuv thread pool (4 threads), which file reads and DNS lookups also use. Without a limit they waited up to 390ms behind image work; with 2, under 10ms.

When raising `IMAGE_PROCESSING_CONCURRENCY`, raise the app container's memory limit by ~150MB per extra image, and keep it below 4.

An upload can spend about twice `IMAGE_PROCESSING_TIMEOUT_MS` waiting and processing (sharp rounds its timeout up to whole seconds; at most an hour). `REQUEST_TIMEOUT_MS` counts from the start of the request, including the upload itself, so keep it above that: otherwise a slow upload gets 408 while its image is still processed.

A 503 carries `SERVICE_UNAVAILABLE_ERROR`, which the frontend shows as "temporarily unavailable, try again shortly".

## Storage Backends

### Local Storage

Files are stored in the filesystem under the `UPLOAD_DEST` directory. Subdirectories are created automatically.

```
uploads/
├── avatars/
│   └── avatar-user123-1702567890-abc123.webp
└── documents/
    └── 1702567890-def456.pdf
```

### S3 Storage

Files are uploaded directly to the configured S3 bucket with the same key structure.

```
s3://your-bucket/avatars/avatar-user123-1702567890-abc123.webp
```

## Background Deletion (BullMQ)

When replacing or removing files (such as an Avatar), the deletion process handles potential network delays via the `file-cleanup` BullMQ queue. 
Instead of blocking the HTTP request waiting for S3 to delete the file, the application pushes the storage `key` to the queue, and a background processor (`FileCleanupConsumer`) safely executes the deletion with automatic exponential backoff retries.

Three events queue a deletion:

| Event | Handler | When |
|---|---|---|
| `AvatarUploadedEvent` | `CleanupOldAvatarHandler` | a new avatar replaced an old one: the old file goes |
| `AvatarRemovedEvent` | `CleanupOldAvatarHandler` | the avatar was removed (`DELETE /api/v1/users/me/avatar`): its file goes |
| `AccountDeletedEvent` | `CleanupAccountAvatarHandler` | the account was deleted (`POST /api/v1/auth/account/delete`): its avatar goes |

Both handlers are in `src/modules/users/application/events/handlers/`. The job id is
derived from the key, so the same file queued twice (two deletions at once)
is one job. The full deletion path is in
[file-uploads-and-s3.md](./file-uploads-and-s3.md#orphaned-objects-and-cleanup)
and [account-deletion.md](./account-deletion.md).

## Error Handling

The module throws `CustomException` with specific error codes:

| Error Code | Type                    | Description              |
| ---------- | ----------------------- | ------------------------ |
| `413001`   | `UPLOAD_FILE_TOO_LARGE` | File exceeds max size (multer's limit is mapped to it by `GlobalExceptionFilter`) |
| `415001`   | `UPLOAD_INVALID_TYPE`   | MIME type or decoded format not allowed |
| `422001`   | `IMAGE_PROCESSING_FAILED` | Image could not be decoded, too many pixels, or took too long |
| `503000`   | `SERVICE_UNAVAILABLE_ERROR` | Too many images being processed; try again |
| `400002`   | `UPLOAD_INVALID_FILE`   | Invalid file object      |
| `500003`   | `UPLOAD_FAILED`         | Storage operation failed |
| `500002`   | `UPLOAD_DELETE_FAILED`  | Delete operation failed  |
| `404002`   | `UPLOAD_FILE_NOT_FOUND` | File not found           |

## Dependencies

- `sharp` - Image processing
- `@aws-sdk/client-s3` - S3 storage (optional)
- `multer` - File upload handling

Unique file names need no package: they come from Node's `crypto.randomUUID()`
(the first segment, after a timestamp), in `local-storage.service.ts` and
`s3-storage.service.ts`.
