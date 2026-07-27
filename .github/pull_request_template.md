## Summary

<!-- What this change does, in a sentence or two. -->

## Motivation

<!-- Why the change is needed. Link any related issue. -->

## Behavior and contract changes

<!--
Describe changes to observations, state phases, policy, audit rules, options, or
defaults. State whether the change is additive or breaking. Write "none" if the
public contract is unchanged.
-->

## Test evidence

<!--
How this was verified. Paste relevant output from `npm run check` (or the
individual test/typecheck/coverage steps). Note any new test cases and the
timelines they exercise.
-->

## Safety and defaults

<!--
Any effect on safety-related defaults — especially degraded retirement — or on
validation and mutation guarantees. Write "none" if unaffected.
-->

## Checklist

- [ ] Public contract changes are documented (`README.md`, `docs/API.md`) and, if user-facing, noted in `CHANGELOG.md`.
- [ ] Tests cover the new or changed behavior, including failing and recovery cases where relevant.
- [ ] `npm run check` passes locally.
- [ ] Changes to safety-related defaults are called out above.
