/**
 * Handling failures by stable `code`: `missing-binding`, `duplicate-binding`,
 * `circular-dependency`, `undecorated-class`.
 *
 * Every error thrown by Spritze's public API is a `SpritzeError` subclass
 * with a `code: SpritzeErrorCode`. Switch on `code`, not on error class or
 * message text, for stable programmatic handling.
 *
 * Run: `bun run examples/errors.ts`
 */
import { createContainer, inject, SpritzeError, type SpritzeErrorCode, token } from "../src/index.ts";

function describeFailure(err: unknown): string {
  if (!(err instanceof SpritzeError)) {
    throw err;
  }
  const code: SpritzeErrorCode = err.code;
  switch (code) {
    case "missing-binding":
      return `missing-binding: ${err.message}`;
    case "duplicate-binding":
      return `duplicate-binding: ${err.message}`;
    case "circular-dependency":
      return `circular-dependency: ${err.message}`;
    case "undecorated-class":
      return `undecorated-class: ${err.message}`;
  }
}

// --- missing-binding: resolving an unbound token -----------------------
{
  const Missing = token<string>("missing");
  const container = createContainer();
  try {
    container.resolve(Missing);
  } catch (err) {
    console.log(describeFailure(err));
  }
}

// --- duplicate-binding: binding the same token twice --------------------
{
  const T = token<number>("dup");
  const container = createContainer();
  container.bind(T).toValue(1);
  try {
    container.bind(T).toValue(2);
  } catch (err) {
    console.log(describeFailure(err));
  }
}

// --- circular-dependency: two classes depending on each other -----------
{
  const X = token<unknown>("x");
  const Y = token<unknown>("y");

  @inject(Y)
  class XImpl {
    constructor(readonly y: unknown) {}
  }

  @inject(X)
  class YImpl {
    constructor(readonly x: unknown) {}
  }

  const container = createContainer();
  container.bind(X).toClass(XImpl);
  container.bind(Y).toClass(YImpl);

  try {
    container.resolve(X);
  } catch (err) {
    console.log(describeFailure(err));
  }
}

// --- undecorated-class: resolving a class with no @inject/@singleton ----
{
  class Plain {}
  const container = createContainer();
  try {
    container.resolve(Plain);
  } catch (err) {
    console.log(describeFailure(err));
  }
}
