export class StartOAuthCommand {
    constructor(
        public readonly provider: string,
        /** Where the web app wants to be afterwards, as it asked; checked here. */
        public readonly redirect: string | undefined
    ) {}
}
