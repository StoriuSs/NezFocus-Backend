import { Injectable } from '@nestjs/common'
import { UserSettings as SettingsRow } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    LANGUAGES,
    PRESENCES,
    SettingsChanges,
    THEMES,
    TimezoneChange,
    UserSettings,
    UserSettingsRepositoryPort
} from '@/modules/users/domain'

/** The row as the domain sees it. Language, theme and presence are text columns: anything unexpected reads as the default. */
const toSettings = (row: SettingsRow): UserSettings => ({
    timezone: row.timezone,
    timezoneChangedAt: row.timezoneChangedAt,
    language: LANGUAGES.find((known) => known === row.language) ?? 'en',
    theme: THEMES.find((known) => known === row.theme) ?? 'system',
    phaseSound: row.phaseSound,
    browserNotifications: row.browserNotifications,
    notifyMentions: row.notifyMentions,
    notifyDirectMessages: row.notifyDirectMessages,
    notifyIncomingCalls: row.notifyIncomingCalls,
    notifyPhaseChanges: row.notifyPhaseChanges,
    notificationPromptDismissed: row.notificationPromptDismissed,
    allowServerMemberMessages: row.allowServerMemberMessages,
    showStudyActivity: row.showStudyActivity,
    presence: PRESENCES.find((known) => known === row.presence) ?? 'online'
})

/**
 * Prisma UserSettings Repository — Outbound Adapter. Only a live user's
 * settings are read or written: a soft-deleted account keeps its row until
 * the sweep, but no request may change it.
 */
@Injectable()
export class PrismaUserSettingsRepository implements UserSettingsRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async find(userId: string): Promise<UserSettings | null> {
        const row = await this.prisma.userSettings.findFirst({ where: { userId, user: { deletedAt: null } } })
        return row ? toSettings(row) : null
    }

    async allowingServerMemberMessages(userIds: string[]): Promise<string[]> {
        if (userIds.length === 0) return []
        const rows = await this.prisma.userSettings.findMany({
            where: { userId: { in: userIds }, allowServerMemberMessages: true, user: { deletedAt: null } },
            select: { userId: true }
        })
        return rows.map((row) => row.userId)
    }

    async studyActivitySettingsOf(
        userIds: string[]
    ): Promise<Map<string, Pick<UserSettings, 'showStudyActivity' | 'presence'>>> {
        if (userIds.length === 0) return new Map()
        // A settings row is made when the account is completed: no row, not completed.
        const rows = await this.prisma.userSettings.findMany({
            where: { userId: { in: userIds }, user: { deletedAt: null, deletionRequestedAt: null } },
            select: { userId: true, showStudyActivity: true, presence: true }
        })
        return new Map(
            rows.map((row) => [
                row.userId,
                {
                    showStudyActivity: row.showStudyActivity,
                    presence: PRESENCES.find((known) => known === row.presence) ?? 'online'
                }
            ])
        )
    }

    async update(userId: string, changes: SettingsChanges, timezone?: TimezoneChange): Promise<UserSettings | null> {
        // One UPDATE … WHERE: Postgres re-checks the condition on the locked
        // row, so of two zone changes at once the second matches nothing.
        const { count } = await this.prisma.userSettings.updateMany({
            where: {
                userId,
                user: { deletedAt: null },
                ...(timezone && {
                    OR: [{ timezoneChangedAt: null }, { timezoneChangedAt: { lte: timezone.lastChangeBefore } }]
                })
            },
            data: {
                ...changes,
                ...(timezone && { timezone: timezone.timezone, timezoneChangedAt: timezone.at })
            }
        })
        return count === 0 ? null : this.find(userId)
    }
}
