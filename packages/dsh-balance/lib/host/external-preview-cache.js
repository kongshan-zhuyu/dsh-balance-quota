import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isId } from "./validate.js";

export const EXTERNAL_PREVIEW_CACHE_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const EXTERNAL_PREVIEW_CACHE_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const EXTERNAL_PREVIEW_CACHE_DIR = join(homedir(), ".dsh", "balance", "cache", "external-status");

function stableHeaders(headers) {
  return Object.entries(headers && typeof headers === "object" ? headers : {})
    .map(([key, value]) => [String(key).toLowerCase(), String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function externalPreviewFingerprint(source) {
  return createHash("sha256").update(JSON.stringify({
    id: source?.id || "",
    endpoint: source?.endpoint || "",
    method: String(source?.method || source?.requestMethod || "GET").toUpperCase(),
    headers: stableHeaders(source?.headers)
  })).digest("hex");
}

function optionsWithDefaults(options = {}) {
  return {
    directory: options.directory || EXTERNAL_PREVIEW_CACHE_DIR,
    maxFileBytes: options.maxFileBytes || EXTERNAL_PREVIEW_CACHE_MAX_FILE_BYTES,
    maxTotalBytes: options.maxTotalBytes || EXTERNAL_PREVIEW_CACHE_MAX_TOTAL_BYTES
  };
}

function cachePath(id, directory) {
  if (!isId(id)) throw new Error("invalid external preview cache id");
  return join(directory, `${id}.json`);
}

async function enforceTotalLimit(directory, maxTotalBytes, keepPath) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(entry.name)) continue;
    const path = join(directory, entry.name);
    try {
      const info = await stat(path);
      files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
    } catch {}
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (total <= maxTotalBytes) break;
    if (file.path === keepPath && files.some(candidate => candidate.path !== keepPath)) continue;
    try {
      await unlink(file.path);
      total -= file.size;
    } catch {}
  }
}

export async function writeExternalPreviewCache(entry, options = {}) {
  const resolved = optionsWithDefaults(options);
  if (!entry || !isId(entry.sourceId) || typeof entry.requestFingerprint !== "string" || !entry.requestFingerprint) {
    throw new Error("invalid external preview cache entry");
  }
  const envelope = {
    version: 1,
    sourceId: entry.sourceId,
    requestFingerprint: entry.requestFingerprint,
    fetchedAt: entry.fetchedAt || new Date().toISOString(),
    payload: entry.payload
  };
  const raw = JSON.stringify(envelope);
  if (Buffer.byteLength(raw, "utf8") > resolved.maxFileBytes) {
    return { written: false, warning: "预览缓存超过单源大小限制，配置已保存但未缓存 JSON" };
  }
  await mkdir(resolved.directory, { recursive: true, mode: 0o700 });
  await chmod(resolved.directory, 0o700);
  const target = cachePath(entry.sourceId, resolved.directory);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, raw, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    await enforceTotalLimit(resolved.directory, resolved.maxTotalBytes, target);
    return { written: true };
  } catch {
    await unlink(temporary).catch(() => {});
    return { written: false, warning: "配置已保存，但预览缓存写入失败" };
  }
}

export async function readExternalPreviewCache(source, options = {}) {
  if (!source || !isId(source.id)) return null;
  const resolved = optionsWithDefaults(options);
  try {
    const raw = await readFile(cachePath(source.id, resolved.directory), "utf8");
    if (Buffer.byteLength(raw, "utf8") > resolved.maxFileBytes) return null;
    const envelope = JSON.parse(raw);
    if (envelope?.version !== 1 || envelope.sourceId !== source.id || envelope.requestFingerprint !== externalPreviewFingerprint(source) || !("payload" in envelope)) return null;
    return envelope;
  } catch {
    return null;
  }
}

export async function deleteExternalPreviewCache(id, options = {}) {
  const resolved = optionsWithDefaults(options);
  try {
    await unlink(cachePath(id, resolved.directory));
    return { deleted: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { deleted: false };
    return { deleted: false, warning: "预览缓存删除失败" };
  }
}
