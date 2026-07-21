/**
 * `bind(token).toFactory(...)`: synchronous factory bindings, the narrow
 * `Resolver` passed to factories, transient-by-default vs. explicit
 * `Lifetime.Singleton` factory caching.
 *
 * Run: `bun run examples/factory.ts`
 */
import { createContainer, inject, Lifetime, type Resolver, token } from "../src/index.ts";

@inject()
class Logger {
  log(message: string): string {
    return `[log] ${message}`;
  }
}

const ConfigToken = token<{ readonly env: string }>("Config");

// A factory receives a narrow `Resolver` -- only `resolve()` is exposed, not
// the mutable container (no `bind()`), keeping factories focused on
// construction-time lookups.
interface ConfiguredLogger {
  log(message: string): string;
}

const ConfiguredLoggerToken = token<ConfiguredLogger>("ConfiguredLogger");

const container = createContainer();
container.bind(ConfigToken).toValue({ env: "production" });

container.bind(ConfiguredLoggerToken).toFactory((resolver: Resolver) => {
  const logger = resolver.resolve(Logger);
  const config = resolver.resolve(ConfigToken);
  return {
    log: (message: string) => logger.log(`(${config.env}) ${message}`),
  };
});

console.log(container.resolve(ConfiguredLoggerToken).log("booted"));

// Factories are synchronous only: no async factory is supported. Returning a
// Promise would just produce a token typed as a Promise, not an awaited
// value -- there is no special-cased handling for it.

// Factory lifetime defaults to transient: a new value is produced on every
// resolve.
const RequestIdToken = token<string>("RequestId");
let counter = 0;
container.bind(RequestIdToken).toFactory(() => `req-${++counter}`);

console.log(container.resolve(RequestIdToken)); // req-1
console.log(container.resolve(RequestIdToken)); // req-2

// Pass `{ lifetime: Lifetime.Singleton }` to cache the factory's result per
// binding (per token), the first time it is successfully produced.
const HeavyResourceToken = token<{ readonly id: number }>("HeavyResource");
let builds = 0;
container.bind(HeavyResourceToken).toFactory(() => ({ id: ++builds }), { lifetime: Lifetime.Singleton });

const first = container.resolve(HeavyResourceToken);
const second = container.resolve(HeavyResourceToken);
console.log("singleton factory identity:", first === second, "builds:", builds);
if (first !== second || builds !== 1) {
  throw new Error("expected singleton factory to be built exactly once");
}
