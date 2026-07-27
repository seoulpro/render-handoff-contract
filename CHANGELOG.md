# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-28

Initial public release.

### Added

- **Handoff contract.** `createHandoffState`, `advanceHandoff`, and
  `runHandoffTimeline` turn per-frame observations into a reveal/retire policy.
  The state machine covers the normal handoff, a degraded reveal after a reveal
  timeout, opt-in degraded retirement (`allowDegradedRetirement`), ownership
  epochs with reset on epoch change, and `active` as a terminal phase while the
  request stays active — cancelling (`requested: false`) resets to idle and the
  next request starts a fresh timeline. When no previous representation is
  available but the next is present, the next representation is shown at full
  opacity immediately and stays `degraded` until readiness stabilizes. Reveal
  progress is monotonic within an epoch and driven by clamped wall-clock frame
  deltas.
- **Timeline audit.** `detectTransientDrops`, `detectTransientSpikes`,
  `detectSurfaceAbsenceAfterFirstPaint`, `isDomSurfacePaintable`, and the
  declarative `auditTimeline` runner flag transient continuity failures on a
  recorded timeline. Sliding-window extrema are computed in linear time.
- **Validation.** Inputs are validated rather than coerced: finite timestamps
  and metrics, real booleans, string or finite-number epochs, non-decreasing
  sample timelines, own-property-only metric paths that reject prototype-control
  segments, and rejection of malformed or internally inconsistent prior state.
  Caller-owned state, observations, options, samples, and rules are not mutated.
- **TypeScript declarations** for the root entry and the `./handoff` and
  `./audit` subpaths. The package is ESM-only and has no runtime dependencies.
- **Package checks.** Runtime tests, coverage thresholds, type-level tests,
  `publint`, and a packed-tarball install/import smoke test.

### Fixed

- An explicit `epoch: null` is now rejected; only an omitted (`undefined`) epoch
  is inferred (from the previous state, or `0` when there is none).
- Zero-valued drop and spike thresholds no longer classify a flat metric as an
  event; a real direction change is required (`baseline > value` for a drop,
  `value > baseline` for a spike).
- Prior-state validation now requires `readySinceMs` for a non-degraded `active`
  state, and accepts an untimed degraded state only as a complete fallbackless
  `degraded-reveal` (`progress: 1`); a partial untimed degraded reveal is
  rejected. A `revealing` state may have a null `readySinceMs`, since a reveal
  can be paused after a readiness dip.
