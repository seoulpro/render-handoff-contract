import assert from "node:assert/strict";
import test from "node:test";

import {
  auditTimeline,
  detectSurfaceAbsenceAfterFirstPaint,
  detectTransientDrops,
  detectTransientSpikes,
  isDomSurfacePaintable,
} from "../src/index.js";

const mergeCandidates = (events, mergeWindowMs) => {
  const merged = [];
  for (const event of events) {
    const previous = merged.at(-1);
    if (previous && event.timeMs - previous.endTimeMs <= mergeWindowMs) {
      previous.endIndex = event.index;
      previous.endTimeMs = event.timeMs;
      previous.minimum = Math.min(previous.minimum, event.value);
      previous.maximum = Math.max(previous.maximum, event.value);
      previous.recovery = event.recovery;
    } else {
      merged.push({
        startIndex: event.index,
        endIndex: event.index,
        startTimeMs: event.timeMs,
        endTimeMs: event.timeMs,
        minimum: event.value,
        maximum: event.value,
        baseline: event.baseline,
        recovery: event.recovery,
      });
    }
  }
  return merged;
};

const valuesInWindow = (samples, index, direction, windowMs) => {
  const output = [];
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < samples.length;
    cursor += direction
  ) {
    if (
      Math.abs(samples[cursor].timeMs - samples[index].timeMs)
      > windowMs
    ) {
      break;
    }
    if (Number.isFinite(samples[cursor].value)) {
      output.push(samples[cursor].value);
    }
  }
  return output;
};

const naiveDrops = (samples, options) => {
  const events = [];
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index].value;
    if (!Number.isFinite(value)) continue;
    const before = valuesInWindow(
      samples,
      index,
      -1,
      options.lookbackMs,
    );
    if (before.length === 0) continue;
    const baseline = Math.max(...before);
    if (baseline < options.minimumBaseline) continue;
    if (baseline <= value) continue;
    if (baseline - value < options.minimumAbsoluteDrop) continue;
    if (
      value / Math.max(baseline, Number.EPSILON)
      > 1 - options.minimumRelativeDrop
    ) {
      continue;
    }
    const after = valuesInWindow(
      samples,
      index,
      1,
      options.recoveryMs,
    );
    const recovery = after.length > 0 ? Math.max(...after) : null;
    if (recovery === null || recovery < baseline * options.recoveryRatio) {
      continue;
    }
    events.push({
      index,
      timeMs: samples[index].timeMs,
      value,
      baseline,
      recovery,
    });
  }
  return mergeCandidates(events, options.mergeWindowMs);
};

const naiveSpikes = (samples, options) => {
  const events = [];
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index].value;
    if (!Number.isFinite(value)) continue;
    const before = valuesInWindow(
      samples,
      index,
      -1,
      options.lookbackMs,
    );
    if (before.length === 0) continue;
    const baseline = Math.min(...before);
    if (value <= baseline) continue;
    if (value - baseline < options.minimumAbsoluteRise) continue;
    if (
      value
      < Math.max(
        options.minimumAbsoluteRise,
        baseline * options.minimumRelativeRise,
      )
    ) {
      continue;
    }
    const after = valuesInWindow(
      samples,
      index,
      1,
      options.recoveryMs,
    );
    const recovery = after.length > 0 ? Math.min(...after) : null;
    if (
      recovery === null
      || recovery > baseline + options.recoveryTolerance
    ) {
      continue;
    }
    events.push({
      index,
      timeMs: samples[index].timeMs,
      value,
      baseline,
      recovery,
    });
  }
  return mergeCandidates(events, options.mergeWindowMs);
};

const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

test("detects a transient metric drop that recovers", () => {
  const events = detectTransientDrops([
    { timeMs: 0, render: { coverage: 1 } },
    { timeMs: 16, render: { coverage: 1 } },
    { timeMs: 32, render: { coverage: 0 } },
    { timeMs: 48, render: { coverage: 1 } },
  ], { path: "render.coverage" });

  assert.equal(events.length, 1);
  assert.equal(events[0].minimum, 0);
  assert.equal(events[0].baseline, 1);
  assert.equal(events[0].recovery, 1);
});

test("ignores persistent changes and missing metrics", () => {
  const events = detectTransientDrops([
    { timeMs: 0, value: 1 },
    { timeMs: 20, value: undefined },
    { timeMs: 40, value: 0 },
    { timeMs: 80, value: 0 },
  ], { path: "value", recoveryMs: 100 });

  assert.deepEqual(events, []);
});

test("detects a transient placeholder spike", () => {
  const events = detectTransientSpikes([
    { timeMs: 0, pixels: { placeholder: 0.02 } },
    { timeMs: 16, pixels: { placeholder: 0.7 } },
    { timeMs: 32, pixels: { placeholder: 0.03 } },
  ], {
    path: "pixels.placeholder",
    minimumAbsoluteRise: 0.2,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].maximum, 0.7);
});

test("merges nearby candidates into one interval", () => {
  const events = detectTransientDrops([
    { timeMs: 0, value: 1 },
    { timeMs: 10, value: 0 },
    { timeMs: 20, value: 0.1 },
    { timeMs: 30, value: 1 },
  ], {
    path: "value",
    minimumRelativeDrop: 0.4,
    mergeWindowMs: 20,
  });

  assert.deepEqual(events, [{
    startIndex: 1,
    endIndex: 2,
    startTimeMs: 10,
    endTimeMs: 20,
    minimum: 0,
    maximum: 0.1,
    baseline: 1,
    recovery: 1,
  }]);
});

test("requires an actual direction change when thresholds allow zero", () => {
  const flat = [
    { timeMs: 0, value: 1 },
    { timeMs: 10, value: 1 },
    { timeMs: 20, value: 1 },
  ];
  const dropOptions = {
    path: "value",
    minimumBaseline: 0,
    minimumAbsoluteDrop: 0,
    minimumRelativeDrop: 0,
    recoveryRatio: 1,
  };
  const spikeOptions = {
    path: "value",
    minimumAbsoluteRise: 0,
    minimumRelativeRise: 1,
    recoveryTolerance: 0,
  };

  assert.deepEqual(detectTransientDrops(flat, dropOptions), []);
  assert.deepEqual(detectTransientSpikes(flat, spikeOptions), []);
  assert.equal(detectTransientDrops([
    flat[0],
    { timeMs: 10, value: 0.99 },
    flat[2],
  ], dropOptions).length, 1);
  assert.equal(detectTransientSpikes([
    flat[0],
    { timeMs: 10, value: 1.01 },
    flat[2],
  ], spikeOptions).length, 1);
});

test("starts surface absence checks only after the first paintable sample", () => {
  const events = detectSurfaceAbsenceAfterFirstPaint([
    { timeMs: 0, surface: null },
    { timeMs: 10, surface: { opacity: 1, width: 100, height: 100 } },
    { timeMs: 20, surface: { opacity: 0, width: 100, height: 100 } },
    { timeMs: 30, surface: { opacity: 1, width: 100, height: 100 } },
  ], { path: "surface" });

  assert.deepEqual(events, [{
    index: 2,
    timeMs: 20,
    value: {
      opacity: 0,
      width: 100,
      height: 100,
    },
  }]);
});

test("applies strict own-property paintability checks", () => {
  assert.equal(isDomSurfacePaintable({ opacity: 1 }), true);
  assert.equal(
    isDomSurfacePaintable({
      connected: true,
      opacity: 1,
      width: 10,
      height: 10,
    }),
    true,
  );

  for (const surface of [
    null,
    "canvas",
    Object.create({ opacity: 1, width: 10, height: 10 }),
    { connected: "yes", opacity: 1 },
    { connected: false, opacity: 1 },
    { display: "none", opacity: 1 },
    { visibility: "hidden", opacity: 1 },
    { visibility: "collapse", opacity: 1 },
    { opacity: "1" },
    { opacity: Infinity },
    { opacity: 1, width: Infinity },
    { opacity: 1, width: 0 },
    { opacity: 1, height: 0 },
  ]) {
    assert.equal(isDomSurfacePaintable(surface), false);
  }
});

test("runs declarative audit rules", () => {
  const samples = [
    {
      timeMs: 0,
      score: 1,
      placeholder: 0,
      surface: { opacity: 1 },
    },
    {
      timeMs: 10,
      score: 0,
      placeholder: 1,
      surface: { opacity: 0 },
    },
    {
      timeMs: 20,
      score: 1,
      placeholder: 0,
      surface: { opacity: 1 },
    },
  ];
  const report = auditTimeline(samples, [
    { id: "coverage", kind: "drop", path: "score" },
    { id: "placeholder", kind: "spike", path: "placeholder" },
    { id: "surface", kind: "surface-absence", path: "surface" },
  ]);

  assert.deepEqual(
    report.map(({ id, events }) => [id, events.length]),
    [
      ["coverage", 1],
      ["placeholder", 1],
      ["surface", 1],
    ],
  );
});

test("does not traverse inherited or prototype-control properties", () => {
  const inherited = Object.create({ score: 1 });
  inherited.timeMs = 0;
  const events = detectTransientDrops([
    inherited,
    { timeMs: 10, score: 0 },
    { timeMs: 20, score: 1 },
  ], { path: "score" });

  assert.deepEqual(events, []);
  for (const path of [
    "__proto__.score",
    "metrics.constructor.value",
    "prototype.score",
    "metrics..score",
  ]) {
    assert.throws(
      () => detectTransientDrops([], { path }),
      /invalid segment/,
    );
  }
});

test("keeps the top-level rule path authoritative", () => {
  const report = auditTimeline([
    { timeMs: 0, score: 1, decoy: 1 },
    { timeMs: 10, score: 0, decoy: 1 },
    { timeMs: 20, score: 1, decoy: 1 },
  ], [
    {
      id: "coverage",
      kind: "drop",
      path: "score",
      options: { path: "decoy" },
    },
  ]);

  assert.equal(report[0].events.length, 1);
});

test("rejects malformed timelines, paths, and detector options", () => {
  for (const [run, expected] of [
    [
      () => detectTransientDrops(null, { path: "score" }),
      /samples must be an array/,
    ],
    [
      () => detectTransientDrops([[]], { path: "score" }),
      /finite own timeMs/,
    ],
    [
      () => detectTransientDrops(
        [{ timeMs: 10 }, { timeMs: 5 }],
        { path: "score" },
      ),
      /non-decreasing/,
    ],
    [
      () => detectTransientDrops([], null),
      /drop options must be an object/,
    ],
    [
      () => detectTransientDrops([], { path: "score", typo: 1 }),
      /unknown drop option/,
    ],
    [
      () => detectTransientDrops([], { path: "" }),
      /non-empty string/,
    ],
    [
      () => detectTransientDrops([], {
        path: "score",
        minimumRelativeDrop: 2,
      }),
      /minimumRelativeDrop/,
    ],
    [
      () => detectTransientDrops([], {
        path: "score",
        recoveryRatio: 1.1,
      }),
      /recoveryRatio/,
    ],
    [
      () => detectTransientSpikes([], {
        path: "score",
        minimumRelativeRise: 0.5,
      }),
      /minimumRelativeRise/,
    ],
    [
      () => detectTransientSpikes([], {
        path: "score",
        lookbackMs: -1,
      }),
      /lookbackMs/,
    ],
    [
      () => detectSurfaceAbsenceAfterFirstPaint([], {
        path: "surface",
        isPaintable: true,
      }),
      /isPaintable must be a function/,
    ],
  ]) {
    assert.throws(run, expected);
  }
});

test("rejects malformed or ambiguous declarative rules", () => {
  for (const [rules, expected] of [
    [null, /rules must be an array/],
    [[null], /each rule must be an object/],
    [[{ id: " ", kind: "drop", path: "score" }], /non-empty id/],
    [[{
      id: "coverage",
      kind: "drop",
      path: "score",
      enabled: true,
    }], /unknown continuity rule field/],
    [[{
      id: "coverage",
      kind: "drop",
      path: "score",
      options: [],
    }], /options must be an object/],
    [[
      { id: "coverage", kind: "drop", path: "score" },
      { id: "coverage", kind: "spike", path: "score" },
    ], /duplicate continuity rule id/],
    [[{ id: "coverage", kind: "dip", path: "score" }], /unknown continuity rule/],
  ]) {
    assert.throws(() => auditTimeline([], rules), expected);
  }
});

test("does not mutate samples, rules, or nested values", () => {
  const samples = freeze([
    { timeMs: 0, metrics: { score: 1 } },
    { timeMs: 10, metrics: { score: 0 } },
    { timeMs: 20, metrics: { score: 1 } },
  ]);
  const rules = freeze([
    {
      id: "score",
      kind: "drop",
      path: "metrics.score",
      options: { recoveryRatio: 0.5 },
    },
  ]);

  const report = auditTimeline(samples, rules);

  assert.equal(report[0].events.length, 1);
  assert.equal(samples[1].metrics.score, 0);
  assert.equal(rules[0].options.recoveryRatio, 0.5);
});

test("matches a naive reference across deterministic noisy samples", () => {
  let seed = 0x0ddc0ffe;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const samples = Array.from({ length: 250 }, (_, index) => ({
    timeMs: index * 13 + (index % 7 === 0 ? 0 : 1),
    value: random(),
  }));
  const dropOptions = {
    path: "value",
    minimumBaseline: 0.1,
    minimumAbsoluteDrop: 0.15,
    minimumRelativeDrop: 0.35,
    lookbackMs: 130,
    recoveryMs: 156,
    recoveryRatio: 0.6,
    mergeWindowMs: 39,
  };
  const spikeOptions = {
    path: "value",
    minimumAbsoluteRise: 0.2,
    minimumRelativeRise: 1.4,
    lookbackMs: 130,
    recoveryMs: 156,
    recoveryTolerance: 0.1,
    mergeWindowMs: 39,
  };

  assert.deepEqual(
    detectTransientDrops(samples, dropOptions),
    naiveDrops(samples, dropOptions),
  );
  assert.deepEqual(
    detectTransientSpikes(samples, spikeOptions),
    naiveSpikes(samples, spikeOptions),
  );
});

test("audits a large window without recursion or quadratic scanning", () => {
  const length = 30_001;
  const midpoint = Math.floor(length / 2);
  const samples = Array.from({ length }, (_, index) => ({
    timeMs: index,
    value: index === midpoint ? 0 : 1,
  }));

  const events = detectTransientDrops(samples, {
    path: "value",
    lookbackMs: length,
    recoveryMs: length,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].startIndex, midpoint);
});
