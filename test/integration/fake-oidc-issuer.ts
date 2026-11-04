import { createHash, randomBytes } from 'crypto'
import { createServer, IncomingMessage, Server } from 'http'
import { AddressInfo } from 'net'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose'

/** Who "signed in" at the fake provider. */
export interface FakeIdentity {
    sub: string
    email?: string
    email_verified?: boolean
    name?: string
}

interface IssuedCode {
    identity: FakeIdentity
    nonce: string
    challenge: string
    redirectUri: string
    used: boolean
}

/**
 * A small OpenID Connect provider for tests: discovery, JWKS, and a token
 * endpoint that checks what Google's does — the client's secret, the code
 * (once), the redirect URI it was issued for, and PKCE — then signs an ID
 * token. There is no login page: `approve()` plays the person signing in, given
 * the authorization URL the app redirected to, and returns the code.
 *
 * The app's real adapter (openid-client) talks to it over HTTP, so a test
 * through it exercises the same checks a real sign-in does.
 */
export class FakeOidcIssuer {
    readonly clientId = 'itest-client'
    readonly clientSecret = `itest-secret-${randomBytes(8).toString('hex')}`
    private server!: Server
    private privateKey!: CryptoKey
    private publicJwk!: Record<string, unknown>
    private codes = new Map<string, IssuedCode>()
    url!: string

    /** Test knobs for the next ID tokens. */
    tamper: { nonce?: string; audience?: string; signWith?: CryptoKey } = {}

    async start(): Promise<void> {
        const { privateKey, publicKey } = await generateKeyPair('RS256')
        this.privateKey = privateKey
        this.publicJwk = { ...(await exportJWK(publicKey)), kid: 'itest-key', alg: 'RS256', use: 'sig' }
        this.server = createServer((req, res) => {
            this.handle(req)
                .then(({ status, body }) => {
                    res.writeHead(status, { 'content-type': 'application/json' })
                    res.end(JSON.stringify(body))
                })
                .catch((error: Error) => {
                    res.writeHead(500, { 'content-type': 'application/json' })
                    res.end(JSON.stringify({ error: 'server_error', error_description: error.message }))
                })
        })
        await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
        this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
    }

    async stop(): Promise<void> {
        this.server.closeAllConnections()
        await new Promise((resolve) => this.server.close(resolve))
    }

    /** The person signs in and agrees: returns the code the provider would send back. */
    approve(authorizationUrl: string, identity: FakeIdentity): string {
        const url = new URL(authorizationUrl)
        if (`${url.origin}${url.pathname}` !== `${this.url}/authorize`) throw new Error('not our authorization URL')
        const param = (name: string) => {
            const value = url.searchParams.get(name)
            if (!value) throw new Error(`authorization URL without ${name}`)
            return value
        }
        if (param('client_id') !== this.clientId) throw new Error('wrong client_id')
        if (param('code_challenge_method') !== 'S256') throw new Error('PKCE must be S256')
        if (!param('scope').split(' ').includes('openid')) throw new Error('not an OpenID request')
        const code = randomBytes(16).toString('hex')
        this.codes.set(code, {
            identity,
            nonce: param('nonce'),
            challenge: param('code_challenge'),
            redirectUri: param('redirect_uri'),
            used: false
        })
        return code
    }

    /** A key the app has never seen, for a forged ID token. */
    async strangerKey(): Promise<CryptoKey> {
        return (await generateKeyPair('RS256')).privateKey
    }

    private async handle(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
        const path = new URL(req.url ?? '/', this.url).pathname
        if (req.method === 'GET' && path === '/.well-known/openid-configuration') {
            return {
                status: 200,
                body: {
                    issuer: this.url,
                    authorization_endpoint: `${this.url}/authorize`,
                    token_endpoint: `${this.url}/token`,
                    jwks_uri: `${this.url}/jwks`,
                    response_types_supported: ['code'],
                    subject_types_supported: ['public'],
                    id_token_signing_alg_values_supported: ['RS256'],
                    code_challenge_methods_supported: ['S256'],
                    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
                }
            }
        }
        if (req.method === 'GET' && path === '/jwks') return { status: 200, body: { keys: [this.publicJwk] } }
        if (req.method === 'POST' && path === '/token') return this.token(req)
        return { status: 404, body: { error: 'not_found' } }
    }

    private async token(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
        const form = new URLSearchParams(await readBody(req))
        const refuse = (error: string) => ({ status: 400, body: { error } })

        const [basicId, basicSecret] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64')
            .toString()
            .split(':')
            .map((part) => decodeURIComponent(part))
        const clientId = form.get('client_id') ?? basicId
        const clientSecret = form.get('client_secret') ?? basicSecret
        if (clientId !== this.clientId || clientSecret !== this.clientSecret) return refuse('invalid_client')

        const issued = this.codes.get(form.get('code') ?? '')
        if (form.get('grant_type') !== 'authorization_code' || !issued || issued.used) return refuse('invalid_grant')
        issued.used = true
        if (form.get('redirect_uri') !== issued.redirectUri) return refuse('invalid_grant')
        const verifier = form.get('code_verifier') ?? ''
        if (createHash('sha256').update(verifier).digest('base64url') !== issued.challenge)
            return refuse('invalid_grant')

        const idToken = await new SignJWT({
            ...issued.identity,
            nonce: this.tamper.nonce ?? issued.nonce
        })
            .setProtectedHeader({ alg: 'RS256', kid: 'itest-key' })
            .setIssuer(this.url)
            .setAudience(this.tamper.audience ?? this.clientId)
            .setSubject(issued.identity.sub)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(this.tamper.signWith ?? this.privateKey)
        return {
            status: 200,
            body: {
                access_token: randomBytes(16).toString('hex'),
                token_type: 'Bearer',
                expires_in: 3600,
                id_token: idToken
            }
        }
    }
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = ''
        req.on('data', (chunk: Buffer) => (body += chunk.toString()))
        req.on('end', () => resolve(body))
        req.on('error', reject)
    })
}
