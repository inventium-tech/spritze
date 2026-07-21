// Benchmark fixtures for Spritze's DI hot paths.
//
// These classes and tokens exist purely to exercise resolution paths with a
// realistic-but-small mix of class, token, and value bindings. They are not
// part of the public library surface and carry no behavior beyond what is
// needed to be constructed and (optionally) hold references to their deps.

import { type Container, createContainer, inject, Lifetime, type Resolver, singleton, token } from "../src/index.ts";

// --- Tokens -----------------------------------------------------------

export interface Config {
  readonly env: string;
  readonly retries: number;
}

export interface Logger {
  log(msg: string): void;
}

export const ConfigToken = token<Config>("Config");
export const LoggerToken = token<Logger>("Logger");
export const TokenBoundSingletonToken = token<TokenBoundSingleton>("TokenBoundSingleton");
export const FactoryTransientToken = token<{ readonly id: number }>("FactoryTransient");
export const FactorySingletonToken = token<{ readonly id: number }>("FactorySingleton");
export const FactoryWithDepsToken = token<{
  readonly leaf: TransientLeaf;
  readonly singleton: CachedSingleton;
}>("FactoryWithDeps");

const configValue: Config = { env: "bench", retries: 3 };

let transientFactoryCalls = 0;
let singletonFactoryCalls = 0;

function createFactoryTransient(_resolver: Resolver): { readonly id: number } {
  return { id: ++transientFactoryCalls };
}

function createFactorySingleton(_resolver: Resolver): { readonly id: number } {
  return { id: ++singletonFactoryCalls };
}

function createFactoryWithDeps(resolver: Resolver): {
  readonly leaf: TransientLeaf;
  readonly singleton: CachedSingleton;
} {
  return {
    leaf: resolver.resolve(TransientLeaf),
    singleton: resolver.resolve(CachedSingleton),
  };
}

@singleton()
class ConsoleLogger implements Logger {
  log(_msg: string): void {
    // Intentionally does nothing observable; avoids I/O skewing timings.
  }
}

// --- Direct cached singleton / token-bound singleton alias -------------

@singleton()
export class CachedSingleton {
  readonly id = "cached-singleton";
}

@singleton()
export class TokenBoundSingleton {
  readonly id = "token-bound-singleton";
}

// --- Transient leaf ------------------------------------------------------

@inject()
export class TransientLeaf {
  readonly id = "transient-leaf";
}

// --- Mixed transient graph (class + token + value deps), 8 nodes total --
//
// Graph shape:
//   MixedGraphRoot -> NodeB, NodeC, ConfigToken
//   NodeB          -> NodeD, NodeC
//   NodeC          -> LoggerToken
//   NodeD          -> NodeE, NodeF
//   NodeE          -> (leaf)
//   NodeF          -> ConfigToken
//   LoggerToken    -> ConsoleLogger (singleton, bound to token)
//   ConfigToken    -> value

@inject()
export class NodeE {
  readonly id = "node-e";
}

@inject(ConfigToken)
export class NodeF {
  constructor(readonly config: Config) {}
}

@inject(NodeE, NodeF)
export class NodeD {
  constructor(
    readonly e: NodeE,
    readonly f: NodeF,
  ) {}
}

@inject(LoggerToken)
export class NodeC {
  constructor(readonly logger: Logger) {}
}

@inject(NodeD, NodeC)
export class NodeB {
  constructor(
    readonly d: NodeD,
    readonly c: NodeC,
  ) {}
}

@inject(NodeB, NodeC, ConfigToken)
export class MixedGraphRoot {
  constructor(
    readonly b: NodeB,
    readonly c: NodeC,
    readonly config: Config,
  ) {}
}

// --- Singleton graph (cold first-resolve / warm cache) ------------------

@singleton()
export class SingLeafA {
  readonly id = "sing-leaf-a";
}

@singleton(SingLeafA)
export class SingLeafB {
  constructor(readonly a: SingLeafA) {}
}

@singleton(SingLeafB, SingLeafA, ConfigToken)
export class SingletonGraphRoot {
  constructor(
    readonly b: SingLeafB,
    readonly a: SingLeafA,
    readonly config: Config,
  ) {}
}

/**
 * Register every binding used by the fixtures above onto `container`.
 *
 * Used by benchmark cases that resolve repeatedly against one warmed-up
 * container (all cases except the cold-singleton-graph and container-setup
 * cases, which build/measure their own container).
 */
export function bindAll(container: Container): Container {
  container.bind(ConfigToken).toValue(configValue);
  container.bind(LoggerToken).toClass(ConsoleLogger);
  container.bind(TokenBoundSingletonToken).toClass(TokenBoundSingleton);
  container.bind(FactoryTransientToken).toFactory(createFactoryTransient);
  container.bind(FactorySingletonToken).toFactory(createFactorySingleton, { lifetime: Lifetime.Singleton });
  container.bind(FactoryWithDepsToken).toFactory(createFactoryWithDeps);
  return container;
}

/**
 * Build a fully-bound, ready-to-resolve container. Equivalent to the setup
 * work measured explicitly by the `container-setup` case.
 */
export function buildContainer(): Container {
  return bindAll(createContainer());
}

function preflight(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Benchmark fixture preflight failed: ${message}`);
  }
}

/** Fail closed if a measured fixture no longer has its claimed semantics. */
export function assertFixtureSemantics(): void {
  const container = buildContainer();

  const directSingleton = container.resolve(CachedSingleton);
  preflight(directSingleton === container.resolve(CachedSingleton), "direct singleton is not cached");

  const tokenSingleton = container.resolve(TokenBoundSingletonToken);
  preflight(
    tokenSingleton === container.resolve(TokenBoundSingletonToken) &&
      tokenSingleton === container.resolve(TokenBoundSingleton),
    "token-bound singleton does not share the class singleton cache",
  );

  const firstTransientLeaf = container.resolve(TransientLeaf);
  const secondTransientLeaf = container.resolve(TransientLeaf);
  preflight(firstTransientLeaf !== secondTransientLeaf, "transient leaf is unexpectedly cached");

  const config = container.resolve(ConfigToken);
  preflight(config === configValue, "value token does not return the bound value");

  const mixed = container.resolve(MixedGraphRoot);
  preflight(mixed.b instanceof NodeB, "mixed root did not receive NodeB");
  preflight(mixed.b.d instanceof NodeD, "NodeB did not receive NodeD");
  preflight(mixed.b.d.e instanceof NodeE, "NodeD did not receive NodeE");
  preflight(mixed.b.d.f instanceof NodeF, "NodeD did not receive NodeF");
  preflight(mixed.b.c instanceof NodeC && mixed.c instanceof NodeC, "mixed graph lacks NodeC");
  preflight(mixed.b.c !== mixed.c, "repeated transient NodeC was unexpectedly shared");
  preflight(
    mixed.config === configValue && mixed.b.d.f.config === configValue,
    "mixed graph did not receive the bound config value",
  );
  preflight(
    mixed.b.c.logger === mixed.c.logger && mixed.c.logger === container.resolve(LoggerToken),
    "mixed graph logger is not the token-bound singleton",
  );
  const nextMixed = container.resolve(MixedGraphRoot);
  preflight(
    nextMixed !== mixed && nextMixed.b !== mixed.b && nextMixed.b.d !== mixed.b.d,
    "mixed transient graph reused transient instances between resolutions",
  );

  const singletonContainer = buildContainer();
  const singletonGraph = singletonContainer.resolve(SingletonGraphRoot);
  preflight(
    singletonGraph === singletonContainer.resolve(SingletonGraphRoot),
    "singleton graph root is not cached after first resolution",
  );
  preflight(singletonGraph.b.a === singletonGraph.a, "singleton graph does not share SingLeafA");
  preflight(singletonGraph.config === configValue, "singleton graph lacks the bound config value");
  preflight(
    buildContainer().resolve(SingletonGraphRoot) !== singletonGraph,
    "singleton graph instance leaked across containers",
  );

  const factoryTransientContainer = buildContainer();
  const firstFactoryTransient = factoryTransientContainer.resolve(FactoryTransientToken);
  const secondFactoryTransient = factoryTransientContainer.resolve(FactoryTransientToken);
  preflight(firstFactoryTransient !== secondFactoryTransient, "transient factory returned cached value");

  const factorySingletonContainer = buildContainer();
  const firstFactorySingleton = factorySingletonContainer.resolve(FactorySingletonToken);
  const secondFactorySingleton = factorySingletonContainer.resolve(FactorySingletonToken);
  preflight(firstFactorySingleton === secondFactorySingleton, "singleton factory did not cache its result");

  const factoryWithDepsContainer = buildContainer();
  const firstWithDeps = factoryWithDepsContainer.resolve(FactoryWithDepsToken);
  const secondWithDeps = factoryWithDepsContainer.resolve(FactoryWithDepsToken);
  preflight(firstWithDeps.singleton === secondWithDeps.singleton, "factory with deps lost singleton");
  preflight(firstWithDeps.leaf !== secondWithDeps.leaf, "factory with deps cached transient leaf");
}
