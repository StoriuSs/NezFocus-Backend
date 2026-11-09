import { EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { serverPlan } from './server-templates'

const channelsOf = (template: 'study' | 'standard') => serverPlan(template).groups.flatMap((group) => group.channels)

describe('Study Server template (REQ-STUDY-08)', () => {
    const plan = serverPlan('study')

    it('has two categories, five text channels and two study rooms', () => {
        expect(plan.groups.map((group) => group.name)).toEqual(['Thông tin', 'Phòng học'])
        const channels = channelsOf('study')
        expect(channels.filter((channel) => channel.type === 'text').map((channel) => channel.name)).toEqual([
            'chao-mung',
            'thong-bao',
            'tai-lieu',
            'hoi-dap',
            'viec-nhom'
        ])
        const rooms = channels.filter((channel) => channel.type === 'voice')
        expect(rooms).toHaveLength(2)
        expect(rooms.every((room) => room.isStudyRoom)).toBe(true)
    })

    it('lets only managers post in thong-bao, and has the Task Board on in viec-nhom', () => {
        const byName = new Map(channelsOf('study').map((channel) => [channel.name, channel]))
        expect(byName.get('thong-bao')?.sendMode).toBe('managers')
        expect(
            channelsOf('study')
                .filter((channel) => channel.taskBoardEnabled)
                .map((channel) => channel.name)
        ).toEqual(['viec-nhom'])
    })

    it('welcomes in chao-mung and gives the owner the Trưởng nhóm role with its five permissions', () => {
        expect(plan.welcomeChannel).toBe('chao-mung')
        expect(plan.roles).toEqual([
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
        ])
    })
})

describe('Standard template (REQ-SRV-01)', () => {
    const plan = serverPlan('standard')

    it('has one text channel and one plain voice room outside any category, welcoming in chung', () => {
        expect(plan.groups).toHaveLength(1)
        expect(plan.groups[0].name).toBeNull()
        expect(channelsOf('standard').map((channel) => [channel.type, channel.name, channel.isStudyRoom])).toEqual([
            ['text', 'chung', false],
            ['voice', 'Phòng thoại chung', false]
        ])
        expect(plan.welcomeChannel).toBe('chung')
        expect(plan.roles).toEqual([])
    })
})

describe('both templates', () => {
    it.each(['study', 'standard'] as const)('%s: @everyone gets the defaults of appendix B', (template) => {
        expect(serverPlan(template).everyonePermissions).toBe(EVERYONE_DEFAULT_PERMISSIONS)
    })

    it.each(['study', 'standard'] as const)('%s: the welcome channel is one of its text channels', (template) => {
        const plan = serverPlan(template)
        expect(
            channelsOf(template).some((channel) => channel.type === 'text' && channel.name === plan.welcomeChannel)
        ).toBe(true)
    })
})
