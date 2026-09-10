import { fromHono } from "chanfana";
import { Hono } from "hono";
import { ListPlans } from "./endpoints/plans.js";
import { ProposeRegistration } from "./endpoints/register.js";
import { GetProjectTimeline } from "./endpoints/timeline.js";
import { VerifyFingerprint } from "./endpoints/verify.js";
import type { Env } from "./types.js";

/**
 * ProofStream's OpenAPI Worker.
 *
 * The read path is public by design — anyone must be able to check a claim without an
 * account, or the proof is only as good as our word for it. The write path is gated:
 * see `endpoints/register.ts`.
 */
const app = new Hono<{ Bindings: Env }>();

const openapi = fromHono(app, {
  docs_url: "/",
  schema: {
    info: {
      title: "ProofStream API",
      version: "0.1.0",
      description:
        "Blockchain-anchored proof of creation. Fingerprints are CIDv1/raw/sha2-256 and are " +
        "computed by the client, so verifying a file never requires uploading it.\n\n" +
        "ProofStream produces an attestation, not a notarization: a notarial act requires a " +
        "commissioned notary. Certificates issued from this API say 'attested and anchored'.",
    },
  },
});

openapi.get("/api/plans", ListPlans);
openapi.get("/api/verify/:cid", VerifyFingerprint);
openapi.get("/api/projects/:projectId/timeline", GetProjectTimeline);
openapi.post("/api/registrations", ProposeRegistration);

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
