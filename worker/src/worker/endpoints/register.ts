import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { validateMilestone, type Milestone } from "../../domain/milestone.js";
import type { AppContext } from "../types.js";

const registrationRequest = z.object({
  projectId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  stage: z.enum(["draft", "revision", "final"]),
  cid: z.string().describe("CIDv1/raw/sha2-256 fingerprint computed by the client"),
  recordedAt: z.string().describe("ISO 8601 instant with a timezone designator"),
  witnesses: z.array(z.string()).default([]),
});

/**
 * Resolve the authenticated principal.
 *
 * Auth0 middleware is not wired into this Worker yet, so there is no principal to
 * resolve and this returns null. That is deliberate: a registration is a claim of
 * authorship, and an unauthenticated endpoint that writes one would let anyone record
 * a claim against anyone's project. Deny by default — the route refuses rather than
 * inventing an owner or trusting one supplied in the body.
 *
 * Wiring this means validating the RS256 JWT (`iss`, `aud`, JWKS), reading the
 * `https://pcg.io/` claims for roles and entity scope, and confirming the `pst.*`
 * prefix is covered. See the governance reference in the create-app skill.
 */
function resolvePrincipal(_c: AppContext): { address: string; plan: string } | null {
  return null;
}

export class ProposeRegistration extends OpenAPIRoute {
  schema = {
    tags: ["Registrations"],
    summary: "Propose a registration (validation only until auth is wired)",
    description:
      "Validates a proposed milestone against the domain rules. Recording it requires an " +
      "authenticated principal, which this Worker cannot yet resolve, so a well-formed " +
      "request is accepted as valid and then refused with 501 rather than written. " +
      "Signing and on-chain anchoring are separate hard-stop steps that this endpoint " +
      "never performs.",
    request: {
      body: {
        content: { "application/json": { schema: registrationRequest } },
      },
    },
    responses: {
      "422": {
        description: "The proposal breaks one or more domain rules; every error is listed",
        content: {
          "application/json": {
            schema: z.object({ errors: z.array(z.string()) }),
          },
        },
      },
      "501": {
        description: "The proposal is valid but cannot be recorded: no authenticated principal",
        content: {
          "application/json": {
            schema: z.object({
              status: z.literal("not-recorded"),
              reason: z.string(),
              validated: z.literal(true),
              blockedBy: z.array(z.string()),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const { body } = await this.getValidatedData<typeof this.schema>();

    // Shape is guaranteed by zod; these are the domain rules on top of it.
    const proposed: Milestone = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      title: body.title,
      description: body.description,
      stage: body.stage,
      cid: body.cid,
      recordedAt: body.recordedAt,
      witnesses: body.witnesses,
    };

    const errors = validateMilestone(proposed);
    if (errors.length > 0) {
      return c.json({ errors }, 422);
    }

    const principal = resolvePrincipal(c);
    if (principal === null) {
      return c.json(
        {
          status: "not-recorded" as const,
          reason:
            "No authenticated principal. A registration is a claim of authorship and is not " +
            "recorded without one.",
          validated: true as const,
          blockedBy: ["auth0-jwt-middleware"],
        },
        501,
      );
    }

    // Unreachable until auth lands. The quota gate, the write, and the hard-stop
    // signing/anchoring handoff belong here, in that order.
    return c.json({ status: "not-recorded" as const }, 501);
  }
}
