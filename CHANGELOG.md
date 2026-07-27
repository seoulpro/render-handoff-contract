# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

Initial development release. Not yet published to npm.

### Added

- **Handoff contract.** `createHandoffState`, `advanceHandoff`, and
  `runHandoffTimeline` turn per-frame observations into a reveal/retire policy.
  The state machine covers the normal handoff, a degraded reveal after a reveal
  timeout, opt-in degraded retirement (`allowDegradedRetirement`), ownership
  epochs with reset on epoch change, and `active` as a terminal phase for the
  epoch. Reveal progress is monotonic within an epoch and driven by clamped
  wall-clock frame deltas.
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
