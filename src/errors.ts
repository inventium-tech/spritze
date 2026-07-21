import type { Token } from "./token.ts";

/**
 * Stable, machine-readable error codes for every failure produced by Spritze.
 *
 * The union is closed so consumers can switch exhaustively and every throw site
 * is checked against the canonical set at compile time.
 */
export type SpritzeErrorCode = "missing-binding" | "duplicate-binding" | "circular-dependency" | "undecorated-class";

/**
 * Base class for all container resolution errors.
 */
export class SpritzeError extends Error {
  /**
   * Stable machine-readable error code. Always populated for errors thrown by
   * Spritze's public API.
   */
  readonly code: SpritzeErrorCode;

  constructor(message: string, code: SpritzeErrorCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/**
 * Thrown when a requested binding is missing or cannot be satisfied, or when a
 * duplicate binding is registered.
 */
export class ResolutionError extends SpritzeError {
  constructor(
    message: string,
    /** Dependency path from the root request to the failing token. */
    public readonly path: readonly string[],
    code: SpritzeErrorCode,
  ) {
    super(message, code);
  }
}

/**
 * Thrown when a dependency cycle is detected.
 */
export class CircularDependencyError extends SpritzeError {
  constructor(
    message: string,
    /** Tokens/classes participating in the cycle, in resolution order. */
    public readonly path: readonly string[],
  ) {
    super(message, "circular-dependency");
  }
}

/**
 * Thrown when a class is resolved without the required decorator metadata.
 */
export class UndecoratedError extends SpritzeError {
  constructor(
    message: string,
    /** The class that is not decorated. */
    public readonly clazz: new (...args: never[]) => unknown,
  ) {
    super(message, "undecorated-class");
  }
}

export function formatKey(key: Token<unknown> | (new (...args: never[]) => unknown)): string {
  if (typeof key === "function") {
    return key.name || "(anonymous class)";
  }
  return `[token:${key.description}]`;
}

export function formatPath(path: readonly (Token<unknown> | (new (...args: never[]) => unknown))[]): string {
  return path.map(formatKey).join(" -> ");
}

export function formatPathStrings(path: readonly string[]): string {
  return path.join(" -> ");
}
