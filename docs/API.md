# API reference

`render-handoff-contract` exports two independent groups of functions: a
handoff **contract** that turns per-frame observations into a reveal/retire
policy, and a timeline **audit** that flags transient continuity failures after
the fact. Neither group inspects pixels, the DOM, GPU state, or the network. The
caller supplies observations; the library returns decisions and findings.

- [Import paths](#import-paths)
- [Handoff contract](#handoff-contract)
  - [`createHandoffState`](#createhandoffstate)
  - [`advanceHandoff`](#advancehandoff)
  - [`runHandoffTimeline`](#runhandofftimeline)
  - [Observation fields](#observation-fields)
  - [Options and defaults](#options-and-defaults)
  - [State fields](#state-fields)
  - [Policy fields](#policy-fields)
  - [Phases](#phases)
- [Timeline audit](#timeline-audit)
  - [`detectTransientDrops`](#detecttransientdrops)
  - [`detectTransientSpikes`](#detecttransientspikes)
  - [`detectSurfaceAbsenceAfterFirstPaint`](#detectsurfaceabsenceafterfirstpaint)
  - [`isDomSurfacePaintable`](#isdomsurfacepaintable)
  - [`auditTimeline`](#audittimeline)
  - [Metric paths](#metric-paths)
- [Validation and errors](#validation-and-errors)
- [Complexity](#complexity)
- [Mutation guarantees](#mutation-guarantees)

## Import paths

The root entry re-exports everything. Two subpaths let you pull in only the
handoff contract or only the audit:

```js
import { advanceHandoff, auditTimeline } from "render-handoff-contract";
import { advanceHandoff } from "render-handoff-contract/handoff";
import { auditTimeline } from "render-handoff-contract/audit";
```

TypeScript declarations ship alongside each entry. The package is ESM-only and
has no runtime dependencies.

---

## Handoff contract

A handoff replaces one asynchronously produced representation with another —
placeholder to real content, low detail to high detail, a server frame to a
local canvas, one engine to another. The contract advances a small state machine
one observation at a time and returns a policy describing what the caller should
show.

### `createHandoffState`

```ts
createHandoffState(options?: { epoch?: string | number }): HandoffState
```

Returns a fresh `idle` state for an ownership epoch. The only accepted option is
`epoch`; any other key throws. `epoch` defaults to `0` and must be a string or a
finite number.

```js
import { createHandoffState } from "render-handoff-contract/handoff";

const state = createHandoffState({ epoch: "scene-1" });
// { epoch: "scene-1", phase: "idle", startedAtMs: null, readySinceMs: null,
//   lastFrameAtMs: null, progress: 0, timedOut: false, degraded: false }
```

Passing a previous state is optional. `advanceHandoff(null, observation)` starts
a handoff without one.

### `advanceHandoff`

```ts
advanceHandoff(
  previousState: HandoffState | null | undefined,
  observation: HandoffObservation,
  options?: HandoffOptions,
): { state: HandoffState; policy: HandoffPolicy }
```

Advances one frame. Returns the next state (to feed into the following call) and
a policy for the current frame. `previousState` may be `null` or `undefined` to
begin. A malformed or internally inconsistent `previousState` is rejected (see
[Validation](#validation-and-errors)); the state you get back from a prior call
always passes.

Behavior, in order:

1. **Not requested.** When `observation.requested` is `false` (its default when
   omitted; a supplied value must be an actual boolean), the handoff is not
   active. The returned state is a fresh `idle` state for the epoch, and the
   policy is `{ nextOpacity: 0, retainPrevious: observation.previousAvailable,
   canRetirePrevious: false, qualityReady: false, timedOut: false, degraded:
   false }`. This resets any progress from earlier frames.
2. **Epoch change.** If the observation's epoch differs from `previousState`'s
   (or there is no previous state), the machine resets for the new epoch:
   `phase` becomes `holding`, `startedAtMs` and `lastFrameAtMs` are set to
   `timeMs`, and progress returns to `0`.
3. **Active is terminal for the epoch.** Once a handoff reaches `active`, later
   frames in the same epoch keep `phase: "active"`, only advancing
   `lastFrameAtMs`. The policy holds at `nextOpacity: 1`, `retainPrevious:
   false`, `canRetirePrevious: true`, and carries the completed handoff's
   `timedOut` and `degraded` flags forward unchanged; `qualityReady` reports
   whether that completion was non-degraded (`!degraded`) rather than measuring
   the current frame. A late `failed` or absent `nextPresent` observation does
   not undo a completed reveal. To start over, change the epoch.
4. **Reveal progress.** While requested and not yet active, the machine tracks
   readiness and advances the reveal. `qualityReady` requires `nextPresent`,
   `coverage >= coverageThreshold`, `loadProgress >= loadThreshold`, and not
   `failed`. Readiness must hold continuously for `stableForMs` before it is
   considered stable. Reveal progress increases by
   `clampedFrameDelta / revealDurationMs` each frame — or jumps straight to `1`
   when `revealDurationMs` is `0` (immediate reveal). Frame deltas are clamped to
   `maximumFrameDeltaMs` so a suspended tab cannot reveal in a single step.

Timeouts and degraded reveal:

- The reveal is considered timed out once `timeMs - startedAtMs >=
  revealTimeoutMs`. `timedOut` is sticky for the epoch. A timed-out handoff may
  still reveal, but it is marked `degraded` unless readiness later becomes
  stable.
- By default a degraded handoff reveals the next representation but does **not**
  retire the previous one (`canRetirePrevious` stays `false`, `retainPrevious`
  stays `true` while a previous representation is available). This keeps a
  fallback on screen when quality was never confirmed.
- Set `allowDegradedRetirement: true` to permit retirement after
  `retirementTimeoutMs` elapses (with `nextPresent` still true) even without
  stable readiness. Enabling this requires `retirementTimeoutMs >=
  revealTimeoutMs`.

```js
import { advanceHandoff, createHandoffState } from "render-handoff-contract/handoff";

let state = createHandoffState({ epoch: 1 });

const { state: next, policy } = advanceHandoff(state, {
  timeMs: performance.now(),
  epoch: 1,
  requested: true,
  previousAvailable: true,
  nextPresent: true,
  coverage: 0.99,
  loadProgress: 1,
});
state = next;

setNextOpacity(policy.nextOpacity);
setPreviousVisible(policy.retainPrevious);
if (policy.canRetirePrevious) disposePrevious();
```

### `runHandoffTimeline`

```ts
runHandoffTimeline(
  observations: readonly HandoffObservation[],
  options?: HandoffOptions,
): Array<Observation & HandoffPolicy & { phase: HandoffPhase }>
```

Folds `advanceHandoff` over an array of observations, threading state from one
frame to the next. Each returned frame is the original observation spread
together with the frame's policy fields and the resulting `phase`. Own keys on
the observation that collide with policy field names are overwritten by the
policy. Useful for tests, offline analysis, and feeding the result straight into
[`auditTimeline`](#audittimeline).

```js
import { runHandoffTimeline } from "render-handoff-contract/handoff";

const frames = runHandoffTimeline(observations, { revealDurationMs: 300 });
// frames[i] === { ...observations[i], nextOpacity, retainPrevious,
//   canRetirePrevious, qualityReady, timedOut, degraded, phase }
```

### Observation fields

An observation describes one measured frame.

| Field               | Type              | Default            | Notes |
| ------------------- | ----------------- | ------------------ | ----- |
| `timeMs`            | finite number     | — (required)       | Frame timestamp. Must not move backward within one epoch. |
| `epoch`             | string or finite number | previous epoch, else `0` | Identifies the ownership generation. |
| `requested`         | boolean           | `false`            | Whether a handoff is active this frame. |
| `previousAvailable` | boolean           | `false`            | Whether a previous representation is still on screen. |
| `nextPresent`       | boolean           | `false`            | Whether the incoming representation exists. |
| `failed`            | boolean           | `false`            | Whether the incoming representation failed to produce quality. |
| `coverage`          | finite number     | `0`                | Clamped to `[0, 1]`. |
| `loadProgress`      | finite number     | `0`                | Clamped to `[0, 1]`. |

Additional own keys are preserved by `runHandoffTimeline` but ignored by the
policy. Boolean fields must be actual booleans (not `0`/`1`/`"yes"`); numeric
fields must be finite; `epoch` may not be an object. Each violation throws a
`TypeError`.

### Options and defaults

Passed as the third argument to `advanceHandoff` or the second to
`runHandoffTimeline`. Unknown option names throw.

| Option                    | Type    | Default | Constraint |
| ------------------------- | ------- | ------- | ---------- |
| `coverageThreshold`       | number  | `0.98`  | finite, `0`–`1` |
| `loadThreshold`           | number  | `0.98`  | finite, `0`–`1` |
| `stableForMs`             | number  | `250`   | finite, `>= 0` |
| `revealDurationMs`        | number  | `300`   | finite, `>= 0`; `0` means immediate reveal |
| `revealTimeoutMs`         | number  | `2500`  | finite, `>= 0` |
| `maximumFrameDeltaMs`     | number  | `100`   | finite, `> 0` |
| `allowDegradedRetirement` | boolean | `false` | must be a boolean |
| `retirementTimeoutMs`     | number  | `8000`  | finite, `>= 0`; when `allowDegradedRetirement` is `true`, must be `>= revealTimeoutMs` |

### State fields

`HandoffState` is the value threaded between calls. Treat it as opaque and
immutable; construct it only via `createHandoffState` or the return of
`advanceHandoff`.

| Field           | Type                     | Meaning |
| --------------- | ------------------------ | ------- |
| `epoch`         | string or finite number  | Current ownership epoch. |
| `phase`         | `HandoffPhase`           | See [Phases](#phases). |
| `startedAtMs`   | number or `null`         | When the current epoch's handoff began. |
| `readySinceMs`  | number or `null`         | Start of the current uninterrupted readiness run. |
| `lastFrameAtMs` | number or `null`         | Timestamp of the most recent observed frame. |
| `progress`      | number in `[0, 1]`       | Reveal progress; equals `policy.nextOpacity`. |
| `timedOut`      | boolean                  | Sticky once the reveal timeout is passed. |
| `degraded`      | boolean                  | Timed out without stable readiness. A degraded state is always timed out. |

### Policy fields

`HandoffPolicy` is the per-frame decision.

| Field               | Type    | Meaning |
| ------------------- | ------- | ------- |
| `nextOpacity`       | number in `[0, 1]` | Opacity to apply to the incoming representation. Monotonic within an epoch. |
| `retainPrevious`    | boolean | Keep showing the previous representation. True only when `previousAvailable` and the previous cannot yet be retired. |
| `canRetirePrevious` | boolean | The previous representation may be disposed. Implies `nextOpacity === 1`. |
| `qualityReady`      | boolean | While revealing, whether readiness has been stable for `stableForMs`. Once the epoch is `active`, whether the completed handoff was non-degraded. |
| `timedOut`          | boolean | The reveal timeout has passed this epoch. |
| `degraded`          | boolean | Revealed (or revealing) without confirmed quality. |

### Phases

| Phase             | Meaning |
| ----------------- | ------- |
| `idle`            | No handoff is active. Progress is `0`. |
| `holding`         | Requested, revealing not started; progress `0`. |
| `revealing`       | Progress is strictly between `0` and `1`, not degraded. |
| `degraded-reveal` | Progress above `0` while degraded. |
| `active`          | Reveal complete and previous retireable. Terminal for the epoch. |

---

## Timeline audit

The audit examines a recorded timeline of samples and reports transient
continuity failures. It is not a pixel-diff engine: what a "coverage" or
"placeholder" metric means is entirely the caller's choice. Every detector
requires samples with finite, non-decreasing own `timeMs` values.

A **sample** is any object with a finite own `timeMs`. Metric values are read
from [dot-delimited own-property paths](#metric-paths).

Drop and spike detectors return `TransientEvent[]`:

| Field         | Meaning |
| ------------- | ------- |
| `startIndex` / `endIndex` | Sample indices bounding the merged event. |
| `startTimeMs` / `endTimeMs` | `timeMs` of those samples. |
| `minimum` / `maximum` | Extreme metric values within the event. |
| `baseline`    | Reference level the event departed from. For a merged event, the baseline of the first candidate in the interval. |
| `recovery`    | Level the metric returned to afterward. For a merged event, the recovery of the last candidate in the interval. |

### `detectTransientDrops`

```ts
detectTransientDrops(samples, options): TransientEvent[]
```

Flags a metric that falls from a recent high, then recovers. For each sample it
takes the maximum value over the preceding `lookbackMs` as a baseline and the
maximum over the following `recoveryMs` as the recovery. A candidate is reported
when the baseline is at least `minimumBaseline`, the absolute drop is at least
`minimumAbsoluteDrop`, the relative drop is at least `minimumRelativeDrop`, and
the recovery reaches at least `baseline * recoveryRatio`. Adjacent candidates
within `mergeWindowMs` are merged into one event.

| Option                | Default | Constraint |
| --------------------- | ------- | ---------- |
| `path`                | — (required) | non-empty metric path |
| `minimumBaseline`     | `0.08`  | finite, `>= 0` |
| `minimumAbsoluteDrop` | `0.05`  | finite, `>= 0` |
| `minimumRelativeDrop` | `0.45`  | finite, `0`–`1` |
| `lookbackMs`          | `600`   | finite, `>= 0` |
| `recoveryMs`          | `600`   | finite, `>= 0` |
| `recoveryRatio`       | `0.7`   | finite, `0`–`1` |
| `mergeWindowMs`       | `150`   | finite, `>= 0` |

```js
import { detectTransientDrops } from "render-handoff-contract/audit";

detectTransientDrops(
  [
    { timeMs: 0, render: { coverage: 1 } },
    { timeMs: 16, render: { coverage: 1 } },
    { timeMs: 32, render: { coverage: 0 } },
    { timeMs: 48, render: { coverage: 1 } },
  ],
  { path: "render.coverage" },
);
// [{ startIndex: 2, endIndex: 2, startTimeMs: 32, endTimeMs: 32,
//    minimum: 0, maximum: 0, baseline: 1, recovery: 1 }]
```

### `detectTransientSpikes`

```ts
detectTransientSpikes(samples, options): TransientEvent[]
```

Flags a metric that rises sharply from a recent low, then settles back. The
baseline is the minimum over the preceding `lookbackMs`; the recovery is the
minimum over the following `recoveryMs`. A candidate is reported when the rise is
at least `minimumAbsoluteRise`, the value reaches at least `max(minimumAbsoluteRise,
baseline * minimumRelativeRise)`, and the recovery is no more than `baseline +
recoveryTolerance`. Merging works as for drops.

| Option                | Default | Constraint |
| --------------------- | ------- | ---------- |
| `path`                | — (required) | non-empty metric path |
| `minimumAbsoluteRise` | `0.15`  | finite, `>= 0` |
| `minimumRelativeRise` | `1.5`   | finite, `>= 1` |
| `lookbackMs`          | `600`   | finite, `>= 0` |
| `recoveryMs`          | `600`   | finite, `>= 0` |
| `recoveryTolerance`   | `0.08`  | finite, `>= 0` |
| `mergeWindowMs`       | `150`   | finite, `>= 0` |

```js
import { detectTransientSpikes } from "render-handoff-contract/audit";

detectTransientSpikes(
  [
    { timeMs: 0, pixels: { placeholder: 0.02 } },
    { timeMs: 16, pixels: { placeholder: 0.7 } },
    { timeMs: 32, pixels: { placeholder: 0.03 } },
  ],
  { path: "pixels.placeholder", minimumAbsoluteRise: 0.2 },
);
// one event with maximum: 0.7
```

### `detectSurfaceAbsenceAfterFirstPaint`

```ts
detectSurfaceAbsenceAfterFirstPaint(samples, options): SurfaceAbsenceEvent[]
```

Reads a surface object from `path` on each sample and reports every sample where
the surface is not paintable **after** the first paintable sample has been seen.
Absences before the first paint are ignored (the surface has not appeared yet).
Paintability is decided by `isPaintable`, which defaults to
[`isDomSurfacePaintable`](#isdomsurfacepaintable).

| Option        | Default                 | Constraint |
| ------------- | ----------------------- | ---------- |
| `path`        | — (required)            | non-empty metric path |
| `isPaintable` | `isDomSurfacePaintable` | must be a function |

Each `SurfaceAbsenceEvent` is `{ index, timeMs, value }`, where `value` is the
raw value found at the path (or `null` when absent).

```js
import { detectSurfaceAbsenceAfterFirstPaint } from "render-handoff-contract/audit";

detectSurfaceAbsenceAfterFirstPaint(
  [
    { timeMs: 0, surface: null },
    { timeMs: 10, surface: { opacity: 1, width: 100, height: 100 } },
    { timeMs: 20, surface: { opacity: 0, width: 100, height: 100 } },
    { timeMs: 30, surface: { opacity: 1, width: 100, height: 100 } },
  ],
  { path: "surface" },
);
// [{ index: 2, timeMs: 20, value: { opacity: 0, width: 100, height: 100 } }]
```

### `isDomSurfacePaintable`

```ts
isDomSurfacePaintable(surface: unknown): boolean
```

A default heuristic for whether a plain object describing a surface would paint.
It reads **own** properties only and returns `false` for anything hidden,
collapsed, disconnected, zero-sized, or nearly transparent.

A surface is paintable only when all of the following hold:

- `opacity` is present, a finite number, and `> 0.01` (there is no default —
  a surface without a numeric own `opacity` is not paintable);
- own `connected`, when present, is the boolean `true` (default `true`);
- own `display` is not `"none"`;
- own `visibility` is neither `"hidden"` nor `"collapse"`;
- own `width` and `height` are finite numbers `> 0` (each defaults to `1` when
  absent).

Inherited properties are not consulted, so a surface built with
`Object.create({ opacity: 1 })` is not paintable.

```js
import { isDomSurfacePaintable } from "render-handoff-contract/audit";

isDomSurfacePaintable({ opacity: 1 });                       // true
isDomSurfacePaintable({ opacity: 0, width: 100, height: 4 }); // false
isDomSurfacePaintable({ visibility: "hidden", opacity: 1 });  // false
```

### `auditTimeline`

```ts
auditTimeline(samples, rules): AuditResult[]
```

Runs a list of declarative rules over one timeline and returns one result per
rule, in order. Each rule is `{ id, kind, path, options? }`:

- `id` must be a non-empty (non-whitespace) string and unique within the call;
- `kind` is `"drop"`, `"spike"`, or `"surface-absence"`;
- `path` is the metric path and is **authoritative** — a rule's top-level `path`
  overrides any `path` inside `options`;
- `options` (optional) is an object of the corresponding detector's options,
  excluding `path`.

Unknown rule fields, unknown `kind` values, blank ids, duplicate ids, and
non-object `options` all throw. Each result is `{ id, kind, path, events }`,
where `events` is the detector output for that kind.

```js
import { auditTimeline } from "render-handoff-contract/audit";

const report = auditTimeline(samples, [
  { id: "surface-coverage", kind: "drop", path: "metrics.coverage" },
  { id: "placeholder-flash", kind: "spike", path: "metrics.placeholderRatio" },
  { id: "canvas-disappeared", kind: "surface-absence", path: "dom.outputCanvas" },
]);
// report[i] === { id, kind, path, events }
```

### Metric paths

A path is a non-empty, dot-delimited string of own-property names, e.g.
`"metrics.coverage"`. Resolution walks own properties only; a missing segment
yields `undefined` (treated as "no value" by the detectors). Empty segments
(from `""` or `"a..b"`) and the prototype-control names `__proto__`,
`constructor`, and `prototype` are rejected with a `TypeError`. Only finite
numeric values participate in drop/spike math; non-finite or absent values are
skipped.

---

## Validation and errors

The library validates inputs instead of coercing them, and throws synchronously:

- **`TypeError`** for wrong shapes and types: non-object state/observation/
  options, unknown option or field names, non-finite `timeMs` or metrics,
  non-boolean flags, an `epoch` that is neither string nor finite number, an
  invalid or empty metric path, a prototype-control path segment, a blank or
  duplicate rule id, an unknown rule kind, and `samples`/`observations`/`rules`
  that are not arrays.
- **`RangeError`** for internally inconsistent values: a `previousState` whose
  fields contradict each other or its phase, `timeMs` moving backward within one
  epoch, sample `timeMs` decreasing, and `retirementTimeoutMs` preceding
  `revealTimeoutMs` when degraded retirement is enabled.

A `previousState` produced by `createHandoffState` or a prior `advanceHandoff`
call always validates. Hand-built states are checked against every phase
invariant (for example, a `holding` state must have `progress: 0`, an `active`
state must have `progress: 1`, and a `degraded` state must be `timedOut`).

## Complexity

- `advanceHandoff` is O(1) per call; `runHandoffTimeline` is O(n) over the
  observations.
- `detectTransientDrops` and `detectTransientSpikes` run in linear time in the
  number of samples. Sliding-window baselines and recoveries are computed with a
  monotonic-deque extrema pass rather than re-scanning each window, so cost does
  not depend on `lookbackMs`/`recoveryMs`. The size of the returned event array
  can still grow with the sample count.
- `detectSurfaceAbsenceAfterFirstPaint` is a single linear pass.
- `auditTimeline` runs each rule independently, so it is O(rules × samples).

## Mutation guarantees

No exported function mutates its inputs. Caller-owned state, observations,
options, samples, and rules are read only; the functions return new objects.
`runHandoffTimeline` builds a new frame object per observation rather than
editing the input array. Freezing your inputs (deeply) does not cause failures.
