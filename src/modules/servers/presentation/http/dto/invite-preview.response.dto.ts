import { Expose, Type } from 'class-transformer'
import { IsOptional, IsString, ValidateNested } from 'class-validator'
import { InviteServerResponseDto } from './invite-server.response.dto'
import { InviteTargetResponseDto } from './invite-target.response.dto'

/** GET /invites/{code} (S-SRV-03): the server with its member and online counts. */
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
