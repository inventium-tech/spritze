// Cross-runtime smoke consumer for the published package.
//
// Bare-imports the public API by package name (not a relative path) so this
// script exercises exactly what a real consumer resolves via node_modules /
// npm: / Bun's module resolution. Must run unmodified under `bun`, `node`,
// and `deno run` against the staged package produced by
// `scripts/test-runtime.sh`.
//
// No decorator syntax is used: class decorators are invoked manually via
// their plain-function form with a minimal hand-built
// `ClassDecoratorContext`, since this file is loaded without a TypeScript/
// decorator-transform toolchain.
import { createContainer, inject, Lifetime, ResolutionError, singleton, token } from "@inventium-tech/spritze";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

function manualContext(name) {
  return {
    kind: "class",
    name,
    addInitializer() {},
    metadata: Object.create(null),
    private: false,
  };
}

// --- Public entry resolution ---
assert(typeof createContainer === "function", "createContainer is exported and callable");
assert(typeof inject === "function", "inject is exported and callable");
assert(typeof singleton === "function", "singleton is exported and callable");
assert(typeof token === "function", "token is exported and callable");
assert(typeof ResolutionError === "function", "ResolutionError is exported and constructible");

// --- Token value binding ---
const GreetingToken = token("Greeting");
const container = createContainer();
container.bind(GreetingToken).toValue("hello");
assert(container.resolve(GreetingToken) === "hello", "token resolves to the bound value");

// --- Class dependency resolution ---
class Clock {
  now() {
    return 42;
  }
}
inject()(Clock, manualContext("Clock"));

class RequestId {
  constructor(clock) {
    this.clock = clock;
  }

  generate() {
    return `req-${this.clock.now()}`;
  }
}
inject(Clock)(RequestId, manualContext("RequestId"));

const requestId = container.resolve(RequestId);
assert(requestId.generate() === "req-42", "class dependency is constructed and injected in order");

// --- Singleton identity ---
class ConnectionPool {}
singleton()(ConnectionPool, manualContext("ConnectionPool"));

const poolA = container.resolve(ConnectionPool);
const poolB = container.resolve(ConnectionPool);
assert(poolA === poolB, "singleton class resolves to the same instance");

// --- Factory caching through Lifetime.Singleton ---
const CounterToken = token("Counter");
let factoryCalls = 0;
container.bind(CounterToken).toFactory(
  () => {
    factoryCalls += 1;
    return factoryCalls;
  },
  { lifetime: Lifetime.Singleton },
);
const first = container.resolve(CounterToken);
const second = container.resolve(CounterToken);
assert(first === 1 && second === 1, "singleton factory is invoked exactly once");
assert(factoryCalls === 1, "singleton factory caches its result across resolutions");

// --- Missing-binding error ---
const MissingToken = token("Missing");
let missingError;
try {
  container.resolve(MissingToken);
} catch (error) {
  missingError = error;
}
assert(missingError instanceof ResolutionError, "missing binding throws a ResolutionError");
assert(missingError.code === "missing-binding", "missing binding error carries the missing-binding code");

console.log("runtime smoke: all assertions passed");
