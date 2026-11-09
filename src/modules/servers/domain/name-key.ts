/**
 * What two names are compared by when they must not repeat (category, channel
 * and role names; D-84, D-87): composed, then lower case. "Phòng Ôn" and
 * "phòng ôn" are the same name; "bàn" and "bạn" are not, since the accents
 * stay. Stored in `nameKey` beside the name, so the unique index does the
 * comparing (see prisma/models/servers.prisma).
 */
export function nameKey(name: string): string {
    return name.normalize('NFC').toLowerCase()
}
