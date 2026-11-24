/*
 * A person's card, as adding a friend shows it (D-110) and their profile
 * outside a server (D-109, D-111): who they are, where we stand, the servers
 * we share.
 */

/** Look someone up by username before asking them (`GET /users/lookup`, 30 a minute). */
export class LookUpPersonQuery {
    constructor(
        readonly userId: string,
        readonly username: string
    ) {}
}

/** Someone's profile (`GET /users/{id}/profile`). */
export class GetPersonProfileQuery {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}
