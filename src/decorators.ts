import type { Token } from "./token.ts";

export enum Lifetime {
  Transient = 0,
  Singleton = 1,
}

export type Dep = Token<unknown> | (new (...args: never[]) => unknown);

export type DepsToArgs<TDeps> = TDeps extends readonly Dep[]
  ? { readonly [K in keyof TDeps]: Resolved<TDeps[K]> }
  : never;

type Resolved<D> = D extends Token<infer T> ? T : D extends abstract new (...args: never[]) => infer R ? R : never;

export interface ClassDefinition<T> {
  readonly lifetime: Lifetime;
  readonly deps: readonly Dep[];
  /** Phantom type slot that makes `T` appear used to `noUnusedLocals`. */
  readonly _type?: T;
}

const definitions = new WeakMap<new (...args: never[]) => unknown, ClassDefinition<unknown>>();

export function getDefinition<T>(clazz: new (...args: never[]) => T): ClassDefinition<T> | undefined {
  return definitions.get(clazz) as ClassDefinition<T> | undefined;
}

type DecoratorTarget<TArgs extends readonly unknown[]> = abstract new (...args: TArgs) => unknown;

type InjectableDecorator<TArgs extends readonly unknown[]> = <
  TClass extends abstract new (
    ...args: never[]
  ) => unknown,
>(
  clazz: [...TArgs] extends ConstructorParameters<TClass> ? TClass : never,
  context: ClassDecoratorContext<TClass>,
) => void;

function decorate(
  lifetime: Lifetime,
  deps: readonly Dep[],
  clazz: new (...args: never[]) => unknown,
  _context: ClassDecoratorContext<new (...args: never[]) => unknown>,
): void {
  if (definitions.has(clazz)) {
    return;
  }
  definitions.set(clazz, { lifetime, deps });
}

export function inject<const TDeps extends readonly Dep[]>(...deps: TDeps): InjectableDecorator<DepsToArgs<TDeps>> {
  return function injectDecorator<T>(
    clazz: DecoratorTarget<DepsToArgs<TDeps>> & (new (...args: never[]) => T),
    context: ClassDecoratorContext<new (...args: never[]) => T>,
  ): void {
    decorate(Lifetime.Transient, deps, clazz, context);
  } as unknown as InjectableDecorator<DepsToArgs<TDeps>>;
}

export function singleton<const TDeps extends readonly Dep[]>(...deps: TDeps): InjectableDecorator<DepsToArgs<TDeps>> {
  return function singletonDecorator<T>(
    clazz: DecoratorTarget<DepsToArgs<TDeps>> & (new (...args: never[]) => T),
    context: ClassDecoratorContext<new (...args: never[]) => T>,
  ): void {
    decorate(Lifetime.Singleton, deps, clazz, context);
  } as unknown as InjectableDecorator<DepsToArgs<TDeps>>;
}
