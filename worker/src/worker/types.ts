import type { Context } from "hono";

export interface Env {
  /** Registry of registrations, their projects, and their proof objects. */
  REGISTRY_KV: KVNamespace;
  /** Which chain anchoring targets. Absent means anchoring is not configured. */
  ANCHOR_CHAIN_ID?: string;
}

export type AppContext = Context<{ Bindings: Env }>;
