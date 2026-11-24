import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import type { Presence } from '@/modules/realtime'
import { SHOWN_PRESENCES } from '../../../application'
import { DmLastMessageResponseDto } from './dm-last-message.response.dto'
import { SocialPersonResponseDto } from './social-person.response.dto'

/**
 * A DM as I see it (D-242, D-244): the other one, whether I may write to
 * them now, the last message. Its unread is in `GET /me/read-states`
 * (`server_id` null).
 */
export class DmResponseDto {
    /** The DM's channel id: its messages, pins, reads go through the channel routes (D-238). */
    @Expose()
    @IsString()
    id: string

    /** Nulls for an account deleted or waiting to be: the client says "Tài khoản đã bị xóa" (D-182). */
    @Expose()
    @ValidateNested()
    @Type(() => SocialPersonResponseDto)
    user: SocialPersonResponseDto

    /** What I see of them: a friend, or someone I share a server with (D-242); null for anyone else or an account gone. */
    @Expose()
    @ApiProperty({ enum: SHOWN_PRESENCES, nullable: true })
    @IsOptional()
    @IsIn(SHOWN_PRESENCES)
    presence: Presence | null

    /** Whether I may message them now (REQ-SOCIAL-04): false shows the locked composer, no call button. */
    @Expose()
    @IsBoolean()
    canMessage: boolean

    /** Null in a DM with no message left. */
    @Expose()
    @ApiProperty({ type: DmLastMessageResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => DmLastMessageResponseDto)
    lastMessage: DmLastMessageResponseDto | null

    @Expose()
    @IsDate()
    createdAt: Date
}
