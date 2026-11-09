import { EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'

/** The starting set of channels a new server gets (REQ-SRV-01). */
export const SERVER_TEMPLATES = ['study', 'standard'] as const
export type ServerTemplateName = (typeof SERVER_TEMPLATES)[number]

export interface ChannelPlan {
    type: 'text' | 'voice'
    /** Text channels already in their stored form (lower case, dashes; REQ-SRV-02). */
    name: string
    sendMode: 'everyone' | 'managers'
    /** A study room with the default 25/5 cycle, anyone in the room may start (REQ-STUDY-01). */
    isStudyRoom: boolean
    taskBoardEnabled: boolean
}

export interface CategoryPlan {
    /** Null: the channels outside any category, listed above the first one. */
    name: string | null
    channels: ChannelPlan[]
}

export interface RolePlan {
    name: string
    permissions: bigint
    /** Given to the owner when the server is made. */
    givenToOwner: boolean
}

export interface ServerPlan {
    /** In display order. */
    groups: CategoryPlan[]
    /** The text channel that gets "X joined the server" (D-83). */
    welcomeChannel: string
    everyonePermissions: bigint
    /** Above @everyone, lowest first: the first is at position 1. */
    roles: RolePlan[]
}

const text = (name: string, extra: Partial<ChannelPlan> = {}): ChannelPlan => ({
    type: 'text',
    name,
    sendMode: 'everyone',
    isStudyRoom: false,
    taskBoardEnabled: false,
    ...extra
})

const voice = (name: string, extra: Partial<ChannelPlan> = {}): ChannelPlan => ({
    type: 'voice',
    name,
    sendMode: 'everyone',
    isStudyRoom: false,
    taskBoardEnabled: false,
    ...extra
})

/**
 * Study Server (REQ-STUDY-08): two categories, five text channels, two study
 * rooms, and a "Trưởng nhóm" role for the owner. Category names are kept as
 * typed; the channel list shows them in capitals (C-06).
 */
const STUDY: ServerPlan = {
    groups: [
        {
            name: 'Thông tin',
            channels: [
                text('chao-mung'),
                text('thong-bao', { sendMode: 'managers' }),
                text('tai-lieu'),
                text('hoi-dap'),
                text('viec-nhom', { taskBoardEnabled: true })
            ]
        },
        {
            name: 'Phòng học',
            channels: [
                voice('Phòng học im lặng', { isStudyRoom: true }),
                voice('Phòng thảo luận nhóm', { isStudyRoom: true })
            ]
        }
    ],
    welcomeChannel: 'chao-mung',
    everyonePermissions: EVERYONE_DEFAULT_PERMISSIONS,
    roles: [
        {
            name: 'Trưởng nhóm',
            permissions:
                Permission.MANAGE_STUDY_ROOMS |
                Permission.MANAGE_TASKS |
                Permission.MANAGE_MESSAGES |
                Permission.MODERATE_MEMBERS |
                Permission.KICK_MEMBERS,
            givenToOwner: true
        }
    ]
}

/** Standard (REQ-SRV-01): one text channel and one voice room, no category. */
const STANDARD: ServerPlan = {
    groups: [{ name: null, channels: [text('chung'), voice('Phòng thoại chung')] }],
    welcomeChannel: 'chung',
    everyonePermissions: EVERYONE_DEFAULT_PERMISSIONS,
    roles: []
}

export function serverPlan(template: ServerTemplateName): ServerPlan {
    return template === 'study' ? STUDY : STANDARD
}
