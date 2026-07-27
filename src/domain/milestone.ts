import { isContentCid } from "./fingerprint.js";

/**
 * Projects and the milestones that make up their creative timeline.
 *
 * The product claim is "first in line, first in time", so the ordering and
 * priority rules here are load-bearing: they decide which registration a
 * dispute resolves in favour of.
 */

export type MilestoneStage = "draft" | "revision" | "final";

export const MILESTONE_STAGES: readonly MilestoneStage[] = ["draft", "revision", "final"];

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  stage: MilestoneStage;
  /** CIDv1 fingerprint of the milestone's content */
  cid: string;
  /** ISO 8601 instant the milestone was recorded */
  recordedAt: string;
  /** Wallet addresses that co-signed this milestone */
  witnesses: string[];
}

export interface Project {
  id: string;
  name: string;
  /** Free-form category shown under the project title, e.g. "Music" */
  category: string;
  /** Wallet address of the account that owns the project */
  owner: string;
  createdAt: string;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 is not checked here; this is a shape check for a 20-byte hex address. */
export function isWalletAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(year: number, month: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * A calendar date alone is not good enough: priority disputes turn on the order of two
 * registrations, so an attestation must carry a time and a zone. Neither is the shape
 * check alone enough — `Date.parse("2024-02-31T00:00:00Z")` does not fail, it silently
 * rolls over to March 2. A date that moves two days after being stored is a defect in a
 * timestamping product, so the calendar fields are range-checked directly.
 */
export function isIsoInstant(value: string): boolean {
  if (typeof value !== "string") return false;
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  return Number.isFinite(Date.parse(value));
}

/**
 * Collect every reason a milestone would be rejected, rather than throwing on the
 * first — the Register screen shows all field errors at once.
 */
export function validateMilestone(milestone: Milestone): string[] {
  const errors: string[] = [];

  if (!milestone.title || milestone.title.trim().length === 0) {
    errors.push("title is required");
  }
  if (!MILESTONE_STAGES.includes(milestone.stage)) {
    errors.push(`stage must be one of: ${MILESTONE_STAGES.join(", ")}`);
  }
  if (!isContentCid(milestone.cid)) {
    errors.push("cid must be a CIDv1/raw/sha2-256 fingerprint");
  }
  if (!isIsoInstant(milestone.recordedAt)) {
    errors.push("recordedAt must be an ISO 8601 instant");
  }

  const invalidWitnesses = milestone.witnesses.filter((address) => !isWalletAddress(address));
  if (invalidWitnesses.length > 0) {
    errors.push(`invalid witness address(es): ${invalidWitnesses.join(", ")}`);
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const address of milestone.witnesses) {
    const key = address.toLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size > 0) {
    errors.push(`duplicate witness address(es): ${[...duplicates].join(", ")}`);
  }

  return errors;
}

/**
 * Timeline order for the project view: newest first, matching the wireframe where the
 * final mix sits above the revision above the first draft. Ties break on id so the
 * render order is stable across reloads.
 */
export function buildTimeline(milestones: readonly Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => {
    const delta = Date.parse(b.recordedAt) - Date.parse(a.recordedAt);
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id);
  });
}

export interface TimelineSummary {
  milestoneCount: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
  spanDays: number;
  witnessCount: number;
  stageCounts: Record<MilestoneStage, number>;
}

export function summariseTimeline(milestones: readonly Milestone[]): TimelineSummary {
  const stageCounts: Record<MilestoneStage, number> = { draft: 0, revision: 0, final: 0 };
  const witnesses = new Set<string>();

  for (const milestone of milestones) {
    stageCounts[milestone.stage] += 1;
    for (const address of milestone.witnesses) {
      witnesses.add(address.toLowerCase());
    }
  }

  if (milestones.length === 0) {
    return {
      milestoneCount: 0,
      firstRecordedAt: null,
      lastRecordedAt: null,
      spanDays: 0,
      witnessCount: 0,
      stageCounts,
    };
  }

  const ordered = buildTimeline(milestones);
  const last = ordered[0];
  const first = ordered[ordered.length - 1];
  const spanMs = Date.parse(last.recordedAt) - Date.parse(first.recordedAt);

  return {
    milestoneCount: milestones.length,
    firstRecordedAt: first.recordedAt,
    lastRecordedAt: last.recordedAt,
    spanDays: Math.floor(spanMs / 86_400_000),
    witnessCount: witnesses.size,
    stageCounts,
  };
}

/**
 * The priority rule behind "first in line, first in time": of every milestone carrying
 * this fingerprint, the earliest recorded one wins. An exact timestamp tie is not
 * resolved by guessing — the caller gets both and escalates.
 */
export interface PriorityResult {
  winner: Milestone | null;
  contested: Milestone[];
}

export function firstInTime(cid: string, milestones: readonly Milestone[]): PriorityResult {
  const matches = milestones.filter((milestone) => milestone.cid === cid);
  if (matches.length === 0) {
    return { winner: null, contested: [] };
  }

  const earliest = matches.reduce((best, milestone) =>
    Date.parse(milestone.recordedAt) < Date.parse(best.recordedAt) ? milestone : best,
  );

  const tied = matches.filter(
    (milestone) => Date.parse(milestone.recordedAt) === Date.parse(earliest.recordedAt),
  );

  if (tied.length > 1) {
    return { winner: null, contested: buildTimeline(tied) };
  }
  return { winner: earliest, contested: [] };
}
