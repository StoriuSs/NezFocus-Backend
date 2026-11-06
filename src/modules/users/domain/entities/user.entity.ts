/**
 * User Domain Entity
 *
 * This is a pure domain object with ZERO framework dependencies.
 * It mirrors the database schema but is completely ORM-independent.
 * The mapper (infrastructure layer) converts between this and Prisma's generated type.
 */
export class UserEntity {
    readonly id: string

    username: string | null
    email: string | null
    roles: string[]
    displayName: string | null
    avatarUrl: string | null
    bio: string | null
    hasSetUsername: boolean
    /** When the "complete your account" step was done; null until then (D-61). */
    completedAt: Date | null

    readonly createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
    deletedBy: string | null

    constructor(props: {
        id: string
        username?: string | null
        email?: string | null
        roles?: string[]
        displayName?: string | null
        avatarUrl?: string | null
        bio?: string | null
        hasSetUsername?: boolean
        completedAt?: Date | null
        createdAt?: Date
        updatedAt?: Date
        deletedAt?: Date | null
        deletedBy?: string | null
    }) {
        this.id = props.id
        this.username = props.username ?? null
        this.email = props.email ?? null
        this.roles = props.roles ?? ['user']
        this.displayName = props.displayName ?? null
        this.avatarUrl = props.avatarUrl ?? null
        this.bio = props.bio ?? null
        this.hasSetUsername = props.hasSetUsername ?? false
        this.completedAt = props.completedAt ?? null
        this.createdAt = props.createdAt ?? new Date()
        this.updatedAt = props.updatedAt ?? new Date()
        this.deletedAt = props.deletedAt ?? null
        this.deletedBy = props.deletedBy ?? null
    }

    get isDeleted(): boolean {
        return this.deletedAt !== null
    }
}
