import { publicEndpoint } from "./net.js";
import { safePath, safePathExpr } from "./json-path.js";
import { OFFICIAL_PROVIDERS } from "./presets.js";
import { balanceCredentialRef } from "./security.js";

const DEFAULT_REQUEST_TIMEOUT_SECONDS = 10;
const DEFAULT_QUERY_INTERVAL_MINUTES = 30;
const EXTERNAL_STATUS_DEFAULT_INTERVAL_SECONDS = 60;
const EXTERNAL_STATUS_PREVIEW_MAX_BYTES = 100_000;

export const EXTERNAL_STATUS_FIELDS = Object.freeze({
  model: "$.model",
  status: "$.status",
  availability: "$.availability",
  ttft: "$.ttftMs",
  response: "$.responseMs",
  history: "$.history",
  historyAt: "$.ts",
  historyStatus: "$.ok",
  historyError: "$.error",
  error: "$.error",
});

export function isId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}

export function isCredentialRef(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function safeHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key) || /^(host|content-length|connection|proxy-)/i.test(key)) throw new Error("unsafe header");
    if (typeof val !== "string" || val.length > 512 || /[\r\n]/.test(val)) throw new Error("unsafe header value");
    out[key] = val;
  }
  return out;
}

export function safeExternalPath(value, optional = true) {
  return optional && (value === "" || value === null || value === undefined) ? true : safePath(value);
}

export async function validateProvider(input) {
  if (!input || !isId(input.id) || typeof input.name !== "string" || input.name.length < 1 || input.name.length > 80) {
    throw new Error("invalid provider identity");
  }
  const timeoutSeconds = Number.isFinite(Number(input.timeoutSeconds)) ? Math.max(1, Math.min(300, Math.trunc(Number(input.timeoutSeconds)))) : DEFAULT_REQUEST_TIMEOUT_SECONDS;
  const queryIntervalMinutes = Number.isFinite(Number(input.queryIntervalMinutes)) ? Math.max(0, Math.min(1440, Math.trunc(Number(input.queryIntervalMinutes)))) : DEFAULT_QUERY_INTERVAL_MINUTES;
  const credential = isCredentialRef(input.credentialRef) ? { credentialRef: input.credentialRef } : { credentialRef: balanceCredentialRef(input.id), credentialOwner: "balance" };
  const preset = typeof input.preset === "string" ? OFFICIAL_PROVIDERS[input.preset] : undefined;
  if (preset) return { id: input.id, name: input.name.trim(), ...preset, balanceEnabled: input.balanceEnabled !== false, timeoutSeconds, queryIntervalMinutes, preset: input.preset, ...credential };
  if (!safePathExpr(input.responsePath)) throw new Error("responsePath must be a simple JSON path or ?? fallback chain such as $.remaining ?? $.balance");
  const endpoint = await publicEndpoint(input.endpoint);
  const usageWindows = Array.isArray(input.usageWindows) ? input.usageWindows.slice(0, 3).map((item) => {
    if (!item || !["rolling", "weekly", "monthly"].includes(item.type) || !safePath(item.percentPath) || !safePath(item.resetAtPath)) throw new Error("invalid usage window");
    return { type: item.type, percentPath: item.percentPath, resetAtPath: item.resetAtPath };
  }) : [];
  const valueDivisor = Number.isFinite(Number(input.valueDivisor)) ? Math.max(1, Number(input.valueDivisor)) : 1;
  return { id: input.id, name: input.name.trim(), balanceEnabled: input.balanceEnabled !== false, endpoint, method: input.method === "POST" ? "POST" : "GET", responsePath: input.responsePath, currency: typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : safePathExpr(input.currency) ? input.currency : "CNY", auth: input.auth === "header" ? "header" : "bearer", authHeader: input.auth === "header" && /^[A-Za-z0-9-]{1,64}$/.test(input.authHeader) ? input.authHeader : "Authorization", headers: safeHeaders(input.headers), usageWindows, timeoutSeconds, queryIntervalMinutes, valueDivisor, ...credential };
}

export async function validateExternalStatusSource(input) {
  if (!input || !isId(input.id) || typeof input.name !== "string" || input.name.trim().length < 1 || input.name.length > 80) throw new Error("invalid external status source identity");
  const endpoint = await publicEndpoint(input.endpoint);
  const modelListPath = typeof input.modelListPath === "string" ? input.modelListPath : "$.models";
  if (!safePath(modelListPath)) throw new Error("modelListPath must be a safe JSON path");
  const fields = { ...EXTERNAL_STATUS_FIELDS, ...(input.fields && typeof input.fields === "object" ? input.fields : {}) };
  const customFields = Array.isArray(input.customFields) ? input.customFields.slice(0, 50).map(field => {
    if (!field || typeof field.name !== "string" || !field.name.trim() || field.name.length > 80 || !safeExternalPath(field.path)) throw new Error("invalid external custom field");
    return { name: field.name.trim(), path: field.path, transform: ["identity", "number", "percent", "status"].includes(field.transform) ? field.transform : "identity" };
  }) : [];
  for (const key of Object.keys(EXTERNAL_STATUS_FIELDS)) if (!safeExternalPath(fields[key])) throw new Error(`invalid external status field: ${key}`);
  const intervalSeconds = Number.isFinite(Number(input.intervalSeconds)) ? Math.max(5, Math.min(86400, Math.trunc(Number(input.intervalSeconds)))) : EXTERNAL_STATUS_DEFAULT_INTERVAL_SECONDS;
  if (input.headers !== undefined) safeHeaders(input.headers);
  const preview = input.preview && typeof input.preview === "object" ? input.preview : undefined;
  const previewKeys = Array.isArray(input.previewKeys) ? input.previewKeys.slice(0, 200) : undefined;
  if (preview !== undefined && Buffer.byteLength(JSON.stringify(preview), "utf8") > EXTERNAL_STATUS_PREVIEW_MAX_BYTES) throw new Error("external preview is too large");
  return { id: input.id, name: input.name.trim(), providerId: typeof input.providerId === "string" && isId(input.providerId) ? input.providerId : "", enabled: input.enabled === true, endpoint, requestType: input.requestType === "custom" ? "custom" : "custom", method: "GET", headers: safeHeaders(input.headers), intervalSeconds, timeoutSeconds: Number.isFinite(Number(input.timeoutSeconds)) ? Math.max(1, Math.min(300, Number(input.timeoutSeconds))) : DEFAULT_REQUEST_TIMEOUT_SECONDS, modelListPath, fields, customFields, transforms: input.transforms && typeof input.transforms === "object" ? Object.fromEntries(Object.entries(input.transforms).filter(([key, value]) => Object.keys(EXTERNAL_STATUS_FIELDS).includes(key) && ["identity", "number", "percent", "status"].includes(value))) : {}, ttftUnit: input.ttftUnit === "s" ? "s" : "ms", responseUnit: input.responseUnit === "s" ? "s" : "ms", ...(preview === undefined ? {} : { preview }), ...(previewKeys === undefined ? {} : { previewKeys }) };
}
