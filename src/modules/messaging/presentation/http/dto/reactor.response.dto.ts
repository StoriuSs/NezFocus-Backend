import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** Someone named in a reaction's tooltip; names are null once the account's personal data is erased, or while it waits to be (D-182). */
export class ReactorResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsOptional()
    @IsString()
    username: string | null

    @Expose()
    @IsOptional()
    @IsString()
    displayName: string | null
}
