import {
  advanceHandoff,
  auditTimeline,
  explainHandoff,
  runHandoffTimeline,
} from "../src/index.js";

// A renderer-shaped event stream. The shape is illustrative: any engine can
// emit something like this from its own paint/decode signals. The contract
// never sees the renderer — only the observations an adapter derives from it.
const paintEvents = [
  { atMs: 0, hasNextLayer: false, painted: 0.0, decoded: 0.1 },
  { atMs: 120, hasNextLayer: true, painted: 0.6, decoded: 0.7 },
  { atMs: 240, hasNextLayer: true, painted: 0.99, decoded: 1.0 },
  { atMs: 360, hasNextLayer: true, painted: 1.0, decoded: 1.0 },
  { atMs: 480, hasNextLayer: true, painted: 1.0, decoded: 1.0 },
];

// The adapter is the integration seam: map engine-specific events onto the
// engine-neutral observation the contract consumes.
const toObservation = (event) => ({
  timeMs: event.atMs,
  epoch: "demo",
  requested: true,
  previousAvailable: true,
  nextPresent: event.hasNextLayer,
  coverage: event.painted,
  loadProgress: event.decoded,
});

const options = { stableForMs: 100, revealDurationMs: 200 };

// Thread the state manually so each decision can be explained for a trace.
let state = null;
const trace = paintEvents.map((event) => {
  const result = advanceHandoff(state, toObservation(event), options);
  state = result.state;
  const { reason, summary } = explainHandoff(result);
  return {
    timeMs: event.atMs,
    phase: result.state.phase,
    nextOpacity: Number(result.policy.nextOpacity.toFixed(2)),
    reason,
    summary,
  };
});

console.log("Explained handoff trace:");
console.table(trace.map(({ summary: _summary, ...row }) => row));
for (const { timeMs, summary } of trace) {
  console.log(`  ${String(timeMs).padStart(4)}ms  ${summary}`);
}

// The same observations can be replayed as a timeline and audited for
// continuity regressions (here: an unexpected drop in the revealed opacity).
const timeline = runHandoffTimeline(paintEvents.map(toObservation), options);
console.log("\nContinuity audit:");
console.log(auditTimeline(timeline, [
  { id: "unexpected-opacity-drop", kind: "drop", path: "nextOpacity" },
]));
