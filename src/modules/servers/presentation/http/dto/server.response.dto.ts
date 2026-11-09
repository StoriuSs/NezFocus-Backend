import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Matches, ValidateNested } from 'class-validator'

/** Permission bits as a decimal string: they go past what a JSON number holds exactly. Read with BigInt(). */
const BITS = /^\d{1,20}$/

export class ServerCategoryResponseDto {
    @Expose()
    @IsString()
    id: string

    /** As typed; the channel list shows it in capitals. */
    @Expose()
    @IsString()
    name: string

    /** Order among the categories, 0 first. */
    @Expose()
    @IsInt()
    position: number
}

export class ServerChannelResponseDto {
    @Expose()
    @IsString()
    id: string

    /** Null: listed above the first category. */
    @Expose()
    @IsOptional()
    @IsString()
    categoryId: string | null

    @Expose()
    @IsIn(['text', 'voice'])
    type: 'text' | 'voice'

    @Expose()
    @IsString()
    name: string

    /** Order within its category, 0 first. */
    @Expose()
    @IsInt()
    position: number

    @Expose()
    @IsBoolean()
    isPrivate: boolean

    /** `managers`: only those with MANAGE_MESSAGES may post. */
    @Expose()
    @IsIn(['everyone', 'managers'])
    sendMode: 'everyone' | 'managers'

    @Expose()
    @IsBoolean()
    isStudyRoom: boolean

    @Expose()
    @IsBoolean()
    taskBoardEnabled: boolean

    /** What they may do in this channel (appendix B, steps 1–6). */
    @ApiProperty({ example: '3657472' })
    @Expose()
    @Matches(BITS)
    permissions: string

    /** The roles that see it when private, sent only to those who may edit that; null otherwise. */
    @ApiProperty({ type: [String], nullable: true })
    @Expose()
    @IsOptional()
    @IsString({ each: true })
    viewRoleIds: string[] | null
}

/** A role of the server, not @everyone (the private-channel picker, S-SRV-05). */
export class ServerRoleResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    /** Higher is more senior. */
    @Expose()
    @IsInt()
    position: number

    /** Holds ADMINISTRATOR: sees every channel, so it is shown ticked and locked. */
    @Expose()
    @IsBoolean()
    administrator: boolean
}

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

/** GET /servers: in the order they joined (C-05). */
export class ServerListResponseDto {
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => ServerResponseDto)
    servers: ServerResponseDto[]
}

/** A category or channel just made, and the server as it now is for them. */
export class CreatedInServerResponseDto {
    /** The new category's or channel's id. */
    @Expose()
    @IsString()
    id: string

    @Expose()
    @ValidateNested()
    @Type(() => ServerResponseDto)
    server: ServerResponseDto
}

export class ServerIconResponseDto {
    @Expose()
    @IsString()
    iconUrl: string
}
