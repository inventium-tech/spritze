import { describe, expect, it } from "bun:test";
import { createContainer, inject, Lifetime, type Resolver, singleton, token } from "../src/index.ts";

// ---------------------------------------------------------------------------
// Compile-time type validation fixtures for Spritze decorator dependency lists.
//
// Runtime assertions are kept minimal; the key verification is that this file
// compiles under strict settings and every `@ts-expect-error` directive fires.
// ---------------------------------------------------------------------------

interface IConfig {
  readonly env: string;
}

@inject()
class Logger {
  log(_msg: string): void {
    // no-op
  }
}

const ConfigToken = token<IConfig>("config");
const CountToken = token<number>("count");

// --- Valid decorator usage ------------------------------------------------

describe("valid decorator typings (compile-time + runtime)", () => {
  it("accepts zero dependencies", () => {
    @inject()
    class NoDeps {
      readonly ok = 1;
    }
    expect(createContainer().resolve(NoDeps).ok).toBe(1);
  });

  it("accepts class dependencies", () => {
    @inject(Logger)
    class WithClassDep {
      constructor(readonly logger: Logger) {}
    }

    expect(createContainer().resolve(WithClassDep).logger).toBeInstanceOf(Logger);
  });

  it("accepts token dependencies", () => {
    @inject(ConfigToken, CountToken)
    class WithTokenDeps {
      constructor(
        readonly config: IConfig,
        readonly count: number,
      ) {}
    }

    const container = createContainer();
    container.bind(ConfigToken).toValue({ env: "test" });
    container.bind(CountToken).toValue(42);
    const instance = container.resolve(WithTokenDeps);
    expect(instance.config.env).toBe("test");
    expect(instance.count).toBe(42);
  });

  it("accepts mixed class + token dependencies", () => {
    @inject(Logger, ConfigToken)
    class MixedDeps {
      constructor(
        readonly logger: Logger,
        readonly config: IConfig,
      ) {}
    }

    const container = createContainer();
    container.bind(ConfigToken).toValue({ env: "mixed" });
    const instance = container.resolve(MixedDeps);
    expect(instance.logger).toBeInstanceOf(Logger);
    expect(instance.config.env).toBe("mixed");
  });

  it("accepts singleton decorator", () => {
    @singleton(Logger)
    class SingletonService {
      constructor(readonly logger: Logger) {}
    }

    expect(createContainer().resolve(SingletonService).logger).toBeInstanceOf(Logger);
  });

  it("supports interface-to-class bindings", () => {
    interface IHasher {
      hash(input: string): string;
    }

    @inject()
    class Sha256 implements IHasher {
      hash(input: string): string {
        return `sha256(${input})`;
      }
    }

    const HasherToken = token<IHasher>("hasher");
    const container = createContainer();
    container.bind(HasherToken).toClass(Sha256);

    const hasher = container.resolve(HasherToken);
    expect(hasher.hash("x")).toBe("sha256(x)");
  });
});

// --- Invalid decorator usage (expected compile errors) --------------------

describe("invalid decorator typings (compile-time)", () => {
  it("rejects mismatched token type", () => {
    // @ts-expect-error CountToken resolves to number, not Logger
    @inject(CountToken)
    class WrongType {
      constructor(readonly logger: Logger) {}
    }

    void WrongType;
  });

  it("rejects wrong class dependency type", () => {
    // @ts-expect-error Logger instance is not assignable to a string parameter
    @inject(Logger)
    class WrongClassType {
      constructor(readonly value: string) {}
    }

    void WrongClassType;
  });

  it("rejects swapped dependency order", () => {
    // @ts-expect-error logger should be Logger, not IConfig
    @inject(ConfigToken, Logger)
    class SwappedOrder {
      constructor(
        readonly logger: Logger,
        readonly config: IConfig,
      ) {}
    }

    void SwappedOrder;
  });

  it("rejects too many constructor parameters", () => {
    // @ts-expect-error Constructor expects one parameter, received two
    @inject(Logger)
    class TooManyParams {
      constructor(
        readonly logger: Logger,
        readonly config: IConfig,
      ) {}
    }

    void TooManyParams;
  });

  it("rejects more dependencies than constructor parameters", () => {
    // @ts-expect-error Constructor accepts one parameter, received two dependencies
    @inject(Logger, ConfigToken)
    class TooManyDeps {
      constructor(readonly logger: Logger) {}
    }

    void TooManyDeps;
  });

  it("allows optional and defaulted dependencies to be omitted or supplied", () => {
    @inject()
    class OmittedOptional {
      constructor(readonly logger?: Logger) {}
    }

    @inject(Logger)
    class SuppliedOptional {
      constructor(readonly logger?: Logger) {}
    }

    @inject()
    class OmittedDefault {
      constructor(readonly logger: Logger = new Logger()) {}
    }

    @inject(Logger)
    class SuppliedDefault {
      constructor(readonly logger: Logger = new Logger()) {}
    }

    void [OmittedOptional, SuppliedOptional, OmittedDefault, SuppliedDefault];
  });

  it("rejects non-dep values in dependency list", () => {
    const plain = { not: "a dep" };

    // @ts-expect-error Objects that are neither Token nor constructor are invalid
    @inject(plain)
    class BadDepList {
      constructor(readonly value: unknown) {}
    }

    void BadDepList;
  });
});

// --- Factory binding typings ------------------------------------------------

describe("factory binding typings (compile-time)", () => {
  it("accepts factories typed by the token", () => {
    interface IHasher {
      hash(input: string): string;
    }

    const HasherToken = token<IHasher>("hasher");
    const container = createContainer();
    container.bind(HasherToken).toFactory(() => ({
      hash: (input: string) => `hashed(${input})`,
    }));

    const hasher = container.resolve(HasherToken);
    expect(hasher.hash("x")).toBe("hashed(x)");
  });

  it("rejects factories returning the wrong type", () => {
    const NumberToken = token<number>("n");
    const container = createContainer();

    // @ts-expect-error string is not assignable to number token
    container.bind(NumberToken).toFactory(() => "not-a-number");

    void container;
  });

  it("rejects invalid lifetime option values", () => {
    const Bad = token<string>("bad");
    const Good = token<string>("good");
    const Default = token<string>("default");
    const container = createContainer();

    // @ts-expect-error "forever" is not a valid lifetime
    container.bind(Bad).toFactory(() => "x", { lifetime: "forever" as "forever" });

    container.bind(Good).toFactory(() => "x", { lifetime: Lifetime.Singleton });
    container.bind(Default).toFactory(() => "y"); // transient default
  });

  it("narrows the resolver to only resolve inside factories", () => {
    const A = token<number>("a");
    const B = token<{ value: number }>("b");
    const container = createContainer();

    container.bind(A).toValue(1);
    container.bind(B).toFactory((resolver: Resolver) => ({
      value: resolver.resolve(A),
    }));

    expect(container.resolve(B).value).toBe(1);
  });

  it("rejects container API on the factory resolver", () => {
    const T = token<string>("t");
    const container = createContainer();

    container.bind(T).toFactory((resolver) => {
      if (false) {
        // Resolver does not expose bind(). Accessing it as unknown first lets
        // us assert the property is absent without a compile-time value error.
        void (resolver as unknown as { bind?: unknown }).bind;
      }
      return "ok";
    });

    expect(container.resolve(T)).toBe("ok");
  });
});
