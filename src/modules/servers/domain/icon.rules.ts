/**
 * A server icon (REQ-SRV-01, D-82): JPG, PNG or WEBP up to 8 MB, cropped
 * square by the person choosing it, stored at most 512×512 WebP with no
 * metadata — the same rules as an avatar (REQ-AUTH-06).
 */
export const ICON_MAX_BYTES = 8 * 1024 * 1024

/** As the browser declares them (`image/jpg` is a common misspelling). */
export const ICON_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

/** As sharp names what it actually decoded: the declared type is only a claim. */
export const ICON_FORMATS: readonly string[] = ['jpeg', 'png', 'webp']
