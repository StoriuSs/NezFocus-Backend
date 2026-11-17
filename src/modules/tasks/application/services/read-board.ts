import { Inject } from '@nestjs/common'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { CHANNEL_DIRECTORY, ChannelDirectoryPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { TASK_REPOSITORY, TaskRepositoryPort } from '../../domain'
import { BoardSources } from './board-access'

/**
 * What every query of a board reads (D-157, D-190): the tasks, where a
 * channel is and what someone may do there, to open the board first
 * (board-access.ts), and the people's pictures.
 */
export abstract class ReadBoard {
    constructor(
        @Inject(TASK_REPOSITORY) protected readonly tasks: TaskRepositoryPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) protected readonly users: UserDirectoryPort
    ) {}

    protected get sources(): BoardSources {
        return { channels: this.channels, checker: this.checker }
    }
}
