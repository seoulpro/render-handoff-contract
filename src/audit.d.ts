export interface TimelineSample {
  readonly timeMs: number;
  readonly [key: string]: unknown;
}

export interface TransientEvent {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly baseline: number;
  readonly recovery: number;
}

export interface SurfaceAbsenceEvent {
  readonly index: number;
  readonly timeMs: number;
  readonly value: unknown;
}

export interface DropOptions {
  readonly path: string;
  readonly minimumBaseline?: number;
  readonly minimumAbsoluteDrop?: number;
  readonly minimumRelativeDrop?: number;
  readonly lookbackMs?: number;
  readonly recoveryMs?: number;
  readonly recoveryRatio?: number;
  readonly mergeWindowMs?: number;
}

export interface SpikeOptions {
  readonly path: string;
  readonly minimumAbsoluteRise?: number;
  readonly minimumRelativeRise?: number;
  readonly lookbackMs?: number;
  readonly recoveryMs?: number;
  readonly recoveryTolerance?: number;
  readonly mergeWindowMs?: number;
}

export interface SurfaceAbsenceOptions {
  readonly path: string;
  readonly isPaintable?: (surface: unknown) => boolean;
}

export interface DropRule {
  readonly id: string;
  readonly kind: "drop";
  readonly path: string;
  readonly options?: Omit<DropOptions, "path">;
}

export interface SpikeRule {
  readonly id: string;
  readonly kind: "spike";
  readonly path: string;
  readonly options?: Omit<SpikeOptions, "path">;
}

export interface SurfaceAbsenceRule {
  readonly id: string;
  readonly kind: "surface-absence";
  readonly path: string;
  readonly options?: Omit<SurfaceAbsenceOptions, "path">;
}

export type AuditRule = DropRule | SpikeRule | SurfaceAbsenceRule;

export interface DropAuditResult {
  readonly id: string;
  readonly kind: "drop";
  readonly path: string;
  readonly events: TransientEvent[];
}

export interface SpikeAuditResult {
  readonly id: string;
  readonly kind: "spike";
  readonly path: string;
  readonly events: TransientEvent[];
}

export interface SurfaceAbsenceAuditResult {
  readonly id: string;
  readonly kind: "surface-absence";
  readonly path: string;
  readonly events: SurfaceAbsenceEvent[];
}

export type AuditResult =
  | DropAuditResult
  | SpikeAuditResult
  | SurfaceAbsenceAuditResult;

export function detectTransientDrops(
  samples: readonly TimelineSample[],
  options: DropOptions,
): TransientEvent[];

export function detectTransientSpikes(
  samples: readonly TimelineSample[],
  options: SpikeOptions,
): TransientEvent[];

export function isDomSurfacePaintable(surface: unknown): boolean;

export function detectSurfaceAbsenceAfterFirstPaint(
  samples: readonly TimelineSample[],
  options: SurfaceAbsenceOptions,
): SurfaceAbsenceEvent[];

export function auditTimeline(
  samples: readonly TimelineSample[],
  rules: readonly AuditRule[],
): AuditResult[];
