import {
  auditTimeline,
  runHandoffTimeline,
} from "../src/index.js";

const timeline = runHandoffTimeline([
  {
    timeMs: 0,
    epoch: 1,
    requested: true,
    previousAvailable: true,
    nextPresent: false,
    coverage: 0,
    loadProgress: 0,
  },
  {
    timeMs: 300,
    epoch: 1,
    requested: true,
    previousAvailable: true,
    nextPresent: true,
    coverage: 1,
    loadProgress: 1,
  },
  {
    timeMs: 600,
    epoch: 1,
    requested: true,
    previousAvailable: true,
    nextPresent: true,
    coverage: 1,
    loadProgress: 1,
  },
]);

console.table(timeline.map((frame) => ({
  timeMs: frame.timeMs,
  phase: frame.phase,
  nextOpacity: frame.nextOpacity,
  retainPrevious: frame.retainPrevious,
})));

console.log(auditTimeline(timeline, [
  {
    id: "unexpected-opacity-drop",
    kind: "drop",
    path: "nextOpacity",
  },
]));
