# 0001 — Monorepo layout and toolchain (M1.2)

Status: accepted · Date: 2026-08-23 · Milestone: M1.2

## Context

The plan requires TypeScript strict everywhere and 80% test coverage, but the
repo had no package manager, no build and no test runner, so neither rule was
enforceable. M1.3 ports the engine to `packages/engine`; doing the toolchain
first means that port lands directly in its final home rather than being moved
twice.

## Decisions

**npm workspaces, not pnpm/turbo/nx.** npm 10 ships workspaces natively and the
repo already assumes npm. A build orchestrator buys parallelism this tree is
far too small to need, at the cost of another config surface.

**`apps/client` + `packages/*` created in full now.** All five target packages
from `CLAUDE.md` exist with manifests, tsconfigs and project references, even
where the source is a placeholder barrel. The dependency graph is therefore
declared before code lands in it, and each subsequent milestone fills a package
rather than inventing one.

**The Phase 1 client moved but was not converted.** `index.html`, `src/` and
`styles/` moved to `apps/client/` as pure git renames — no file contents
changed. `allowJs` is on and `checkJs` is off: the prototype is JavaScript and
`render/` is replaced wholesale by the PixiJS port in M1.8, so converting it
now would be work thrown away. New client code should be `.ts`.

**TypeScript project references.** `tsc --build` from the root typechecks every
package in dependency order, and `packages/engine` cannot import from
`apps/client` because no reference points that way. The structural rule that
makes the engine portable to the Phase 2 server is enforced by the compiler
rather than by review.

**Coverage thresholds apply to `packages/*` only.** 80% across lines, functions,
branches and statements. `apps/client` is excluded until its logic has migrated
into packages; the placeholder barrels are excluded individually so that an
empty package cannot dilute the ratio, and each exclusion is removed by the
milestone that fills its package in.

**`@crush/ledger` ships real code now, not a placeholder.** `LG-2` requires that
a float in a money field fail the type system, and `PL-4` requires
round-half-away-from-zero. The branded `Cents` type and the rounding helper are
what M1.3 needs in order to convert the money path, so they exist and are
tested at M1.2 rather than being written twice.

## Consequences

- `npm test`, `npm run typecheck` and `npm run build` are the three gates, run
  on every push by `.github/workflows/ci.yml`.
- The prototype now runs under `npm run dev` (Vite) instead of an ad-hoc static
  server. Opening `apps/client/index.html` over `file://` still fails on CORS,
  as before.
- Root `npm run build` runs `tsc --build` then the client's Vite build, so a
  type error in any package fails the build.
