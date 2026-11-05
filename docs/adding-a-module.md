# Adding a module

The starter ships two feature modules: `users`, small enough to read in one
sitting, and `auth`, the same shape at full size. This page builds a third one
— `orders` — so you can see every layer filled in once, in order, with the
reasoning at each step.

If you only need one more endpoint on a module that already exists, skip to
[Adding one operation](#adding-one-operation) at the end.

- [Before you start](#before-you-start)
- [1. The database](#1-the-database)
- [2. The domain](#2-the-domain)
- [3. The application layer](#3-the-application-layer)
- [4. The infrastructure layer](#4-the-infrastructure-layer)
- [5. The presentation layer](#5-the-presentation-layer)
- [6. Wire it up](#6-wire-it-up)
- [7. Test it](#7-test-it)
- [Names and places](#names-and-places)
- [Adding one operation](#adding-one-operation)
- [Common mistakes](#common-mistakes)

## Before you start

Read [hexagonal-architecture.md](./hexagonal-architecture.md) and
[cqrs-guide.md](./cqrs-guide.md) if the words *port*, *adapter* and *command
handler* are not yet familiar. This page assumes them.

Keep `src/modules/users/` open in another window. Every step below has an
equivalent there, and copying a working file beats typing one from a guide.

When your module grows past a handful of operations, look at
`src/modules/auth/` too. It shows what `users` is too small to: a port with
several adapters behind it (`OAUTH_PROVIDERS`, one per sign-in provider),
shared steps pulled into `application/services/` instead of copied between
handlers, and how one module uses another without importing its insides: auth
imports only what `src/modules/users/index.ts` publishes — the
`USER_DIRECTORY` port, two events, a command and `normaliseEmail`
([auth/in-the-code.md](./auth/in-the-code.md)).

The order matters: **inside out**. The domain first, the HTTP last. Starting
at the controller is how you end up with business rules that only exist inside
a request.

## 1. The database

Prisma models live in one file per module, under `prisma/models/`
(`users.prisma` holds one model, `auth.prisma` seven):

```prisma
// prisma/models/orders.prisma
model Order {
  id         String      @id @default(uuid())
  userId     String
  status     OrderStatus @default(PENDING)
  totalMinor Int         // money in the smallest unit
  createdAt  DateTime    @default(now())
  deletedAt  DateTime?

  user       User        @relation(fields: [userId], references: [id])

  @@index([userId, createdAt])
}

enum OrderStatus {
  PENDING
  PAID
  CANCELLED
}
```

Then:

```bash
pnpm prisma:migrate     # creates the migration and applies it
```

Three conventions worth copying: **names as Prisma writes them** — the
existing tables are `"User"`, `"Session"` and so on with camelCase columns,
so a new one without `@map`/`@@map` matches them (if you want snake_case,
change every model at once, not one); **`deletedAt`** if rows must survive
deletion for business reasons (see [account-deletion.md](./account-deletion.md));
and **money as an integer in the smallest unit** — never a float.

→ [prisma-module.md](./prisma-module.md)

## 2. The domain

The heart, and the only layer that is allowed to know nothing.

```
src/modules/orders/domain/
├── entities/order.entity.ts
├── errors/order.errors.ts          # one file per topic, with errors/index.ts
├── ports/order.repository.port.ts  # the repository port lives here, not in application/
└── index.ts
```

**The entity** carries the rules that are true regardless of where the data is
stored. It takes one object, as `UserEntity` does, so adding a field later
does not reorder every call:

```typescript
// The domain's own type: never Prisma's OrderStatus enum, even though it has the same values.
export type OrderStatus = 'PENDING' | 'PAID' | 'CANCELLED'

export class OrderEntity {
    readonly id: string
    readonly userId: string
    status: OrderStatus
    readonly totalMinor: number
    readonly createdAt: Date

    constructor(props: { id: string; userId: string; status: OrderStatus; totalMinor: number; createdAt: Date }) {
        this.id = props.id
        this.userId = props.userId
        this.status = props.status
        this.totalMinor = props.totalMinor
        this.createdAt = props.createdAt
    }

    /** A paid order is final: refunds are a new transaction, not an edit. */
    canBeCancelled(): boolean {
        return this.status === 'PENDING'
    }
}
```

No decorators, no Prisma types, no `@nestjs/*` import. If you need one, the
logic belongs in a different layer. The mapper turns Prisma's row, enum
included, into this.

**Errors** extend `DomainError` and declare a `kind` and an `errorKey`. That is
all the mapping there is — no filter to register, no status code in the
domain:

```typescript
import { DomainError } from '@/shared/domain'

export class OrderNotFoundError extends DomainError {
    readonly kind = 'not_found'               // → 404
    readonly errorKey = 'ORDER_NOT_FOUND'     // → meta.code and meta.type
    constructor(id: string) {
        super(`Order ${id} was not found`)
    }
}
```

`errorKey` must exist in both `ERROR_CODES` and `ERROR_TYPES`
(`src/shared/constants/error-response.ts`), or the class does not compile. Add
it there first, under the same key in both:

```typescript
// ERROR_TYPES
ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
// ERROR_CODES: the HTTP status, then a number in the module's own hundred
ORDER_NOT_FOUND: '404300',
```

A code is the HTTP status and three digits. A new code takes its module's
hundred: auth's are `x1xx`, users' `x2xx`, shared ones `x0xx`, so `orders`
takes `x3xx` (`404300`, then `409300`, ...). Most existing codes are older
than that rule and were numbered in turn under their status, auth's
`401001`–`401009` and `403002`–`403005` and `USER_NOT_FOUND` `404001`
among them. They keep their numbers: a code keeps one meaning for ever, in logs
and support tickets. For the same reason, never reuse a retired one (they are
listed above `ERROR_CODES`).

| `kind` | Status |
| --- | --- |
| `invalid` | 400 |
| `unauthenticated` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `unprocessable` | 422 |
| `rate_limited` | 429, with `Retry-After` from `retryAfterSeconds` |
| `unavailable` | 503 |

An optional `details` object is added to the answer's `data`
([BACKEND_RESPONSE_HANDLING.md](./BACKEND_RESPONSE_HANDLING.md#throwing-errors-from-a-module-domainerror)).

**The repository port** is an interface plus a symbol to inject it by:

```typescript
export const ORDER_REPOSITORY = Symbol('OrderRepositoryPort')

export interface OrderRepositoryPort {
    findById(id: string): Promise<OrderEntity | null>
    findByUser(userId: string): Promise<OrderEntity[]>
    create(data: { userId: string; totalMinor: number }): Promise<OrderEntity>
    markPaid(id: string): Promise<OrderEntity | null>
}
```

Write the methods your use cases need, in the language of the domain. Not
`findMany(where)` — that is Prisma's vocabulary leaking through a hole you
made yourself.

## 3. The application layer

One folder per thing the application can do.

```
src/modules/orders/application/
├── commands/place-order/
│   ├── place-order.command.ts
│   └── place-order.handler.ts
├── queries/get-order/
│   ├── get-order.query.ts
│   └── get-order.handler.ts
├── events/
│   ├── order-placed.event.ts   # events this module publishes
│   └── handlers/               # one handler per file, for any module's events
├── ports/                      # ports this module needs beyond its repository
└── index.ts
```

**A command** is a plain data class — the intent, nothing else:

```typescript
export class PlaceOrderCommand {
    constructor(
        readonly userId: string,
        readonly totalMinor: number
    ) {}
}
```

**A handler** orchestrates. It depends only on ports:

```typescript
@CommandHandler(PlaceOrderCommand)
export class PlaceOrderHandler implements ICommandHandler<PlaceOrderCommand> {
    constructor(
        @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepositoryPort,
        private readonly eventBus: EventBus
    ) {}

    async execute(command: PlaceOrderCommand): Promise<OrderEntity> {
        const order = await this.orders.create({
            userId: command.userId,
            totalMinor: command.totalMinor
        })

        // Not awaited: whoever listens must not be able to fail this command.
        this.eventBus.publish(new OrderPlacedEvent(order.id, order.userId))
        return order
    }
}
```

**Events** are how something else happens without this handler knowing about
it. Sending a confirmation email is an event handler, not three more lines
here. Two rules that are not optional:

- **A failed event handler is not retried.** The event bus catches the
  error, logs it and reports it to error tracking (`CqrsObservabilityModule`),
  and the command that published the event has already returned: the work is
  simply lost. Catch what the handler can deal with itself; for work that must
  happen, queue a job, which is retried.
- **Publishing is not a transaction.** A crash between the write and the
  publish loses the event. If that matters, add a sweep that finds the work
  that never happened. The auth module's hourly clean-up does exactly that
  for account deletion: it ends the sessions and removes the passwords and
  Google links of deleted accounts whose `AccountDeletedEvent` was lost
  ([account-deletion.md](./account-deletion.md)). Or read the
  [outbox section](./extensions.md#transactional-outbox).

**Extra ports** go here, not in the domain, when the *use case* needs
something the domain does not: sending mail, queuing a job, calling a payment
provider. `users` keeps `storage`, `background-jobs` and `user-directory`
here for that reason; `auth` keeps nine (`auth-mailer`, `rate-limit`,
`oauth-provider`, ...).

## 4. The infrastructure layer

The real implementations.

```
src/modules/orders/infrastructure/
├── persistence/prisma-order.repository.ts
├── mappers/order.mapper.ts
├── adapters/                   # one per application port: <what>.adapter.ts
└── index.ts
```

```typescript
@Injectable()
export class PrismaOrderRepository implements OrderRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async findById(id: string): Promise<OrderEntity | null> {
        const row = await this.prisma.order.findFirst({ where: { id, deletedAt: null } })
        return row ? OrderMapper.toDomain(row) : null
    }
}
```

**The mapper is not ceremony.** It is the seam: the database row and the
domain entity are allowed to be different shapes, and change independently,
precisely because something translates between them.

**Filter soft-deleted rows in every read *and* every update.** Excluding them
from reads but not writes means a caller holding a stale id can still mutate a
deleted record.

## 5. The presentation layer

The edge: HTTP in, and queue workers.

```
src/modules/orders/presentation/
├── http/
│   ├── orders.controller.ts
│   └── dto/
│       ├── place-order.request.dto.ts
│       ├── order.response.dto.ts
│       └── index.ts
└── index.ts
```

```typescript
@ApiTags('orders')
@ApiBearerAuth('bearer')
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
    constructor(private readonly commandBus: CommandBus) {}

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @Idempotent('1h')
    @ApiEnvelopeResponse(OrderResponseDto)
    async place(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: PlaceOrderRequestDto
    ) {
        const order = await this.commandBus.execute(
            new PlaceOrderCommand(user.id, dto.totalMinor)
        )
        return createResponse('Order placed', validateAndTransform(OrderResponseDto, order))
    }
}
```

The controller reads user input, calls one handler, and shapes the answer.
That is the whole job. Anything else here is business logic in the wrong
place.

**One controller per topic, not per module.** A module with a dozen routes
or more splits them by what a person is doing, each controller with the same
`path`, so the URLs don't change: auth has five
([in-the-code.md](./auth/in-the-code.md#the-controllers)), one for signing in,
one for passwords, and so on. No rule caps a file's length; a controller of
twenty routes is hard to read because finding one route means scrolling
past the others. What the controllers share (cookies, small helpers) goes in
a file beside them, not in a base class.

**A route with a parameter where the others have a word** (`GET orders/:id`
beside `GET orders/summary`) must come after them. Express takes the first
route that matches, in the order they were registered: methods in the order
of the file, controllers in the order of the module's `controllers`. If
`orders/:id` comes first, `GET orders/summary` is a request for the order
with id "summary". Put such routes last, and when they are in a controller of
their own, list it last and say why beside the list, as auth does with
`AUTH_CONTROLLERS`; a test that calls the fixed routes keeps it so.

**DTOs are the contract**, and they are what generates the OpenAPI document:

```typescript
export class PlaceOrderRequestDto {
    @ApiProperty({ example: 2500, description: 'Total in the smallest currency unit' })
    @IsInt()
    @Min(1)
    totalMinor: number
}
```

Unknown fields are rejected globally, so anything not declared here is a 422
rather than a silent drop. Remember the wire is `snake_case`: a client sends
`total_minor`.

**`@Idempotent`** belongs on anything a user could trigger twice — a double
tap, a retry, a flaky connection. Placing an order is the textbook case
([idempotency.md](./idempotency.md)).

## 6. Wire it up

The module file is where ports meet adapters. Nothing else in the application
knows which implementation it gets:

```typescript
@Module({
    imports: [CqrsModule],
    controllers: [OrdersController],
    providers: [
        { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
        PlaceOrderHandler,
        GetOrderHandler,
        NotifyOnOrderPlacedHandler
    ]
})
export class OrdersModule {}
```

Then add `OrdersModule` to the `imports` of `src/app.module.ts`, and the
routes exist.

**What other modules may use** goes in `src/modules/orders/index.ts`, and
nothing else: a port, an event, a command another module sends. Add
`'orders'` to `MODULES` at the top of `eslint.config.mjs` and a deep import into
the module from another one (`@/modules/orders/application/...`) becomes a
lint error. Its insides then stay free to move.

The rule covers `src/modules` only. `src/app.module.ts`, `src/maintenance`
and the CLIs in `src/bootstrap` are where modules are wired together, and a
CLI builds the adapters it needs itself, without Nest: they may reach in.
Moving a file a CLI imports means updating that CLI.

Swapping Postgres for something else is now one line in this file. That is the
entire payoff of the ports, and it is also why testing a handler needs no
database.

## 7. Test it

Three levels, and the first is where most of the value is:

```bash
pnpm test              # unit: handlers with mocked ports. Fast, no services.
pnpm test:e2e          # the HTTP edge, in memory
pnpm test:services:up && pnpm test:integration   # against real Postgres and Redis
```

A handler test needs no database, which is the point:

```typescript
const orders = { create: jest.fn().mockResolvedValue(anOrder) }
const handler = new PlaceOrderHandler(orders as never, eventBus as never)

await handler.execute(new PlaceOrderCommand('user-1', 2500))

expect(orders.create).toHaveBeenCalledWith({ userId: 'user-1', totalMinor: 2500 })
```

Write the test for the rule, not for the framework. "A paid order cannot be
cancelled" is worth a test forever; "the controller calls the command bus" is
worth one once.

→ [testing.md](./testing.md)

## Names and places

Both modules follow these, so a file is where you expect it:

| What | Where, and named |
| --- | --- |
| Entity | `domain/entities/<name>.entity.ts` |
| Domain rules | Pure functions and constants beside the entities, `domain/<topic>.ts`: users' `username.rules.ts`, auth's `password-policy.ts`, `session-end.ts` |
| Domain errors | `domain/errors/<topic>.errors.ts`, classes named `<Something>Error` (not `Exception`: in Nest that is an `HttpException`) |
| Repository port | `domain/ports/<name>.repository.port.ts` |
| Other ports | `application/ports/<name>.port.ts` |
| Command | `application/commands/<name>/<name>.command.ts` and `<name>.handler.ts`, the folder named after the command: `PlaceOrderCommand` → `place-order/` |
| Query | `application/queries/<name>/<name>.query.ts` and `<name>.handler.ts` |
| Event, event handler | `application/events/<name>.event.ts`; `application/events/handlers/<name>.handler.ts`, one per file |
| Shared steps | `application/services/` |
| Settings | Tunables the handlers need, read once from config: an interface and a token in `application/<module>-settings.ts` (`AuthSettings`, `AUTH_SETTINGS`), provided by the module file with `useFactory` |
| Repository | `infrastructure/persistence/prisma-<name>.repository.ts` |
| Mapper | `infrastructure/mappers/<name>.mapper.ts`: the Prisma row to the entity and back, used by the repository |
| Other adapter | `infrastructure/adapters/<what>.adapter.ts`; the class named for its technology and role, no suffix: `BullMqAuthMailer`, `Argon2PasswordHasher`, `UploadStorage`. A helper several adapters share sits beside them without the suffix (auth's `cache-keys.ts`) |
| Controller | `presentation/http/<topic>.controller.ts`, `<Topic>Controller`: the module's name for its main one (`orders.controller.ts`), a topic for the others (`password.controller.ts`). What several share sits beside them without the suffix (auth's `auth-cookies.ts`) |
| Queue consumer | `presentation/consumers/<name>.consumer.ts`: an inbound adapter, like a controller, for jobs the module itself queues. A job on a schedule is not one of these (below) |
| DI token | The port's role in capitals, no suffix: `ORDER_REPOSITORY`, `AUTH_MAILER`, `STORAGE`. Its `Symbol` description is the port's name, `Symbol('OrderRepositoryPort')` |
| Emails | `infrastructure/email/<module>-emails.ts` (each email's subject and context, sent through shared's `EmailService`) and `templates/*.hbs` beside it ([core-infrastructure.md](./core-infrastructure.md#a-modules-emails)) |
| A job on a schedule | a command of the module's, exported from its `index.ts`, and a line in `src/maintenance/maintenance-tasks.ts` saying how often ([core-infrastructure.md](./core-infrastructure.md#scheduled-work)) |
| DTO | `presentation/http/dto/<name>.request.dto.ts`, `<name>.response.dto.ts`, `<name>.params.dto.ts` or `<name>.query.dto.ts`: one class per file, a response shared by several routes included. Base classes in `dto/shared/`, in a file ending `.dto.ts` (the Swagger plugin reads only those) |
| Barrels | an `index.ts` in every layer and in `dto/`; the module's own `index.ts` for other modules |

## Adding one operation

To an existing module, the short version:

1. **A command or query class** in `application/commands/<name>/` or
   `application/queries/<name>/`.
2. **A handler** beside it, depending only on ports.
3. **Register the handler** in that module's provider list.
4. **A DTO** in `presentation/http/dto/` for the request
   (`<name>.request.dto.ts`), and one for the response if the shape is new
   (`<name>.response.dto.ts`), both exported from `dto/index.ts`.
5. **A controller method** — decorators, one bus call, `createResponse` —
   in the controller of its topic.
6. **`pnpm openapi:export`** so the committed contract matches, and a test.

If you find yourself adding a sixth argument to an existing command rather
than writing a new one, that is usually two operations wearing a coat.

## Common mistakes

**A Prisma type in the domain.** The moment `domain/` imports from
`@/generated/prisma`, the database has leaked into the business rules and the
layers stop meaning anything. The mapper exists to prevent exactly this.

**A repository method named after a query.** `findMany(where)` is Prisma's
vocabulary. `findPendingForUser(userId)` is yours, and it is the one that
still makes sense after you change database.

**Business logic in the controller.** If it contains `if` about anything but
the shape of the input, it belongs in a handler.

**A new response shape built by hand.** Use `createResponse` and
`@ApiEnvelopeResponse`, or the envelope drifts and the OpenAPI document starts
lying.

**Forgetting `validateAndTransform` on the way out.** It is what guarantees
the response matches the DTO the specification promises.

**A new environment variable in only one place.** It goes in `.env.example`,
in `validation.ts`, and in the `*.config.ts` that reads it — a test fails if
you miss one ([environment.md](./environment.md#adding-a-variable)).

**Work that must happen, done in an event handler.** A failure there is
reported but never retried. Queue a job instead, or add a sweep that finds what
was missed.

## Related

- [hexagonal-architecture.md](./hexagonal-architecture.md) — the layers in full
- [cqrs-guide.md](./cqrs-guide.md) — commands, queries and events
- [OVERVIEW.md](../OVERVIEW.md) — where this fits in the whole
- [auth/in-the-code.md](./auth/in-the-code.md) — the larger module, file by file
- [common-utilities.md](./common-utilities.md) — what the shared layer already gives you
