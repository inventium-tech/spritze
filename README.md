# spritze

![GitHub License](https://img.shields.io/github/license/inventium-tech/spritze?style=for-the-badge)
![NPM Downloads](https://img.shields.io/npm/dw/%40inventium-tech%2Fspritze?style=for-the-badge)
![NPM Version](https://img.shields.io/npm/v/%40inventium-tech%2Fspritze?style=for-the-badge)

A zero-dependency dependency injection container for TypeScript. Opaque typed tokens, standard ECMAScript class
decorators (no `reflect-metadata`, no constructor parameter decorators), and a small, explicit resolution model.

Runtime support (see `engines` in `package.json` for the minimum supported versions):

- **Bun:** `>=1.3.0`
- **Node.js:** `>=22.0.0`
- **Deno:** `>=2.0.0`.

Bun remains the build and development tool -- the library itself is built with TypeScript's standard (Stage 3) class
decorators and has no runtime dependencies or runtime-specific shims. CI runs a cross-runtime smoke suite (`bun run
test:runtime`) against the packaged `dist/` output on all three runtimes. No browser runtime guarantee is established or
claimed.

## What it does / Use cases

Spritze wires up an application's classes and interface-shaped contracts at runtime: register bindings once via
`createContainer()`, then resolve fully constructed instances with their dependencies already supplied. Typical use
cases are constructor-injected services, swapping an interface's implementation (e.g. a `Logger` for tests vs.
production), and per-container singletons such as connection pools or caches.

## Install

Installing as a dependency in another project:

```bash
bun add spritze
```

Using npm with Node.js:

```bash
npm install @inventium-tech/spritze
```

Consuming from Deno via the `npm:` specifier:

```ts
import { createContainer } from "npm:@inventium-tech/spritze";
```

Setting up this repository for local development (see
[CONTRIBUTING.md](./CONTRIBUTING.md)):

```bash
bun install
```

## Quickstart

```ts
import { createContainer, inject, token } from "spritze";

@inject()
class Logger {
  log(message: string): string {
    return `[log] ${message}`;
  }
}

interface Greeter {
  greet(name: string): string;
}

@inject(Logger)
class EnglishGreeter implements Greeter {
  constructor(private readonly logger: Logger) {
  }

  greet(name: string): string {
    this.logger.log(`greeting ${name}`);
    return `Hello, ${name}!`;
  }
}

const GreeterToken = token<Greeter>("Greeter");

const container = createContainer();
container.bind(GreeterToken).toClass(EnglishGreeter);

console.log(container.resolve(GreeterToken).greet("world"));
container.resolve(Logger); // decorated classes resolve directly, no binding required

/*
* console output:
* Hello, world!
*/
```

Runnable version: [`examples/quickstart.ts`](examples/quickstart.ts).

## Benchmarks

Point-in-time results from one machine, reproduced with `bun run bench -- --json`. These are not a guarantee -- numbers
vary by Bun version, system load, power state, OS, and hardware. Do not compare against these figures on different
setups.

- **Hardware:** AMD Ryzen 7 PRO 4750U with Radeon Graphics (16 logical CPUs), 30.57 GiB RAM
- **OS:** Linux 7.1.3-zen1-3-zen x86_64
- **Bun:** 1.3.14

| Scenario                 | Median    | Ops/s   |
|--------------------------|-----------|---------|
| direct-cached-singleton  | 66.23 ns  | 14.67M  |
| token-singleton-alias    | 93.34 ns  | 10.57M  |
| transient-leaf           | 211.98 ns | 4.67M   |
| mixed-transient-graph    | 2.03 µs   | 478.41K |
| cold-singleton-graph     | 1.30 µs   | 738.81K |
| cached-singleton-graph   | 83.66 ns  | 11.69M  |
| container-setup          | 524.26 ns | 1.92M   |
| token-value-lookup       | 31.81 ns  | 30.20M  |
| factory-transient        | 119.56 ns | 8.11M   |
| factory-singleton-cached | 71.18 ns  | 13.84M  |
| factory-with-deps        | 401.02 ns | 2.44M   |

See [`bench/README.md`](bench/README.md) for full methodology, scenario descriptions, and reproducibility limits.

## Documentation Reference

| Document                                                   | Purpose                                                 |
|------------------------------------------------------------|---------------------------------------------------------|
| [CONTRIBUTING.md](./CONTRIBUTING.md)                       | How to contribute and set up locally                    |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                       | System design and component overview                    |
| [AGENTS.md](./AGENTS.md)                                   | Machine execution rules for AI agents                   |
| [docs/concepts.md](docs/concepts.md)                       | Tokens, decorators, bindings, factories, error taxonomy |
| [docs/faq-troubleshooting.md](docs/faq-troubleshooting.md) | Common questions and error diagnosis                    |

## Examples

All examples import directly from source (`../src/index.ts`). Examples that include assertions throw if those assertions
fail; the errors example is log-oriented and demonstrates handling by printing each error code.

| File                                               | Covers                                                                                         |
|----------------------------------------------------|------------------------------------------------------------------------------------------------|
| [`examples/quickstart.ts`](examples/quickstart.ts) | Tokens, `@inject`, `bind().toClass/.toValue`, resolving classes without a binding.             |
| [`examples/decorators.ts`](examples/decorators.ts) | `@inject` vs `@singleton`, ordered typed dependencies, singleton alias sharing.                |
| [`examples/interfaces.ts`](examples/interfaces.ts) | Binding a token to a class implementing an interface; decorated consumers and implementations. |
| [`examples/factory.ts`](examples/factory.ts)       | `bind().toFactory`, the `Resolver` type, transient vs. singleton factory lifetime.             |
| [`examples/errors.ts`](examples/errors.ts)         | Handling every `SpritzeErrorCode` by `code`.                                                   |

Run all of them:

```bash
bun run examples
```

Run one directly:

```bash
bun run examples/quickstart.ts
```

## FAQ & Troubleshooting

See [docs/faq-troubleshooting.md](./docs/faq-troubleshooting.md)

## What this does not (yet) support

- No child/scoped containers.
- No async factories.
- No disposal/teardown hooks.
- No browser runtime guarantee.

See [`ROADMAP.md`](ROADMAP.md) for what's planned and what's explicitly gated on measurement first.
