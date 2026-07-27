import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceHandoff,
  createHandoffState,
  runHandoffTimeline,
} from "../src/index.js";

const observation = (timeMs, overrides = {}) => ({
  timeMs,
  epoch: 1,
  requested: true,
  previousAvailable: true,
  nextPresent: true,
  coverage: 1,
  loadProgress: 1,
  ...overrides,
});

const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

test("retains the previous representation until readiness is stable", () => {
  const timeline = runHandoffTimeline(
    [
      observation(0),
      observation(100),
      observation(249),
      observation(250),
      observation(350),
    ],
    { stableForMs: 250, revealDurationMs: 100 },
  );

  assert.equal(timeline[2].nextOpacity, 0);
  assert.equal(timeline[2].retainPrevious, true);
  assert.equal(timeline[3].nextOpacity, 0.01);
  assert.equal(timeline[3].retainPrevious, true);
  assert.equal(timeline[4].nextOpacity, 1);
  assert.equal(timeline[4].canRetirePrevious, true);
  assert.equal(timeline[4].phase, "active");
});

test("pauses an in-progress reveal when readiness drops", () => {
  const options = {
    stableForMs: 0,
    revealDurationMs: 100,
    revealTimeoutMs: 1_000,
  };
  let result = advanceHandoff(null, observation(0), options);
  result = advanceHandoff(result.state, observation(50), options);
  assert.equal(result.state.phase, "revealing");
  assert.equal(result.state.progress, 0.5);

  result = advanceHandoff(
    result.state,
    observation(60, { coverage: 0.4 }),
    options,
  );
  assert.equal(result.state.phase, "revealing");
  assert.equal(result.state.readySinceMs, null);
  assert.equal(result.state.progress, 0.5);

  result = advanceHandoff(
    result.state,
    observation(70, { coverage: 0.4 }),
    options,
  );
  assert.equal(result.state.progress, 0.5);

  result = advanceHandoff(result.state, observation(80), options);
  assert.equal(result.state.readySinceMs, 80);
  assert.equal(result.state.progress, 0.6);
});

test("treats a zero reveal duration as an immediate handoff", () => {
  const result = advanceHandoff(null, observation(0), {
    stableForMs: 0,
    revealDurationMs: 0,
  });

  assert.equal(result.state.phase, "active");
  assert.equal(result.policy.nextOpacity, 1);
  assert.equal(result.policy.canRetirePrevious, true);
});

test("does not retire after a degraded timeout by default", () => {
  const timeline = runHandoffTimeline([
    observation(0, { coverage: 0.4 }),
    observation(2_500, { coverage: 0.4 }),
    observation(2_800, { coverage: 0.4 }),
  ], {
    stableForMs: 0,
    revealTimeoutMs: 2_000,
    revealDurationMs: 100,
    maximumFrameDeltaMs: 500,
  });

  assert.equal(timeline.at(-1).nextOpacity, 1);
  assert.equal(timeline.at(-1).degraded, true);
  assert.equal(timeline.at(-1).retainPrevious, true);
  assert.equal(timeline.at(-1).canRetirePrevious, false);
});

test("shows the next representation immediately when no fallback is available", () => {
  const options = {
    stableForMs: 100,
    revealDurationMs: 300,
  };
  let result = advanceHandoff(
    null,
    observation(0, {
      previousAvailable: false,
      coverage: 0.4,
      loadProgress: 0.4,
    }),
    options,
  );

  assert.equal(result.state.phase, "degraded-reveal");
  assert.equal(result.policy.nextOpacity, 1);
  assert.equal(result.policy.retainPrevious, false);
  assert.equal(result.policy.canRetirePrevious, false);
  assert.equal(result.policy.timedOut, false);
  assert.equal(result.policy.degraded, true);

  result = advanceHandoff(
    result.state,
    observation(100),
    options,
  );
  assert.equal(result.state.phase, "degraded-reveal");
  assert.equal(result.policy.retainPrevious, true);

  result = advanceHandoff(
    result.state,
    observation(200),
    options,
  );
  assert.equal(result.state.phase, "active");
  assert.equal(result.policy.qualityReady, true);
  assert.equal(result.policy.degraded, false);
});

test("permits explicitly configured degraded retirement", () => {
  let result = advanceHandoff(
    null,
    observation(0, { coverage: 0.4 }),
    {
      stableForMs: 0,
      revealTimeoutMs: 100,
      revealDurationMs: 0,
      allowDegradedRetirement: true,
      retirementTimeoutMs: 200,
    },
  );
  result = advanceHandoff(
    result.state,
    observation(100, { coverage: 0.4 }),
    {
      stableForMs: 0,
      revealTimeoutMs: 100,
      revealDurationMs: 0,
      allowDegradedRetirement: true,
      retirementTimeoutMs: 200,
    },
  );
  assert.equal(result.state.phase, "degraded-reveal");
  assert.equal(result.policy.canRetirePrevious, false);

  result = advanceHandoff(
    result.state,
    observation(200, { coverage: 0.4 }),
    {
      stableForMs: 0,
      revealTimeoutMs: 100,
      revealDurationMs: 0,
      allowDegradedRetirement: true,
      retirementTimeoutMs: 200,
    },
  );
  assert.equal(result.state.phase, "active");
  assert.equal(result.policy.degraded, true);
  assert.equal(result.policy.canRetirePrevious, true);
});

test("keeps active terminal within an ownership epoch", () => {
  const completed = advanceHandoff(null, observation(0), {
    stableForMs: 0,
    revealDurationMs: 0,
  });
  const result = advanceHandoff(
    completed.state,
    observation(20, {
      previousAvailable: false,
      nextPresent: false,
      coverage: 0,
      loadProgress: 0,
      failed: true,
    }),
  );

  assert.equal(result.state.phase, "active");
  assert.equal(result.state.lastFrameAtMs, 20);
  assert.equal(result.policy.nextOpacity, 1);
  assert.equal(result.policy.retainPrevious, false);
  assert.equal(result.policy.canRetirePrevious, true);
  assert.equal(result.policy.qualityReady, true);
});

test("resets progress and terminal state when the epoch changes", () => {
  const completed = advanceHandoff(null, observation(0), {
    stableForMs: 0,
    revealDurationMs: 0,
  });
  const reset = advanceHandoff(
    completed.state,
    observation(-10, {
      epoch: "replacement",
      coverage: 0,
      loadProgress: 0,
    }),
  );

  assert.equal(reset.policy.nextOpacity, 0);
  assert.equal(reset.state.epoch, "replacement");
  assert.equal(reset.state.phase, "holding");
});

test("uses wall-clock deltas but clamps a long suspended frame", () => {
  const timeline = runHandoffTimeline(
    [observation(0), observation(1), observation(10_000)],
    {
      stableForMs: 0,
      revealDurationMs: 1_000,
      maximumFrameDeltaMs: 100,
    },
  );

  assert.equal(timeline.at(-1).nextOpacity, 0.101);
});

test("returns an idle policy when no handoff is requested", () => {
  const result = advanceHandoff(
    createHandoffState(),
    observation(0, { requested: false }),
  );

  assert.deepEqual(result.state, createHandoffState({ epoch: 1 }));
  assert.equal(result.policy.nextOpacity, 0);
  assert.equal(result.policy.retainPrevious, true);
});

test("clamps finite coverage metrics without coercing them", () => {
  const ready = advanceHandoff(
    null,
    observation(0, { coverage: 4, loadProgress: 2 }),
    { stableForMs: 0, revealDurationMs: 0 },
  );
  assert.equal(ready.policy.qualityReady, true);

  const notReady = advanceHandoff(
    null,
    observation(0, { coverage: -1, loadProgress: 2 }),
    { stableForMs: 0, revealDurationMs: 0 },
  );
  assert.equal(notReady.policy.qualityReady, false);
  assert.equal(notReady.state.phase, "holding");
});

test("does not mutate caller-owned state, observations, or options", () => {
  const state = freeze(createHandoffState({ epoch: "scene" }));
  const frame = freeze(observation(0, { epoch: "scene" }));
  const options = freeze({ stableForMs: 0, revealDurationMs: 20 });

  const result = advanceHandoff(state, frame, options);

  assert.notEqual(result.state, state);
  assert.deepEqual(state, createHandoffState({ epoch: "scene" }));
  assert.equal(result.state.phase, "holding");
});

test("validates observations instead of silently coercing values", () => {
  for (const [frame, expected] of [
    [null, /observation must be an object/],
    [[], /observation must be an object/],
    [{ timeMs: "0" }, /timeMs must be a finite number/],
    [{ timeMs: Infinity }, /timeMs must be a finite number/],
    [observation(0, { requested: 1 }), /requested must be a boolean/],
    [observation(0, { failed: "yes" }), /failed must be a boolean/],
    [observation(0, { coverage: "1" }), /coverage must be a finite number/],
    [observation(0, { loadProgress: NaN }), /loadProgress must be a finite number/],
    [observation(0, { epoch: null }), /epoch must be a string or finite number/],
    [observation(0, { epoch: {} }), /epoch must be a string or finite number/],
  ]) {
    assert.throws(() => advanceHandoff(null, frame), expected);
  }
});

test("rejects malformed state creation and handoff options", () => {
  assert.throws(() => createHandoffState(null), /state options/);
  assert.throws(
    () => createHandoffState({ generation: 1 }),
    /unknown state option/,
  );
  assert.throws(
    () => createHandoffState({ epoch: Infinity }),
    /epoch must be a string or finite number/,
  );

  for (const [options, expected] of [
    [null, /handoff options must be an object/],
    [[], /handoff options must be an object/],
    [{ coverageThreshhold: 0.9 }, /unknown handoff option/],
    [{ coverageThreshold: 2 }, /from 0 to 1/],
    [{ stableForMs: -1 }, /finite non-negative number/],
    [{ revealDurationMs: -1 }, /finite non-negative number/],
    [{ maximumFrameDeltaMs: 0 }, /finite positive number/],
    [{ allowDegradedRetirement: "yes" }, /must be a boolean/],
    [{
      allowDegradedRetirement: true,
      revealTimeoutMs: 200,
      retirementTimeoutMs: 100,
    }, /must not precede revealTimeoutMs/],
  ]) {
    assert.throws(
      () => advanceHandoff(null, observation(0), options),
      expected,
    );
  }
});

test("rejects incomplete or internally inconsistent previous state", () => {
  const holding = advanceHandoff(
    null,
    observation(0, { nextPresent: false }),
  ).state;
  const { phase: _phase, ...missingPhase } = holding;

  for (const [state, expected] of [
    [42, /previousState must be an object/],
    [[], /previousState must be an object/],
    [missingPhase, /missing phase/],
    [{ ...holding, extra: true }, /unknown previousState field/],
    [{ ...holding, phase: "waiting" }, /phase is invalid/],
    [{ ...holding, progress: Infinity }, /progress must be a finite number/],
    [{ ...holding, lastFrameAtMs: null }, /timestamps are inconsistent/],
    [{ ...holding, readySinceMs: -1 }, /outside the observed timeline/],
    [{ ...holding, degraded: true }, /must be timed out/],
    [{ ...holding, progress: 0.5 }, /holding previousState/],
    [{
      ...holding,
      phase: "revealing",
      progress: 1,
    }, /revealing previousState/],
    [{
      ...holding,
      phase: "degraded-reveal",
      progress: 0.5,
    }, /degraded-reveal previousState/],
    [{
      ...holding,
      phase: "degraded-reveal",
      progress: 0.5,
      degraded: true,
    }, /untimed degraded-reveal previousState/],
    [{
      ...holding,
      phase: "active",
      progress: 1,
    }, /active previousState/],
    [{
      ...holding,
      phase: "active",
      progress: 0.5,
    }, /active previousState/],
  ]) {
    assert.throws(
      () => advanceHandoff(state, observation(10)),
      expected,
    );
  }
});

test("rejects backward time within one epoch", () => {
  const first = advanceHandoff(null, observation(100));

  assert.throws(
    () => advanceHandoff(first.state, observation(99)),
    /must not precede/,
  );
  assert.throws(
    () => advanceHandoff(
      first.state,
      observation(99, { requested: false }),
    ),
    /must not precede/,
  );
});

test("starts a fresh timeline after a request is cancelled", () => {
  const holding = advanceHandoff(null, observation(100));
  const idle = advanceHandoff(
    holding.state,
    observation(200, { requested: false }),
  );
  const restarted = advanceHandoff(idle.state, observation(50));

  assert.equal(idle.state.phase, "idle");
  assert.equal(idle.state.lastFrameAtMs, null);
  assert.equal(restarted.state.phase, "holding");
  assert.equal(restarted.state.startedAtMs, 50);
});

test("maintains policy invariants across a deterministic noisy timeline", () => {
  let seed = 0x51f15e;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  let state = null;
  let previousProgress = 0;
  let active = false;

  for (let index = 0; index < 1_000; index += 1) {
    const timeMs = index * 17;
    const frame = freeze(observation(timeMs, {
      coverage: random(),
      loadProgress: random(),
      nextPresent: random() > 0.08,
      failed: random() < 0.03,
    }));
    const result = advanceHandoff(state, frame, {
      stableForMs: 34,
      revealDurationMs: 120,
      revealTimeoutMs: 500,
      maximumFrameDeltaMs: 40,
    });

    assert.ok(result.policy.nextOpacity >= previousProgress);
    assert.ok(result.policy.nextOpacity >= 0);
    assert.ok(result.policy.nextOpacity <= 1);
    assert.equal(
      result.policy.retainPrevious,
      frame.previousAvailable && !result.policy.canRetirePrevious,
    );
    if (result.policy.canRetirePrevious) {
      assert.equal(result.policy.nextOpacity, 1);
    }
    if (active) assert.equal(result.state.phase, "active");

    state = freeze(result.state);
    previousProgress = result.policy.nextOpacity;
    active ||= result.state.phase === "active";
  }
});

test("preserves observation data in timeline output and validates the list", () => {
  const timeline = runHandoffTimeline([
    observation(0, { adapter: "canvas" }),
  ], {
    stableForMs: 0,
    revealDurationMs: 0,
  });

  assert.equal(timeline[0].adapter, "canvas");
  assert.equal(timeline[0].phase, "active");
  assert.throws(
    () => runHandoffTimeline(null),
    /observations must be an array/,
  );
});
