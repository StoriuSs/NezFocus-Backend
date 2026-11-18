/**
 * The people of these voice rooms (D-205), for the rooms in `GET /servers`:
 * asked by servers through ROOM_PEOPLE. Whoever asks has already decided
 * the rooms may be shown.
 */
export class ListRoomPeopleQuery {
    constructor(public readonly channelIds: string[]) {}
}
