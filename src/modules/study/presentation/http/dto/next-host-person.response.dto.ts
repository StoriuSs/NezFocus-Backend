import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

/** The person who would control the session next (D-233). */
export class NextHostPersonResponseDto {
    @Expose()
    @IsString()
    id: string

    /** Null for an account shown as deleted (D-182): the client says it without a name. */
    @Expose()
    @IsOptional()
    @IsString()
    displayName: string | null
}
