import { QueryBus } from '@nestjs/cqrs'
import { validateAndTransform } from '@/shared/utils'
import { GetRelationshipQuery, RelationshipView } from '../../application'
import { PersonNotFoundError } from '../../domain'
import { RelationshipResponseDto } from './dto'

/**
 * The answer of every change (D-237, D-159): the person as I see them now,
 * read by the query the list uses. Gone between the two calls (deleted for
 * good meanwhile): not found.
 */
export async function relationshipAfter(
    queryBus: QueryBus,
    userId: string,
    otherId: string
): Promise<RelationshipResponseDto> {
    const view: RelationshipView | null = await queryBus.execute(new GetRelationshipQuery(userId, otherId))
    if (!view) throw new PersonNotFoundError(otherId)
    return validateAndTransform(RelationshipResponseDto, view)
}
