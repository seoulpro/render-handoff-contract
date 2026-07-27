const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const RULE_KEYS = new Set(["id", "kind", "path", "options"]);

const assertTimeline = (samples) => {
  if (!Array.isArray(samples)) {
    throw new TypeError("samples must be an array");
  }
  let previousTime = -Infinity;
  for (const [index, sample] of samples.entries()) {
    if (
      typeof sample !== "object"
      || sample === null
      || Array.isArray(sample)
      || !Object.hasOwn(sample, "timeMs")
      || !Number.isFinite(sample.timeMs)
    ) {
      throw new TypeError(`sample ${index} must have a finite own timeMs`);
    }
    if (sample.timeMs < previousTime) {
      throw new RangeError("sample timeMs values must be non-decreasing");
    }
    previousTime = sample.timeMs;
  }
};

const normalizeOptions = (options, label, allowedKeys) => {
  if (
    typeof options !== "object"
    || options === null
    || Array.isArray(options)
  ) {
    throw new TypeError(`${label} options must be an object`);
  }
  for (const key of Object.keys(options)) {
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`unknown ${label} option: ${key}`);
    }
  }
  return options;
};

const assertNumber = (
  value,
  name,
  { minimum = 0, maximum = Infinity } = {},
) => {
  if (
    !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    const range = maximum === Infinity
      ? `at least ${minimum}`
      : `from ${minimum} to ${maximum}`;
    throw new TypeError(`${name} must be a finite number ${range}`);
  }
};

const parsePath = (path) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("audit path must be a non-empty string");
  }
  const segments = path.split(".");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || FORBIDDEN_PATH_SEGMENTS.has(segment),
    )
  ) {
    throw new TypeError("audit path contains an invalid segment");
  }
  return segments;
};

const getPath = (value, segments) => {
  let current = value;
  for (const key of segments) {
    if (
      current === null
      || (typeof current !== "object" && typeof current !== "function")
      || !Object.hasOwn(current, key)
    ) {
      return undefined;
    }
    current = current[key];
  }
  return current;
};

const finiteMetric = (sample, segments) => {
  const value = getPath(sample, segments);
  return Number.isFinite(value) ? Number(value) : null;
};

const mergeNearbyEvents = (events, mergeWindowMs) => {
  const merged = [];
  for (const event of events) {
    const previous = merged.at(-1);
    if (previous && event.timeMs - previous.endTimeMs <= mergeWindowMs) {
      previous.endIndex = event.index;
      previous.endTimeMs = event.timeMs;
      previous.minimum = Math.min(previous.minimum, event.value);
      previous.maximum = Math.max(previous.maximum, event.value);
      previous.recovery = event.recovery;
      continue;
    }
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
  return merged;
};

const metricValues = (samples, segments) =>
  samples.map((sample) => finiteMetric(sample, segments));

const windowExtrema = (
  samples,
  values,
  windowMs,
  mode,
  direction,
) => {
  const output = Array(samples.length).fill(null);
  const deque = [];
  let head = 0;
  const isBetter = mode === "maximum"
    ? (candidate, current) => candidate >= current
    : (candidate, current) => candidate <= current;
  const push = (index) => {
    while (
      deque.length > head
      && isBetter(values[index], values[deque.at(-1)])
    ) {
      deque.pop();
    }
    deque.push(index);
  };

  if (direction < 0) {
    for (let index = 0; index < samples.length; index += 1) {
      const cutoff = samples[index].timeMs - windowMs;
      while (
        head < deque.length
        && samples[deque[head]].timeMs < cutoff
      ) {
        head += 1;
      }
      if (head < deque.length) output[index] = values[deque[head]];
      if (values[index] !== null) push(index);
    }
  } else {
    for (let index = samples.length - 1; index >= 0; index -= 1) {
      const cutoff = samples[index].timeMs + windowMs;
      while (
        head < deque.length
        && samples[deque[head]].timeMs > cutoff
      ) {
        head += 1;
      }
      if (head < deque.length) output[index] = values[deque[head]];
      if (values[index] !== null) push(index);
    }
  }
  return output;
};

export const detectTransientDrops = (
  samples,
  options,
) => {
  assertTimeline(samples);
  const normalized = normalizeOptions(options, "drop", [
    "path",
    "minimumBaseline",
    "minimumAbsoluteDrop",
    "minimumRelativeDrop",
    "lookbackMs",
    "recoveryMs",
    "recoveryRatio",
    "mergeWindowMs",
  ]);
  const {
    path,
    minimumBaseline = 0.08,
    minimumAbsoluteDrop = 0.05,
    minimumRelativeDrop = 0.45,
    lookbackMs = 600,
    recoveryMs = 600,
    recoveryRatio = 0.7,
    mergeWindowMs = 150,
  } = normalized;
  assertNumber(minimumBaseline, "minimumBaseline");
  assertNumber(minimumAbsoluteDrop, "minimumAbsoluteDrop");
  assertNumber(minimumRelativeDrop, "minimumRelativeDrop", { maximum: 1 });
  assertNumber(lookbackMs, "lookbackMs");
  assertNumber(recoveryMs, "recoveryMs");
  assertNumber(recoveryRatio, "recoveryRatio", { maximum: 1 });
  assertNumber(mergeWindowMs, "mergeWindowMs");
  const segments = parsePath(path);
  const values = metricValues(samples, segments);
  const baselines = windowExtrema(
    samples,
    values,
    lookbackMs,
    "maximum",
    -1,
  );
  const recoveries = windowExtrema(
    samples,
    values,
    recoveryMs,
    "maximum",
    1,
  );
  const events = [];
  for (let index = 0; index < samples.length; index += 1) {
    const value = values[index];
    if (value === null) continue;
    const baseline = baselines[index];
    if (baseline === null) continue;
    if (baseline < minimumBaseline) continue;
    if (baseline - value < minimumAbsoluteDrop) continue;
    if (value / Math.max(baseline, Number.EPSILON) > 1 - minimumRelativeDrop) {
      continue;
    }
    const recovery = recoveries[index];
    if (recovery === null || recovery < baseline * recoveryRatio) continue;
    events.push({
      index,
      timeMs: samples[index].timeMs,
      value,
      baseline,
      recovery,
    });
  }
  return mergeNearbyEvents(events, mergeWindowMs);
};

export const detectTransientSpikes = (
  samples,
  options,
) => {
  assertTimeline(samples);
  const normalized = normalizeOptions(options, "spike", [
    "path",
    "minimumAbsoluteRise",
    "minimumRelativeRise",
    "lookbackMs",
    "recoveryMs",
    "recoveryTolerance",
    "mergeWindowMs",
  ]);
  const {
    path,
    minimumAbsoluteRise = 0.15,
    minimumRelativeRise = 1.5,
    lookbackMs = 600,
    recoveryMs = 600,
    recoveryTolerance = 0.08,
    mergeWindowMs = 150,
  } = normalized;
  assertNumber(minimumAbsoluteRise, "minimumAbsoluteRise");
  assertNumber(
    minimumRelativeRise,
    "minimumRelativeRise",
    { minimum: 1 },
  );
  assertNumber(lookbackMs, "lookbackMs");
  assertNumber(recoveryMs, "recoveryMs");
  assertNumber(recoveryTolerance, "recoveryTolerance");
  assertNumber(mergeWindowMs, "mergeWindowMs");
  const segments = parsePath(path);
  const values = metricValues(samples, segments);
  const baselines = windowExtrema(
    samples,
    values,
    lookbackMs,
    "minimum",
    -1,
  );
  const recoveries = windowExtrema(
    samples,
    values,
    recoveryMs,
    "minimum",
    1,
  );
  const events = [];
  for (let index = 0; index < samples.length; index += 1) {
    const value = values[index];
    if (value === null) continue;
    const baseline = baselines[index];
    if (baseline === null) continue;
    if (value - baseline < minimumAbsoluteRise) continue;
    if (value < Math.max(minimumAbsoluteRise, baseline * minimumRelativeRise)) {
      continue;
    }
    const recovery = recoveries[index];
    if (recovery === null || recovery > baseline + recoveryTolerance) continue;
    events.push({
      index,
      timeMs: samples[index].timeMs,
      value,
      baseline,
      recovery,
    });
  }
  return mergeNearbyEvents(events, mergeWindowMs);
};

export const isDomSurfacePaintable = (surface) => {
  if (
    surface === null
    || (typeof surface !== "object" && typeof surface !== "function")
  ) {
    return false;
  }
  const ownValue = (key, fallback) =>
    Object.hasOwn(surface, key) ? surface[key] : fallback;
  const connected = ownValue("connected", true);
  const opacity = ownValue("opacity", undefined);
  const width = ownValue("width", 1);
  const height = ownValue("height", 1);
  const visibility = ownValue("visibility", undefined);
  return typeof connected === "boolean"
    && connected
    && ownValue("display", undefined) !== "none"
    && visibility !== "hidden"
    && visibility !== "collapse"
    && typeof opacity === "number"
    && Number.isFinite(opacity)
    && opacity > 0.01
    && typeof width === "number"
    && Number.isFinite(width)
    && width > 0
    && typeof height === "number"
    && Number.isFinite(height)
    && height > 0;
};

export const detectSurfaceAbsenceAfterFirstPaint = (
  samples,
  options,
) => {
  assertTimeline(samples);
  const {
    path,
    isPaintable = isDomSurfacePaintable,
  } = normalizeOptions(options, "surface-absence", ["path", "isPaintable"]);
  if (typeof isPaintable !== "function") {
    throw new TypeError("isPaintable must be a function");
  }
  const segments = parsePath(path);
  const failures = [];
  let firstPaintObserved = false;
  for (let index = 0; index < samples.length; index += 1) {
    const surface = getPath(samples[index], segments);
    if (isPaintable(surface)) {
      firstPaintObserved = true;
      continue;
    }
    if (!firstPaintObserved) continue;
    failures.push({
      index,
      timeMs: samples[index].timeMs,
      value: surface ?? null,
    });
  }
  return failures;
};

export const auditTimeline = (samples, rules) => {
  assertTimeline(samples);
  if (!Array.isArray(rules)) {
    throw new TypeError("rules must be an array");
  }
  const identifiers = new Set();
  return rules.map((rule) => {
    if (
      typeof rule !== "object"
      || rule === null
      || Array.isArray(rule)
    ) {
      throw new TypeError("each rule must be an object");
    }
    for (const key of Object.keys(rule)) {
      if (!RULE_KEYS.has(key)) {
        throw new TypeError(`unknown continuity rule field: ${key}`);
      }
    }
    if (
      typeof rule.id !== "string"
      || rule.id.trim().length === 0
    ) {
      throw new TypeError("each rule requires a non-empty id");
    }
    if (identifiers.has(rule.id)) {
      throw new TypeError(`duplicate continuity rule id: ${rule.id}`);
    }
    identifiers.add(rule.id);
    if (
      rule.options !== undefined
      && (
        typeof rule.options !== "object"
        || rule.options === null
        || Array.isArray(rule.options)
      )
    ) {
      throw new TypeError(`rule ${rule.id} options must be an object`);
    }
    const options = { ...rule.options, path: rule.path };
    let events;
    if (rule.kind === "drop") events = detectTransientDrops(samples, options);
    else if (rule.kind === "spike") events = detectTransientSpikes(samples, options);
    else if (rule.kind === "surface-absence") {
      events = detectSurfaceAbsenceAfterFirstPaint(samples, options);
    } else {
      throw new TypeError(`unknown continuity rule: ${String(rule.kind)}`);
    }
    return { id: rule.id, kind: rule.kind, path: rule.path, events };
  });
};
