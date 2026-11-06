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
    /** When the "complete your account" step was done; null until then (D-61). */
    completedAt: Date | null
    /** When the owner agreed to the Terms, in that step (REQ-AUTH-01). */
    termsAcceptedAt: Date | null

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
        completedAt?: Date | null
        termsAcceptedAt?: Date | null
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
        this.completedAt = props.completedAt ?? null
        this.termsAcceptedAt = props.termsAcceptedAt ?? null
        this.createdAt = props.createdAt ?? new Date()
        this.updatedAt = props.updatedAt ?? new Date()
        this.deletedAt = props.deletedAt ?? null
        this.deletedBy = props.deletedBy ?? null
    }

    get isDeleted(): boolean {
        return this.deletedAt !== null
    }
}
