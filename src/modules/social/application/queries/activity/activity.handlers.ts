import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Activity } from '../../../domain'
import { StudyActivities } from '../../services/activities'
import { ListActivitiesQuery } from './activity.queries'

/** For the member list (D-108): everyone listed shares the server with the viewer, so each may be shown. */
@QueryHandler(ListActivitiesQuery)
export class ListActivitiesHandler implements IQueryHandler<ListActivitiesQuery> {
    constructor(private readonly activities: StudyActivities) {}

    execute({ userIds }: ListActivitiesQuery): Promise<Map<string, Activity>> {
        return this.activities.of(userIds)
    }
}

export const ACTIVITY_QUERY_HANDLERS = [ListActivitiesHandler]
