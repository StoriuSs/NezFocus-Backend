export function getFullUrl(relativePath: string | null, baseUrl?: string | null): string | null {
    if (!relativePath) return null
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) return relativePath

    const base = (baseUrl ?? process.env.BASE_URL ?? '').replace(/\/$/, '')
    const path = relativePath.replace(/^\//, '')
    return base ? `${base}/${path}` : `/${path}`
}
