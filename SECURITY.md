# Security policy

`render-handoff-contract` is an in-memory policy and audit library. It performs
no file, network, DOM, or renderer access. It does not evaluate strings as code,
and the only caller-supplied code it invokes is the optional `isPaintable`
predicate passed to `detectSurfaceAbsenceAfterFirstPaint` (and the
`surface-absence` audit rule). Any side effects or exceptions from that predicate
are the caller's responsibility, not a vulnerability in this library. Otherwise
its trust boundary is the data you pass in.

## Supported versions

The package is in its `0.x` series. Security fixes target the latest release on
the default branch.

## Reporting a vulnerability

When the repository provides GitHub private vulnerability reporting, use it —
open a private report from the repository's **Security** tab (**Report a
vulnerability**). Otherwise, email [lim@limsumin.com](mailto:lim@limsumin.com).
Either way, the report stays confidential while it is triaged.

Do not open a public issue for a vulnerability, and do not include vulnerability
details, reproducers, or exploit steps in any public issue or pull request.

In scope are crafted observations or audit rules that cause, for example:

- unbounded resource use (memory or time) disproportionate to the input;
- property access outside documented own-property traversal, including
  prototype-control segments;
- mutation of caller-owned state, observations, options, samples, or rules;
- a policy result that violates the documented retirement safeguards (for
  instance, retiring the previous representation in a degraded handoff without
  `allowDegradedRetirement`).

When you report, include the affected version, the smallest observation or
sample timeline that reproduces the problem, the options or rules used, the
impact, and a suggested mitigation if you have one. Do not include private or
production telemetry in a report.

## Out of scope

Renderer failures, incorrect measurements, and unsafe application-specific
thresholds are outside the package's trust boundary. Callers own observation
collection and rendering. When auditing telemetry from an untrusted source,
bound the timeline length and validate measurements before passing them in.
