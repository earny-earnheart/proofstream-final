import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { buildTimeline, summariseTimeline } from "../../domain/milestone.js";
import { KvRegistryStore } from "../registry.js";
import type { AppContext } from "../types.js";

const milestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  stage: z.enum(["draft", "revision", "final"]),
  cid: z.string(),
  recordedAt: z.string(),
  witnesses: z.array(z.string()),
});

export class GetProjectTimeline extends OpenAPIRoute {
  schema = {
    tags: ["Projects"],
    summary: "Read a project's creative timeline",
    description:
      "Milestones newest first, matching the timeline screen, with a summary of the span " +
      "and the stages recorded.",
    request: {
      params: z.object({ projectId: z.string() }),
    },
    responses: {
      "200": {
        description: "The project's milestones and a summary",
        content: {
          "application/json": {
            schema: z.object({
              projectId: z.string(),
              milestones: z.array(milestoneSchema),
              summary: z.object({
                milestoneCount: z.number(),
                firstRecordedAt: z.string().nullable(),
                lastRecordedAt: z.string().nullable(),
                spanDays: z.number(),
                witnessCount: z.number(),
                stageCounts: z.object({
                  draft: z.number(),
                  revision: z.number(),
                  final: z.number(),
                }),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const store = new KvRegistryStore(c.env.REGISTRY_KV);

    const milestones = (await store.entriesForProject(params.projectId)).map(
      (entry) => entry.milestone,
    );

    return c.json({
      projectId: params.projectId,
      milestones: buildTimeline(milestones),
      summary: summariseTimeline(milestones),
    });
  }
}
