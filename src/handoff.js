const DEFAULTS = Object.freeze({
  coverageThreshold: 0.98,
  loadThreshold: 0.98,
  stableForMs: 250,
  revealDurationMs: 300,
  revealTimeoutMs: 2_500,
  maximumFrameDeltaMs: 100,
  allowDegradedRetirement: false,
  retirementTimeoutMs: 8_000,
});
const OPTION_NAMES = new Set(Object.keys(DEFAULTS));
const STATE_NAMES = new Set([
  "epoch",
  "phase",
  "startedAtMs",
  "readySinceMs",
  "lastFrameAtMs",
  "progress",
  "timedOut",
  "degraded",
]);
const PHASES = new Set([
  "idle",
  "holding",
  "revealing",
  "degraded-reveal",
  "active",
]);

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const assertObject = (value, label) => {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
};

const assertEpoch = (epoch) => {
  if (
    (typeof epoch !== "string" && typeof epoch !== "number")
    || (typeof epoch === "number" && !Number.isFinite(epoch))
  ) {
    throw new TypeError("epoch must be a string or finite number");
  }
};

const assertBooleanField = (value, name) => {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`observation.${name} must be a boolean`);
  }
};

const normalizeMetric = (value, name) => {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`observation.${name} must be a finite number`);
  }
  return clamp01(value);
};

const normalizeOptions = (overrides) => {
  assertObject(overrides, "handoff options");
  for (const name of Object.keys(overrides)) {
    if (!OPTION_NAMES.has(name)) {
      throw new TypeError(`unknown handoff option: ${name}`);
    }
  }
  const options = { ...DEFAULTS, ...overrides };
  for (const name of ["coverageThreshold", "loadThreshold"]) {
    if (
      !Number.isFinite(options[name])
      || options[name] < 0
      || options[name] > 1
    ) {
      throw new TypeError(`${name} must be a finite number from 0 to 1`);
    }
  }
  for (const name of [
    "stableForMs",
    "revealDurationMs",
    "revealTimeoutMs",
    "retirementTimeoutMs",
  ]) {
    if (!Number.isFinite(options[name]) || options[name] < 0) {
      throw new TypeError(`${name} must be a finite non-negative number`);
    }
  }
  if (
    !Number.isFinite(options.maximumFrameDeltaMs)
    || options.maximumFrameDeltaMs <= 0
  ) {
    throw new TypeError(
      "maximumFrameDeltaMs must be a finite positive number",
    );
  }
  if (typeof options.allowDegradedRetirement !== "boolean") {
    throw new TypeError("allowDegradedRetirement must be a boolean");
  }
  if (
    options.allowDegradedRetirement
    && options.retirementTimeoutMs < options.revealTimeoutMs
  ) {
    throw new RangeError(
      "retirementTimeoutMs must not precede revealTimeoutMs "
      + "when degraded retirement is enabled",
    );
  }
  return options;
};

export const createHandoffState = (options = {}) => {
  assertObject(options, "state options");
  for (const name of Object.keys(options)) {
    if (name !== "epoch") {
      throw new TypeError(`unknown state option: ${name}`);
    }
  }
  const { epoch = 0 } = options;
  assertEpoch(epoch);
  return {
    epoch,
    phase: "idle",
    startedAtMs: null,
    readySinceMs: null,
    lastFrameAtMs: null,
    progress: 0,
    timedOut: false,
    degraded: false,
  };
};

const resetForEpoch = (epoch, timeMs) => ({
  ...createHandoffState({ epoch }),
  phase: "holding",
  startedAtMs: timeMs,
  lastFrameAtMs: timeMs,
});

const assertTimestamp = (value, name) => {
  if (value !== null && !Number.isFinite(value)) {
    throw new TypeError(`previousState.${name} must be null or finite`);
  }
};

const assertState = (state) => {
  assertObject(state, "previousState");
  for (const name of Object.keys(state)) {
    if (!STATE_NAMES.has(name)) {
      throw new TypeError(`unknown previousState field: ${name}`);
    }
  }
  for (const name of STATE_NAMES) {
    if (!Object.hasOwn(state, name)) {
      throw new TypeError(`previousState is missing ${name}`);
    }
  }

  assertEpoch(state.epoch);
  if (!PHASES.has(state.phase)) {
    throw new TypeError("previousState.phase is invalid");
  }
  assertTimestamp(state.startedAtMs, "startedAtMs");
  assertTimestamp(state.readySinceMs, "readySinceMs");
  assertTimestamp(state.lastFrameAtMs, "lastFrameAtMs");
  if (
    !Number.isFinite(state.progress)
    || state.progress < 0
    || state.progress > 1
  ) {
    throw new TypeError(
      "previousState.progress must be a finite number from 0 to 1",
    );
  }
  for (const name of ["timedOut", "degraded"]) {
    if (typeof state[name] !== "boolean") {
      throw new TypeError(`previousState.${name} must be a boolean`);
    }
  }

  const hasStarted = state.startedAtMs !== null;
  const hasLastFrame = state.lastFrameAtMs !== null;
  if (hasStarted !== hasLastFrame) {
    throw new RangeError(
      "previousState start and last-frame timestamps are inconsistent",
    );
  }
  if (
    hasStarted
    && state.lastFrameAtMs < state.startedAtMs
  ) {
    throw new RangeError(
      "previousState.lastFrameAtMs must not precede startedAtMs",
    );
  }
  if (
    state.readySinceMs !== null
    && (
      !hasStarted
      || state.readySinceMs < state.startedAtMs
      || state.readySinceMs > state.lastFrameAtMs
    )
  ) {
    throw new RangeError(
      "previousState.readySinceMs is outside the observed timeline",
    );
  }
  if (
    state.degraded
    && !state.timedOut
    && state.phase !== "degraded-reveal"
  ) {
    throw new RangeError(
      "a degraded previousState outside degraded-reveal must be timed out",
    );
  }
  if (
    state.degraded
    && !state.timedOut
    && state.progress !== 1
  ) {
    throw new RangeError(
      "an untimed degraded-reveal previousState must have complete progress",
    );
  }
  if (
    state.phase === "idle"
    && (
      hasStarted
      || state.readySinceMs !== null
      || state.progress !== 0
      || state.timedOut
      || state.degraded
    )
  ) {
    throw new RangeError("idle previousState fields are inconsistent");
  }
  if (state.phase !== "idle" && !hasStarted) {
    throw new RangeError(
      "non-idle previousState requires timeline timestamps",
    );
  }
  if (state.phase === "holding" && state.progress !== 0) {
    throw new RangeError("holding previousState must have zero progress");
  }
  if (
    state.phase === "revealing"
    && (
      state.progress <= 0
      || state.progress >= 1
      || state.degraded
    )
  ) {
    throw new RangeError("revealing previousState fields are inconsistent");
  }
  if (
    state.phase === "degraded-reveal"
    && (state.progress <= 0 || !state.degraded)
  ) {
    throw new RangeError(
      "degraded-reveal previousState fields are inconsistent",
    );
  }
  if (
    state.phase === "active"
    && (
      state.progress !== 1
      || (!state.degraded && state.readySinceMs === null)
    )
  ) {
    throw new RangeError("active previousState must have complete progress");
  }
};

const normalizeObservation = (observation, previousState) => {
  assertObject(observation, "observation");
  if (
    typeof observation.timeMs !== "number"
    || !Number.isFinite(observation.timeMs)
  ) {
    throw new TypeError("observation.timeMs must be a finite number");
  }
  for (const name of [
    "requested",
    "previousAvailable",
    "nextPresent",
    "failed",
  ]) {
    assertBooleanField(observation[name], name);
  }
  const epoch = observation.epoch === undefined
    ? previousState?.epoch ?? 0
    : observation.epoch;
  assertEpoch(epoch);
  return {
    timeMs: observation.timeMs,
    epoch,
    requested: observation.requested ?? false,
    previousAvailable: observation.previousAvailable ?? false,
    nextPresent: observation.nextPresent ?? false,
    failed: observation.failed ?? false,
    coverage: normalizeMetric(observation.coverage, "coverage"),
    loadProgress: normalizeMetric(
      observation.loadProgress,
      "loadProgress",
    ),
  };
};

/**
 * Advance one visual handoff.
 *
 * The caller supplies observations; the contract returns policy. No renderer,
 * scene graph, fetch implementation, or animation loop is assumed.
 */
export const advanceHandoff = (previousState, observation, overrides = {}) => {
  if (previousState !== null && previousState !== undefined) {
    assertState(previousState);
  }
  const options = normalizeOptions(overrides);
  const normalized = normalizeObservation(observation, previousState);
  const { timeMs, epoch } = normalized;
  if (
    previousState
    && previousState.epoch === epoch
    && previousState.lastFrameAtMs !== null
    && (
      !Number.isFinite(previousState.lastFrameAtMs)
      || timeMs < previousState.lastFrameAtMs
    )
  ) {
    throw new RangeError(
      "observation.timeMs must not precede the previous frame in one epoch",
    );
  }
  let state = !previousState || previousState.epoch !== epoch
    ? resetForEpoch(epoch, timeMs)
    : { ...previousState };

  if (!normalized.requested) {
    const idle = createHandoffState({ epoch });
    return {
      state: idle,
      policy: {
        nextOpacity: 0,
        retainPrevious: normalized.previousAvailable,
        canRetirePrevious: false,
        qualityReady: false,
        timedOut: false,
        degraded: false,
      },
    };
  }

  if (state.phase === "active") {
    state.lastFrameAtMs = timeMs;
    return {
      state,
      policy: {
        nextOpacity: 1,
        retainPrevious: false,
        canRetirePrevious: true,
        qualityReady: !state.degraded,
        timedOut: state.timedOut,
        degraded: state.degraded,
      },
    };
  }

  if (state.startedAtMs === null) state.startedAtMs = timeMs;
  const elapsedMs = Math.max(0, timeMs - state.startedAtMs);
  const frameDeltaMs = state.lastFrameAtMs === null
    ? 0
    : Math.min(
      options.maximumFrameDeltaMs,
      Math.max(0, timeMs - state.lastFrameAtMs),
    );
  state.lastFrameAtMs = timeMs;

  const {
    nextPresent,
    coverage,
    loadProgress,
  } = normalized;
  const qualityReady = nextPresent
    && coverage >= options.coverageThreshold
    && loadProgress >= options.loadThreshold
    && !normalized.failed;

  if (qualityReady) {
    if (state.readySinceMs === null) state.readySinceMs = timeMs;
  } else {
    state.readySinceMs = null;
  }
  const stableReady = qualityReady
    && timeMs - state.readySinceMs >= options.stableForMs;
  state.timedOut = state.timedOut
    || elapsedMs >= options.revealTimeoutMs;

  const fallbacklessReveal = nextPresent
    && !normalized.previousAvailable;
  const canReveal = nextPresent
    && (stableReady || state.timedOut || fallbacklessReveal);
  if (fallbacklessReveal) {
    state.progress = 1;
  } else if (canReveal) {
    state.progress = options.revealDurationMs === 0
      ? 1
      : clamp01(
        state.progress + frameDeltaMs / options.revealDurationMs,
      );
  }

  const retirementTimedOut = elapsedMs >= options.retirementTimeoutMs;
  const canRetirePrevious = state.progress >= 1
    && (
      stableReady
      || (options.allowDegradedRetirement && nextPresent && retirementTimedOut)
    );
  state.degraded = !stableReady
    && (state.timedOut || fallbacklessReveal || state.degraded);
  state.phase = canRetirePrevious
    ? "active"
    : state.progress > 0
      ? state.degraded ? "degraded-reveal" : "revealing"
      : "holding";

  return {
    state,
    policy: {
      nextOpacity: state.progress,
      retainPrevious:
        normalized.previousAvailable && !canRetirePrevious,
      canRetirePrevious,
      qualityReady: stableReady,
      timedOut: state.timedOut,
      degraded: state.degraded,
    },
  };
};

export const runHandoffTimeline = (observations, options) => {
  if (!Array.isArray(observations)) {
    throw new TypeError("observations must be an array");
  }
  let state = null;
  return observations.map((observation) => {
    const result = advanceHandoff(state, observation, options);
    state = result.state;
    return { ...observation, ...result.policy, phase: state.phase };
  });
};
