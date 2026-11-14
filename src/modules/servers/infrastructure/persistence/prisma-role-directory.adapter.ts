import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { DirectoryRole, RoleDirectoryPort } from '../../application/ports'

/** RoleDirectoryPort, answered from the Role table (its primary key). */
@Injectable()
export class PrismaRoleDirectory implements RoleDirectoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async rolesOf(serverId: string, ids: string[]): Promise<DirectoryRole[]> {
        if (!ids.length) return []
        return this.prisma.role.findMany({
            where: { id: { in: ids }, serverId, isEveryone: false, server: { deletedAt: null } },
            select: { id: true, name: true, mentionable: true }
        })
    }
}
