import { describe, expect, it } from "vitest";
import { contentCid } from "../src/domain/fingerprint.js";
import {
  buildTimeline,
  firstInTime,
  isIsoInstant,
  isWalletAddress,
  summariseTimeline,
  validateMilestone,
  type Milestone,
} from "../src/domain/milestone.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

const ALICE = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
const BOB = "0x1111111111111111111111111111111111111111";

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "m1",
    projectId: "p1",
    title: "Track 3 First Draft",
    description: "Initial recording and composition",
    stage: "draft",
    cid: contentCid(utf8("track-3-first-draft")),
    recordedAt: "2024-10-20T11:23:00.000Z",
    witnesses: [],
    ...overrides,
  };
}

describe("isWalletAddress", () => {
  it("accepts a 20-byte hex address in either case", () => {
    expect(isWalletAddress(ALICE)).toBe(true);
    expect(isWalletAddress(ALICE.toLowerCase())).toBe(true);
  });

  it.each([
    ["a short address", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"],
    ["a long address", `${ALICE}00`],
    ["a missing 0x prefix", ALICE.slice(2)],
    ["non-hex characters", "0xzzzz35Cc6634C0532925a3b844Bc9e7595f0bEb0"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(isWalletAddress(value)).toBe(false);
  });
});

describe("isIsoInstant", () => {
  it("accepts a UTC instant", () => {
    expect(isIsoInstant("2024-10-20T11:23:00.000Z")).toBe(true);
  });

  it.each([
    ["a date without a time", "2024-10-20"],
    ["a human-readable date", "Oct 20, 2024 11:23 AM"],
    ["an instant with no timezone designator", "2024-10-20T11:23:00"],
    ["a day that does not exist", "2024-02-31T00:00:00.000Z"],
    ["Feb 29 in a non-leap year", "2023-02-29T00:00:00.000Z"],
    ["a 13th month", "2024-13-01T00:00:00.000Z"],
    ["hour 24", "2024-10-20T24:00:00.000Z"],
    ["gibberish", "not-a-date"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(isIsoInstant(value)).toBe(false);
  });

  it("accepts an instant carrying a UTC offset", () => {
    expect(isIsoInstant("2024-10-20T11:23:00-07:00")).toBe(true);
  });

  it("accepts Feb 29 in a leap year", () => {
    expect(isIsoInstant("2024-02-29T00:00:00.000Z")).toBe(true);
  });
});

describe("validateMilestone", () => {
  it("accepts a well-formed milestone", () => {
    expect(validateMilestone(milestone())).toEqual([]);
  });

  it("requires a non-blank title", () => {
    expect(validateMilestone(milestone({ title: "   " }))).toContain("title is required");
  });

  it("rejects a fingerprint that is not a content CID", () => {
    expect(validateMilestone(milestone({ cid: "0x8f7da2b3" }))).toContain(
      "cid must be a CIDv1/raw/sha2-256 fingerprint",
    );
  });

  it("rejects a stage outside the timeline vocabulary", () => {
    const errors = validateMilestone(milestone({ stage: "mastered" as Milestone["stage"] }));
    expect(errors.some((error) => error.startsWith("stage must be one of"))).toBe(true);
  });

  it("rejects a malformed witness address", () => {
    const errors = validateMilestone(milestone({ witnesses: [ALICE, "0xnope"] }));
    expect(errors.some((error) => error.includes("invalid witness address"))).toBe(true);
  });

  it("treats the same witness in different casing as a duplicate", () => {
    const errors = validateMilestone(milestone({ witnesses: [ALICE, ALICE.toLowerCase()] }));
    expect(errors.some((error) => error.includes("duplicate witness address"))).toBe(true);
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const errors = validateMilestone(
      milestone({ title: "", cid: "nope", recordedAt: "yesterday", witnesses: ["0xnope"] }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("buildTimeline", () => {
  const draft = milestone({ id: "m1", stage: "draft", recordedAt: "2024-10-20T11:23:00.000Z" });
  const revision = milestone({
    id: "m2",
    stage: "revision",
    recordedAt: "2024-10-28T16:12:00.000Z",
  });
  const final = milestone({ id: "m3", stage: "final", recordedAt: "2024-11-01T14:34:00.000Z" });

  it("orders newest first, as the timeline screen renders it", () => {
    expect(buildTimeline([draft, final, revision]).map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("breaks ties on id so the render order is stable", () => {
    const a = milestone({ id: "b", recordedAt: "2024-10-20T11:23:00.000Z" });
    const b = milestone({ id: "a", recordedAt: "2024-10-20T11:23:00.000Z" });
    expect(buildTimeline([a, b]).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [draft, final, revision];
    buildTimeline(input);
    expect(input.map((m) => m.id)).toEqual(["m1", "m3", "m2"]);
  });

  it("handles an empty project", () => {
    expect(buildTimeline([])).toEqual([]);
  });
});

describe("summariseTimeline", () => {
  const milestones = [
    milestone({ id: "m1", stage: "draft", recordedAt: "2024-10-20T11:23:00.000Z" }),
    milestone({
      id: "m2",
      stage: "revision",
      recordedAt: "2024-10-28T16:12:00.000Z",
      witnesses: [ALICE, BOB],
    }),
    milestone({
      id: "m3",
      stage: "final",
      recordedAt: "2024-11-01T14:34:00.000Z",
      witnesses: [ALICE.toLowerCase()],
    }),
  ];

  it("counts milestones by stage", () => {
    expect(summariseTimeline(milestones).stageCounts).toEqual({
      draft: 1,
      revision: 1,
      final: 1,
    });
  });

  it("reports the span from first to last registration", () => {
    const summary = summariseTimeline(milestones);
    expect(summary.firstRecordedAt).toBe("2024-10-20T11:23:00.000Z");
    expect(summary.lastRecordedAt).toBe("2024-11-01T14:34:00.000Z");
    expect(summary.spanDays).toBe(12);
  });

  it("counts each witness once regardless of address casing", () => {
    expect(summariseTimeline(milestones).witnessCount).toBe(2);
  });

  it("returns a zeroed summary for a project with no milestones", () => {
    expect(summariseTimeline([])).toEqual({
      milestoneCount: 0,
      firstRecordedAt: null,
      lastRecordedAt: null,
      spanDays: 0,
      witnessCount: 0,
      stageCounts: { draft: 0, revision: 0, final: 0 },
    });
  });
});

describe("firstInTime", () => {
  const cid = contentCid(utf8("disputed-work"));
  const early = milestone({ id: "early", cid, recordedAt: "2024-10-20T11:23:00.000Z" });
  const late = milestone({ id: "late", cid, recordedAt: "2025-02-01T09:00:00.000Z" });
  const unrelated = milestone({ id: "other", cid: contentCid(utf8("something-else")) });

  it("awards priority to the earliest registration of the fingerprint", () => {
    expect(firstInTime(cid, [late, unrelated, early]).winner?.id).toBe("early");
  });

  it("ignores registrations of other content", () => {
    expect(firstInTime(cid, [late, unrelated, early]).contested).toEqual([]);
  });

  it("returns no winner for content that was never registered", () => {
    expect(firstInTime(contentCid(utf8("never-seen")), [early, late])).toEqual({
      winner: null,
      contested: [],
    });
  });

  it("refuses to pick a winner on an exact timestamp tie and surfaces both claims", () => {
    const tie = milestone({ id: "tie", cid, recordedAt: early.recordedAt });
    const result = firstInTime(cid, [early, tie]);
    expect(result.winner).toBeNull();
    expect(result.contested.map((m) => m.id).sort()).toEqual(["early", "tie"]);
  });
});
