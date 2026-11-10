import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { Logger as PinoLogger } from 'nestjs-pino'
import request from 'supertest'
import { ChannelLayoutController } from '@/modules/servers/presentation/http/channel-layout.controller'
import { InvitesController } from '@/modules/servers/presentation/http/invites.controller'
import { ServersController } from '@/modules/servers/presentation/http/servers.controller'
import { DomainExceptionFilter } from '@/shared/presentation/filters/domain-exception.filter'
import { GlobalExceptionFilter } from '@/shared/presentation/filters/global-exception.filter'
import { SnakeToCamelPipe, createValidationPipe } from '@/shared/presentation/pipes'

/**
 * A write answers with the server as the list shows it, read after the
 * command (D-159). When that read finds nothing, the server went between the
 * two (deleted, or the caller lost access): the answer is a 404, never a
 * 500 from presenting a server that is not there. Each controller that reads
 * after a write has a case here.
 */
describe('Servers write then read (e2e)', () => {
    let app: INestApplication
    const commandBus = { execute: jest.fn() }
    // The read after the write finds no server.
    const queryBus = { execute: jest.fn().mockResolvedValue([]) }

    beforeAll(async () => {
        const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() }
        const moduleRef = await Test.createTestingModule({
            controllers: [ServersController, ChannelLayoutController, InvitesController],
            providers: [
                { provide: CommandBus, useValue: commandBus },
                { provide: QueryBus, useValue: queryBus },
                { provide: PinoLogger, useValue: logger }
            ]
        }).compile()

        app = moduleRef.createNestApplication()
        // What the access-token guard would attach: a signed-in user.
        app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
            req.user = { id: 'user-1', sessionId: 'session-1' }
            next()
        })
        app.useGlobalPipes(new SnakeToCamelPipe(), createValidationPipe())
        app.useGlobalFilters(
            new GlobalExceptionFilter(moduleRef.get(PinoLogger)),
            new DomainExceptionFilter(moduleRef.get(PinoLogger))
        )
        await app.init()
    })

    afterAll(async () => {
        await app?.close()
    })

    it('answers 404 when the new server is gone before it is read back', async () => {
        commandBus.execute.mockResolvedValueOnce({ serverId: 'server-1' })

        const res = await request(app.getHttpServer())
            .post('/servers')
            .send({ name: 'Study group', template: 'study' })
            .expect(404)

        expect(res.body.meta.type).toBe('NOT_FOUND_ERROR')
    })

    it('answers 404 when the changed server is gone before it is read back', async () => {
        commandBus.execute.mockResolvedValueOnce(undefined)

        const res = await request(app.getHttpServer())
            .patch('/servers/0b6f3c3e-8d5f-4b2a-9a51-3f1f2f6c7d10')
            .send({ name: 'Study group' })
            .expect(404)

        expect(res.body.meta.type).toBe('NOT_FOUND_ERROR')
    })

    it('answers 404 when the server is gone before its new channel layout is read back', async () => {
        commandBus.execute.mockResolvedValueOnce(undefined)

        const res = await request(app.getHttpServer())
            .patch('/servers/0b6f3c3e-8d5f-4b2a-9a51-3f1f2f6c7d10/categories/5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f')
            .send({ name: 'Notes' })
            .expect(404)

        expect(res.body.meta.type).toBe('NOT_FOUND_ERROR')
    })

    it('answers 404 when the joined server is gone before it is read back', async () => {
        commandBus.execute.mockResolvedValueOnce({ serverId: 'server-1', decision: 'join' })

        const res = await request(app.getHttpServer()).post('/invites/aB3dE5fG/accept').expect(404)

        expect(res.body.meta.type).toBe('NOT_FOUND_ERROR')
    })
})
