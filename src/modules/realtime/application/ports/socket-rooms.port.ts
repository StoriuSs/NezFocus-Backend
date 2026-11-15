/**
 * Socket Rooms Port: moves sockets that are already connected between rooms
 * when what their person may see changes (SRS 5.2, D-178). A socket is put
 * in its rooms when it connects (OpenConnection); this keeps them right
 * afterwards. Reaches every app instance through the socket.io Redis adapter.
 */
export interface SocketRoomsPort {
    /** The people with at least one socket in the room, each once. */
    usersIn(room: string): Promise<string[]>
    /** Every socket of one person: out of `leave`, then into `join`. */
    move(userId: string, leave: string[], join: string[]): Promise<void>
}

export const SOCKET_ROOMS = Symbol('SocketRoomsPort')
