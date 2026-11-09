import {
    freeNameProblem,
    normaliseFreeName,
    normaliseTextChannelName,
    textChannelNameProblem
} from './channel-name.rules'

describe('text channel names (REQ-SRV-02)', () => {
    it.each([
        ['Hỏi Đáp Chung', 'hỏi-đáp-chung'],
        ['Tài liệu chương 5', 'tài-liệu-chương-5'],
        ['  Việc   nhóm K22  ', 'việc-nhóm-k22'],
        ['a -- b', 'a-b'],
        ['-tai_lieu-', 'tai_lieu'],
        ['Q&A / ôn tập!', 'qa-ôn-tập'],
        ['tab\there', 'tab-here'],
        ['zero​width', 'zerowidth'],
        ['???', '']
    ])('stores %j as %j', (typed, stored) => {
        expect(normaliseTextChannelName(typed)).toBe(stored)
    })

    it('composes accents typed as separate marks (Telex, VNI) before folding', () => {
        expect(normaliseTextChannelName('Ôn thi')).toBe('ôn-thi')
    })

    it('needs 1-100 characters, counted in code points, and a letter or digit', () => {
        expect(textChannelNameProblem('')).toBe('length')
        expect(textChannelNameProblem('ô'.repeat(100))).toBeNull()
        expect(textChannelNameProblem('ô'.repeat(101))).toBe('length')
        expect(textChannelNameProblem('__')).toBe('no_letter_or_digit')
        expect(textChannelNameProblem('5')).toBeNull()
    })
})

describe('room and category names', () => {
    it('keeps the name as typed, composed and trimmed', () => {
        expect(normaliseFreeName('  Phòng ôn chương 3 ')).toBe('Phòng ôn chương 3')
    })

    it('needs 1-100 characters on one line, something visible among them', () => {
        expect(freeNameProblem('A')).toBeNull()
        expect(freeNameProblem('')).toBe('length')
        expect(freeNameProblem('x'.repeat(101))).toBe('length')
        expect(freeNameProblem('a\nb')).toBe('length')
        expect(freeNameProblem('​')).toBe('length')
    })
})
