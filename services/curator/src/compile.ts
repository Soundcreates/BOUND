/**
 * Loads curation input from a JSON file and compiles it into a canonical, digested
 * snapshot. Separated from `publish.ts` so `bound-curator compile` can be run and
 * inspected (e.g. to hand the digest to someone else for review) without ever touching a
 * private key, an RPC, or Arkiv — compiling is pure, local, and offline by construction.
 */
import { readFile } from "node:fs/promises";
import { compileSnapshot, type CompileInput, type SiteChainInput, type SharedChainInput, type Evidence } from "@bound/snapshot";

/** The on-disk shape `compile` reads: `CompileInput` with dates as ISO strings (JSON has no Date). */
export interface CompileInputFile {
  epoch: number;
  network: string;
  rootName: string;
  generatedAt: string;
  validityDays: number;
  sites: SiteChainInput[];
  shared: SharedChainInput[];
}

export class CompileInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileInputError";
  }
}

function isEvidenceArray(v: unknown): v is Evidence[] {
  return Array.isArray(v);
}

function assertCompileInputFile(v: unknown, path: string): CompileInputFile {
  if (typeof v !== "object" || v === null) throw new CompileInputError(`${path}: expected a JSON object`);
  const obj = v as Record<string, unknown>;
  for (const key of ["epoch", "network", "rootName", "generatedAt", "validityDays", "sites", "shared"]) {
    if (!(key in obj)) throw new CompileInputError(`${path}: missing required field "${key}"`);
  }
  if (typeof obj.epoch !== "number" || !Number.isInteger(obj.epoch) || obj.epoch < 1) {
    throw new CompileInputError(`${path}: "epoch" must be a positive integer`);
  }
  if (typeof obj.generatedAt !== "string" || Number.isNaN(Date.parse(obj.generatedAt))) {
    throw new CompileInputError(`${path}: "generatedAt" must be an ISO-8601 timestamp string`);
  }
  if (!Array.isArray(obj.sites)) throw new CompileInputError(`${path}: "sites" must be an array`);
  if (!Array.isArray(obj.shared)) throw new CompileInputError(`${path}: "shared" must be an array`);
  for (const site of obj.sites as unknown[]) {
    if (typeof site !== "object" || site === null || !isEvidenceArray((site as { evidence?: unknown }).evidence)) {
      throw new CompileInputError(`${path}: every site entry needs an "evidence" array`);
    }
  }
  return obj as unknown as CompileInputFile;
}

export async function loadCompileInput(filePath: string): Promise<CompileInput> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (e) {
    throw new CompileInputError(`could not read ${filePath}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new CompileInputError(`${filePath} is not valid JSON: ${(e as Error).message}`);
  }
  const file = assertCompileInputFile(parsed, filePath);
  return {
    epoch: file.epoch,
    network: file.network,
    rootName: file.rootName,
    generatedAt: new Date(file.generatedAt),
    validityDays: file.validityDays,
    sites: file.sites,
    shared: file.shared,
  };
}

export { compileSnapshot };
