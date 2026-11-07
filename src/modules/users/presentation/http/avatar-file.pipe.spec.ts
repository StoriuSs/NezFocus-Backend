import { BadRequestException } from '@nestjs/common'
import { CustomException } from '@/shared/presentation/exceptions'
import { AvatarFilePipe } from './avatar-file.pipe'

const file = (mimetype: string) => ({ mimetype, size: 1024, buffer: Buffer.from('x') }) as Express.Multer.File

// POST /users/me/avatar: the type as declared (REQ-AUTH-06); the size is multer's limit, the content sharp's.
describe('AvatarFilePipe', () => {
    const pipe = new AvatarFilePipe()

    it.each(['image/jpeg', 'image/png', 'image/webp'])('lets %s through', (type) => {
        expect(pipe.transform(file(type))).toEqual(file(type))
    })

    it.each(['image/gif', 'image/svg+xml', 'application/pdf'])('refuses %s as UPLOAD_INVALID_TYPE (415)', (type) => {
        const refused = (() => {
            try {
                pipe.transform(file(type))
            } catch (error) {
                return error as CustomException
            }
        })()
        expect(refused).toBeInstanceOf(CustomException)
        expect([refused!.getStatus(), refused!.type]).toEqual([415, 'UPLOAD_INVALID_TYPE'])
    })

    it('asks for the file when none was sent', () => {
        expect(() => pipe.transform(undefined)).toThrow(BadRequestException)
    })
})
