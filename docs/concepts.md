# Concepts

<!-- TOC -->
* [Concepts](#concepts)
  * [Tokens](#tokens)
  * [Decorators](#decorators)
  * [Container and fluent bindings](#container-and-fluent-bindings)
  * [Singleton alias sharing](#singleton-alias-sharing)
  * [Factories](#factories)
  * [Errors](#errors)
<!-- TOC -->

## Tokens

`token<T>(description?)` creates an opaque, typed identifier for a dependency contract (typically an interface).
Tokens carry no runtime type information, matching happens by object identity, and `T` is enforced only
at compile time. Two tokens created with the same description are distinct and not interchangeable.

```ts
const ConfigToken = token<{ readonly env: string }>("Config");
```

## Decorators

- `@inject(...)`
- `@singleton(...)`

Both are standard ECMAScript class decorators (no experimental `experimentalDecorators`, no `reflect-metadata`, no
parameter decorators). Dependencies are declared as a fixed, ordered list of tokens and/or other decorated classes.
They are also type-checked against the constructor's parameter list at compile time (order, arity, and type must all
line up):

```ts
@inject()
class Clock {}

@inject(Clock) // transient: a new instance is constructed on every resolve
class RequestId {
  constructor(private readonly clock: Clock) {}
}

@singleton() // singleton: one instance per container, cached after first resolve
class ConnectionPool {}
```

- `@inject(...)` -> `Lifetime.Transient` (the default).
- `@singleton(...)` -> `Lifetime.Singleton`, cached per container.
- A class must be decorated with `@inject` or `@singleton` before it can be resolved (directly or as a dependency);
  resolving an undecorated class throws `UndecoratedError`.
- Decoration does not propagate through subclassing: a subclass of a decorated class is not itself decorated.
- Applying two decorators to the same class keeps the first definition deterministically; the second is ignored.

Runnable version: [`examples/decorators.ts`](../examples/decorators.ts).

## Container and fluent bindings

```ts
const container = createContainer();

container.bind(SomeToken).toClass(SomeImpl);      // decorated class
container.bind(SomeToken).toValue(someInstance);  // pre-built value
container.bind(SomeToken).toFactory((resolver) => // synchronous factory
  new SomeImpl(resolver.resolve(SomeDep)),
);

container.resolve(SomeToken);
container.resolve(SomeDecoratedClass); // classes can be resolved without a binding
```

- `bind(token)` returns a fluent builder (`toClass` / `toValue` / `toFactory`) and each call registers exactly one
  binding.
- Binding the same token twice throws `ResolutionError` with code `"duplicate-binding"`. Bindings cannot be
  replaced or overwritten.
- `resolve()` accepts either a `Token<T>` or a class decorated with `@inject` / `@singleton`.
- Containers are independent: singletons (class or factory) are cached per container instance, never shared across
  containers.
- **No child/scoped containers**: `createContainer()` always produces a fully independent, top-level container.
  There is no parent-lookup-on-miss hierarchy.

## Singleton alias sharing

A singleton class has exactly one instance per container, regardless of how many tokens are bound to it. Resolving
the class directly and resolving any token bound to it via `toClass` all return the same instance:

```ts
@singleton()
class ConnectionPool {}

const PoolToken = token<ConnectionPool>("ConnectionPool");
container.bind(PoolToken).toClass(ConnectionPool);

container.resolve(ConnectionPool) === container.resolve(PoolToken); // true
```

If a singleton's constructor throws, the failed attempt is not cached; the next resolve attempt retries construction
from scratch.

## Factories

- `bind(token).toFactory(factory, opts?)` binds a token to a **synchronous** function `(resolver: Resolver) => T`.
  There is no async factory support (**yet**): returning a `Promise` produces a token typed as a promise, not an
  awaited value -- it is not special-cased or awaited by the container.
- `Resolver` is intentionally narrow: it exposes only `resolve()`, not the mutable `Container` (`bind()` is not
reachable from inside a factory), so factories stay focused on construction-time dependency lookup.
- Factories must use the supplied `resolver` for every nested dependency lookup. Do not capture the full `container`
  and call `container.resolve(...)` from a factory: that starts a separate resolution stack, so the dependency path
  and cycle detection are not preserved; a cycle can evade detection and recurse indefinitely.

```ts
container.bind(ConfiguredLoggerToken).toFactory((resolver) => {
  const logger = resolver.resolve(Logger);
  const config = resolver.resolve(ConfigToken);
  return { log: (msg: string) => logger.log(`(${config.env}) ${msg}`) };
});
```

Lifetime:

- Default: **transient** -- the factory runs on every `resolve()` call.
- `{ lifetime: Lifetime.Singleton }` -- the result is cached the first time the factory succeeds, keyed by the exact
  token identity used in the binding (two different tokens with the same description are cached independently). As
  with class singletons, a thrown error is not cached and the next resolve retries.
- If a factory resolves a `@singleton()` class via `resolver.resolve(...)`, it shares the same per-class singleton
  cache as any other resolution path in that container.

Runnable version: [`examples/factory.ts`](../examples/factory.ts).

## Errors

Container-generated binding and resolution errors extend `SpritzeError` and carry a stable, machine-readable `code:
SpritzeErrorCode`. Switch on `code`, not on class or message text, for durable programmatic handling. Errors thrown
by your own constructors or factories propagate unchanged and do not carry a Spritze error code. Other public API
validation errors, such as a non-string token description, are native errors rather than `SpritzeError` instances:

| Code                    | Class                     | Thrown when                                                                            |
|-------------------------|---------------------------|----------------------------------------------------------------------------------------|
| `"missing-binding"`     | `ResolutionError`         | Resolving a token with no binding, or an unbound dependency reached during resolution. |
| `"duplicate-binding"`   | `ResolutionError`         | A token is bound a second time.                                                        |
| `"circular-dependency"` | `CircularDependencyError` | A dependency cycle is detected (direct or indirect, through classes and/or factories). |
| `"undecorated-class"`   | `UndecoratedError`        | Resolving (or binding to) a class without `@inject`/`@singleton`.                      |


`ResolutionError` and `CircularDependencyError` carry a `path: readonly string[]` describing the dependency chain
from the resolution root to the failure, for diagnostics. `UndecoratedError` carries the offending `clazz`.

Errors thrown by your own constructors or factories propagate unwrapped (e.g., a factory that throws `RangeError`
surfaces as that exact `RangeError`, not a `SpritzeError`).

```ts
import { SpritzeError, type SpritzeErrorCode } from "spritze";

try {
  container.resolve(SomeToken);
} catch (err) {
  if (err instanceof SpritzeError) {
    const code: SpritzeErrorCode = err.code;
    // "missing-binding" | "duplicate-binding" | "circular-dependency" | "undecorated-class"
  } else {
    throw err; // not a Spritze error (e.g. thrown by your own code)
  }
}
```

Runnable version: [`examples/errors.ts`](../examples/errors.ts).
