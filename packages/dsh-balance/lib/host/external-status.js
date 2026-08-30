import { requestPinnedJson } from "./net.js";
import { readJsonPath } from "./json-path.js";
import { HttpError, formatProviderError, PROVIDER_ERROR_MAX_LENGTH } from "./http-utils.js";
import { isId, validateExternalStatusSource } from "./validate.js";
import { externalPreviewFingerprint } from "./external-preview-cache.js";

const EXTERNAL_STATUS_DEFAULT_INTERVAL_SECONDS = 60;
const EXTERNAL_STATUS_MAX_HISTORY = 60;
const EXTERNAL_PREVIEW_STAGE_MAX_ENTRIES = 32;

export const externalStatusCache = new Map();
export const externalPreviewStage = new Map();

export function normalizeExternalHealth(value) {
  if (value === true || value === 1 || String(value).toLowerCase() === "ok" || String(value).toLowerCase() === "online" || String(value).toLowerCase() === "operational" || String(value).toLowerCase() === "healthy" || String(value).toLowerCase() === "normal" || String(value).toLowerCase() === "good" || String(value).toLowerCase() === "available") return "ok";
  if (value === false || value === 0 || ["fail", "failed", "failing", "error", "down", "offline", "degraded", "bad"].includes(String(value).toLowerCase())) return "error";
  if (["warn", "warning", "partial", "idle", "pending"].includes(String(value).toLowerCase())) return "warn";
  return "unknown";
}

export function normalizeAvailability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const percent = number >= 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, percent));
}

export function normalizeLatency(value, unit = "ms") {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.round(unit === "s" ? number * 1000 : number);
}

function readMapped(data, path) {
  return path ? readJsonPath(data, path) : undefined;
}

export function normalizeExternalError(value) {
  return Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean).join(" / ") : String(value || "").trim();
}

export const EXTERNAL_TRANSFORMS = Object.freeze({
  identity: value => value,
  number: value => { const number = Number(value); return Number.isFinite(number) ? number : value; },
  percent: normalizeAvailability,
  status: normalizeExternalHealth
});

export function applyExternalTransform(value, transform) {
  const fn = EXTERNAL_TRANSFORMS[transform];
  return fn ? fn(value) : value;
}

export function normalizeExternalStatus(source, payload, now = new Date().toISOString()) {
  const list = readMapped(payload, source.modelListPath);
  if (!Array.isArray(list)) throw new Error("external status model list is not an array");
  const models = list.slice(0, 500).map((item) => {
    const rawHistory = source.fields.history ? readMapped(item, source.fields.history) : undefined;
    const history = Array.isArray(rawHistory) ? rawHistory.slice(-EXTERNAL_STATUS_MAX_HISTORY).map(record => ({
      at: source.fields.historyAt ? readMapped(record, source.fields.historyAt) : undefined,
      status: normalizeExternalHealth(source.fields.historyStatus ? readMapped(record, source.fields.historyStatus) : undefined),
      error: source.fields.historyError ? normalizeExternalError(readMapped(record, source.fields.historyError)).slice(0, PROVIDER_ERROR_MAX_LENGTH) : undefined
    })) : [];
    const statusValue = source.fields.status ? readMapped(item, source.fields.status) : undefined;
    const status = normalizeExternalHealth(statusValue ?? (history.length ? history[history.length - 1].status : undefined));
    const transforms = source.transforms || {};
    const custom = Object.fromEntries((source.customFields || []).map(field => [field.name, applyExternalTransform(readMapped(item, field.path), field.transform)]));
    return {
      model: String(applyExternalTransform(readMapped(item, source.fields.model) || "未知模型", transforms.model)).slice(0, 160),
      status,
      custom,
      availability: source.fields.availability ? applyExternalTransform(readMapped(item, source.fields.availability), transforms.availability || "percent") : undefined,
      ttftMs: source.fields.ttft ? normalizeLatency(applyExternalTransform(readMapped(item, source.fields.ttft), transforms.ttft), source.ttftUnit) : undefined,
      responseMs: source.fields.response ? normalizeLatency(applyExternalTransform(readMapped(item, source.fields.response), transforms.response), source.responseUnit) : undefined,
      samples: history.length,
      history,
      errors: source.fields.error ? [normalizeExternalError(readMapped(item, source.fields.error)).slice(0, PROVIDER_ERROR_MAX_LENGTH)].filter(Boolean) : []
    };
  });
  const errors = models.filter(item => item.status === "error").length;
  return { id: source.id, name: source.name, endpoint: source.endpoint, fetchedAt: now, status: errors ? (errors === models.length ? "error" : "warn") : models.length ? "ok" : "unknown", models };
}

export function previewExternalJson(value) {
  if (Array.isArray(value)) return value.map(item => previewExternalJson(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, previewExternalJson(item)]));
  return value;
}

export function collectExternalPaths(value, prefix = "$", output = [], seen = new Set(output.map(item => item.path))) {
  if (Array.isArray(value)) {
    for (const item of value) collectExternalPaths(item, `${prefix}[]`, output, seen);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (!seen.has(path)) {
      output.push({ path, type: Array.isArray(item) ? "array" : item === null ? "null" : typeof item });
      seen.add(path);
    }
    collectExternalPaths(item, path, output, seen);
  }
  return output;
}

export function deriveExternalPreview(source, payload, fetchedAt = new Date().toISOString(), allowInvalidMapping = false) {
  let normalized = null;
  try {
    normalized = normalizeExternalStatus(source, payload, fetchedAt);
  } catch (error) {
    if (!allowInvalidMapping) throw error;
  }
  return {
    preview: previewExternalJson(payload),
    keys: collectExternalPaths(payload),
    normalized
  };
}

function stageExternalPreview(source, payload, fetchedAt) {
  externalPreviewStage.delete(source.id);
  externalPreviewStage.set(source.id, {
    requestFingerprint: externalPreviewFingerprint(source),
    fetchedAt,
    payload
  });
  while (externalPreviewStage.size > EXTERNAL_PREVIEW_STAGE_MAX_ENTRIES) {
    externalPreviewStage.delete(externalPreviewStage.keys().next().value);
  }
}

export async function previewExternalStatusSource(input) {
  const source = await validateExternalStatusSource({ ...input, id: isId(input?.id) ? input.id : "preview-source", name: typeof input?.name === "string" && input.name ? input.name : "Preview" });
  const response = await requestPinnedJson({ ...source, method: "GET", timeoutSeconds: source.timeoutSeconds }, { accept: "application/json", ...source.headers });
  if (response.status < 200 || response.status >= 300) throw new HttpError(502, formatProviderError(response.status, response.text));
  let payload;
  try { payload = JSON.parse(response.text); } catch { throw new HttpError(502, "external status source returned invalid JSON"); }
  const fetchedAt = new Date().toISOString();
  stageExternalPreview(source, payload, fetchedAt);
  return { source: { ...source, preview: true }, ...deriveExternalPreview(source, payload, fetchedAt) };
}

export async function queryExternalStatus(source, force = false) {
  const cacheMs = Math.max(5, Number(source.intervalSeconds || EXTERNAL_STATUS_DEFAULT_INTERVAL_SECONDS)) * 1000;
  const existing = externalStatusCache.get(source.id);
  if (!force && existing && Date.now() - existing.at < cacheMs) return existing.value;
  const response = await requestPinnedJson({ ...source, method: "GET" }, { accept: "application/json", ...source.headers });
  if (response.status < 200 || response.status >= 300) throw new HttpError(502, formatProviderError(response.status, response.text));
  let payload;
  try { payload = JSON.parse(response.text); } catch { throw new HttpError(502, "external status source returned invalid JSON"); }
  const value = normalizeExternalStatus(source, payload);
  externalStatusCache.set(source.id, { at: Date.now(), value });
  return value;
}

export async function externalSummary(config, force = false, requestedId = null) {
  const sources = requestedId ? config.externalStatusSources.filter(source => source.id === requestedId) : config.externalStatusSources;
  return Promise.all(sources.map(async source => {
    try {
      return await queryExternalStatus(source, force);
    } catch (error) {
      return { id: source.id, name: source.name, endpoint: source.endpoint, fetchedAt: new Date().toISOString(), status: "error", models: [], error: error instanceof Error ? error.message : "external status request failed" };
    }
  }));
}
