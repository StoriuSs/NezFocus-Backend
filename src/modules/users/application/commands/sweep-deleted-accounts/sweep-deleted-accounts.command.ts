export class SweepDeletedAccountsCommand {
    constructor(
        public readonly now: Date,
        /** Personal data of accounts deleted longer ago than this is erased. */
        public readonly retentionDays: number
    ) {}
}
