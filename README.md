# render-handoff-contract

Engine-neutral policies and timeline audits for visually continuous renderer
handoffs.

Applications routinely replace one asynchronously produced representation with
another: a placeholder with real content, a low-detail view with a high-detail
view, a server-rendered frame with a local canvas, one rendering engine with
another. A `loaded === true` check is not enough to avoid a visible seam.
Content can be present while screen coverage is incomplete, load progress can
briefly bounce, and a single blank frame can slip past a final screenshot
assertion.

This package separates that coordination from the rendering engine. It does two
things:

- a **handoff contract** — feed it per-frame observations and it returns a
  policy (how opaque the incoming representation should be, whether to keep the
  previous one, whether the previous one can be retired);
- a **timeline audit** — give it a recorded timeline and it flags transient
  continuity failures such as a coverage drop that recovered or a placeholder
  that flashed.

It consumes observations you collect. It does not inspect pixels, the DOM, GPU
state, or the network, and it assumes no particular renderer, scene graph, fetch
implementation, or animation loop.

## Requirements

- **Node.js 22 or newer.**
- **ESM only** — use `import`, not `require`.
- **No runtime dependencies.**
- **TypeScript declarations included** for every entry point.

## Installation

```sh
npm install render-handoff-contract
```

The code samples below import from the package name `render-handoff-contract`,
which is the normal consumer API. The runnable example in the repository imports
from `./src/index.js` (and the `./src/handoff.js` / `./src/audit.js` files)
instead, because it runs against the source in place.

### Local development

To work on the package from a checkout:

```sh
# from the repository root
npm install        # installs devDependencies only (there are no runtime deps)
npm run example    # runs examples/simulate.mjs
npm run check      # lint, typecheck, tests with coverage, example, package checks
```

The runnable example lives at
[`examples/simulate.mjs`](./examples/simulate.mjs).

## The handoff contract

`advanceHandoff` takes the previous state and one observation and returns the
next state plus a policy for the current frame. Thread the returned `state` back
in on the following frame.

```js
import {
  advanceHandoff,
  createHandoffState,
} from "render-handoff-contract/handoff";

let state = createHandoffState({ epoch: 1 });

function onFrame() {
  const result = advanceHandoff(state, {
    timeMs: performance.now(),
    epoch: 1,
    requested: true,
    previousAvailable: true,
    nextPresent: true,
    coverage: 0.99,
    loadProgress: 1,
  });
  state = result.state;

  setNextOpacity(result.policy.nextOpacity);
  setPreviousVisible(result.policy.retainPrevious);
  if (result.policy.canRetirePrevious) disposePrevious();
}
```

`coverage` and `loadProgress` are clamped to `[0, 1]`; boolean fields must be
booleans; `timeMs` must be finite and may not move backward within one epoch
while a prior frame's timestamp is on record — including a `requested: false`
cancellation frame, which is still checked against the last requested frame. That
cancellation returns a fresh idle state and clears the recorded timestamp, so a
later requested frame begins a new timeline and may use an earlier finite
`timeMs`.
Unknown options and out-of-range thresholds are rejected rather than silently
corrected.

### The normal handoff

In the default policy the incoming representation is revealed only after quality
holds steady, and the previous representation stays until the new one is fully
revealed and confirmed:

- readiness requires `nextPresent`, `coverage >= coverageThreshold`,
  `loadProgress >= loadThreshold`, and no `failed` flag;
- readiness must hold continuously for `stableForMs` before the reveal advances
  on quality;
- reveal opacity increases monotonically within an epoch, driven by clamped
  wall-clock deltas rather than frame counts;
- if readiness dips after the reveal has begun, further progress pauses while
  the opacity reached so far is preserved, and it resumes once readiness is
  stable again;
- the previous representation is retired only once the reveal reaches full
  opacity with stable readiness.

Setting `revealDurationMs: 0` makes the reveal immediate — opacity jumps to `1`
in the frame the reveal begins.

### Immediate reveal without a fallback

When a handoff is requested with the incoming representation present
(`nextPresent: true`) but no previous representation available
(`previousAvailable: false`), there is nothing to hold behind, so the contract
sets `nextOpacity` to `1` immediately rather than returning a blank frame. Until
readiness becomes stable this is a **degraded reveal**: `degraded` is `true`,
`canRetirePrevious` is `false`, and `timedOut` may still be `false`. If a
previous representation later becomes available, it is retained until readiness
is stable (or an allowed degraded retirement).

### Degraded reveal

`degraded` means the incoming representation is exposed without confirmed stable
quality. Two situations cause it: readiness never stabilizing before
`revealTimeoutMs` elapses (so the user is not left staring at a stalled
placeholder), or the absence of a fallback to hold behind (the immediate reveal
above). It does not by itself imply `timedOut`. While a previous representation
is available, a degraded reveal keeps it on screen because quality was never
confirmed.

### Opt-in degraded retirement

By default a degraded handoff never retires the previous representation. If your
application would rather drop the fallback after a longer timeout, opt in:

```js
advanceHandoff(state, observation, {
  allowDegradedRetirement: true,
  revealTimeoutMs: 2500,
  retirementTimeoutMs: 8000, // must be >= revealTimeoutMs
});
```

With this enabled, once `retirementTimeoutMs` elapses (and the incoming
representation is present), the previous one may be retired even without stable
readiness. Enabling it requires `retirementTimeoutMs >= revealTimeoutMs`.

### Ownership epochs

An `epoch` (a string or a finite number) identifies the current handoff
generation. When the observed epoch changes, the machine resets: progress
returns to zero and a new handoff begins. This is how you cancel an in-flight
handoff when the target changes — start observing with a new epoch and the old
progress is discarded.

Only an omitted (`undefined`) `epoch` is inferred — from the previous state, or
`0` when there is none. An explicit `epoch: null` is rejected; the accepted
values are a string or a finite number.

### Active is terminal for the epoch

Once a handoff completes it enters the `active` phase, which is terminal **for
that epoch while the request stays active**. Later requested frames in the same
epoch stay `active` and keep the incoming representation fully revealed; a late
`failed` or a momentarily absent `nextPresent` does not unwind a completed
reveal. To hand off again, move to a new epoch. Setting `requested: false`
returns a fresh idle state and clears the timeline timestamps; a later request —
even in the same epoch — begins a fresh handoff timeline.

### Running a whole timeline

`runHandoffTimeline` folds the contract over an array of observations, threading
state for you, and returns each observation merged with its policy and phase —
convenient for tests, offline analysis, or feeding straight into the audit.

```js
import { runHandoffTimeline } from "render-handoff-contract/handoff";

const frames = runHandoffTimeline(observations, { revealDurationMs: 300 });
// each frame: { ...observation, nextOpacity, retainPrevious,
//   canRetirePrevious, qualityReady, timedOut, degraded, phase }
```

Defaults and every field are documented in [docs/API.md](./docs/API.md).

## Timeline auditing

The audit inspects a recorded timeline after the fact and reports transient
continuity failures. It reads metrics you recorded — it does not decide what
"coverage" or "placeholder" means, and it is not a pixel-diff engine.

```js
import { auditTimeline } from "render-handoff-contract/audit";

const report = auditTimeline(samples, [
  { id: "surface-coverage", kind: "drop", path: "metrics.coverage" },
  { id: "placeholder-flash", kind: "spike", path: "metrics.placeholderRatio" },
  { id: "canvas-disappeared", kind: "surface-absence", path: "dom.outputCanvas" },
]);
```

Three rule kinds are available:

- `drop` — a metric that fell from a recent high and then recovered;
- `spike` — a metric that rose sharply from a recent low and then settled;
- `surface-absence` — a surface that stopped being paintable after it had first
  appeared.

Samples must have finite, non-decreasing own `timeMs` values. Metric paths are
dot-delimited own-property paths: empty segments and the prototype-control names
`__proto__`, `constructor`, and `prototype` are rejected. A rule's top-level
`path` is authoritative — a `path` inside `options` cannot redirect it. Rule ids
must be non-blank and unique.

The `surface-absence` kind uses `isDomSurfacePaintable` by default, which treats
a surface as not paintable when it is hidden, collapsed, disconnected,
zero-sized, or nearly transparent, reading own numeric properties only. You can
supply your own `isPaintable` predicate.

## What this library does not do

- It does not sample frames, read the DOM, capture screenshots, query the GPU,
  or watch the network. You collect observations; it returns decisions.
- It does not know which of your metrics describe visual quality — thresholds
  and metric paths are yours to choose.
- The audit works from the samples you record; its findings are only as good as
  that telemetry. Supply samples in chronological order, and bound the timeline
  length before auditing data from an untrusted source.

The API is intentionally small and may still change during the `0.x` series as
adapters exercise it.

## Documentation

- [docs/API.md](./docs/API.md) — every export, field, option, default, event,
  and guarantee.
- [CHANGELOG.md](./CHANGELOG.md) — release notes.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — development and test expectations.
- [SECURITY.md](./SECURITY.md) — how to report a vulnerability.

## Related projects

- [playwright-render-contract](https://github.com/seoulpro/playwright-render-contract) —
  readiness and structure checks alongside Playwright screenshots.
- [atomic-quadtree-cut](https://github.com/seoulpro/atomic-quadtree-cut) — coherent
  streamed refinement, with the same no-partial-replacement rule.
- [tileset-scope-versioner](https://github.com/seoulpro/tileset-scope-versioner) — cache
  versions for nested tilesets whose swaps must stay visually coherent.
- [stable-marker-layout](https://github.com/seoulpro/stable-marker-layout) —
  projection-agnostic placement for annotations that keep moving.

## License

[MIT](./LICENSE)
