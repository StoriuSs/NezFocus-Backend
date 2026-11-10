export class ListMyServersQuery {
    constructor(
        public readonly userId: string,
        /** Only this one (after creating it, say); empty when they are not in it. */
        public readonly serverId?: string
    ) {}
}
