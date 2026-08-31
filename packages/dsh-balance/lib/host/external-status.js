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

// 健康状态的中文展示标签（自定义字段 status 转换输出用，与 client 预览一致）
const EXTERNAL_STATUS_LABELS = Object.freeze({ ok: "正常", error: "失败", warn: "警告", unknown: "未知" });

export function normalizeAvailability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const percent = number >= 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, percent));
}

export function normalizeLatency(value, unit = "ms") {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  // 统一换算为 ms 存储，保留 3 位小数（0.001ms 精度），显示层按配置的小数位格式化
  return Math.round((unit === "s" ? number * 1000 : number) * 1000) / 1000;
}

function formatCustomNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const unit = field.unit === "s" ? "s" : "ms";
  const displayUnit = field.displayUnit === "s" || field.displayUnit === "ms" ? field.displayUnit : unit;
  const converted = displayUnit === "s" ? (unit === "s" ? number : number / 1000) : (unit === "s" ? number * 1000 : number);
  const decimals = Math.max(0, Math.min(2, Math.round(Number(field.decimals) || 0)));
  return `${converted.toFixed(decimals)}${displayUnit}`;
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
  // 百分比三种模式：percent=自动（0-1 视为小数 ×100）、percent100=强制 ×100、percentRaw=原值即百分数直接加 %
  percent: normalizeAvailability,
  percent100: value => { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(100, number * 100)) : undefined; },
  percentRaw: value => { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : undefined; },
  status: normalizeExternalHealth
});

export function applyExternalTransform(value, transform) {
  const fn = EXTERNAL_TRANSFORMS[transform];
  return fn ? fn(value) : value;
}

// 状态转换：自定义映射（transforms.status / historyStatus 为 { kind: "map", entries }）时
// 完全以映射为主——命中的用映射值，未命中的归"未知"，不再回退内置词表；
// 未配置映射的源走内置健康词表识别（兼容 ok/fail 等标准值）。
function applyStatusTransform(value, transform) {
  if (transform && typeof transform === "object" && transform.kind === "map") {
    const raw = value === null || value === undefined ? "" : String(value).trim();
    const entry = (transform.entries || []).find(item => item.raw.trim().toLowerCase() === raw.toLowerCase());
    return entry ? entry.status : "unknown";
  }
  return normalizeExternalHealth(value);
}

export function normalizeExternalStatus(source, payload, now = new Date().toISOString()) {
  const list = readMapped(payload, source.modelListPath);
  if (!Array.isArray(list)) throw new Error("external status model list is not an array");
  const models = list.slice(0, 500).map((item) => {
    const rawHistory = source.fields.history ? readMapped(item, source.fields.history) : undefined;
    const transforms = source.transforms || {};
    const history = Array.isArray(rawHistory) ? rawHistory.slice(-EXTERNAL_STATUS_MAX_HISTORY).map(record => ({
      at: source.fields.historyAt ? readMapped(record, source.fields.historyAt) : undefined,
      status: applyStatusTransform(source.fields.historyStatus ? readMapped(record, source.fields.historyStatus) : undefined, transforms.historyStatus),
      error: source.fields.historyError ? normalizeExternalError(readMapped(record, source.fields.historyError)).slice(0, PROVIDER_ERROR_MAX_LENGTH) : undefined
    })) : [];
    const statusValue = source.fields.status ? readMapped(item, source.fields.status) : undefined;
    const status = applyStatusTransform(statusValue ?? (history.length ? history[history.length - 1].status : undefined), transforms.status);
    // 自定义字段：输出与 client 预览一致的显示字符串（百分比带 %、状态为中文），弹窗直接展示
    const custom = Object.fromEntries((source.customFields || []).map(field => {
      const raw = readMapped(item, field.path);
      const transform = field.transform || "identity";
      let value;
      if (transform === "percent" || transform === "percent100" || transform === "percentRaw") {
        const transformed = applyExternalTransform(raw, transform);
        value = transformed === undefined || transformed === null ? "" : `${Number(transformed).toFixed(2)}%`;
      } else if (transform === "status") {
        value = EXTERNAL_STATUS_LABELS[applyExternalTransform(raw, "status")] ?? String(raw ?? "");
      } else {
        value = transform === "number" ? formatCustomNumber(raw, field) : applyExternalTransform(raw, transform);
      }
      return [field.name, value === undefined || value === null ? "" : String(value)];
    }));
    return {
      model: String(applyExternalTransform(readMapped(item, source.fields.model) || "未知模型", transforms.model)).slice(0, 160),
      // 分组名称：可选绑定字段，未绑定为 undefined（卡片不显示分组标签）
      group: source.fields.group ? String(applyExternalTransform(readMapped(item, source.fields.group), transforms.group || "identity") ?? "").trim().slice(0, 80) || undefined : undefined,
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
  const labels = source.labels && Object.keys(source.labels).length ? source.labels : undefined;
  // 指标显示配置透传给弹窗：接口单位（存储换算依据）、显示单位（""=跟随接口单位，此处已解析）、小数位（0-2）
  const units = { ttft: source.ttftUnit === "s" ? "s" : "ms", response: source.responseUnit === "s" ? "s" : "ms" };
  const displayUnits = {
    ttft: source.displayUnit?.ttft === "s" || source.displayUnit?.ttft === "ms" ? source.displayUnit.ttft : units.ttft,
    response: source.displayUnit?.response === "s" || source.displayUnit?.response === "ms" ? source.displayUnit.response : units.response
  };
  const decimals = source.decimals && Object.keys(source.decimals).length ? source.decimals : undefined;
  return { id: source.id, name: source.name, endpoint: source.endpoint, fetchedAt: now, status: errors ? (errors === models.length ? "error" : "warn") : models.length ? "ok" : "unknown", models, ...(labels ? { labels } : {}), units, displayUnits, ...(decimals ? { decimals } : {}) };
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
  // 预览阶段宽容处理：modelListPath 尚未绑定或结构不匹配时仍返回 JSON 预览与
  // 路径目录，供前端点击绑定数组；normalized 为 null 由前端提示用户绑定。
  return { source: { ...source, preview: true }, ...deriveExternalPreview(source, payload, fetchedAt, true) };
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
