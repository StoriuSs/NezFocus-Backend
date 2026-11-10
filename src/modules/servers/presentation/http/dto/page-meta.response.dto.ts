import { Expose } from 'class-transformer'
import { IsBoolean, IsInt } from 'class-validator'

export class PageMetaResponseDto {
    @Expose()
    @IsInt()
    currentPage: number

    @Expose()
    @IsInt()
    itemsPerPage: number

    @Expose()
    @IsInt()
    totalItems: number

    @Expose()
    @IsInt()
    totalPages: number

    @Expose()
    @IsBoolean()
    hasNextPage: boolean

    @Expose()
    @IsBoolean()
    hasPreviousPage: boolean
}
