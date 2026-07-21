/**
 * `@inject(...)` vs `@singleton(...)`: ordered constructor dependencies,
 * transient-by-default behavior, and singleton alias sharing across a token
 * and the class it is bound to.
 *
 * Run: `bun run examples/decorators.ts`
 */
import { createContainer, inject, singleton, token } from "../src/index.ts";

@inject()
class Clock {
  now(): number {
    return Date.now();
  }
}

// `@inject(...)` deps are positional and type-checked against the
// constructor's parameter list at compile time (order, arity, and type must
// all match).
@inject(Clock)
class RequestId {
  constructor(private readonly clock: Clock) {}

  generate(): string {
    return `req-${this.clock.now()}`;
  }
}

// `@singleton(...)` classes are constructed once per container: every
// resolution (direct or via a token alias) after the first returns the same
// instance.
@singleton()
class ConnectionPool {
  readonly id = Math.random();
}

const container = createContainer();

const a = container.resolve(ConnectionPool);
const b = container.resolve(ConnectionPool);
console.log("singleton identity (direct):", a === b);
if (a !== b) throw new Error("expected same singleton instance");

// A token bound to a singleton class shares the *same* underlying instance as
// resolving the class directly -- there is exactly one instance per class per
// container, regardless of how many tokens alias it.
const PoolToken = token<ConnectionPool>("ConnectionPool");
container.bind(PoolToken).toClass(ConnectionPool);

const viaToken = container.resolve(PoolToken);
console.log("singleton identity (via token alias):", viaToken === a);
if (viaToken !== a) throw new Error("expected token alias to share singleton instance");

// `RequestId` has no lifetime decorator override -> transient: a fresh
// instance is constructed on every resolve.
const id1 = container.resolve(RequestId).generate();
const id2 = container.resolve(RequestId).generate();
console.log(id1, id2);
