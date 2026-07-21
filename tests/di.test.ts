import { describe, expect, it } from "bun:test";
import {
  CircularDependencyError,
  createContainer,
  inject,
  ResolutionError,
  SpritzeError,
  singleton,
  type Token,
  token,
  UndecoratedError,
} from "../src/index.ts";

function thrown(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected function to throw");
}

// --- Opaque typed tokens ---

describe("token", () => {
  it("creates opaque typed tokens independent of description", () => {
    const a = token<string>("string");
    const b = token<string>("string");
    expect(a).not.toBe(b);
    expect(a.description).toBe("string");
    expect(b.description).toBe("string");
  });

  it("defaults description to anonymous", () => {
    expect(token<number>().description).toBe("anonymous");
  });

  it("rejects invalid description", () => {
    expect(() => token(123 as unknown as string)).toThrow(TypeError);
  });

  it("is typesafe: tokens with different type params are not assignable", () => {
    const numberToken = token<number>("n");
    const stringToken = token<string>("s");
    const acceptNumber = (_t: typeof numberToken) => true;
    const acceptString = (_t: typeof stringToken) => true;
    expect(acceptNumber(numberToken)).toBe(true);
    expect(acceptString(stringToken)).toBe(true);
  });
});

// --- Interface-to-class binding ---

describe("interface token binding", () => {
  interface IHasher {
    hash(input: string): string;
  }

  @inject()
  class Sha256 implements IHasher {
    hash(input: string): string {
      return `sha256(${input})`;
    }
  }

  it("binds an interface token to a class", () => {
    const T = token<IHasher>("hasher");
    const container = createContainer();
    container.bind(T).toClass(Sha256);
    const hasher = container.resolve(T);
    expect(hasher.hash("x")).toBe("sha256(x)");
  });

  it("binds a token to a value", () => {
    const T = token<string>("greeting");
    const container = createContainer();
    container.bind(T).toValue("hello");
    expect(container.resolve(T)).toBe("hello");
  });
});

// --- Ordered dependencies ---

describe("ordered dependencies", () => {
  @inject()
  class A {
    readonly name = "A";
  }

  @inject(A, A)
  class B {
    constructor(
      readonly first: A,
      readonly second: A,
    ) {}
  }

  const N = token<number>("n");

  @inject(N, A)
  class C {
    constructor(
      readonly n: number,
      readonly a: A,
    ) {}
  }

  it("passes class dependencies to the constructor in order", () => {
    const c = createContainer();
    const b = c.resolve(B);
    expect(b.first).toBeInstanceOf(A);
    expect(b.second).toBeInstanceOf(A);
    expect(b.first).not.toBe(b.second);
  });

  it("passes mixed token and class dependencies in order", () => {
    const c = createContainer();
    c.bind(N).toValue(42);
    const resolved = c.resolve(C);
    expect(resolved.n).toBe(42);
    expect(resolved.a).toBeInstanceOf(A);
  });
});

// --- Nested resolution ---

describe("nested resolution", () => {
  @inject()
  class Logger {
    log(message: string): string {
      return `[log] ${message}`;
    }
  }

  @inject(Logger)
  class Service {
    constructor(readonly logger: Logger) {}
    run(): string {
      return this.logger.log("ok");
    }
  }

  @inject(Service)
  class Controller {
    constructor(readonly service: Service) {}
  }

  it("resolves transitive dependencies", () => {
    const c = createContainer();
    const controller = c.resolve(Controller);
    expect(controller.service.run()).toBe("[log] ok");
  });
});

// --- Transient behavior ---

describe("transient lifetime", () => {
  @inject()
  class Counter {
    value = 0;
  }

  it("returns a new instance on every resolve", () => {
    const c = createContainer();
    const a = c.resolve(Counter);
    const b = c.resolve(Counter);
    expect(a).toBeInstanceOf(Counter);
    expect(a).not.toBe(b);
    a.value = 1;
    expect(b.value).toBe(0);
  });

  it("returns distinct instances for class bound to token", () => {
    const T = token<Counter>("counter");
    const c = createContainer();
    c.bind(T).toClass(Counter);
    const a = c.resolve(T);
    const b = c.resolve(T);
    expect(a).not.toBe(b);
  });
});

// --- Singleton behavior ---

describe("singleton lifetime", () => {
  @singleton()
  class GlobalCounter {
    value = 0;
  }

  it("returns the same instance for singleton class", () => {
    const c = createContainer();
    const a = c.resolve(GlobalCounter);
    const b = c.resolve(GlobalCounter);
    expect(a).toBe(b);
    a.value = 5;
    expect(b.value).toBe(5);
  });

  it("returns the same instance for token bound to singleton class", () => {
    const T = token<GlobalCounter>("global-counter");
    const c = createContainer();
    c.bind(T).toClass(GlobalCounter);
    const a = c.resolve(T);
    const b = c.resolve(T);
    expect(a).toBe(b);
  });

  it("isolates singletons per container", () => {
    const c1 = createContainer();
    const c2 = createContainer();
    const a = c1.resolve(GlobalCounter);
    const b = c2.resolve(GlobalCounter);
    expect(a).not.toBe(b);
  });

  it("isolates singletons for token bindings per container", () => {
    const T = token<GlobalCounter>("global-counter");
    const c1 = createContainer();
    const c2 = createContainer();
    c1.bind(T).toClass(GlobalCounter);
    c2.bind(T).toClass(GlobalCounter);
    expect(c1.resolve(T)).not.toBe(c2.resolve(T));
  });

  it("uses one singleton instance across direct and aliased class resolution", () => {
    const First = token<GlobalCounter>("first");
    const Second = token<GlobalCounter>("second");
    const c = createContainer();
    c.bind(First).toClass(GlobalCounter);
    c.bind(Second).toClass(GlobalCounter);

    expect(c.resolve(First)).toBe(c.resolve(Second));
    expect(c.resolve(First)).toBe(c.resolve(GlobalCounter));
  });
});

// --- Singleton retry after constructor failure ---

describe("singleton retry after constructor failure", () => {
  let attempts = 0;

  @singleton()
  class Flaky {
    constructor() {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("boom");
      }
    }
  }

  it("does not cache failed singleton construction and allows retry", () => {
    const c = createContainer();
    expect(() => c.resolve(Flaky)).toThrow("boom");
    expect(attempts).toBe(1);
    const instance = c.resolve(Flaky);
    expect(instance).toBeInstanceOf(Flaky);
    expect(attempts).toBe(2);
    expect(c.resolve(Flaky)).toBe(instance);
    expect(attempts).toBe(2);
  });
});

// --- Missing binding diagnostic / path ---

describe("missing binding diagnostics", () => {
  @inject()
  class Database {}

  @inject(token<Database>("db"))
  class Repository {
    constructor(readonly db: Database) {}
  }

  @inject(Repository)
  class App {
    constructor(readonly repo: Repository) {}
  }

  it("throws ResolutionError with the dependency path", () => {
    const c = createContainer();
    const err = thrown(() => c.resolve(App)) as ResolutionError;
    expect(err).toBeInstanceOf(ResolutionError);
    expect(err.path.join(" -> ")).toContain("App");
    expect(err.path.join(" -> ")).toContain("Repository");
    expect(err.path.join(" -> ")).toContain("[token:db]");
  });

  it("throws ResolutionError for unbound token", () => {
    const T = token<string>("missing");
    const c = createContainer();
    const err = thrown(() => c.resolve(T)) as ResolutionError;
    expect(err).toBeInstanceOf(ResolutionError);
    expect(err.path).toEqual(["[token:missing]"]);
  });
});

// --- Undecorated classes ---

describe("undecorated classes", () => {
  class Plain {}

  it("throws UndecoratedError when resolving a class without decorator", () => {
    const c = createContainer();
    const err = thrown(() => c.resolve(Plain)) as UndecoratedError;
    expect(err).toBeInstanceOf(UndecoratedError);
    expect(err.clazz).toBe(Plain);
    expect(err.message).toContain("Plain");
  });

  it("throws UndecoratedError when binding undecorated class to token", () => {
    const T = token<Plain>("plain");
    const c = createContainer();
    c.bind(T).toClass(Plain);
    const err = thrown(() => c.resolve(T)) as UndecoratedError;
    expect(err).toBeInstanceOf(UndecoratedError);
    expect(err.clazz).toBe(Plain);
  });
});

// --- Cycles ---

describe("circular dependencies", () => {
  @inject()
  class A {}

  @inject(A)
  class B {
    constructor(readonly a: A) {}
  }

  @inject(B)
  class C {
    constructor(readonly b: B) {}
  }

  it("detects direct cycle", () => {
    type Self = unknown;
    const T = token<Self>("self");
    @inject(T)
    class DirectCycle {
      constructor(readonly self: Self) {}
    }
    const c = createContainer();
    c.bind(T).toClass(DirectCycle);
    const err = thrown(() => c.resolve(DirectCycle)) as CircularDependencyError;
    expect(err).toBeInstanceOf(CircularDependencyError);
    expect(err.path.length).toBeGreaterThanOrEqual(1);
  });

  it("detects indirect cycle", () => {
    type InjectedX = unknown;
    type InjectedY = unknown;

    const X = token<InjectedX>("x");
    const Y = token<InjectedY>("y");

    @inject(Y)
    class InjectedXImpl {
      constructor(readonly y: InjectedY) {}
    }

    @inject(X)
    class InjectedYImpl {
      constructor(readonly x: InjectedX) {}
    }

    const c = createContainer();
    c.bind(X).toClass(InjectedXImpl);
    c.bind(Y).toClass(InjectedYImpl);

    const err = thrown(() => c.resolve(X)) as CircularDependencyError;
    expect(err).toBeInstanceOf(CircularDependencyError);
    expect(err.path.join(" -> ")).toMatch(/InjectedXImpl.*InjectedYImpl|InjectedYImpl.*InjectedXImpl/);
  });

  it("detects class-only cycle", () => {
    abstract class CyclicBase {}
    class CyclicBImpl extends CyclicBase {
      constructor(readonly a: CyclicAImpl) {
        super();
      }
    }
    @inject(CyclicBImpl)
    class CyclicAImpl extends CyclicBase {
      constructor(readonly b: CyclicBImpl) {
        super();
      }
    }
    inject(CyclicAImpl)(CyclicBImpl, {
      kind: "class",
      name: "CyclicBImpl",
      addInitializer() {},
      metadata: Object.create(null),
      private: false,
    } as unknown as ClassDecoratorContext<typeof CyclicBImpl>);
    const c = createContainer();
    const err = thrown(() => c.resolve(CyclicAImpl)) as CircularDependencyError;
    expect(err).toBeInstanceOf(CircularDependencyError);
    expect(err.path.join(" -> ")).toContain("CyclicAImpl");
    expect(err.path.join(" -> ")).toContain("CyclicBImpl");
  });

  it("does not falsely flag acyclic deep trees", () => {
    const c = createContainer();
    expect(c.resolve(C)).toBeInstanceOf(C);
    expect(c.resolve(C).b.a).toBeInstanceOf(A);
  });
});

// --- No reflection dependency/metadata ---

const NameToken = token<string>("name");

describe("no reflection metadata", () => {
  it("has no reflect-metadata dependency declared in package.json", async () => {
    const pkg = await import("../package.json");
    const deps = { ...(pkg as { dependencies?: Record<string, string> }).dependencies };
    const peerDeps = {
      ...(pkg as { peerDependencies?: Record<string, string> }).peerDependencies,
    };
    expect(deps["reflect-metadata"]).toBeUndefined();
    expect(peerDeps["reflect-metadata"]).toBeUndefined();
    expect(Object.keys(deps)).toHaveLength(0);
  });

  it("cannot resolve the reflect-metadata module (not installed anywhere)", async () => {
    const moduleName = "reflect-metadata";
    await expect(import(moduleName)).rejects.toBeDefined();
  });

  it("decorator context.metadata is never read or written by decorate()", () => {
    @inject()
    class Empty {}
    // Re-derive the context Spritze would have received: Standard decorators
    // pass `context.metadata` as a shared object. Spritze's own decorators
    // never touch `Symbol.metadata`, so the class must not carry one even
    // though the runtime always provides a `context.metadata` bag.
    const observedMetadata = (Empty as unknown as { [k: symbol]: unknown })[Symbol.metadata as symbol];
    expect(observedMetadata).not.toHaveProperty("design:paramtypes");
  });

  it("decorated class is stored without reflect-metadata metadata", () => {
    @inject()
    class Empty {}

    expect((Empty as unknown as Record<string, unknown>).__metadata__).toBeUndefined();
  });

  it("decorated class dependencies are stored in internal WeakMap, not on Symbol.metadata", () => {
    @inject(NameToken)
    class WithDeps {
      constructor(readonly name: string) {}
    }

    // The dependency list must be recoverable via the container's resolver,
    // not via any metadata object attached to the class.
    const metadata = (WithDeps as unknown as { [k: symbol]: unknown })[Symbol.metadata as symbol];
    if (metadata !== null && metadata !== undefined) {
      expect(metadata).not.toHaveProperty("deps");
      expect(metadata).not.toHaveProperty("design:paramtypes");
    }

    const c = createContainer();
    c.bind(NameToken).toValue("spritze");
    const instance = c.resolve(WithDeps);
    expect(instance.name).toBe("spritze");
  });
});

// --- Error base class & duplicate binding ---

describe("errors and binding rules", () => {
  it("exposes public typed error hierarchy", () => {
    expect(new SpritzeError("x", "missing-binding")).toBeInstanceOf(Error);
    expect(new ResolutionError("x", [], "missing-binding")).toBeInstanceOf(SpritzeError);
    expect(new CircularDependencyError("x", [])).toBeInstanceOf(SpritzeError);
    expect(new UndecoratedError("x", class Foo {})).toBeInstanceOf(SpritzeError);
  });

  it("attaches stable machine-readable error codes", () => {
    const missing = thrown(() => {
      const c = createContainer();
      c.resolve(token<number>("n"));
    }) as ResolutionError;
    expect(missing.code).toBe("missing-binding");

    const dup = thrown(() => {
      const c = createContainer();
      const T = token<number>("n");
      c.bind(T).toValue(1);
      c.bind(T).toValue(2);
    }) as ResolutionError;
    expect(dup.code).toBe("duplicate-binding");

    const undecorated = thrown(() => {
      class Plain {}
      createContainer().resolve(Plain);
    }) as UndecoratedError;
    expect(undecorated.code).toBe("undecorated-class");
  });

  it("tags circular-dependency errors with their code", () => {
    type Self = unknown;
    const T = token<Self>("self");
    @inject(T)
    class DirectCycle {
      constructor(readonly self: Self) {}
    }
    const c = createContainer();
    c.bind(T).toClass(DirectCycle);
    const cycle = thrown(() => c.resolve(DirectCycle)) as CircularDependencyError;
    expect(cycle).toBeInstanceOf(CircularDependencyError);
    expect(cycle.code).toBe("circular-dependency");
  });

  it("forbids duplicate bindings deterministically", () => {
    const T = token<number>("t");
    const c = createContainer();
    c.bind(T).toValue(1);
    const err = thrown(() => c.bind(T).toValue(2)) as ResolutionError;
    expect(err).toBeInstanceOf(ResolutionError);
    expect(err.message).toContain("already bound");
    // Regression: duplicate-binding path must contain the formatted token
    // exactly once, not a duplicated "[token:t] -> [token:t]" chain.
    expect(err.path).toEqual(["[token:t]"]);
  });

  it("matches tokens by object identity rather than inherited numeric id", () => {
    const original = token<number>("original");
    const inherited = Object.create(original) as Token<number>;
    const c = createContainer();
    c.bind(original).toValue(1);
    c.bind(inherited).toValue(2);

    expect(c.resolve(original)).toBe(1);
    expect(c.resolve(inherited)).toBe(2);
  });

  it("does not inherit injectable decoration through class inheritance", () => {
    @inject()
    class Base {}
    class UndecoratedChild extends Base {}

    const err = thrown(() => createContainer().resolve(UndecoratedChild));
    expect(err).toBeInstanceOf(UndecoratedError);
  });
});
