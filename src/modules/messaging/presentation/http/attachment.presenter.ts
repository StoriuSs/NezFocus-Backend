import { validateAndTransform } from '@/shared/utils'
import { UploadTicket } from '../../application'
import { UploadTicketResponseDto } from './dto'

/**
 * The form's fields leave as a list of names and values: the answer's keys
 * are turned to snake_case on the way out, which would break the storage's
 * own names (`X-Amz-Signature`).
 */
export function presentUploadTicket(ticket: UploadTicket): UploadTicketResponseDto {
    return validateAndTransform(UploadTicketResponseDto, {
        attachmentId: ticket.attachmentId,
        upload: {
            url: ticket.upload.url,
            fields: Object.entries(ticket.upload.fields).map(([name, value]) => ({ name, value }))
        },
        expiresAt: ticket.expiresAt
    })
}
