# Roadmap

Spritze's priority order is: correctness and measurement first, ergonomics
second, advanced features only where concrete demand justifies them. This
roadmap avoids date commitments; milestones are sequenced, not scheduled.

## MVP (done)

- [x] Opaque, type-safe tokens (`token<T>()`) for interface/contract binding.
- [x] Standard ECMAScript class decorators (`@inject`, `@singleton`) with
      no `reflect-metadata` and no constructor parameter decorators.
- [x] Container with `bind(token).toClass(...)` / `.toValue(...)` /
      `.toFactory(...)` and `resolve(tokenOrClass)`.
- [x] Transient (`@inject`) and per-container singleton (`@singleton`)
      lifetimes, including factory singleton caching.
- [x] Cycle detection with descriptive `CircularDependencyError` paths.
- [x] Duplicate-binding and missing-binding detection via `ResolutionError`.
- [x] `UndecoratedError` for classes resolved without `@inject`/`@singleton`.
- [x] Stable structured machine-readable error codes and shapes.
- [x] Zero runtime dependencies; Bun-only build (`bun build`) and type
      declarations (`tsc --project tsconfig.build.json`).
- [x] Test suite covering tokens, binding, lifetimes, factory bindings,
      error paths, and dependency ordering (`bun test`).
- [x] Reproducible micro-benchmarks
      ([`bench/README.md`](./bench/README.md)) runnable via `bun run bench`:
      methodology and hardware context are documented, but raw benchmark
      artifacts are not committed to the repository.

## Measurement (remaining)

Measurement remains important as ongoing evidence, but it no longer blocks
other work.

- [ ] Close coverage gaps with explicit tests: deeply nested dependency
      graphs and repeated resolution of the same singleton instance across
      a graph.
- [ ] Memory footprint characterization, only if a concrete need arises;
      resolution throughput and container creation cost are already covered.

## Ergonomics (prioritized near-term)

Outcome: reduce boilerplate and friction for the common cases validated by
the MVP, without adding new resolution semantics.

- [ ] Improved error message formatting for large dependency graphs.
- [ ] Batch/module-style registration helpers to reduce repeated `bind`
      calls for related bindings.

## Advanced features (conditional)

Outcome: only pursued if concrete demand shows transient and singleton
lifetimes, or independent containers, are insufficient for real usage. Any
candidate feature is evaluated with existing benchmarks to detect resolution
regression, but measurement informs prioritization rather than approving or
blocking work.

- [ ] Child/scoped containers for hierarchical composition (parent-lookup on
      miss), pending a concrete use case.
- [ ] Scope-bound lifetime (instance shared within an explicit scope shorter
      than container lifetime), pending a concrete use case.
- [ ] Lazy/deferred resolution for cases where eager construction is
      measurably costly, pending a concrete use case.

## Non-goals

- No multi-runtime support (Node, Deno, browser). Spritze is Bun-only.
- No `reflect-metadata` or constructor parameter decorators.
- Benchmarks inform performance-sensitive work and regression checks, but do
  not block later feature work.
- No committed benchmark result artifacts in the repository.
