/**
 * Role Directory Port — what the servers module tells other modules about a
 * server's roles. The messaging module asks it when a message mentions
 * roles: whether each may be mentioned (REQ-MSG-03), and the names the
 * message is shown with (D-171).
 *
 * Only the roles: who may mention any role (MENTION_EVERYONE) is the
 * permissions module's to answer.
 */
export interface DirectoryRole {
    id: string
    name: string
    /** "Let everyone mention this role". */
    mentionable: boolean
}

export interface RoleDirectoryPort {
    /**
     * The roles among `ids` that belong to this live server, in no order.
     * Never @everyone's own role: the @everyone mention stands for it.
     */
    rolesOf(serverId: string, ids: string[]): Promise<DirectoryRole[]>
}

export const ROLE_DIRECTORY = Symbol('RoleDirectoryPort')
