import { EventBus } from '@nestjs/cqrs'
import { TypingSignalledEvent } from '../../events/typing-signalled.event'
import { ReportTypingCommand } from './report-typing.command'
import { ReportTypingHandler } from './report-typing.handler'

describe('A tab typing (REQ-MSG-06)', () => {
    it('is handed on to messaging as it came: typing is its own', async () => {
        const events = { publish: jest.fn() }
        await new ReportTypingHandler(events as unknown as EventBus).execute(new ReportTypingCommand('an', 's1', 'c1'))
        expect(events.publish).toHaveBeenCalledWith(new TypingSignalledEvent('an', 's1', 'c1'))
    })
})
