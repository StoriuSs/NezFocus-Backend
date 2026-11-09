import { isServerName, normaliseServerName } from './server-name.rules'
import { nameKey } from './name-key'

describe('server name', () => {
    it('counts characters, not UTF-16 units: two decomposed letters are two', () => {
        const decomposed = 'Ô'.normalize('NFD') + 'n'.normalize('NFD')
        expect(isServerName(normaliseServerName(decomposed))).toBe(true)
        expect(isServerName('🙂'.repeat(100))).toBe(true)
        expect(isServerName('🙂'.repeat(101))).toBe(false)
    })

    it.each([
        ['one character', 'Ô'],
        ['only spaces once trimmed', normaliseServerName('    ')],
        ['only invisible characters', 'ㅤㅤ'],
        ['a line break', 'Ôn\nthi'],
        ['101 characters', 'a'.repeat(101)]
    ])('refuses %s', (_title, name) => {
        expect(isServerName(name)).toBe(false)
    })

    it('trims and composes before it is stored', () => {
        expect(normaliseServerName('  Ôn thi  '.normalize('NFD'))).toBe('Ôn thi')
    })
})

describe('nameKey', () => {
    it('ignores case but keeps accents', () => {
        expect(nameKey('Phòng Ôn')).toBe(nameKey('phòng ôn'))
        expect(nameKey('bàn')).not.toBe(nameKey('bạn'))
    })

    it('treats a decomposed name as the composed one', () => {
        expect(nameKey('Ôn'.normalize('NFD'))).toBe(nameKey('Ôn'))
    })
})
