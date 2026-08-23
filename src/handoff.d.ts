export type HandoffEpoch = string | number;

export type HandoffPhase =
  | "idle"
  | "holding"
  | "revealing"
  | "degraded-reveal"
  | "active";

export interface HandoffState {
  readonly epoch: HandoffEpoch;
  readonly phase: HandoffPhase;
  readonly startedAtMs: number | null;
  readonly readySinceMs: number | null;
  readonly lastFrameAtMs: number | null;
  readonly progress: number;
  readonly timedOut: boolean;
  readonly degraded: boolean;
}

export interface CreateHandoffStateOptions {
  readonly epoch?: HandoffEpoch;
}

export interface HandoffObservation {
  readonly timeMs: number;
  readonly epoch?: HandoffEpoch;
  readonly requested?: boolean;
  readonly previousAvailable?: boolean;
  readonly nextPresent?: boolean;
  readonly coverage?: number;
  readonly loadProgress?: number;
  readonly failed?: boolean;
  readonly [key: string]: unknown;
}

export interface HandoffOptions {
  readonly coverageThreshold?: number;
  readonly loadThreshold?: number;
  readonly stableForMs?: number;
  readonly revealDurationMs?: number;
  readonly revealTimeoutMs?: number;
  readonly maximumFrameDeltaMs?: number;
  readonly allowDegradedRetirement?: boolean;
  readonly retirementTimeoutMs?: number;
}

export interface HandoffPolicy {
  readonly nextOpacity: number;
  readonly retainPrevious: boolean;
  readonly canRetirePrevious: boolean;
  readonly qualityReady: boolean;
  readonly timedOut: boolean;
  readonly degraded: boolean;
}

export interface HandoffResult {
  readonly state: HandoffState;
  readonly policy: HandoffPolicy;
}

export type HandoffReason =
  | "not-requested"
  | "holding-for-quality"
  | "revealing"
  | "revealing-paused"
  | "degraded-after-timeout"
  | "degraded-no-fallback"
  | "retired-degraded"
  | "retired-stable";

export interface HandoffExplanation {
  readonly reason: HandoffReason;
  readonly summary: string;
}

export type HandoffTimelineFrame<
  Observation extends HandoffObservation = HandoffObservation,
> = Omit<Observation, keyof HandoffPolicy | "phase">
  & HandoffPolicy
  & { readonly phase: HandoffPhase };

export function createHandoffState(
  options?: CreateHandoffStateOptions,
): HandoffState;

export function advanceHandoff(
  previousState: HandoffState | null | undefined,
  observation: HandoffObservation,
  options?: HandoffOptions,
): HandoffResult;

export function runHandoffTimeline<
  Observation extends HandoffObservation,
>(
  observations: readonly Observation[],
  options?: HandoffOptions,
): Array<HandoffTimelineFrame<Observation>>;

export function explainHandoff(result: HandoffResult): HandoffExplanation;
