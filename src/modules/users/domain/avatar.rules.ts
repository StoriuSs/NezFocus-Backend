/**
 * What an avatar upload may be (SRS REQ-AUTH-06, S-ME-02): JPG, PNG or WEBP
 * up to 8 MB. No GIF: an avatar is a still picture, and an animated one in
 * every member list and study-room seat is noise.
 *
 * A product rule, so not MAX_FILE_SIZE: that one is the storage layer's
 * general ceiling, set per deployment.
 */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024

/** As the browser declares them (`image/jpg` is a common misspelling of `image/jpeg`). */
export const AVATAR_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

/** As sharp names what it actually decoded: the declared type is only the client's claim. */
export const AVATAR_FORMATS: readonly string[] = ['jpeg', 'png', 'webp']
