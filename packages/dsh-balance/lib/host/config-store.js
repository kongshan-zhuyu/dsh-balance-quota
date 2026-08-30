import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const CONFIG_FILE = join(homedir(), ".dsh", "balance", "config.json");
export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  statusBar: true,
  defaultProviderId: null,
  bindings: {},
  providers: [],
  externalStatusSources: []
});

let configMutation = Promise.resolve();

function externalSourceScore(source) {
  return Number(Boolean(source?.providerId)) * 1000 +
    Number(Boolean(source?.modelListPath)) * 100 +
    Object.values(source?.fields || {}).filter(Boolean).length +
    (Array.isArray(source?.customFields) ? source.customFields.length : 0) +
    Number(Boolean(source?.preview)) * 10;
}

export function normalizeExternalSources(sources) {
  const result = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source !== "object") continue;
    const duplicateIndex = result.findIndex(item => item.id === source.id || (source.providerId && item.providerId === source.providerId));
    if (duplicateIndex < 0) result.push(source);
    else if (externalSourceScore(source) >= externalSourceScore(result[duplicateIndex])) result[duplicateIndex] = source;
  }
  return result;
}

export async function loadConfig() {
  try {
    const parsed = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    return { ...DEFAULT_CONFIG, ...parsed, externalStatusSources: normalizeExternalSources(parsed.externalStatusSources) };
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(DEFAULT_CONFIG);
    throw new Error(`failed to load balance config: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export async function saveConfig(config) {
  await mkdir(dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, CONFIG_FILE);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function mutateConfig(mutator) {
  const operation = configMutation.then(async () => {
    const config = await loadConfig();
    return mutator(config);
  });
  configMutation = operation.catch(() => {});
  return operation;
}
