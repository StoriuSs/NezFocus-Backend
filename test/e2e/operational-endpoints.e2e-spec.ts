import { Test } from '@nestjs/testing'
import { Controller, Get, INestApplication } from '@nestjs/common'
import request from 'supertest'
import { mountApiDocs } from '@/bootstrap/operational-endpoints'

@Controller('things')
class ThingsController {
    @Get()
    list() {
        return []
    }
}

const credentials = { user: 'ops', password: 'k3Q9-vT7w-pL2x' }

/**
 * The API docs are mounted on raw Express, so nothing but the middleware in
 * mountApiDocs protects them. Basic auth used to be registered after
 * SwaggerModule.setup — Express answered from Swagger's handlers first, and
 * the docs were public in production. The JSON and YAML specs are siblings of
 * /api-docs, so a mount on /api-docs alone left them public too.
 */
describe('API docs protection (e2e)', () => {
    let app: INestApplication

    afterAll(async () => {
        await app?.close()
    })

    it('asks for credentials on every docs URL when protected, and refuses wrong ones', async () => {
        const moduleRef = await Test.createTestingModule({ controllers: [ThingsController] }).compile()
        app = moduleRef.createNestApplication()
        mountApiDocs(app, 'Test', credentials)
        await app.init()
        const server = app.getHttpServer()

        for (const url of ['/api-docs', '/api-docs/', '/api-docs-json', '/api-docs-yaml']) {
            const res = await request(server).get(url)
            expect({ url, status: res.status }).toEqual({ url, status: 401 })
        }
        await request(server).get('/api-docs-json').auth(credentials.user, 'wrong').expect(401)
        await request(server).get('/api-docs-json').auth(credentials.user, credentials.password).expect(200)
    })
})
