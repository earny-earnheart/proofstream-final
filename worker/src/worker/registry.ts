import type { Milestone, Project } from "../domain/milestone.js";
import type { ProofObject, RegistryEntry } from "../domain/proof.js";

/**
 * Storage seam for the registry.
 *
 * The domain layer stays pure by taking a plain array of entries; this interface is
 * what fetches those arrays. Two implementations exist on purpose — KV in the Worker,
 * in-memory in the tests — so the endpoint logic is exercised without workerd, and the
 * rules that decide authorship never depend on a storage engine.
 */
export interface RegistryStore {
  /** Every registration carrying this fingerprint. More than one means a dispute. */
  entriesForCid(cid: string): Promise<RegistryEntry[]>;
  entriesForProject(projectId: string): Promise<RegistryEntry[]>;
  /** Registrations recorded by an owner in a billing period, for the quota gate. */
  monthlyCount(owner: string, yearMonth: string): Promise<number>;
  append(entry: RegistryEntry): Promise<void>;
}

/** `YYYY-MM` in UTC — the billing period a quota is counted against. */
export function billingPeriod(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface StoredEntry {
  milestone: Milestone;
  project: Project;
  proof: ProofObject;
}

export class MemoryRegistryStore implements RegistryStore {
  private readonly entries: StoredEntry[] = [];

  constructor(seed: readonly RegistryEntry[] = []) {
    this.entries.push(...seed);
  }

  async entriesForCid(cid: string): Promise<RegistryEntry[]> {
    return this.entries.filter((entry) => entry.milestone.cid === cid);
  }

  async entriesForProject(projectId: string): Promise<RegistryEntry[]> {
    return this.entries.filter((entry) => entry.milestone.projectId === projectId);
  }

  async monthlyCount(owner: string, yearMonth: string): Promise<number> {
    return this.entries.filter(
      (entry) =>
        entry.project.owner.toLowerCase() === owner.toLowerCase() &&
        entry.milestone.recordedAt.startsWith(yearMonth),
    ).length;
  }

  async append(entry: RegistryEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/**
 * KV-backed registry.
 *
 * Entries are stored once and indexed twice — by fingerprint and by project — because
 * both lookups are on the read path and KV has no secondary indexes. The usage counter
 * is kept separately so the quota gate does not have to page through registrations.
 *
 * KV is eventually consistent. That is acceptable for reads, but it means this store
 * cannot by itself guarantee that two simultaneous registrations of the same content
 * are ordered correctly. `firstInTime` surfaces exact ties as contested rather than
 * picking one, which is the honest behaviour here; a strict ordering guarantee needs
 * a Durable Object or D1, and that is a deliberate choice to make before launch.
 */
export class KvRegistryStore implements RegistryStore {
  constructor(private readonly kv: KVNamespace) {}

  private async readIndex(key: string): Promise<string[]> {
    return (await this.kv.get<string[]>(key, "json")) ?? [];
  }

  private async readEntries(ids: readonly string[]): Promise<RegistryEntry[]> {
    const entries = await Promise.all(
      ids.map((id) => this.kv.get<StoredEntry>(`entry:${id}`, "json")),
    );
    return entries.filter((entry): entry is StoredEntry => entry !== null);
  }

  async entriesForCid(cid: string): Promise<RegistryEntry[]> {
    return this.readEntries(await this.readIndex(`cid:${cid}`));
  }

  async entriesForProject(projectId: string): Promise<RegistryEntry[]> {
    return this.readEntries(await this.readIndex(`project:${projectId}`));
  }

  async monthlyCount(owner: string, yearMonth: string): Promise<number> {
    const raw = await this.kv.get(`usage:${owner.toLowerCase()}:${yearMonth}`);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async append(entry: RegistryEntry): Promise<void> {
    const id = entry.milestone.id;
    const cidKey = `cid:${entry.milestone.cid}`;
    const projectKey = `project:${entry.milestone.projectId}`;
    const usageKey = `usage:${entry.project.owner.toLowerCase()}:${billingPeriod(
      new Date(entry.milestone.recordedAt),
    )}`;

    const [cidIndex, projectIndex, used] = await Promise.all([
      this.readIndex(cidKey),
      this.readIndex(projectKey),
      this.monthlyCount(entry.project.owner, billingPeriod(new Date(entry.milestone.recordedAt))),
    ]);

    await Promise.all([
      this.kv.put(`entry:${id}`, JSON.stringify(entry)),
      this.kv.put(cidKey, JSON.stringify([...new Set([...cidIndex, id])])),
      this.kv.put(projectKey, JSON.stringify([...new Set([...projectIndex, id])])),
      this.kv.put(usageKey, String(used + 1)),
    ]);
  }
}
