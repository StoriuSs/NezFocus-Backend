import { IsString, MaxLength } from 'class-validator'
import { MessageIdParamsDto } from './message-id.params.dto'

/** `/messages/{message_id}/reactions/{emoji}`: that the emoji is one standard emoji is the handler's check (SRS 1.71). */
export class ReactionParamsDto extends MessageIdParamsDto {
    /**
     * The longest standard emoji (a family with skin tones) is well under
     * this. Checked before the handler, so a forged longer one is refused
     * even from someone timed out.
     */
    @IsString()
    @MaxLength(64)
    emoji: string
}
