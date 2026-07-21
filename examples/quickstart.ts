/**
 * Quickstart: opaque tokens, `@inject`, `bind(token).toClass/.toValue`, and
 * `resolve()` for both tokens and decorated classes.
 *
 * Run: `bun run examples/quickstart.ts`
 */
import { createContainer, inject, token } from "../src/index.ts";

// A decorated class can be resolved directly by its own constructor, with no
// binding required.
@inject()
class Logger {
  log(message: string): string {
    return `[log] ${message}`;
  }
}

// Tokens let you bind an interface/contract to a concrete implementation
// without the consumer depending on the concrete class.
interface Greeter {
  greet(name: string): string;
}

@inject(Logger)
class EnglishGreeter implements Greeter {
  constructor(private readonly logger: Logger) {}

  greet(name: string): string {
    this.logger.log(`greeting ${name}`);
    return `Hello, ${name}!`;
  }
}

const GreeterToken = token<Greeter>("Greeter");

const container = createContainer();
container.bind(GreeterToken).toClass(EnglishGreeter);

// Resolve by token.
const greeter = container.resolve(GreeterToken);
console.log(greeter.greet("world")); // -> "Hello, world!"

// Resolve a decorated class directly, without any binding.
const logger = container.resolve(Logger);
console.log(logger.log("resolved Logger directly"));

// `bind(token).toValue()` wires a token to a plain, already-constructed value.
const AppNameToken = token<string>("AppName");
container.bind(AppNameToken).toValue("spritze-quickstart");
console.log(container.resolve(AppNameToken));

if (greeter.greet("world") !== "Hello, world!") {
  throw new Error("quickstart example failed");
}
