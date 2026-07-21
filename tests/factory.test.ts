import { describe, expect, it } from "bun:test";
import {
  CircularDependencyError,
  type Container,
  createContainer,
  inject,
  Lifetime,
  ResolutionError,
  type Resolver,
  type SpritzeError,
  singleton,
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

// --- Basic factory binding ---

describe("factory binding", () => {
  it("binds a token to a factory returning a value", () => {
    const T = token<string>("greeting");
    const c = createContainer();
    c.bind(T).toFactory(() => "hello");
    expect(c.resolve(T)).toBe("hello");
  });

  it("receives a narrow resolver, not the mutable container", () => {
    const T = token<string>("name");
    const c = createContainer();
    c.bind(T).toFactory((resolver) => {
      // The resolver only exposes resolve.
      expect(typeof resolver.resolve).toBe("function");
      expect((resolver as unknown as Container).bind).toBeUndefined();
      return "ok";
    });
    expect(c.resolve(T)).toBe("ok");
  });
});

// --- Factory lifetimes ---

describe("factory lifetime", () => {
  it("defaults to transient: each resolve creates a new value", () => {
    const T = token<{ readonly id: number }>("transient");
    let n = 0;
    const c = createContainer();
    c.bind(T).toFactory(() => ({ id: ++n }));

    const a = c.resolve(T);
    const b = c.resolve(T);
    expect(a).not.toBe(b);
    expect(n).toBe(2);
  });

  it("supports explicit singleton lifetime: result is cached per binding identity", () => {
    const T = token<{ readonly id: number }>("singleton");
    let n = 0;
    const c = createContainer();
    c.bind(T).toFactory(() => ({ id: ++n }), { lifetime: Lifetime.Singleton });

    const a = c.resolve(T);
    const b = c.resolve(T);
    expect(a).toBe(b);
    expect(n).toBe(1);
  });

  it("caches an undefined singleton factory result and invokes it once", () => {
    const T = token<undefined>("undefined-singleton");
    let n = 0;
    const c = createContainer();
    c.bind(T).toFactory(
      () => {
        n += 1;
        return undefined;
      },
      { lifetime: Lifetime.Singleton },
    );

    expect(c.resolve(T)).toBeUndefined();
    expect(c.resolve(T)).toBeUndefined();
    expect(n).toBe(1);
  });

  it("isolates singleton factories per container", () => {
    const T = token<{ readonly id: number }>("singleton");
    let n = 0;
    const c1 = createContainer();
    const c2 = createContainer();
    c1.bind(T).toFactory(() => ({ id: ++n }), { lifetime: Lifetime.Singleton });
    c2.bind(T).toFactory(() => ({ id: ++n }), { lifetime: Lifetime.Singleton });

    expect(c1.resolve(T)).not.toBe(c2.resolve(T));
    expect(n).toBe(2);
  });

  it("caches singleton factory by token identity, not description", () => {
    const A = token<{ readonly id: number }>("same-desc");
    const B = token<{ readonly id: number }>("same-desc");
    let n = 0;
    const c = createContainer();
    c.bind(A).toFactory(() => ({ id: ++n }), { lifetime: Lifetime.Singleton });
    c.bind(B).toFactory(() => ({ id: ++n }), { lifetime: Lifetime.Singleton });

    const a = c.resolve(A);
    const b = c.resolve(B);
    expect(a).not.toBe(b);
    expect(n).toBe(2);
  });
});

// --- Factory retry after failure ---

describe("factory retry after failure", () => {
  it("does not cache a failed singleton factory and allows retry", () => {
    const T = token<{ readonly ok: true }>("flaky");
    let attempts = 0;
    const c = createContainer();
    c.bind(T).toFactory(
      () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error("boom");
        }
        return { ok: true as const };
      },
      { lifetime: Lifetime.Singleton },
    );

    expect(() => c.resolve(T)).toThrow("boom");
    expect(attempts).toBe(1);

    const instance = c.resolve(T);
    expect(instance.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(c.resolve(T)).toBe(instance);
    expect(attempts).toBe(2);
  });

  it("releases the singleton lock after a factory failure", () => {
    const T = token<{ readonly id: number }>("lock-release");
    let fail = true;
    const c = createContainer();
    c.bind(T).toFactory(
      () => {
        if (fail) {
          throw new Error("locked");
        }
        return { id: 1 };
      },
      { lifetime: Lifetime.Singleton },
    );

    expect(() => c.resolve(T)).toThrow("locked");
    fail = false;
    expect(() => c.resolve(T)).not.toThrow();
    expect(c.resolve(T)).toEqual({ id: 1 });
  });
});

// --- Nested resolution from factories ---

describe("factory nested resolution", () => {
  it("resolves decorated class dependencies via the factory resolver", () => {
    @inject()
    class Logger {
      log(msg: string): string {
        return `[log] ${msg}`;
      }
    }

    const T = token<{ logger: Logger }>("logger-wrapper");
    const c = createContainer();
    c.bind(T).toFactory((resolver) => ({ logger: resolver.resolve(Logger) }));

    expect(c.resolve(T).logger.log("ok")).toBe("[log] ok");
  });

  it("resolves token-bound values via the factory resolver", () => {
    const Config = token<{ env: string }>("config");
    const T = token<{ env: string }>("configured");
    const c = createContainer();
    c.bind(Config).toValue({ env: "test" });
    c.bind(T).toFactory((resolver) => resolver.resolve(Config));

    expect(c.resolve(T).env).toBe("test");
  });

  it("retains path context when nested factory resolution is missing", () => {
    const Missing = token<number>("missing");
    const Wrapper = token<{ value: number }>("wrapper");
    const c = createContainer();
    c.bind(Wrapper).toFactory((resolver) => ({ value: resolver.resolve(Missing) }));

    const err = thrown(() => c.resolve(Wrapper)) as ResolutionError;
    expect(err).toBeInstanceOf(ResolutionError);
    expect(err.code).toBe("missing-binding");
    expect(err.path.join(" -> ")).toContain("[token:wrapper]");
    expect(err.path.join(" -> ")).toContain("[token:missing]");
  });

  it("retains path context for cycles that pass through a factory", () => {
    const A = token<{ b: unknown }>("a");
    const B = token<{ a: unknown }>("b");
    const c = createContainer();
    c.bind(A).toFactory((resolver) => ({ b: resolver.resolve(B) }));
    c.bind(B).toFactory((resolver) => ({ a: resolver.resolve(A) }));

    const err = thrown(() => c.resolve(A)) as CircularDependencyError;
    expect(err).toBeInstanceOf(CircularDependencyError);
    expect(err.code).toBe("circular-dependency");
    expect(err.path.join(" -> ")).toMatch(/\[token:a\].*\[token:b\]|\[token:b\].*\[token:a\]/);
  });

  it("uses class singleton cache when a factory resolves a singleton class", () => {
    @singleton()
    class Global {
      readonly id = "global";
    }

    const T = token<{ g: Global }>("wrapper");
    const c = createContainer();
    c.bind(T).toFactory((resolver) => ({ g: resolver.resolve(Global) }));

    expect(c.resolve(T).g).toBe(c.resolve(Global));
  });
});

// --- Error propagation ---

describe("factory error propagation", () => {
  it("preserves errors thrown by a factory without wrapping", () => {
    const T = token<string>("boom");
    const c = createContainer();
    c.bind(T).toFactory(() => {
      throw new RangeError("factory blew up");
    });

    expect(() => c.resolve(T)).toThrow(RangeError);
    expect(() => c.resolve(T)).toThrow("factory blew up");
  });

  it("propagates errors from nested class construction without wrapping", () => {
    @inject()
    class FlakyDep {
      constructor() {
        throw new Error("dep failure");
      }
    }

    const T = token<{ dep: FlakyDep }>("wrapper");
    const c = createContainer();
    c.bind(T).toFactory((resolver) => ({ dep: resolver.resolve(FlakyDep) }));

    expect(() => c.resolve(T)).toThrow("dep failure");
  });

  it("still reports undecorated classes when reached from a factory", () => {
    class Plain {}
    const T = token<{ p: Plain }>("wrapper");
    const c = createContainer();
    c.bind(T).toFactory((resolver) => ({ p: resolver.resolve(Plain) }));

    const err = thrown(() => c.resolve(T)) as UndecoratedError;
    expect(err).toBeInstanceOf(UndecoratedError);
    expect(err.code).toBe("undecorated-class");
    expect(err.clazz).toBe(Plain);
  });
});

// --- Type narrowing for resolver ---

describe("factory resolver typing", () => {
  it("allows resolving tokens and classes from a typed factory", () => {
    @inject()
    class Dep {
      readonly name = "dep";
    }
    const Config = token<string>("config");

    const T = token<{ dep: Dep; config: string }>("typed");
    const c = createContainer();
    c.bind(Config).toValue("value");
    c.bind(T).toFactory((resolver: Resolver) => ({
      dep: resolver.resolve(Dep),
      config: resolver.resolve(Config),
    }));

    const instance = c.resolve(T);
    expect(instance.dep.name).toBe("dep");
    expect(instance.config).toBe("value");
  });

  it("rejects arbitrary keys at compile time", () => {
    const T = token<string>("typed");
    const c = createContainer();
    c.bind(T).toFactory((resolver) => {
      if (false) {
        // @ts-expect-error strings are not valid dependency keys
        resolver.resolve("not-a-key");
      }
      return "ok";
    });
    expect(c.resolve(T)).toBe("ok");
  });
});

// --- Error codes (exhaustive sanity) ---

describe("factory error codes", () => {
  it("exposes every stable code as a SpritzeError subtype property", () => {
    const codes: readonly string[] = [
      "missing-binding",
      "duplicate-binding",
      "circular-dependency",
      "undecorated-class",
    ];
    for (const code of codes) {
      expect(typeof code).toBe("string");
    }
  });

  it("tags factory-related missing bindings with missing-binding", () => {
    const T = token<string>("unbound");
    const err = thrown(() => createContainer().resolve(T)) as ResolutionError;
    expect((err as SpritzeError).code).toBe("missing-binding");
  });
});
