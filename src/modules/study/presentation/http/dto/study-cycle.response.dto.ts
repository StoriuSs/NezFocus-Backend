import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsInt, IsOptional } from 'class-validator'

/** A study cycle, in minutes (D-223). */
export class StudyCycleResponseDto {
    @Expose()
    @IsInt()
    focusMinutes: number

    @Expose()
    @IsInt()
    shortBreakMinutes: number

    /** Both null: no long break. */
    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    longBreakMinutes: number | null

    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    longBreakEvery: number | null
}
