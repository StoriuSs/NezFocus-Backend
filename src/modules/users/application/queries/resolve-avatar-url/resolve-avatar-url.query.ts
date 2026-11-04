export class ResolveAvatarUrlQuery {
    /** The stored avatar key; null or empty when there is none. */
    constructor(public readonly key: string | null | undefined) {}
}
