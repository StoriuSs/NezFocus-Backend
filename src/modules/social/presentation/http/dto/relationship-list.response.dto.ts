import { Expose, Type } from 'class-transformer'
import { IsArray, ValidateNested } from 'class-validator'
import { RelationshipResponseDto } from './relationship.response.dto'

/** Everyone in my list, all at once (D-242: no pages): friends, requests both ways, people I blocked; newest first. */
export class RelationshipListResponseDto {
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RelationshipResponseDto)
    relationships: RelationshipResponseDto[]
}
