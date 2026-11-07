import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'

/** One signed-in device (S-ME-03). */
export class SessionResponseDto {
    /** End it with `DELETE /auth/sessions/{id}`. */
    @Expose()
    @IsString()
    id: string

    /** Chrome, Edge, Firefox, Safari, Opera, Cốc Cốc, Samsung Internet, Chromium; null when not one of these. */
    @Expose()
    @IsOptional()
    @IsString()
    browser: string | null

    /** Windows, macOS, iOS, iPadOS, Android, Ubuntu, Linux, ChromeOS; null when not one of these. */
    @Expose()
    @IsOptional()
    @IsString()
    os: string | null

    /** For the icon. */
    @Expose()
    @IsIn(['desktop', 'tablet', 'mobile'])
    device: 'desktop' | 'tablet' | 'mobile'

    /**
     * The network of the last use, the rest masked: `14.231.x.x`,
     * `2405:4802:x:x…` (D-138). Null when it is not known.
     */
    @Expose()
    @IsOptional()
    @IsString()
    ip: string | null

    /** The last refresh, or the sign-in before any. */
    @Expose()
    @IsDate()
    lastActiveAt: Date

    @Expose()
    @IsDate()
    signedInAt: Date

    /** The session of this request: "This device". Always first. */
    @Expose()
    @IsBoolean()
    current: boolean
}

/** The live sessions: this device first, then by latest use (D-75). */
export class SessionListResponseDto {
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => SessionResponseDto)
    sessions: SessionResponseDto[]
}
