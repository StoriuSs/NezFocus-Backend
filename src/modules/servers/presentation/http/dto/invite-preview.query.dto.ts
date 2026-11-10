import { IsOptional, IsString, MaxLength } from 'class-validator'

export class InvitePreviewQueryDto {
    /** The `?channel=` of the link (D-150). Not one someone joining sees: ignored. */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    channel?: string
}
