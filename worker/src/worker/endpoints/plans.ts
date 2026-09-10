import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { PLANS, PLAN_ORDER } from "../../domain/plans.js";
import type { AppContext } from "../types.js";

/**
 * Serves the pricing tiers from the same module the quota gate reads, so the published
 * prices and the enforced limits cannot drift apart.
 */
export class ListPlans extends OpenAPIRoute {
  schema = {
    tags: ["Plans"],
    summary: "List subscription tiers",
    responses: {
      "200": {
        description: "Plans, cheapest first",
        content: {
          "application/json": {
            schema: z.object({
              plans: z.array(
                z.object({
                  id: z.enum(["free", "creator", "professional", "studio"]),
                  name: z.string(),
                  priceUsdMonthly: z.number(),
                  monthlyRegistrations: z
                    .number()
                    .nullable()
                    .describe("null means unlimited"),
                  apiAccess: z.boolean(),
                  teamSeats: z.number(),
                }),
              ),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    return c.json({ plans: PLAN_ORDER.map((id) => PLANS[id]) });
  }
}
