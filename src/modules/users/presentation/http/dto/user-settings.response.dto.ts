import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsOptional, IsString } from 'class-validator'
import { LANGUAGES, THEMES } from '@/modules/users/domain/user-settings.rules'

/**
 * The signed-in user's settings, the same in every browser (SRS 7.1,
 * REQ-AUTH-08). Returned by GET and PATCH /users/me/settings.
 */
export class UserSettingsResponseDto {
    /** An IANA zone name, in ICU's letter case (asia/tokyo is stored as Asia/Tokyo). */
    @Expose()
    @IsString()
    timezone: string

    /**
     * When the zone may change again (once every 24 hours); null if it may
     * now. Worked out by the server, so the device's clock does not matter.
     */
    @Expose()
    @IsOptional()
    @IsDate()
    timezoneChangeableAt: Date | null

    @Expose()
    @ApiProperty({ enum: LANGUAGES })
    @IsIn(LANGUAGES)
    language: (typeof LANGUAGES)[number]

    @Expose()
    @ApiProperty({ enum: THEMES })
    @IsIn(THEMES)
    theme: (typeof THEMES)[number]

    @Expose()
    @IsBoolean()
    phaseSound: boolean

    @Expose()
    @IsBoolean()
    browserNotifications: boolean

    @Expose()
    @IsBoolean()
    notifyMentions: boolean

    @Expose()
    @IsBoolean()
    notifyDirectMessages: boolean

    @Expose()
    @IsBoolean()
    notifyIncomingCalls: boolean

    @Expose()
    @IsBoolean()
    notifyPhaseChanges: boolean

    @Expose()
    @IsBoolean()
    notificationPromptDismissed: boolean

    @Expose()
    @IsBoolean()
    allowServerMemberMessages: boolean

    @Expose()
    @IsBoolean()
    showStudyActivity: boolean
}
