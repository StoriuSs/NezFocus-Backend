export class FinishOAuthCommand {
    constructor(
        public readonly provider: string,
        /** The query string the provider returned with: `code`, `state`, or `error`. */
        public readonly query: string,
        /** The state this browser's cookie holds: set when the attempt began. */
        public readonly cookieState: string | undefined,
        public readonly client: { ip: string; userAgent?: string }
    ) {}
}
