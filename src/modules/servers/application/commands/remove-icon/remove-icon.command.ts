export class RemoveServerIconCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}
