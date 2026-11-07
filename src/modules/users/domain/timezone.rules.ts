/**
 * Time zones (SRS REQ-AUTH-08): an IANA zone name such as `Asia/Ho_Chi_Minh`,
 * the names the browser's `Intl` gives the frontend's time zone picker.
 *
 * A zone, not an offset: "GMT+7" cannot follow daylight saving time, and the
 * zone decides where a study day starts and ends (streaks).
 */

/** Zones without a region part that are still zones, not offsets. */
const BARE_ZONES = new Set(['UTC'])

/**
 * `Etc/` names are fixed offsets (`Etc/GMT+7` is UTC-7), except UTC itself. In
 * any letter case: ICU takes `etc/gmt+7` for the same zone.
 */
const isFixedOffset = (name: string) => {
    const lower = name.toLowerCase()
    return lower.startsWith('etc/') && lower !== 'etc/utc'
}

/**
 * The zone name to store, or null if it is not one.
 *
 * Kept as the browser sent it, not rewritten to ICU's canonical spelling:
 * Node's ICU calls `Asia/Ho_Chi_Minh` `Asia/Saigon`, some browsers do the
 * opposite, and both names work in either. A name sent in another letter
 * case than ICU's own spelling of it (`asia/tokyo`) is stored in ICU's, so it
 * matches the picker's list; an old spelling in another case stays as sent.
 * Offsets (`+07:00`, `Etc/GMT+7`, in any case) and names ICU does not know
 * are refused.
 */
export function canonicalTimeZone(value: string): string | null {
    const name = value.trim()
    if ((!name.includes('/') && !BARE_ZONES.has(name)) || isFixedOffset(name)) return null
    try {
        const known = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone
        return known.toLowerCase() === name.toLowerCase() ? known : name
    } catch {
        return null
    }
}
