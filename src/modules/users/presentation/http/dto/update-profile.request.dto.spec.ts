import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateProfileRequestDto } from './update-profile.request.dto'

/** The DTO as the global ValidationPipe builds it: the fields it refuses, and the values it keeps. */
async function check(body: object) {
    const dto = plainToInstance(UpdateProfileRequestDto, body)
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
    return { refused: errors.map((error) => error.property), dto }
}

// PATCH /users/me (S-ME-02, REQ-AUTH-06, D-139).
describe('UpdateProfileRequestDto', () => {
    it('composes and trims the name, counting 32 decomposed Vietnamese letters as 32', async () => {
        const { refused, dto } = await check({ displayName: ` ${'ễ'.repeat(32)} ` })
        expect(refused).toEqual([])
        expect(dto.displayName).toBe('ễ'.repeat(32))
    })

    it('takes 32 emoji as a name and 200 as a bio', async () => {
        expect((await check({ displayName: '🙂'.repeat(32), bio: '🙂'.repeat(200) })).refused).toEqual([])
    })

    it.each([
        ['33 characters', { displayName: 'a'.repeat(33) }],
        ['only Hangul fillers', { displayName: 'ㅤㅤ' }],
        ['only a zero-width space', { displayName: '​' }],
        ['only spaces', { displayName: '   ' }],
        ['a line break', { displayName: 'Thanh\nAn' }],
        ['null', { displayName: null }]
    ])('refuses a display name of %s', async (_case, body) => {
        expect((await check(body)).refused).toEqual(['displayName'])
    })

    it.each([
        ['201 characters', { bio: 'a'.repeat(201) }],
        ['a tab', { bio: 'a\tb' }],
        ['null', { bio: null }]
    ])('refuses a bio of %s', async (_case, body) => {
        expect((await check(body)).refused).toEqual(['bio'])
    })

    it('leaves out what is not sent, and clears the bio with an empty string', async () => {
        const { refused, dto } = await check({ bio: '  ' })
        expect(refused).toEqual([])
        expect(dto).toEqual({ bio: '' })
    })
})
