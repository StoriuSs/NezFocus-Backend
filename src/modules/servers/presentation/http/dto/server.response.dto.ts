import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsInt, IsOptional, IsString, Matches, ValidateNested } from 'class-validator'
import { ServerCategoryResponseDto } from './server-category.response.dto'
import { ServerChannelResponseDto } from './server-channel.response.dto'
import { ServerRoleResponseDto } from './server-role.response.dto'
import { BITS } from './shared/fields'

/** A server as the signed-in person sees it (D-115, D-145). */
export class ServerResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    /** Null: show the initials. */
    @Expose()
    @IsOptional()
    @IsString()
    iconUrl: string | null

    /** The owner outranks every role and may do everything. */
    @Expose()
    @IsBoolean()
    isOwner: boolean

    /**
     * Everyone in it, themselves included (D-161): "gone for N members" when
     * deleting it, and the servers that block deleting the account (D-76).
     */
    @Expose()
    @IsInt()
    memberCount: number

    /** What they may do in the server as a whole: menus and settings pages. */
    @ApiProperty({ example: '3657600' })
    @Expose()
    @Matches(BITS)
    permissions: string

    /** Their highest role's position, 0 with none. Roles at or above it are locked for them, unless they are the owner. */
    @Expose()
    @IsInt()
    topRolePosition: number

    /** The roles they hold, not @everyone. */
    @Expose()
    @IsString({ each: true })
    roleIds: string[]

    /** Every role but @everyone, highest first. */
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => ServerRoleResponseDto)
    roles: ServerRoleResponseDto[]

    /** Set only while they are timed out. */
    @Expose()
    @IsOptional()
    @IsDate()
    timeoutUntil: Date | null

    /** The text channel that gets "X joined the server"; null for none, or one they cannot see. */
    @Expose()
    @IsOptional()
    @IsString()
    welcomeChannelId: string | null

    /** Only those with a channel they can see, unless they manage channels. */
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => ServerCategoryResponseDto)
    categories: ServerCategoryResponseDto[]

    /** Only the ones they can see, by position; group them by category_id. */
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => ServerChannelResponseDto)
    channels: ServerChannelResponseDto[]
}
