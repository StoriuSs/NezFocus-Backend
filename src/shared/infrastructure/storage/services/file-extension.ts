/** File types an upload may be stored as, and the extension each one gets. */
const EXTENSIONS: Readonly<Record<string, string>> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf'
}

/**
 * The extension a stored upload gets: from its type, which the storage service
 * has checked against the allowlist, never from the client's filename. Stored
 * files are served from /uploads, where the extension decides the type:
 * `page.html` sent as image/png was kept as page.html and served as a web
 * page from the API's own origin. An allowed type missing here gets `.bin`,
 * which browsers download rather than render.
 */
export function extensionFor(mimetype: string): string {
    return EXTENSIONS[mimetype.trim().toLowerCase()] ?? 'bin'
}
