const TokenType = Symbol.for("spritze.tokenType");

/**
 * Opaque token identifying a dependency contract.
 *
 * Tokens are created with an optional diagnostic description and carry
 * no runtime metadata about the represented type; TypeScript enforces the
 * contract at compile time, while containers match bindings by identity.
 */
export interface Token<T> {
  readonly [TokenType]: T;
  /** Diagnostic description for error messages. */
  readonly description: string;
}

/**
 * Create a new opaque token representing a dependency of type `T`.
 */
export function token<T>(description?: string): Token<T> {
  if (description !== undefined && typeof description !== "string") {
    throw new TypeError("Token description must be a string");
  }
  const desc = description ?? "anonymous";
  return Object.freeze({
    [TokenType]: undefined as unknown as T,
    description: desc,
  }) as Token<T>;
}
