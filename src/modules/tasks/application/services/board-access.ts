import {
    AccessChannel,
    channelPermissions,
    Permission,
    PermissionCheckerPort,
    ServerAccess
} from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import {
    ChannelNotFoundError,
    TaskActor,
    TaskBoardDisabledError,
    TaskNotFoundError,
    TaskRecord,
    TaskRepositoryPort
} from '../../domain'

/** A text channel's Task Board the person may view, and who they are on it. */
export interface OpenBoard {
    serverId: string
    channelId: string
    actor: TaskActor
}

/** What opening a board reads: where a channel is, and what someone may do there. */
export interface BoardSources {
    channels: ChannelDirectoryPort
    checker: PermissionCheckerPort
}

/**
 * The Task Board of `channelId` as `userId` sees it now (REQ-TASK-01, 02).
 * Anyone who may not view the text channel learns only "not found"
 * (NFR-SEC-05); a board that is off says so (`task_board_disabled`), to
 * those who view the channel only.
 *
 * Reads the permission cache, which holds whether the board is on (D-189):
 * a switch a moment ago reaches it once servers has told the cache (D-146).
 */
export async function openBoard(
    { channels, checker }: BoardSources,
    channelId: string,
    userId: string,
    now: Date
): Promise<OpenBoard> {
    const serverId = await channels.serverIdOf(channelId)
    if (!serverId) throw new ChannelNotFoundError(channelId)
    const access = await checker.access(serverId, userId)
    const channel = access?.server.channels.find((candidate) => candidate.id === channelId)
    if (!access || channel?.type !== 'text') throw new ChannelNotFoundError(channelId)

    const permissions = channelPermissions(access.server, access.member, channel, now)
    if ((permissions & Permission.VIEW_CHANNEL) === 0n) throw new ChannelNotFoundError(channelId)
    if (!channel.taskBoardEnabled) throw new TaskBoardDisabledError()

    // A timeout leaves only VIEW_CHANNEL (appendix B, step 6); the owner and
    // ADMINISTRATOR keep every bit through one, so they are never held back.
    const { timeoutUntil } = access.member
    const heldBack = timeoutUntil !== null && timeoutUntil.getTime() > now.getTime()
    return {
        serverId,
        channelId,
        actor: {
            userId,
            manages: (permissions & Permission.MANAGE_TASKS) !== 0n,
            creates: (permissions & Permission.CREATE_TASKS) !== 0n,
            timedOutUntil: heldBack && (permissions & Permission.MANAGE_TASKS) === 0n ? timeoutUntil : null
        }
    }
}

/**
 * A task and its board, as `userId` sees them now: a task in a channel they
 * may not view is not found, like one that does not exist (NFR-SEC-05).
 */
export async function openTask(
    tasks: TaskRepositoryPort,
    sources: BoardSources,
    taskId: string,
    userId: string,
    now: Date
): Promise<{ task: TaskRecord; board: OpenBoard }> {
    const task = await tasks.find(taskId)
    if (!task) throw new TaskNotFoundError(taskId)
    try {
        return { task, board: await openBoard(sources, task.channelId, userId, now) }
    } catch (error) {
        if (error instanceof ChannelNotFoundError) throw new TaskNotFoundError(taskId)
        throw error
    }
}

/** Whether someone may view a channel of the server they are known in by the permission cache. */
const views = (access: ServerAccess, channel: AccessChannel, now: Date): boolean =>
    (channelPermissions(access.server, access.member, channel, now) & Permission.VIEW_CHANNEL) !== 0n

/** Whether someone, as the permission cache knows them in a server, may view one of its channels now. */
export function viewsChannel(access: ServerAccess | null, channelId: string, now: Date): boolean {
    const channel = access?.server.channels.find((candidate) => candidate.id === channelId)
    if (!access || !channel) return false
    return views(access, channel, now)
}

/**
 * The Task Boards someone may open in a server now, as `openBoard` would
 * let them (REQ-TASK-01, REQ-TASK-05): its text channels with the board on
 * that they view. None in a server they are not in (`access` null).
 */
export function openBoardsOf(access: ServerAccess | null, now: Date): string[] {
    if (!access) return []
    return access.server.channels
        .filter((channel) => channel.type === 'text' && channel.taskBoardEnabled && views(access, channel, now))
        .map((channel) => channel.id)
}

/**
 * A board as the app sees it for its own work, with no one opening it (a
 * reminder, REQ-TASK-04): whether it is on, and which of `userIds` view its
 * channel now, as the permission cache knows them. Read through those
 * people, as the cache is read per member: when none of them is in the
 * server any more, the board counts as off, as there is no one to tell.
 */
export async function boardReach(
    checker: PermissionCheckerPort,
    { serverId, channelId }: Pick<OpenBoard, 'serverId' | 'channelId'>,
    userIds: string[],
    now: Date
): Promise<{ on: boolean; viewerIds: Set<string> }> {
    const people = [...new Set(userIds)]
    const accesses = await Promise.all(people.map((userId) => checker.access(serverId, userId)))
    const known = accesses.find((access): access is ServerAccess => access !== null)
    const channel = known?.server.channels.find((candidate) => candidate.id === channelId)
    const viewerIds = new Set(people.filter((_, index) => viewsChannel(accesses[index] ?? null, channelId, now)))
    return { on: channel?.type === 'text' && channel.taskBoardEnabled, viewerIds }
}

/**
 * Those among `userIds` who may view the board's channel now (REQ-TASK-01):
 * the only people a task may be given to. A member timed out still views.
 */
export async function viewersOf(
    checker: PermissionCheckerPort,
    { serverId, channelId }: Pick<OpenBoard, 'serverId' | 'channelId'>,
    userIds: string[],
    now: Date
): Promise<Set<string>> {
    const views = await Promise.all(
        [...new Set(userIds)].map(async (userId) =>
            viewsChannel(await checker.access(serverId, userId), channelId, now) ? userId : null
        )
    )
    return new Set(views.filter((userId): userId is string => userId !== null))
}
