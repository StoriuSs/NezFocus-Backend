import { proseText } from './message-markdown'

/*
 * A mention counts only where the client draws text (D-172), so the two
 * parsers must agree. The first block is the client's own cases
 * (NezFocus-Frontend `src/features/messaging/__tests__/markdown.test.ts`),
 * read as the runs of text they leave; change both together.
 */
describe("The client's formatting cases, as the runs of text they leave (REQ-MSG-02)", () => {
    it.each([
        ['Câu 3 làm sao?\nMình kẹt rồi', ['Câu 3 làm sao?\nMình kẹt rồi']],
        ['**Tóm tắt** *tọa độ cực* _gấp_ ~~sai~~', ['Tóm tắt', ' ', 'tọa độ cực', ' ', 'gấp', ' ', 'sai']],
        ['***cả hai***', ['cả hai']],
        ['*a **b** c*', ['a ', 'b', ' c']],
        ['2 * 3 * 4', ['2 * 3 * 4']],
        ['ten_bien_moi và **', ['ten_bien_moi và **']],
        ['**chưa đóng', ['**chưa đóng']],
        ['đặt `x = r cos φ` nhé', ['đặt ', ' nhé']],
        ['`**a** https://a.vn`', []],
        ['``có ` bên trong``', []],
        ['\\*không nghiêng\\* và \\\\', ['*không nghiêng* và \\']],
        ['C:\\Users', ['C:\\Users']],
        ['<b>x</b> <img src=x onerror=alert(1)>', ['<b>x</b> <img src=x onerror=alert(1)>']],
        ['Xem https://tailieu.ptit.edu.vn/giai-tich-2.', ['Xem ', '.']],
        ['(http://a.vn/x?y=1)', ['(', ')']],
        ['https://vi.wikipedia.org/wiki/T%C3%ADch_(to%C3%A1n)', []],
        ['javascript:alert(1)', ['javascript:alert(1)']],
        ['[bấm](javascript:alert(1))', ['[bấm](javascript:alert(1))']],
        ['data:text/html,x ftp://a.vn', ['data:text/html,x ftp://a.vn']],
        ['**https://a.vn**', []],
        ['Lời giải:\n```js\nconst x = 1\n**y**\n```\nXong', ['Lời giải:', 'Xong']],
        ['```\n∬_D (x² + y²) dA\n```', []],
        ['```một dòng```', []],
        ['```js\nchưa đóng', ['```js\nchưa đóng']],
        ['> Nhớ đổi cận\n> theo góc **phần tư**\nRồi tính', ['Nhớ đổi cận\ntheo góc ', 'phần tư', 'Rồi tính']],
        ['>không cách', ['>không cách']]
    ])('%j leaves %j', (message, runs) => {
        expect(proseText(message)).toEqual(runs)
    })
})

describe('The words of a message outside code and links, as the client draws them (REQ-MSG-02, D-172)', () => {
    it('gives plain text as it is', () => {
        expect(proseText('hello @everyone')).toEqual(['hello @everyone'])
    })

    it('leaves out code blocks, with or without a language line', () => {
        expect(proseText('before\n```\n@everyone\n```\nafter')).toEqual(['before', 'after'])
        expect(proseText('```ts\n<@0190a0b0-0000-7000-8000-000000000001>\n```')).toEqual([])
    })

    it('keeps an unclosed fence as text', () => {
        expect(proseText('``` @everyone')).toEqual(['``` @everyone'])
    })

    it('leaves out inline code of one or two backticks', () => {
        expect(proseText('type `@everyone` to call all')).toEqual(['type ', ' to call all'])
        expect(proseText('``a ` @everyone``')).toEqual([])
    })

    it('keeps three backticks in a line, and a lone one, as text', () => {
        expect(proseText('a ` @everyone')).toEqual(['a ` @everyone'])
    })

    it('reads an escaped backtick as text, so it opens no code', () => {
        expect(proseText('\\`@everyone`')).toEqual(['`@everyone`'])
    })

    it('leaves out links: what follows the address in it is part of it', () => {
        expect(proseText('see https://example.com/@everyone now')).toEqual(['see ', ' now'])
    })

    it('reads inside bold, italic, strikethrough and quotes', () => {
        expect(proseText('**hi @everyone**')).toEqual(['hi @everyone'])
        expect(proseText('> @everyone\nnext')).toEqual(['@everyone', 'next'])
        expect(proseText('~~_@everyone_~~')).toEqual(['@everyone'])
    })

    it('lets bold that closes first win over a backtick inside it, as the client does', () => {
        // "**a `b**" is bold around "a `b"; the backtick after it opens nothing.
        expect(proseText('**a `b** c` @everyone')).toEqual(['a `b', ' c` @everyone'])
    })
})
