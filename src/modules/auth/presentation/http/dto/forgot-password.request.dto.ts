import type { EmailLanguage } from '@/modules/auth/application/ports'
import { EmailField, IsEmailLanguage } from './shared/fields.dto'

export class ForgotPasswordRequestDto extends EmailField {
    @IsEmailLanguage()
    language?: EmailLanguage
}
