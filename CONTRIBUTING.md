# Contributing

> Developer change process. See AGENTS.md for automation commands. See ARCHITECTURE.md for system design.

## Local Setup

Prerequisites: Bun (see `engines.bun` in `package.json` for the minimum supported version).

```sh
bun install
```

## Code Quality

```sh
bun test                 # run the test suite
bun run typecheck        # tsc --noEmit
bun run typecheck:strict # tsc --noEmit with noUnusedLocals/noUnusedParameters/noImplicitReturns
bun run lint             # biome lint (unused imports/vars, correctness, style)
bun run format           # biome format --write
bun run format:check     # biome format (check only, no writes)
bun run check            # typecheck + typecheck:strict + lint + format:check + test
bun run build            # bundle src/index.ts to dist/ (bun build)
bun run build:types
bun run prepack          # clean dist/, then build + build:types (runs automatically on bun publish)
bun run examples         # run every example script
bun run bench            # micro-benchmarks, grouped headline output
```

Run `bun run check` before opening a PR; it mirrors the CI pipeline's lint/type/test gate.

## Branching Conventions

Create a branch with one of the following prefixes:

| Prefix            | Purpose                                                  |
|-------------------|----------------------------------------------------------|
| `feature/<title>` | Introduce a new feature                                  |
| `fix/<title>`     | Fix or patch an existing bug or malfunction              |
| `docs/<title>`    | Documentation-only changes                               |
| `perf/<title>`    | Performance improvements                                 |
| `ci/<title>`      | CI/CD workflow changes                                   |
| `chore/<title>`   | Refactoring, config updates, or anything non-user-facing |

## Commit Message Format

Any contributor **MUST** follow [Conventional Commits](https://www.conventionalcommits.org/). The commit
history drives [Semantic Release](https://semantic-release.gitbook.io/semantic-release/) (using the
`conventionalcommits` preset) for tags and releases.

Every commit must use the following structure:

```text
<type>[optional (scope)][!]: <description>

[optional body]

[optional footer(s)]
```

| Type       | Description                                                            |
|------------|------------------------------------------------------------------------|
| `feat`     | Changes which introduce a new feature                                  |
| `fix`      | Changes which fix or patch a bug                                       |
| `perf`     | Changes which affect performance improvements                          |
| `docs`     | Changes which affect documentation                                     |
| `style`    | Changes which don't affect code meaning (whitespace, formatting, etc.) |
| `refactor` | Changes which neither fix a bug nor add a feature                      |
| `test`     | Adding or correcting tests                                             |
| `build`    | Changes affecting the build system or external dependencies            |
| `ci`       | Changes which affect CI/CD workflows                                   |
| `chore`    | Anything else that isn't user-facing                                   |

A breaking change is indicated either by appending `!` after the type/scope, or by including a
`BREAKING CHANGE:` footer describing the incompatible change:

```text
feat!: remove deprecated resolve() overload
```

```text
fix: correct token resolution order

BREAKING CHANGE: tokens registered after container creation are no longer resolved eagerly
```

Release behavior is configured separately from this commit syntax and may differ from the default
Conventional Commits release mappings.

Examples:

```text
feat(container): add support for async factory providers
```

```text
fix(token): resolve circular dependency detection off-by-one
```

```text
docs: clarify branching conventions in CONTRIBUTING.md
```

## PR / MR Process

1. Follow the instructions to configure your development environment (see [Local Setup](#local-setup))
2. Pull the latest changes from the target branch before starting work
3. Create a branch following the [Branching Conventions](#branching-conventions)
4. Open a Merge Request / Pull Request on your project's Git platform
5. The MR/PR title **must** comply with [Commit Message Format](#commit-message-format)
6. Include enough information about your changes in the MR/PR description
7. Assign a Maintainer as reviewer
8. Update `README.md` if your changes affect main configuration
9. Ensure the pipeline passes before marking the MR/PR as ready

## Proposing Design Changes

1. Open an issue describing the problem and proposed solution.
2. Discuss in the issue thread, referencing [ARCHITECTURE.md](./ARCHITECTURE.md) where the
   proposal affects system structure or resolution semantics.
3. Open a PR referencing the issue once approach is agreed.
4. Feature expansion follows the priority order in [ROADMAP.md](./ROADMAP.md): correctness
   and measurement first, ergonomics second.

## Code of Conduct

<!-- TODO: fill — link to your Code of Conduct document or describe expected contributor behavior. -->
