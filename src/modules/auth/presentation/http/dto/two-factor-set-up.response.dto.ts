import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

export class TwoFactorSetUpResponseDto {
    /** For typing into the app by hand, when the QR code cannot be scanned. Base32. */
    @Expose()
    @IsString()
    secret: string

    /** The QR code's content: `otpauth://totp/…`. */
    @Expose()
    @IsString()
    otpauthUri: string
}
