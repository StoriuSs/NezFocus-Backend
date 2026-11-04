import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

export class RecoveryCodesResponseDto {
    /** Ten codes, each usable once. Shown this once: only their fingerprints are kept. */
    @Expose()
    @IsString({ each: true })
    recoveryCodes: string[]
}
