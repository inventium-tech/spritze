import { type Dep, getDefinition, Lifetime } from "./decorators.ts";
import {
  CircularDependencyError,
  formatKey,
  formatPath,
  formatPathStrings,
  ResolutionError,
  UndecoratedError,
} from "./errors.ts";
import type { Token } from "./token.ts";

type FactoryFn<T> = (resolver: Resolver) => T;

type BindingTarget<T> =
  | { readonly kind: "class"; readonly clazz: Injectable<T> }
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "factory"; readonly factory: FactoryFn<T>; readonly lifetime: Lifetime };

type Key = Token<unknown> | (new (...args: never[]) => unknown);

/**
 * Resolution-aware resolver passed to factory functions.
 *
 * It exposes only `resolve`; the mutable container API (bind, etc.) is not
 * available, keeping factories focused on construction-time dependency lookup.
 */
export interface Resolver {
  /** Resolve a token from the container. */
  resolve<T>(key: Token<T>): T;
  /** Resolve a decorated class from the container. */
  resolve<T>(key: Injectable<T>): T;
}

class Binding<T> {
  constructor(
    public readonly token: Token<T>,
    public readonly target: BindingTarget<T>,
  ) {}
}

/**
 * A constructor whose parameters may be verified against a dependency list.
 * This alias is kept abstract so interface-to-class bindings remain ergonomic.
 */
type Injectable<T> = (new (...args: never[]) => T) | (abstract new (...args: never[]) => T);

/**
 * Fluent builder returned by `container.bind(token)`.
 */
export interface BindTo<T> {
  /**
   * Bind the token to an injectable class.
   *
   * The class must have been decorated with `@inject(...)` or
   * `@singleton(...)`; bindings to undecorated classes fail at resolve time.
   */
  toClass(clazz: Injectable<T>): Container;
  /**
   * Bind the token to a pre-created value.
   */
  toValue(value: T): Container;
  /**
   * Bind the token to a synchronous factory function.
   *
   * The factory receives a narrow, resolution-aware resolver (not the mutable
   * container). Factory lifetime defaults to transient; pass
   * `{ lifetime: Lifetime.Singleton }` for per-binding singleton caching.
   */
  toFactory(factory: FactoryFn<T>, opts?: { readonly lifetime?: Lifetime }): Container;
}

class BindToBuilder<T> implements BindTo<T> {
  constructor(
    private readonly container: ContainerImpl,
    private readonly token: Token<T>,
  ) {}

  toClass(clazz: Injectable<T>): Container {
    this.container.addBinding(new Binding<T>(this.token, { kind: "class", clazz }));
    return this.container;
  }

  toValue(value: T): Container {
    this.container.addBinding(new Binding<T>(this.token, { kind: "value", value }));
    return this.container;
  }

  toFactory(factory: FactoryFn<T>, opts: { readonly lifetime?: Lifetime } = {}): Container {
    this.container.addBinding(
      new Binding<T>(this.token, {
        kind: "factory",
        factory,
        lifetime: opts.lifetime ?? Lifetime.Transient,
      }),
    );
    return this.container;
  }
}

export interface Container {
  /**
   * Start binding `token` to an implementation.
   */
  bind<T>(token: Token<T>): BindTo<T>;
  /**
   * Resolve a token from the container.
   */
  resolve<T>(key: Token<T>): T;
  /**
   * Resolve a decorated class from the container.
   */
  resolve<T>(key: Injectable<T>): T;
}

interface ResolutionState<T> {
  readonly token: Token<T> | undefined;
  readonly clazz: (new (...args: never[]) => T) | undefined;
}

class ContainerImpl implements Container {
  private readonly bindings = new Map<Token<unknown>, Binding<unknown>>();
  private readonly singletonCache = new Map<new (...args: never[]) => unknown, unknown>();
  private readonly singletonLocks = new Set<new (...args: never[]) => unknown>();
  private readonly factorySingletonCache = new Map<Token<unknown>, unknown>();
  private readonly factorySingletonLocks = new Set<Token<unknown>>();

  bind<T>(token: Token<T>): BindTo<T> {
    return new BindToBuilder<T>(this, token);
  }

  addBinding<T>(binding: Binding<T>): void {
    if (this.bindings.has(binding.token)) {
      throw new ResolutionError(
        `Token ${binding.token.description} is already bound`,
        this.duplicatePath(binding.token),
        "duplicate-binding",
      );
    }
    this.bindings.set(binding.token, binding as Binding<unknown>);
  }

  private duplicatePath(token: Token<unknown>): readonly string[] {
    return [formatPath([token])];
  }

  resolve<T>(key: Token<T>): T;
  resolve<T>(key: Injectable<T>): T;
  resolve<T>(key: Token<T> | Injectable<T>): T {
    return this.resolveInternal(key as Key, []) as T;
  }

  private resolveInternal<T>(key: Key, stack: Key[]): T {
    const state = this.identify<T>(key);

    if (state.token) {
      const target = this.bindings.get(state.token)?.target;
      if (target?.kind === "value") {
        return target.value as T;
      }
      if (target?.kind === "factory") {
        return this.resolveFactory(
          state.token,
          target as { readonly kind: "factory"; readonly factory: FactoryFn<T>; readonly lifetime: Lifetime },
          stack,
        );
      }
    }

    if (!state.clazz) {
      const path = [...stack, key];
      throw new ResolutionError(
        `No binding registered for ${formatPath([key])}`,
        [formatPath(path)],
        "missing-binding",
      );
    }

    const targetClass = state.clazz;
    const definition = getDefinition(targetClass);
    if (!definition) {
      throw new UndecoratedError(
        `Class ${targetClass.name || "(anonymous)"} is not decorated with @inject or @singleton`,
        targetClass,
      );
    }

    const path = [...stack, key];

    if (definition.lifetime === Lifetime.Singleton) {
      return this.resolveSingleton(key, targetClass, definition, stack, path);
    }

    this.detectCycle(targetClass, stack);
    return this.construct(targetClass, definition.deps, path);
  }

  private identify<T>(key: Key): ResolutionState<T> {
    if (typeof key === "function") {
      return {
        token: undefined,
        clazz: key as unknown as new (...args: never[]) => T,
      };
    }
    const token = key as Token<T>;
    const binding = this.bindings.get(token);
    const target = binding?.target;
    const clazz =
      target?.kind === "class"
        ? (target as { readonly kind: "class"; readonly clazz: new (...args: never[]) => T }).clazz
        : undefined;
    return { token, clazz };
  }

  private resolveFactory<T>(
    token: Token<T>,
    target: { readonly kind: "factory"; readonly factory: FactoryFn<T>; readonly lifetime: Lifetime },
    stack: Key[],
  ): T {
    if (target.lifetime === Lifetime.Singleton) {
      if (this.factorySingletonCache.has(token)) {
        return this.factorySingletonCache.get(token) as T;
      }

      this.detectCycle(token, stack);

      if (this.factorySingletonLocks.has(token)) {
        const path = [...stack, token];
        const formatted = path.map((p) => formatKey(p));
        throw new CircularDependencyError(
          `Circular dependency detected while constructing singleton factory ${formatPathStrings(formatted)}`,
          formatted,
        );
      }

      this.factorySingletonLocks.add(token);
      try {
        const instance = this.invokeFactory(token, target.factory, stack);
        this.factorySingletonCache.set(token, instance);
        return instance;
      } finally {
        this.factorySingletonLocks.delete(token);
      }
    }

    this.detectCycle(token, stack);
    return this.invokeFactory(token, target.factory, stack);
  }

  private invokeFactory<T>(token: Token<T>, factory: FactoryFn<T>, stack: Key[]): T {
    const nextStack = [...stack, token];

    const resolve = <U>(key: Token<U> | Injectable<U>): U => this.resolveInternal(key as Key, nextStack) as U;

    const resolver: Resolver = {
      resolve,
    } as Resolver;

    return factory(resolver);
  }

  private resolveSingleton<T>(
    _key: Key,
    clazz: new (...args: never[]) => T,
    definition: { readonly lifetime: Lifetime; readonly deps: readonly Dep[] },
    stack: Key[],
    path: Key[],
  ): T {
    if (this.singletonCache.has(clazz)) {
      return this.singletonCache.get(clazz) as T;
    }

    this.detectCycle(clazz, stack);

    if (this.singletonLocks.has(clazz)) {
      const formatted = path.map((p) => formatKey(p));
      throw new CircularDependencyError(
        `Circular dependency detected while constructing singleton ${formatPathStrings(formatted)}`,
        formatted,
      );
    }

    this.singletonLocks.add(clazz);
    try {
      const instance = this.construct(clazz, definition.deps, path);
      this.singletonCache.set(clazz, instance);
      return instance;
    } finally {
      this.singletonLocks.delete(clazz);
    }
  }

  private detectCycle(key: Key, stack: Key[]): void {
    const seen = stack.indexOf(key);
    if (seen !== -1) {
      const full = [...stack, key].map((p) => formatKey(p));
      throw new CircularDependencyError(`Circular dependency detected: ${formatPathStrings(full)}`, full);
    }
  }

  private construct<T>(clazz: new (...args: never[]) => T, deps: readonly Dep[], path: Key[]): T {
    const nextStack = [...path, clazz];
    const args = deps.map((dep) => this.resolveInternal(dep, nextStack)) as never[];
    return new clazz(...args);
  }
}

/**
 * Create a new, empty dependency injection container.
 */
export function createContainer(): Container {
  return new ContainerImpl();
}
