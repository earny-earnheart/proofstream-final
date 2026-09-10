import { describe, expect, it } from "vitest";
import { contentCid } from "../src/domain/fingerprint.js";
import type { Milestone, Project } from "../src/domain/milestone.js";
import type { ProofObject, RegistryEntry } from "../src/domain/proof.js";
import app from "../src/worker/index.js";
import { MemoryRegistryStore, billingPeriod } from "../src/worker/registry.js";
import type { Env } from "../src/worker/types.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

const SIGNER = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
const RIVAL = `0x${"9".repeat(40)}`;
const SIGNATURE = `0x${"ab".repeat(65)}`;
const TX_HASH = `0x${"cd".repeat(32)}`;

const TRACK_3_CID = await contentCid(utf8("track-3-first-draft"));
const UNREGISTERED_CID = await contentCid(utf8("never-registered"));

const PROJECT: Project = {
  id: "p1",
  name: "Summer Album 2024",
  category: "Music",
  owner: SIGNER,
  createdAt: "2024-10-15T00:00:00.000Z",
};

const MILESTONE: Milestone = {
  id: "m1",
  projectId: "p1",
  title: "Track 3 First Draft",
  stage: "draft",
  cid: TRACK_3_CID,
  recordedAt: "2024-10-20T11:23:00.000Z",
  witnesses: [],
};

const PROOF: ProofObject = {
  cid: TRACK_3_CID,
  signer: SIGNER,
  date: "2024-10-20T11:23:00.000Z",
  eip712Signature: SIGNATURE,
  anchorTx: TX_HASH,
  anchorChainId: 8453,
};

const ENTRY: RegistryEntry = { milestone: MILESTONE, project: PROJECT, proof: PROOF };

/**
 * A KV stand-in backed by the in-memory store, so the endpoints are exercised end to end
 * through the real Hono/chanfana stack without needing workerd.
 */
function kvFrom(entries: readonly RegistryEntry[]): KVNamespace {
  const store = new MemoryRegistryStore(entries);

  return {
    async get(key: string, _type?: string) {
      if (key.startsWith("cid:")) {
        const found = await store.entriesForCid(key.slice("cid:".length));
        return found.length > 0 ? found.map((entry) => entry.milestone.id) : null;
      }
      if (key.startsWith("project:")) {
        const found = await store.entriesForProject(key.slice("project:".length));
        return found.length > 0 ? found.map((entry) => entry.milestone.id) : null;
      }
      if (key.startsWith("entry:")) {
        const id = key.slice("entry:".length);
        return entries.find((entry) => entry.milestone.id === id) ?? null;
      }
      return null;
    },
    async put() {},
  } as unknown as KVNamespace;
}

function env(entries: readonly RegistryEntry[] = [ENTRY]): Env {
  return { REGISTRY_KV: kvFrom(entries) };
}

const request = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`https://proofstream.test${path}`, init), env());

describe("GET /health", () => {
  it("answers ok", async () => {
    const response = await request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});

describe("OpenAPI document", () => {
  it("is served and describes the API", async () => {
    const response = await request("/openapi.json");
    expect(response.status).toBe(200);

    const doc = (await response.json()) as {
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(doc.info.title).toBe("ProofStream API");
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/api/plans",
      "/api/projects/{projectId}/timeline",
      "/api/registrations",
      "/api/verify/{cid}",
    ]);
  });
});

describe("GET /api/plans", () => {
  it("serves the four tiers cheapest first, from the same module the gate reads", async () => {
    const response = await request("/api/plans");
    const body = (await response.json()) as {
      plans: { id: string; priceUsdMonthly: number; monthlyRegistrations: number | null }[];
    };

    expect(body.plans.map((plan) => plan.id)).toEqual([
      "free",
      "creator",
      "professional",
      "studio",
    ]);
    expect(body.plans.map((plan) => plan.priceUsdMonthly)).toEqual([0, 10, 25, 100]);
    expect(body.plans[2].monthlyRegistrations).toBeNull();
  });
});

describe("GET /api/verify/:cid", () => {
  it("verifies a registered fingerprint", async () => {
    const response = await request(`/api/verify/${TRACK_3_CID}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      contested: boolean;
      registration: { creator: string; projectName: string; anchored: boolean };
    };
    expect(body.status).toBe("verified");
    expect(body.registration.creator).toBe(SIGNER);
    expect(body.registration.projectName).toBe("Summer Album 2024");
    expect(body.registration.anchored).toBe(true);
    expect(body.contested).toBe(false);
  });

  it("reports an unregistered fingerprint without calling it an error", async () => {
    const response = await request(`/api/verify/${UNREGISTERED_CID}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("unregistered");
  });

  it("distinguishes a malformed fingerprint from an unregistered one", async () => {
    const response = await request("/api/verify/not-a-cid");
    expect(((await response.json()) as { status: string }).status).toBe("invalid-input");
  });

  it("flags a contested fingerprint and still returns the earliest claim", async () => {
    const rival: RegistryEntry = {
      project: { ...PROJECT, id: "p2", name: "Copycat EP", owner: RIVAL },
      milestone: { ...MILESTONE, id: "m9", projectId: "p2", recordedAt: "2025-03-01T00:00:00.000Z" },
      proof: { ...PROOF, signer: RIVAL, date: "2025-03-01T00:00:00.000Z" },
    };
    const response = await app.fetch(
      new Request(`https://proofstream.test/api/verify/${TRACK_3_CID}`),
      env([rival, ENTRY]),
    );

    const body = (await response.json()) as {
      contested: boolean;
      registration: { projectName: string };
    };
    expect(body.contested).toBe(true);
    expect(body.registration.projectName).toBe("Summer Album 2024");
  });

  it("does not present an unanchored proof as chain-backed", async () => {
    const unanchored: RegistryEntry = {
      ...ENTRY,
      proof: { ...PROOF, anchorTx: undefined, anchorChainId: undefined },
    };
    const response = await app.fetch(
      new Request(`https://proofstream.test/api/verify/${TRACK_3_CID}`),
      env([unanchored]),
    );

    const body = (await response.json()) as { registration: { anchored: boolean } };
    expect(body.registration.anchored).toBe(false);
  });
});

describe("GET /api/projects/:projectId/timeline", () => {
  it("returns milestones newest first with a summary", async () => {
    const later: RegistryEntry = {
      ...ENTRY,
      milestone: {
        ...MILESTONE,
        id: "m2",
        stage: "final",
        recordedAt: "2024-11-01T14:34:00.000Z",
      },
    };
    const response = await app.fetch(
      new Request("https://proofstream.test/api/projects/p1/timeline"),
      env([ENTRY, later]),
    );

    const body = (await response.json()) as {
      milestones: { id: string }[];
      summary: { milestoneCount: number; spanDays: number };
    };
    expect(body.milestones.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(body.summary.milestoneCount).toBe(2);
    expect(body.summary.spanDays).toBe(12);
  });

  it("returns an empty timeline for an unknown project", async () => {
    const response = await request("/api/projects/does-not-exist/timeline");
    const body = (await response.json()) as {
      milestones: unknown[];
      summary: { milestoneCount: number };
    };
    expect(body.milestones).toEqual([]);
    expect(body.summary.milestoneCount).toBe(0);
  });
});

describe("POST /api/registrations", () => {
  const valid = {
    projectId: "p1",
    title: "Track 4 First Draft",
    stage: "draft",
    cid: UNREGISTERED_CID,
    recordedAt: "2025-01-05T09:00:00.000Z",
    witnesses: [],
  };

  const post = (body: unknown) =>
    request("/api/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses to record a valid proposal while no principal can be authenticated", async () => {
    const response = await post(valid);
    expect(response.status).toBe(501);

    const body = (await response.json()) as {
      status: string;
      validated: boolean;
      blockedBy: string[];
    };
    expect(body.status).toBe("not-recorded");
    expect(body.validated).toBe(true);
    expect(body.blockedBy).toContain("auth0-jwt-middleware");
  });

  it("rejects a fingerprint that is not a content CID before anything else", async () => {
    const response = await post({ ...valid, cid: "0x8f7da2b3" });
    expect(response.status).toBe(422);

    const body = (await response.json()) as { errors: string[] };
    expect(body.errors).toContain("cid must be a CIDv1/raw/sha2-256 fingerprint");
  });

  it("rejects a bare calendar date as the attestation instant", async () => {
    const response = await post({ ...valid, recordedAt: "2025-01-05" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { errors: string[] }).errors).toContain(
      "recordedAt must be an ISO 8601 instant",
    );
  });

  it("rejects a malformed witness address", async () => {
    const response = await post({ ...valid, witnesses: ["0xnope"] });
    expect(response.status).toBe(422);
    expect(
      ((await response.json()) as { errors: string[] }).errors.some((error) =>
        error.includes("invalid witness address"),
      ),
    ).toBe(true);
  });

  it("rejects a stage outside the timeline vocabulary at the schema boundary", async () => {
    const response = await post({ ...valid, stage: "mastered" });
    expect(response.status).toBe(400);
  });
});

describe("billingPeriod", () => {
  it("formats the UTC year and month, zero-padded", () => {
    expect(billingPeriod(new Date("2025-01-05T09:00:00.000Z"))).toBe("2025-01");
    expect(billingPeriod(new Date("2025-12-31T23:59:59.000Z"))).toBe("2025-12");
  });

  it("uses UTC rather than local time at a month boundary", () => {
    expect(billingPeriod(new Date("2025-02-01T00:30:00.000Z"))).toBe("2025-02");
  });
});
