import { Expose, Type } from 'class-transformer'
import { IsOptional, IsString, ValidateNested } from 'class-validator'
import { InviteServerResponseDto } from './invite-server.response.dto'
import { InviteTargetResponseDto } from './invite-target.response.dto'

/** GET /invites/{code} (S-SRV-03). Online counts come with presence in M2 (D-143). */
export class InvitePreviewResponseDto {
    @Expose()
    @IsString()
    code: string

    @Expose()
    @ValidateNested()
    @Type(() => InviteServerResponseDto)
    server: InviteServerResponseDto

    /** Null: the creator has left or the account is deleted ("You're invited to", D-81). */
    @Expose()
    @IsOptional()
    @IsString()
    inviterName: string | null

    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => InviteTargetResponseDto)
    channel: InviteTargetResponseDto | null
}
