import { Expose } from 'class-transformer'
import { IsBoolean, IsInt, IsString } from 'class-validator'

/** One emoji on a message, as the reader sees it (C-10 ReactionChip). */
export class ReactionSummaryResponseDto {
    @Expose()
    @IsString()
    emoji: string

    @Expose()
    @IsInt()
    count: number

    /** The reader gave it: the chip shows so, and clicking takes it off. */
    @Expose()
    @IsBoolean()
    me: boolean
}
