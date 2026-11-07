import { canonicalTimeZone } from './timezone.rules'

describe('canonicalTimeZone', () => {
    it('keeps a zone ICU knows as it was sent, old spellings included', () => {
        expect(canonicalTimeZone('Asia/Ho_Chi_Minh')).toBe('Asia/Ho_Chi_Minh')
        expect(canonicalTimeZone('Asia/Saigon')).toBe('Asia/Saigon')
        expect(canonicalTimeZone(' Asia/Tokyo ')).toBe('Asia/Tokyo')
        expect(canonicalTimeZone('UTC')).toBe('UTC')
        expect(canonicalTimeZone('Etc/UTC')).toBe('Etc/UTC')
    })

    it('refuses offsets and names ICU does not know', () => {
        for (const value of ['+07:00', 'GMT+7', 'Etc/GMT+7', 'Etc/GMT-14', 'Asia/Atlantis', '', 'utc+7']) {
            expect(canonicalTimeZone(value)).toBeNull()
        }
    })

    it('refuses an offset in any letter case, and stores ICU spelling for a name sent in another case', () => {
        // ICU matches names in any case: etc/gmt+7 is the offset Etc/GMT+7 all the same.
        expect(canonicalTimeZone('etc/gmt+7')).toBeNull()
        expect(canonicalTimeZone('ETC/GMT-14')).toBeNull()
        expect(canonicalTimeZone('asia/tokyo')).toBe('Asia/Tokyo')
    })
})
