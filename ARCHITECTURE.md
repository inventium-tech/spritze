# Architecture

> System structure and design reference. See AGENTS.md for execution commands. See README.md for a quickstart.

## 1. System Overview

Spritze is a zero-dependency, Bun-native dependency injection (DI) container for TypeScript. It provides opaque typed
tokens, standard ECMAScript class decorators (`@inject`/`@singleton`, no `reflect-metadata`, no constructor parameter
decorators), and a small, explicit resolution model with transient and per-container singleton lifetimes. The library is
a single importable module (`src/index.ts`) with no runtime dependencies and no plugin or extension surface.

## 2. Architectural Style

Single-module library, not a service. There is no network layer, no persistence, and no runtime configuration beyond the
values passed to its own API. Internally, the design is layered: a public API surface (`index.ts`), a resolution engine
(`container.ts`), a decorator/metadata layer (`decorators.ts`), a value-identity layer (`token.ts`), and a shared error
taxonomy (`errors.ts`).

## 3. Component Breakdown

| Component                     | File                | Responsibility                                                                                                                                                                                                                  |
|-------------------------------|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Public API                    | `src/index.ts`      | Re-exports the container, decorators, errors, and token factory as the package's sole entry point.                                                                                                                              |
| Container / resolution engine | `src/container.ts`  | `createContainer()`, `ContainerImpl` (bindings map, singleton caches, resolution stack), `BindToBuilder` fluent binding API (`toClass`/`toValue`/`toFactory`), cycle detection, factory invocation via a narrow `Resolver`.     |
| Decorators                    | `src/decorators.ts` | `@inject(...)` and `@singleton(...)` class decorators; attaches a `Lifetime` and an ordered `Dep[]` list to a class via `getDefinition`, without `reflect-metadata` or parameter decorators.                                    |
| Tokens                        | `src/token.ts`      | `token<T>(description?)` — creates an opaque object identity used as a compile-time-typed, runtime-matched binding key.                                                                                                         |
| Errors                        | `src/errors.ts`     | `SpritzeError` base class and `SpritzeErrorCode` union; `ResolutionError`, `CircularDependencyError`, `UndecoratedError`; path-formatting helpers (`formatKey`, `formatPath`, `formatPathStrings`) used in diagnostic messages. |

## 4. Data & Control Flow

1. A consumer calls `token<T>()` to create a typed key, or decorates a class with `@inject`/`@singleton` to make it
   directly resolvable.
2. `createContainer()` returns a `ContainerImpl` holding: a `bindings` map (`Token` → `Binding`), a class singleton
   cache/lock set, and a factory singleton cache/lock set.
3. `container.bind(token)` returns a `BindToBuilder`, whose `toClass`/`toValue`/`toFactory` calls register exactly
   one `Binding` per token; a second bind to the same token throws
   `ResolutionError` (`"duplicate-binding"`).
4. `container.resolve(keyOrClass)` enters `resolveInternal`, which:
   - Identifies whether the key is a `Token` (looked up in `bindings`) or a decorated class.
   - For `value` bindings, returns the stored value directly.
   - For `factory` bindings, invokes the factory with a narrow `Resolver` (exposes only `resolve`, not the mutable
     container) — transient by default, or cached per-token if `{ lifetime: Lifetime.Singleton }` was set.
   - For `class` targets (bound or resolved directly), reads the decorator-attached definition; missing decoration throws
     `UndecoratedError`.
   - Singleton classes are constructed once per container (cached by class identity, guarded by a lock set to detect
     self-referential construction); transient classes are constructed fresh on every resolution.lution.
   - Dependencies are constructed depth-first via `construct()`, threading a resolution `stack` used by
     `detectCycle()` to throw `CircularDependencyError` with a formatted dependency path on any direct or indirect
     cycle.
5. Errors thrown by user constructors or factories propagate unwrapped (not wrapped in `SpritzeError`); only
   container-generated binding/resolution failures carry a `SpritzeErrorCode`.

## 5. External Dependencies

None at runtime. `src/` has zero runtime dependencies by design (enforced convention, not tooling-checked).
Development-only dependencies (`@biomejs/biome`, `@types/bun`, `typescript`) are used for linting, formatting, and
type declaration emission — they are not bundled into `dist/`.

## 6. Repository Structure

```
.
├── src/            # library source (container, decorators, errors, token, public exports)
├── tests/          # bun test suite (di, factory, types, bench-report tests)
├── examples/       # runnable scripts importing directly from ../src/index.ts
├── bench/          # Bun micro-benchmarks (resolution throughput, container creation)
├── dist/           # generated build output (bun run build); not source
└── .github/workflows/  # CI pipeline definition
```

Not a monorepo — a single package with one public entry point (`src/index.ts`).

## 7. Design Constraints & Decisions

- **No `reflect-metadata`, no constructor parameter decorators**: dependencies are declared as an explicit, ordered
  `Dep[]` list passed to `@inject(...)`/`@singleton(...)`, type-checked against the constructor signature at compile
  time.
- **No child/scoped containers**: `createContainer()` always produces a fully independent container; there is no
  parent-lookup-on-miss hierarchy. This is a deliberate simplicity tradeoff, revisited only if benchmarking justifies
  the added resolution overhead.
- **Synchronous-only factories**: `toFactory` factories are not awaited; a factory returning a `Promise` yields a token
  typed as a promise, not an awaited value.
- **Factories receive a narrow `Resolver`**, not the full `Container`, so `bind()` is unreachable from inside a factory
  and the resolution/cycle-detection stack cannot be bypassed by capturing the outer container.
- **Bindings are immutable once set**: duplicate binds throw rather than silently overwriting, to keep container state
  easy to reason about.
- **Bun-only runtime target**: no Node.js or browser compatibility shims are added; this keeps the codebase small and
  avoids compatibility-layer maintenance burden.
- **Zero runtime dependencies**: a hard project-wide constraint (see AGENTS.md: "Constraints").

## 8. Evolution Strategy

Feature work follows the sequencing in [ROADMAP.md](./ROADMAP.md): correctness and measurement first (expanded test
coverage, reproducible micro-benchmarks), then ergonomics (child/scoped containers, batch registration helpers — each
gated on benchmark evidence of no resolution-performance regression), then diagnostics/tooling, then advanced lifetimes
(request/scope-bound, lazy resolution) only if Milestone 1 benchmarking shows the current transient/singleton model is
insufficient. No multi-runtime support is planned; Spritze remains Bun-only by design.
