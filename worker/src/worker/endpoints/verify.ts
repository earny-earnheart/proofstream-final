import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { verifyCid } from "../../domain/proof.js";
import { KvRegistryStore, type RegistryStore } from "../registry.js";
import type { AppContext } from "../types.js";

const registrationSchema = z.object({
  cid: z.string(),
  registeredAt: z.string(),
  creator: z.string(),
  projectName: z.string(),
  projectCategory: z.string(),
  milestoneTitle: z.string(),
  milestoneStage: z.enum(["draft", "revision", "final"]),
  anchorTx: z.string().optional(),
  anchored: z
    .boolean()
    .describe(
      "False means the timestamp rests on trusting the pinning service rather than a chain. " +
        "Do not present an unanchored proof as chain-backed.",
    ),
});

const verificationSchema = z.object({
  status: z.enum(["verified", "unregistered", "invalid-input"]),
  registration: registrationSchema.optional(),
  detail: z.string().optional(),
  contested: z
    .boolean()
    .describe(
      "True when more than one registration carries this fingerprint. The earliest is " +
        "returned; the competing claims need a human.",
    ),
});

/**
 * Public verification. No account, no upload — the caller hashes their file locally and
 * asks about the resulting fingerprint, which is what keeps the Verify screen's promise
 * that the file never leaves their machine.
 */
export class VerifyFingerprint extends OpenAPIRoute {
  schema = {
    tags: ["Verify"],
    summary: "Verify a content fingerprint against the registry",
    description:
      "Takes a CIDv1/raw/sha2-256 fingerprint computed by the caller. Returns the earliest " +
      "registration carrying it, if any. `unregistered` is a truthful answer, not an error.",
    request: {
      params: z.object({
        cid: z.string().describe("CIDv1/raw/sha2-256 fingerprint, e.g. bafkrei..."),
      }),
    },
    responses: {
      "200": {
        description: "Verification outcome",
        content: { "application/json": { schema: verificationSchema } },
      },
    },
  };

  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const store: RegistryStore = new KvRegistryStore(c.env.REGISTRY_KV);

    const entries = await store.entriesForCid(params.cid);
    const result = verifyCid(params.cid, entries);

    return c.json({ ...result, contested: entries.length > 1 });
  }
}
