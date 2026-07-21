/**
 * Interface tokens: TypeScript interfaces are erased at runtime, so spritze
 * uses opaque typed tokens (`token<T>`) as the runtime identity for a contract.
 * The consumer depends only on the token and interface; the concrete class is
 * wired at composition time with `bind(token).toClass(...)`.
 *
 * Run: `bun run examples/interfaces.ts`
 */
import { createContainer, inject, token } from "../src/index.ts";

interface ILogger {
  log(message: string): string;
}

// Runtime identity for the erased `ILogger` interface.
const ILoggerToken = token<ILogger>("ILogger");

// Concrete implementation. It must also be decorated: decoration tells the
// container the class participates in injection, both when resolved directly
// and when bound as a target implementation.
@inject()
class ConsoleLogger implements ILogger {
  log(message: string): string {
    return `[console] ${message}`;
  }
}

// Consumer depending on the interface via its token.
@inject(ILoggerToken)
class GreeterService {
  constructor(private readonly logger: ILogger) {}

  greet(name: string): string {
    this.logger.log(`greeting ${name}`);
    return `Hello, ${name}!`;
  }
}

const container = createContainer();
container.bind(ILoggerToken).toClass(ConsoleLogger);

const greeter = container.resolve(GreeterService);
const result = greeter.greet("world");
console.log(result); // -> "Hello, world!"

// Resolving the same logger by token returns the same instance (default transient).
const logger = container.resolve(ILoggerToken);
console.log(logger.log("resolved via ILoggerToken"));
if (logger.log("test") !== "[console] test") {
  throw new Error("interfaces example failed");
}
if (result !== "Hello, world!") {
  throw new Error("interfaces example failed");
}
