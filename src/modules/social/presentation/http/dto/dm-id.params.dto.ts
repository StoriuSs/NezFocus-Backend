import { IsUUID } from 'class-validator'

export class DmIdParamsDto {
    /** The DM's channel id: its messages go through the channel routes (D-238). */
    @IsUUID()
    dmId: string
}
