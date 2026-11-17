import { foldForSearch, isTaskDescription, isTaskTitle, normaliseTaskText } from './task-text.rules'

describe('searching tasks by title (D-97)', () => {
    it('drops accents and case, đ read as d, so "de cuong" finds "Đề cương"', () => {
        expect(foldForSearch('Tổng hợp ĐỀ CƯƠNG chương 1–3')).toBe('tong hop de cuong chuong 1–3')
        expect(foldForSearch('  Đăng   nhập ')).toBe('dang   nhap')
    })
})

describe('the text of a task (REQ-TASK-01)', () => {
    it('is composed and trimmed', () => {
        expect(normaliseTaskText('  Ôn chương 4\n')).toBe('Ôn chương 4')
        expect(normaliseTaskText('Ôn')).toBe('Ôn')
    })

    it('takes a title of 1-200 characters on one line', () => {
        expect(isTaskTitle('Ôn chương 4')).toBe(true)
        expect(isTaskTitle('')).toBe(false)
        expect(isTaskTitle('a'.repeat(200))).toBe(true)
        expect(isTaskTitle('a'.repeat(201))).toBe(false)
        expect(isTaskTitle('😀'.repeat(200))).toBe(true)
        expect(isTaskTitle('hai\ndòng')).toBe(false)
    })

    it('takes a description of up to 2000 characters, line breaks allowed', () => {
        expect(isTaskDescription('')).toBe(true)
        expect(isTaskDescription('Lan xem phần gửi mã,\nmình xem phần kiểm tra.')).toBe(true)
        expect(isTaskDescription('a'.repeat(2001))).toBe(false)
        expect(isTaskDescription('a\u0000b')).toBe(false)
    })
})
