<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [CQRS in NestJS: A Beginner's Guide](#cqrs-in-nestjs-a-beginners-guide)
  - [Table of Contents](#table-of-contents)
  - [What is CQRS?](#what-is-cqrs)
  - [Why use CQRS?](#why-use-cqrs)
  - [Core Concepts](#core-concepts)
    - [Commands vs Queries](#commands-vs-queries)
    - [The Buses (CommandBus & QueryBus)](#the-buses-commandbus--querybus)
    - [Handlers](#handlers)
  - [Domain Events & Side Effects](#domain-events--side-effects)
    - [What is an Event?](#what-is-an-event)
    - [The EventBus and Publisher](#the-eventbus-and-publisher)
    - [Why use Events for Side Effects?](#why-use-events-for-side-effects)
  - [Full Flow Example: Updating a Profile](#full-flow-example-updating-a-profile)
      - [1. The Controller (Inbound Adapter)](#1-the-controller-inbound-adapter)
      - [2. The Command Bus (The Postman)](#2-the-command-bus-the-postman)
      - [3. The Command Handler (Business Logic)](#3-the-command-handler-business-logic)
      - [4. The Event Bus (The Broadcaster)](#4-the-event-bus-the-broadcaster)
      - [5. The Event Handler (Side Effect)](#5-the-event-handler-side-effect)
      - [Summary of the Flow:](#summary-of-the-flow)
  - [FAQ](#faq)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# CQRS in NestJS: A Beginner's Guide

## Table of Contents
1. [What is CQRS?](#what-is-cqrs)
2. [Why use CQRS?](#why-use-cqrs)
3. [Core Concepts](#core-concepts)
    - [Commands vs Queries](#commands-vs-queries)
    - [The Buses (CommandBus & QueryBus)](#the-buses-commandbus--querybus)
    - [Handlers](#handlers)
4. [Domain Events & Side Effects](#domain-events--side-effects)
    - [What is an Event?](#what-is-an-event)
    - [The EventBus and Publisher](#the-eventbus-and-publisher)
    - [Why use Events for Side Effects?](#why-use-events-for-side-effects)
5. [Full Flow Example: Updating a Profile](#full-flow-example-updating-a-profile)
6. [FAQ](#faq)
---

## What is CQRS?

**CQRS** stands for **Command Query Responsibility Segregation**. 

In traditional architecture, you usually have a "Service" class (e.g., `UsersService`) that handles everything: creating users, updating users, fetching users, and deleting users. 

CQRS says: **"Stop putting all operations in one big box."**

Instead, it strictly separates your code into two distinct paths:
1. **Commands (Writes):** Operations that *change* data (Create, Update, Delete).
2. **Queries (Reads):** Operations that just *read* data (Get, List, Search).

## Why use CQRS?

If you separate reads from writes, your app becomes much easier to maintain and scale:
* **Single Responsibility:** Instead of a 1000-line `UsersService`, you have many small files, each doing exactly one thing (e.g., `UploadAvatarHandler`, `CheckUsernameHandler`).
* **Performance:** Reading data is fundamentally different from writing data. You can optimize them separately (e.g., reading from a fast Redis cache, writing to a secure PostgreSQL database).
* **Testability:** Tiny, focused handlers are incredibly easy to write unit tests for.

---

## Core Concepts

To understand how CQRS works in our NestJS app, you need to know a few building blocks provided by the `@nestjs/cqrs` package.

### Commands vs Queries

- **Command:** A simple class containing the data needed to make a change. It has no logic.
  *Example: "I want to update user 123's displayName to 'John'."*
  ```typescript
  export class UpdateProfileCommand {
      constructor(
          public readonly userId: string,
          public readonly displayName?: string,
          public readonly bio?: string
      ) {}
  }
  ```

- **Query:** A simple class containing the data needed to fetch something. It has no logic.
  *Example: "I want to know if the username 'johndoe' is available."*
  ```typescript
  export class CheckUsernameQuery {
      constructor(public username: string) {}
  }
  ```

### The Buses (CommandBus & QueryBus)

Think of a **Bus** as an intelligent postman. 

When your Controller receives an HTTP request, it creates a Command (or Query) and hands it to the Bus. The Controller doesn't know *how* the work gets done; it just trusts the Bus.

The `CommandBus` looks at the Command and says: *"Ah, this is an `UpdateProfileCommand`. I know exactly who handles this!"* and delivers it to the correct Handler.

### Handlers

A **Handler** is where the actual business logic lives. Every Command has exactly **one** Handler. Every Query has exactly **one** Handler.

When the Bus delivers the message, the Handler takes over, does the database work, and returns the result.

```typescript
// The CommandHandler decorator tells the CommandBus "Send UpdateProfileCommands to me!"
@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<UpdateProfileCommand> {
    constructor(@Inject(USER_REPOSITORY) private readonly userRepo: UserRepositoryPort) {}

    async execute(command: UpdateProfileCommand) {
        // 1. Do the logic: update the database, through the repository port
        return this.userRepo.update(command.userId, {
            displayName: command.displayName,
            bio: command.bio
        })
    }
}
```

---

## Domain Events & Side Effects

Sometimes, a Command does more than just update the database. It triggers **Side Effects**. 
For example, when a user updates their profile, we also need to:
1. Drop the copy of their record that the session check keeps in Redis, so the
   next request sees the new name.
2. Send an email notification (potentially).

If we put all this logic directly inside `UpdateProfileHandler`, it becomes messy and tightly coupled. Instead, we use **Domain Events**.

### What is an Event?
An Event is a simple class stating that **something already happened in the past**.
*Example: "The User Profile was updated."*

```typescript
export class UserProfileUpdatedEvent {
    constructor(public readonly userId: string) {}
}
```

### The EventBus and Publisher

Just like the `CommandBus`, the `EventBus` is a postman. But instead of delivering to *one* person, it broadcasts the Event over a loudspeaker.

Inside our `UpdateProfileHandler`, after saving to the database, we **publish** the event:
```typescript
this.eventBus.publish(new UserProfileUpdatedEvent(user.id))
```

### Why use Events for Side Effects?

By broadcasting the event, the Command Handler can finish its job and return the response to the user instantly.

Elsewhere in the app, **Event Handlers** are listening. You can have zero, one, or ten Event Handlers listening to the same event.

```typescript
// This handler listens for the broadcast. It lives in the auth module
// (src/modules/auth/application/events/handlers/refresh-cached-user.handler.ts): the users
// module that publishes the event knows nothing about it.
@EventsHandler(UserProfileUpdatedEvent)
export class RefreshCachedUserHandler implements IEventHandler<UserProfileUpdatedEvent> {
    constructor(@Inject(SESSION_CACHE) private readonly cache: SessionCachePort) {}

    async handle(event: UserProfileUpdatedEvent): Promise<void> {
        try {
            // Perform the side effect: drop the cached copy of the user
            await this.cache.invalidateUser(event.userId)
        } catch (error) {
            this.logger.error(`Could not drop the cached copy of user ${event.userId}: ...`)
        }
    }
}
```
*Why is this amazing?* If your boss says "We need to send an email every time a profile is updated", you don't even touch the `UpdateProfileHandler`. You just create a new `SendEmailOnProfileUpdateHandler` that listens to `UserProfileUpdatedEvent`. True decoupling!

---

## Full Flow Example: Updating a Profile

Here is exactly how a request travels through the system from start to finish when a user changes their display name.

#### 1. The Controller (Inbound Adapter)
The user sends a `PATCH /api/v1/users/me` API request with `{ "display_name": "John" }` (`snake_case` on the wire, converted to `displayName` before the controller sees it).
The Controller intercepts it, creates a Command, and hands it to the `CommandBus`.

```typescript
@Patch('me')
async updateProfile(@CurrentUser() user, @Body() dto: UpdateProfileRequestDto) {
    // Hand it to the postman!
    return await this.commandBus.execute(
        new UpdateProfileCommand(user.id, dto.displayName, dto.bio)
    );
}
```

#### 2. The Command Bus (The Postman)
The `CommandBus` looks at the `UpdateProfileCommand` and routes it to `UpdateProfileHandler`.

#### 3. The Command Handler (Business Logic)
The Handler receives the Command. It calls the Database Repository to save "John" to PostgreSQL.

```typescript
async execute(command: UpdateProfileCommand) {
    const user = await this.userRepo.update(command.userId, { displayName: command.displayName, bio: command.bio })

    // Announce to the app that this just happened!
    this.eventBus.publish(new UserProfileUpdatedEvent(user.id))
    
    return user;
}
```

#### 4. The Event Bus (The Broadcaster)
The `EventBus` takes the `UserProfileUpdatedEvent` and alerts all listeners asynchronously.

#### 5. The Event Handler (Side Effect)
The `RefreshCachedUserHandler` (auth module) hears the broadcast. It takes the `userId` from the event and drops the cached copy of the user in Redis, so the next request's session check reads fresh data from Postgres.

```typescript
async handle(event: UserProfileUpdatedEvent) {
    await this.cache.invalidateUser(event.userId);
}
```

#### Summary of the Flow:
1. `Client` -> `UsersController`
2. `UsersController` -> `CommandBus`
3. `CommandBus` -> `UpdateProfileHandler`
4. `UpdateProfileHandler` -> `Database`
5. `UpdateProfileHandler` -> `EventBus`
6. `EventBus` -> triggers `RefreshCachedUserHandler` (auth module) -> drops `auth:user:<id>` from Redis

---

## FAQ

**1. After the command handler uses `.publish()`, is the command considered "completed"? Does it wait for the events? Is the request finished?**
Yes, the command is considered 100% completed (and completely "successful") the exact millisecond after `.publish()` fires! 
While `.publish()` *does* return a Promise, you will notice we write `this.eventBus.publish(...)` **without** using the `await` keyword. Because we don't await it, it acts as a "fire-and-forget" mechanism. The command handler immediately returns its result back to the controller (and thus to the user). **It does NOT wait for the event handlers to finish.** 

Because of this, even if an event handler throws a massive error 2 seconds later, your HTTP request has already succeeded and returned `200 OK` to the user. *(If you **did** `await this.eventBus.publish(...)`, the command would pause, and an event failure would cause the entire command to fail and return a `500 Internal Server Error`).* By intentionally omitting `await`, we protect the core business action from failing due to secondary side-effects.

**2. What is the order of Execution if an event has multiple handlers?**
The `.publish()` method synchronously *initiates* each handler by looping through them and calling `handler.handle(event)` one by one (**without** `await`). However, because each `handle()` is an `async` function, calling it without `await` immediately returns a Promise and moves on to the next handler. The actual work inside each handler (database calls, API requests, etc.) then runs **concurrently in the background** via the Node.js event loop. There is no guaranteed order of *completion*.

```
publish() loop (synchronous dispatch):
  → calls handler1.handle()  →  returns Promise instantly  →  actual work runs in background
  → calls handler2.handle()  →  returns Promise instantly  →  actual work runs in background
  → loop finishes almost instantly

Meanwhile, in the background (concurrent):
  handler1: doing database query...
  handler2: calling Redis...
  (no guaranteed order of completion!)
```

- `AccountDeletedEvent` triggers both `CleanupAccountAvatarHandler` (users module) and `EndSessionsOfDeletedAccountHandler` (auth module). They are both *initiated* in sequence by the loop, but their async work runs concurrently — either one could finish first.
- You should **never** design event handlers that depend on the order of execution. Each handler must operate completely independently!

**3. What happens if an event has multiple handlers, and ONE of them fails? Does the lack of try/catch fail the whole command?**
They are completely isolated! Because they run concurrently, if `CleanupAccountAvatarHandler` crashes, it will NOT stop `EndSessionsOfDeletedAccountHandler` from succeeding. 

More importantly, it will **NOT** fail the original Command (the User profile will still be updated) because the Command Handler did not `await` the `.publish()`.

**However, if you don't use a `try/catch` in your Event Handlers, it is incredibly dangerous.** 
When an asynchronous function throws an error that is not caught, it causes an "Unhandled Promise Rejection". In modern Node.js versions (v15+), unhandled promise rejections will **crash the entire Node.js server process** abruptly. We use `try/catch` inside Event Handlers solely to swallow the error, log a warning, and prevent the entire application from shutting down!

**4. What happens if the `.publish()` itself fails?**
In `@nestjs/cqrs`, the `.publish()` method is purely local and synchronous **in its dispatch mechanism** — it just loops through the registered handlers and calls `handler.handle(event)` without `await`. This dispatch loop itself almost *never* fails unless you have a severe memory crash. (Note: while the *dispatch* is synchronous, the handlers' actual async work runs concurrently in the background — see FAQ #2 for the full picture.)

*However*, what if the server crashes *right after* the database saves, but *right before* `.publish()` is called? 
In highly critical banking/enterprise systems, to solve this, they use a pattern called the **Outbox Pattern**. They save the Domain Event into the exact same PostgreSQL database transaction as the User update. Then a background worker reads the database and publishes it. This guarantees 100% "at-least-once" delivery. For a standard startup/app, the in-memory `.publish()` we use is perfectly fine.

**5. Are there any scenarios where the Command Handler is BLOCKED and has to wait for Event Handlers?**
By default, no. We use "fire-and-forget" events for side effects (like emails or cache invalidation) specifically because we *don't* want to block the user's HTTP request.
However, in incredibly rare scenarios called **Sagas**, you might need to coordinate a complex, multi-step transaction across microservices. In a Saga, a Command publishes an Event, then literally pauses and waits for another microservice to reply before finishing. You almost never need to do this in a standard monolithic application. If you need something to finish *before* the user gets a response, that logic belongs directly inside the **Command Handler**, not an Event Handler!

**6. What happens if a side effect fails permanently? (e.g., the external email API is down)**
This is exactly why we use **BullMQ** (a Redis-backed message queue) alongside our Event Handlers. 
If you look at our `AvatarUploadedEvent`, the `CleanupOldAvatarHandler` doesn't actually delete the file itself. It just *enqueues a job* into BullMQ. If the AWS S3 API is temporarily down, the event handler succeeds instantly, and the BullMQ worker retries deleting the file: 10 attempts with exponential backoff from 10 seconds, about 85 minutes in all (`DEFAULT_JOB_OPTIONS` in `src/shared/infrastructure/queue/queues.ts`). There is no separate dead-letter queue: a job that fails all its attempts stays in the queue's *failed* list for 14 days, where an engineer can inspect and retry it on `/admin/queues`, and it is reported to error tracking. Emails use shorter rules (3 attempts from 5 seconds), because a code expires in minutes ([BULLMQ-GUIDE.md](./BULLMQ-GUIDE.md)).

**7. Can a Command Handler return data?**
Yes, but strictly speaking, purists say "No."
In strict, purist CQRS, a Command should simply return `void` (or an acknowledgement), and the client must immediately issue a separate Query to fetch the updated state.
However, in practical, modern web development (especially with REST or GraphQL APIs), it is standard practice to return the updated entity from the Command Handler (like we return the `UserEntity` in `UpdateProfileHandler`). This saves a totally unnecessary round-trip network call for the frontend.

**8. Is CQRS the same thing as Event Sourcing?**
No, but they are best friends. 
**CQRS** is separating writes from reads. 
**Event Sourcing** means instead of saving the *current state* of a user in a database row, you save an *immutable log of every single event that ever happened* (UserCreated, ProfileUpdated, PasswordChanged), and you mathematically "replay" those events to calculate their current state. Event Sourcing is incredibly complex and usually only used in banking (ledgers) or high-compliance auditing systems. We are **not** doing Event Sourcing here, just CQRS.

**9. When should I absolutely NOT use CQRS?**
If your module is just doing simple CRUD (Create, Read, Update, Delete) where the UI perfectly matches the database table, CQRS is total overkill. It introduces a lot of boilerplate (separate classes for Commands, Queries, Handlers, Events). You only use CQRS when the *business logic* starts getting complex, or when one write operation needs to trigger multiple different side-effects across the system.

**10. What if the `handle()` function in the event handlers is sync instead of async?**
In JavaScript/Node.js, if you write a `handle()` function synchronously (without `async/await` returning a Promise), it will run immediately on the main thread and **block the entire Node.js event loop** until it completes. Because Node.js is single-threaded, if your synchronous event handler takes 5 seconds to calculate a heavy CPU task or uses a blocking library, the `CommandBus.publish()` call will stall, the Command Handler will pause, the HTTP response will hang, and **every other user making requests to your entire server will be frozen for 5 seconds.** 

Always make event handlers `async`. When you use `async`, calling `handle()` immediately yields a Promise and hands control back to the event loop. The Command Handler instantly moves on and returns its fast HTTP response, while Node.js processes the actual event handler logic safely in the background!

**11. What if I use a Database Transaction inside my Command Handler?**
This is a very important question! If you wrap your Command Handler's database update in a transaction (e.g., `prisma.$transaction`), you must be extremely careful about **when** you call `.publish()`.

You MUST commit the transaction *before* you publish the event. 
If you publish the event *inside* the transaction block, the Event Handlers will instantly wake up and try to read the database. Because the transaction hasn't committed yet, the Event Handlers will read **stale, old data**, which leads to incredibly frustrating race conditions.

**Correct Way:**
```typescript
// 1. Commit the transaction completely
const result = await prisma.$transaction(async (tx) => {
    return await tx.user.update(...);
});

// 2. Publish the event AFTER the transaction is fully committed
this.eventBus.publish(new UserProfileUpdatedEvent(result.id));
```
If you absolutely need the event to be published safely alongside the transaction (e.g., if the server crashes between step 1 and step 2), you must use the **Outbox Pattern** (saving the event to a database table inside the transaction itself, instead of using `.publish()`).
