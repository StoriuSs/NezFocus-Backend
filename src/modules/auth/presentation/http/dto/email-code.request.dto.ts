import type { EmailLanguage } from '@/modules/auth/application/ports'
import { EmailField, IsEmailLanguage } from './shared/fields.dto'

/** POST /auth/email-code: the address to send a sign-in code to. */
export class EmailCodeRequestDto extends EmailField {
    @IsEmailLanguage()
    language?: EmailLanguage
}
