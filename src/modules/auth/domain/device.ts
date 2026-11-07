/** What kind of device a session is on: the icon of its row (10-settings › S-ME-03). */
export type DeviceKind = 'desktop' | 'tablet' | 'mobile'

/** A session's browser and system, as its user agent names them; null for what it does not. */
export interface Device {
    browser: string | null
    os: string | null
    kind: DeviceKind
}

/*
 * Read in order, first match wins. Order matters because user agents borrow
 * each other's names: Edge, Opera, Cốc Cốc and Samsung Internet also say
 * "Chrome" and "Safari", and Chrome says "Safari"; so the most specific
 * token comes first and Safari last (only Safari says "Version/").
 */
const BROWSERS: [RegExp, string][] = [
    [/\bEdg(e|A|iOS)?\//, 'Edge'],
    [/\b(OPR|OPiOS|OPT)\//, 'Opera'],
    [/\bcoc_coc_browser\//, 'Cốc Cốc'],
    [/\bSamsungBrowser\//, 'Samsung Internet'],
    [/\b(Firefox|FxiOS)\//, 'Firefox'],
    [/\bChromium\//, 'Chromium'],
    [/\b(Chrome|CriOS)\//, 'Chrome'],
    [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari']
]

/*
 * An iPhone says "like Mac OS X" and Android says "Linux": both come before
 * the system they borrow from. An iPad on Safari's default "desktop site"
 * says Macintosh and is read as macOS (D-138).
 */
const SYSTEMS: [RegExp, string][] = [
    [/\bWindows NT\b/, 'Windows'],
    [/\biPad\b/, 'iPadOS'],
    [/\b(iPhone|iPod)\b/, 'iOS'],
    [/\bCrOS\b/, 'ChromeOS'],
    [/\bAndroid\b/, 'Android'],
    [/\bMacintosh\b|\bMac OS X\b/, 'macOS'],
    [/\bUbuntu\b/, 'Ubuntu'],
    [/\bLinux\b/, 'Linux']
]

const first = (table: [RegExp, string][], userAgent: string) =>
    table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null

/** An Android browser says "Mobile" on a phone and leaves it out on a tablet. */
function kindOf(userAgent: string): DeviceKind {
    if (/\biPad\b|\bTablet\b/.test(userAgent)) return 'tablet'
    if (/\bAndroid\b/.test(userAgent)) return /\bMobile\b/.test(userAgent) ? 'mobile' : 'tablet'
    if (/\bMobi|\biPhone\b|\biPod\b/.test(userAgent)) return 'mobile'
    return 'desktop'
}

/**
 * Name a session's browser and system from its user agent (D-138): a few
 * families, read with a table rather than a library. One it does not know
 * shows as "Unknown browser" in the list; nothing depends on it.
 */
export function describeDevice(userAgent: string | null | undefined): Device {
    if (!userAgent) return { browser: null, os: null, kind: 'desktop' }
    return { browser: first(BROWSERS, userAgent), os: first(SYSTEMS, userAgent), kind: kindOf(userAgent) }
}
