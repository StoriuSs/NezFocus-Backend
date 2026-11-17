import { PermissionCheckerPort } from '@/modules/permissions'
import { TaskRepositoryPort } from '../../domain'
import { openBoardsOf } from './board-access'

/**
 * The channels whose tasks `userId`'s To-do page lists now (REQ-TASK-05,
 * D-186): text channels of the servers their tasks are in (only `serverId`
 * when one is asked for) that they still view and whose Task Board is on.
 * A server they left gives none (its access is null); so does a board
 * turned off or a channel gone private to them (spec 05 › Edge case).
 *
 * Reads the permission cache once per server, so the page's lists filter in
 * one query each and their counts match their pages.
 */
export async function myBoards(
    tasks: TaskRepositoryPort,
    checker: PermissionCheckerPort,
    userId: string,
    serverId: string | null,
    now: Date
): Promise<string[]> {
    const servers = (await tasks.serversOfMine(userId)).filter((id) => serverId === null || id === serverId)
    const accesses = await Promise.all(servers.map((id) => checker.access(id, userId)))
    return accesses.flatMap((access) => openBoardsOf(access, now))
}
