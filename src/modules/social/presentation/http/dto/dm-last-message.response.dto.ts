import { ApiProperty } from '@nestjs/swagger'
import { Expose, Transform, Type } from 'class-transformer'
import { IsArray, IsDate, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
import { DmMentionedUserResponseDto } from './dm-mentioned-user.response.dto'
import { DmMessageFilesResponseDto } from './dm-message-files.response.dto'

const MESSAGE_TYPES = ['regular', 'system'] as const

/** The last message of a DM not deleted, as its row's second line shows it (spec 09 › C-30 DMRow). */
export class DmLastMessageResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @ApiProperty({ enum: MESSAGE_TYPES })
    @IsIn(MESSAGE_TYPES)
    type: 'regular' | 'system'

    /** What a system message says happened (`call_ended` from M6 L4); null on a regular one. */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    systemEvent: string | null

    /**
     * What a system message says, as the chat's message has it: a call
     * `{ user_id, call_id, status, end_reason, video, duration_seconds }`
     * (D-250); null on a regular one.
     */
    @Expose()
    // As it is: an untyped object would otherwise come out empty, every key not @Expose()d.
    @Transform(({ obj }: { obj: { systemData?: unknown } }) => obj.systemData ?? null, { toClassOnly: true })
    @ApiProperty({ type: Object, nullable: true })
    @IsOptional()
    @IsObject()
    systemData: Record<string, unknown> | null

    /** Who wrote it; null on a system message. */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    authorId: string | null

    /** As written, its tokens (`<@id>`) named by `mention_users`. */
    @Expose()
    @IsString()
    content: string

    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DmMentionedUserResponseDto)
    mentionUsers: DmMentionedUserResponseDto[]

    @Expose()
    @ValidateNested()
    @Type(() => DmMessageFilesResponseDto)
    files: DmMessageFilesResponseDto

    @Expose()
    @IsDate()
    createdAt: Date
}
