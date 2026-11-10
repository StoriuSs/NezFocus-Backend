import { Expose } from 'class-transformer'
import { IsDate, IsInt, IsOptional, IsString } from 'class-validator'

export class InviteResponseDto {
    /** The link is /invite/{code}. */
    @Expose()
    @IsString()
    code: string

    /** The lifetime chosen; null: never expires. */
    @Expose()
    @IsOptional()
    @IsInt()
    maxAgeSeconds: number | null

    /** Null: no limit. */
    @Expose()
    @IsOptional()
    @IsInt()
    maxUses: number | null

    @Expose()
    @IsInt()
    uses: number

    /** Null: never expires. */
    @Expose()
    @IsOptional()
    @IsDate()
    expiresAt: Date | null

    @Expose()
    @IsDate()
    createdAt: Date
}
