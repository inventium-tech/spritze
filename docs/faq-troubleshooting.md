# FAQ and Troubleshooting

<!-- TOC -->
* [FAQ and Troubleshooting](#faq-and-troubleshooting)
  * [FAQ](#faq)
    * [Why can't I bind a token directly to a TypeScript interface?](#why-cant-i-bind-a-token-directly-to-a-typescript-interface)
    * [When do I need `@inject()` or `@singleton()` on the implementation class?](#when-do-i-need-inject-or-singleton-on-the-implementation-class)
  * [Troubleshooting](#troubleshooting)
    * [`UndecoratedError` when using `bind().toClass()`](#undecoratederror-when-using-bindtoclass)
<!-- TOC -->

## FAQ

### Why can't I bind a token directly to a TypeScript interface?

TypeScript interfaces are purely a compile-time construct. After compilation (`tsc` / `bun build`) they are erased
and leave no runtime value the container can resolve. Spritze represents contracts at runtime with opaque typed tokens:

```ts
interface ILogger {
  log(message: string): string;
}

const ILoggerToken = token<ILogger>("ILogger");
```

The type parameter `T` on `token<T>` gives you compile-time type checking and autocomplete; the token value itself
(`ILoggerToken`) is the runtime identity used by `bind()` and `resolve()`. Two tokens with the same description are
always distinct objects and are not interchangeable.

### When do I need `@inject()` or `@singleton()` on the implementation class?

Always. A class bound through `bind(Token).toClass(Impl)` must be decorated: decoration is what registers the class
with the container's lifetime model so it can be constructed. Consumers decorated with `@inject(ILoggerToken)` also
need decoration, because the container resolves only decorated classes.

Runnable version: [`examples/interfaces.ts`](../examples/interfaces.ts).

## Troubleshooting

### `UndecoratedError` when using `bind().toClass()`

`UndecoratedError` (`"undecorated-class"`) means the container tried to build a class that has no `@inject()` or
`@singleton()` decoration. With `bind(Token).toClass(Impl)`, the error is usually about `Impl`, not the
consumer.

- The class *consuming* the token must be decorated so `resolve()` can build it.
- The class used as the implementation (`toClass(...)`) must also be decorated, so the container knows its lifetime
  and dependencies.

```ts
class PlainLogger implements ILogger {} // error when bound
@inject()
class ConsoleLogger implements ILogger {} // OK

container.bind(ILoggerToken).toClass(ConsoleLogger);
```
