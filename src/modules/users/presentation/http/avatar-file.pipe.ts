import { BadRequestException, HttpStatus, Injectable, PipeTransform } from '@nestjs/common'
import { CustomException } from '@/shared/presentation/exceptions'
import { ERROR_CODES, ERROR_TYPES, MESSAGES } from '@/shared/constants'
import { AVATAR_MIME_TYPES } from '@/modules/users/domain/avatar.rules'

/**
 * The avatar file's declared type, refused with the error the profile page
 * names ("Only JPG, PNG or WEBP images."), not a bare 400. A first pass only:
 * sharp checks what the bytes really are. The size is checked earlier, by
 * multer while the body streams in (UPLOAD_FILE_TOO_LARGE).
 */
@Injectable()
export class AvatarFilePipe implements PipeTransform<Express.Multer.File | undefined, Express.Multer.File> {
    transform(file: Express.Multer.File | undefined): Express.Multer.File {
        if (!file) throw new BadRequestException('avatar: a file is required')
        if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
            throw new CustomException({
                code: ERROR_CODES.UPLOAD_INVALID_TYPE,
                type: ERROR_TYPES.UPLOAD_INVALID_TYPE,
                message: MESSAGES.UPLOAD.INVALID_FILE_TYPE,
                status: HttpStatus.UNSUPPORTED_MEDIA_TYPE
            })
        }
        return file
    }
}
