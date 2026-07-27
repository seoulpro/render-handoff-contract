import {
  advanceHandoff,
  auditTimeline,
  createHandoffState,
  runHandoffTimeline,
  type AuditRule,
  type HandoffObservation,
  type HandoffOptions,
  type HandoffState,
} from "render-handoff-contract";
import {
  detectTransientDrops,
} from "render-handoff-contract/audit";
import {
  type HandoffPolicy,
} from "render-handoff-contract/handoff";

const state: HandoffState = createHandoffState({ epoch: "scene-1" });
const frame = {
  timeMs: 0,
  requested: true,
  nextPresent: true,
  previousAvailable: true,
  coverage: 1,
  loadProgress: 1,
  adapter: "canvas",
} satisfies HandoffObservation;
const options = {
  stableForMs: 0,
  revealDurationMs: 0,
} satisfies HandoffOptions;

const result = advanceHandoff(state, frame, options);
const policy: HandoffPolicy = result.policy;
const timeline = runHandoffTimeline([frame], options);
const adapter: unknown = timeline[0]?.adapter;

const rules = [
  { id: "coverage", kind: "drop", path: "coverage" },
  { id: "placeholder", kind: "spike", path: "placeholder" },
  { id: "canvas", kind: "surface-absence", path: "surface" },
] satisfies AuditRule[];

const report = auditTimeline([{ timeMs: 0, coverage: 1 }], rules);
const events = detectTransientDrops(
  [{ timeMs: 0, coverage: 1 }],
  { path: "coverage" },
);

void policy;
void adapter;
void report;
void events;

// @ts-expect-error epochs are strings or finite numbers at runtime
createHandoffState({ epoch: {} });

// @ts-expect-error handoff option names are exact
advanceHandoff(state, frame, { stableDurationMs: 20 });

// @ts-expect-error rule kinds are a closed set
auditTimeline([], [{ id: "bad", kind: "dip", path: "score" }]);
