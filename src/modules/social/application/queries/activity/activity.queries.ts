/*
 * Reads of the study activity line (D-240, D-247), for other modules: the
 * member list of servers asks through MEMBER_ACTIVITY.
 */

/** The activity of each of these people who shows one, the same for every viewer. */
export class ListActivitiesQuery {
    constructor(readonly userIds: string[]) {}
}
