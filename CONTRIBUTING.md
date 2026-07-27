# Contributing to render-handoff-contract

Contributions should improve a renderer-neutral policy or make a timeline
failure easier to diagnose. Propose new observation fields, state phases, or
audit rule kinds in an issue before changing the public contract.

## Development

Use Node.js 22 or newer. The package is ESM-only and has no runtime
dependencies; `npm install` pulls in development tooling only.

```sh
npm install
npm run check     # lint, typecheck, tests with coverage, example, package checks
npm run example   # run examples/simulate.mjs
```

Individual steps are available as `npm run lint`, `npm run typecheck`,
`npm test`, `npm run test:coverage`, `npm run package:lint` (publint), and
`npm run package:smoke` (packs a tarball and imports it in a scratch project).

## Test expectations

Runtime tests use the built-in `node:test` runner and `node:assert`. Handoff
changes should exercise the complete state transition — epoch resets, unstable
readiness, frame-delta clamping, timeout behavior, and retirement policy. Audit
changes should include normal, failing, and recovery timelines with explicit
timestamps.

Tests should describe observations rather than a particular rendering engine.
Keep time deterministic: pass explicit `timeMs` values and do not depend on
animation frames or wall-clock delays. The type-level tests under `types-test`
must keep passing under `npm run typecheck`.

## Design constraints

The library consumes measurements and returns policy. It does not collect DOM,
GPU, network, or screenshot data, and it must not mutate caller-owned state,
observations, options, samples, or rules. Keep adapters outside the core and
avoid adding a renderer dependency. Changes to safety-related defaults —
especially degraded retirement — must be called out explicitly in the pull
request.

See [SECURITY.md](./SECURITY.md) for private reporting. Contributions are
licensed under the [MIT license](./LICENSE).
