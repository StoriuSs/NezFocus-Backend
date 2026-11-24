/*
 * Direct messages (REQ-SOCIAL-04, D-238, D-244): opening one with someone,
 * and closing one on my side. Their messages go through messaging's routes.
 */

/** Open my DM with someone, made if there is none (`POST /me/dms`); answers its channel. */
export class OpenDmCommand {
    constructor(
        readonly userId: string,
        readonly otherId: string
    ) {}
}

/** Close a DM of mine on my side (`DELETE /me/dms/{id}`); a new message shows it again. */
export class CloseDmCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string
    ) {}
}
