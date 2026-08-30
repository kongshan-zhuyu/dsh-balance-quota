# Implementation Plan: Balance Quota Plugin Modular Refactor

Date: `2026-08-30`
Spec Ref: `docs/aegis/specs/2026-08-30-refactor-design.md`
Baseline Ref: `docs/aegis/baseline/2026-08-23-initial-baseline.md`
ADR Ref: `docs/aegis/adr/2026-08-23-balance-status-release-owners.md`

## Overview

Refactor `packages/dsh-balance` by modularizing `lib/host/` into 8 single-responsibility units using Strategy, Command, and Facade patterns, while restructuring `lib/client/client.js` internally with Custom Hooks and decomposed renderers. Preserves 100% export compatibility, zero-build simplicity, and passes all 15 tests unchanged.

```text
TDD Route:
- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression
- Reason: Pure structural refactoring with 100% behavior preservation; existing 15 regression test cases are authoritative.
- Verification: node --test across all test suites + pnpm verify
```

```text
Execution Readiness View:
- Intent Lock: Decompose monolith files without changing observable behavior, runtime dependencies, or published exports.
- Scope Fence: packages/dsh-balance/lib/host/* and lib/client/client.js. Legacy packages untouched.
- Baseline Lock: Preserve config schema, credentials isolation, DNS pinning, error sanitization, and session-local selection.
- Approved Behavior: Exactly matches 0.3.2 behavior.
- Owner / Contract Constraints: lib/host/index.js exports 11 required symbols; lib/client/client.js remains the module bundle.
- Compatibility Boundary: All 15 existing test cases in test/ must pass without modifying test files.
- Retirement Boundary: None. Old single-file monoliths replaced in-place.
- Task Batches:
  * Batch 1: Host Infrastructure & Core (net, http-utils, json-path, presets)
  * Batch 2: Host Domain & Services (validate, config-store, external-status, query, routes)
  * Batch 3: Host Composition Root & Test Verification
  * Batch 4: Client Internal Restructuring
  * Batch 5: Repo Scripts & Final pnpm verify
- Test Obligations: pnpm test and pnpm verify after each batch.
- Review Gates: Verify all 15 unit tests pass after Host composition root (Batch 3).
- Drift / Rewind Rules: If any test fails, revert to previous passing commit before continuing.
- Evidence Required Before Completion: pnpm verify output (check + test + pack:check) fully passing.
```

---

## Tasks

### Task 1: Create Host Infrastructure Modules (`net.js`, `http-utils.js`)

**Files**:
- Create `packages/dsh-balance/lib/host/net.js`
- Create `packages/dsh-balance/lib/host/http-utils.js`

**Why**: Extract DNS resolution, IP pinning, HTTPS request handling, and HTTP error sanitization into dedicated security/network boundary modules.

**Code**:

`packages/dsh-balance/lib/host/net.js`:
```javascript
import dns from "node:dns/promises";
import https from "node:https";
import { HttpError } from "./http-utils.js";

export const MAX_BODY = 512 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 10;

const badHost = /(^localhost$|\.local$|\.internal$)/i;

export function privateIp(ip) {
  return ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd") || /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
}

export async function resolvePublicEndpoint(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || badHost.test(url.hostname)) {
    throw new Error("endpoint must be public HTTPS");
  }
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => privateIp(record.address))) {
    throw new Error("endpoint resolves to a private address");
  }
  return { url, records };
}

export async function publicEndpoint(raw) {
  const { url } = await resolvePublicEndpoint(raw);
  return url.toString();
}

export function requestPinnedJson(provider, headers) {
  return new Promise(async (resolve, reject) => {
    let target;
    try {
      target = await resolvePublicEndpoint(provider.endpoint);
    } catch (error) {
      reject(error);
      return;
    }
    const address = target.records[0];
    const timeoutMs = Math.max(1, Number(provider.timeoutSeconds ?? DEFAULT_REQUEST_TIMEOUT_SECONDS)) * 1000;
    const request = https.request({
      protocol: "https:",
      hostname: address.address,
      family: address.family,
      port: 443,
      method: provider.method,
      path: `${target.url.pathname}${target.url.search}`,
      headers: { ...headers, host: target.url.host },
      servername: target.url.hostname,
      rejectUnauthorized: true,
      timeout: timeoutMs,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new HttpError(502, "provider redirect is not allowed"));
        return;
      }
      const contentLength = Number(response.headers["content-length"] || 0);
      if (contentLength > MAX_BODY) {
        response.resume();
        reject(new HttpError(502, "provider response too large"));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          response.destroy(new HttpError(502, "provider response too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new HttpError(502, "provider request timed out")));
    request.on("error", reject);
    request.end();
  });
}
```

`packages/dsh-balance/lib/host/http-utils.js`:
```javascript
export const PROVIDER_ERROR_MAX_LENGTH = 240;
const MAX_BODY = 512 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sanitizeProviderError(value) {
  return String(value || "")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, PROVIDER_ERROR_MAX_LENGTH);
}

export function formatProviderError(status, text) {
  let detail = "";
  try {
    const data = JSON.parse(text);
    const candidate = data?.error?.message || data?.error?.detail || data?.error || data?.message || data?.detail || data?.msg || data?.code;
    detail = typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : "";
  } catch {
    detail = String(text || "");
  }
  detail = sanitizeProviderError(detail);
  return `供应商返回 HTTP ${status}${detail ? `：${detail}` : ""}`;
}

export function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  const message = error instanceof Error ? error.message : "";
  if (/^provider (?:returned|redirect|request)/.test(message) || /credential is missing/.test(message)) return 502;
  if (/^failed to load balance config/.test(message)) return 500;
  return 400;
}

export function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(raw);
}

export function body(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", part => {
      size += part.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
      } else {
        parts.push(part);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
```

**Verification**:
```bash
node --check packages/dsh-balance/lib/host/net.js
node --check packages/dsh-balance/lib/host/http-utils.js
```

---

### Task 2: Create JSON Path Engine & Preset Strategy Registry (`json-path.js`, `presets.js`)

**Files**:
- Create `packages/dsh-balance/lib/host/json-path.js`
- Create `packages/dsh-balance/lib/host/presets.js`

**Why**: Pure JSON path evaluation without eval, and Strategy-pattern based provider preset registry.

**Code**:

`packages/dsh-balance/lib/host/json-path.js`:
```javascript
const PATH_EXPR_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PATH_EXPR_RE = /^(?:\$|response)(?:(?:\.|\?\.)[A-Za-z_$][A-Za-z0-9_$]*){1,8}$/;
const PATH_EXPR_LITERAL = /^"[A-Za-z0-9 _./:-]{1,32}"$/;

export function safePath(value) {
  return typeof value === "string" && /^\$(?:\.[A-Za-z_$][A-Za-z0-9_$]*){1,8}$/.test(value) && !/(?:__proto__|constructor|prototype)/.test(value);
}

export function parsePathExpr(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  const parts = value.split("??");
  if (parts.length < 1 || parts.length > 5) return null;
  const alternatives = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) return null;
    if (part.startsWith('"')) {
      if (!PATH_EXPR_LITERAL.test(part)) return null;
      alternatives.push({ kind: "literal", value: part.slice(1, -1) });
      continue;
    }
    if (!PATH_EXPR_RE.test(part)) return null;
    const rest = part.startsWith("response") ? part.slice("response".length) : part.slice(1);
    const segments = rest.split(/(?:\?\.|\.)/).filter(Boolean);
    for (const segment of segments) {
      if (!PATH_EXPR_SEGMENT.test(segment) || /^(?:__proto__|constructor|prototype)$/.test(segment)) return null;
    }
    alternatives.push({ kind: "path", segments });
  }
  return alternatives;
}

export function safePathExpr(value) {
  return parsePathExpr(value) !== null;
}

export function readJsonPath(data, path) {
  if (!safePath(path)) throw new Error("unsafe JSON path");
  return path.slice(2).split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), data);
}

export function readJsonPathExpr(data, expr) {
  const parsed = parsePathExpr(expr);
  if (!parsed) throw new Error("unsafe JSON path expression");
  for (const alternative of parsed) {
    const value = alternative.kind === "literal"
      ? alternative.value
      : alternative.segments.reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), data);
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

export function resolveCurrency(data, currency) {
  if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency)) return currency;
  try {
    const resolved = readJsonPathExpr(data, currency);
    if (typeof resolved === "string" && /^[A-Z]{3}$/.test(resolved)) return resolved;
  } catch {}
  return "CNY";
}
```

`packages/dsh-balance/lib/host/presets.js`:
```javascript
export const OFFICIAL_PROVIDERS = Object.freeze({
  deepseek: Object.freeze({
    id: "deepseek",
    label: "DeepSeek 官方余额",
    endpoint: "https://api.deepseek.com/user/balance",
    method: "GET",
    responsePath: "$.balance_infos",
    currency: "CNY",
    auth: "bearer",
    authHeader: "Authorization",
    headers: {},
    usageWindows: [],
  }),
  "opencode-go": Object.freeze({
    id: "opencode-go",
    label: "OpenCode Go 官方额度",
    endpoint: "https://opencode.ai/zen/go/v1/usage",
    method: "GET",
    responsePath: "$.usage.rolling.percent",
    currency: "USD",
    auth: "bearer",
    authHeader: "Authorization",
    headers: {},
    usageWindows: [
      { type: "rolling", percentPath: "$.usage.rolling.percent", resetAtPath: "$.usage.rolling.resetsAt" },
      { type: "weekly", percentPath: "$.usage.weekly.percent", resetAtPath: "$.usage.weekly.resetsAt" },
      { type: "monthly", percentPath: "$.usage.monthly.percent", resetAtPath: "$.usage.monthly.resetsAt" },
    ],
  }),
});

export const OFFICIAL_PROVIDER_IDS = Object.freeze(Object.keys(OFFICIAL_PROVIDERS));

export function isOfficialProvider(provider) {
  return Boolean(provider && OFFICIAL_PROVIDERS[provider.preset]);
}
```

**Verification**:
```bash
node --check packages/dsh-balance/lib/host/json-path.js
node --check packages/dsh-balance/lib/host/presets.js
```

---

### Task 3: Create Validation & Config Persistence Modules (`validate.js`, `config-store.js`)

**Files**:
- Create `packages/dsh-balance/lib/host/validate.js`
- Create `packages/dsh-balance/lib/host/config-store.js`

**Why**: Specification-based input validation and serialized atomic file persistence.

**Code**:

`packages/dsh-balance/lib/host/validate.js`:
```javascript
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
  if (preset) return { id: input.id, name: input.name.trim(), ...preset, timeoutSeconds, queryIntervalMinutes, preset: input.preset, ...credential };
  if (!safePathExpr(input.responsePath)) throw new Error("responsePath must be a simple JSON path or ?? fallback chain such as $.remaining ?? $.balance");
  const endpoint = await publicEndpoint(input.endpoint);
  const usageWindows = Array.isArray(input.usageWindows) ? input.usageWindows.slice(0, 3).map((item) => {
    if (!item || !["rolling", "weekly", "monthly"].includes(item.type) || !safePath(item.percentPath) || !safePath(item.resetAtPath)) throw new Error("invalid usage window");
    return { type: item.type, percentPath: item.percentPath, resetAtPath: item.resetAtPath };
  }) : [];
  const valueDivisor = Number.isFinite(Number(input.valueDivisor)) ? Math.max(1, Number(input.valueDivisor)) : 1;
  return { id: input.id, name: input.name.trim(), endpoint, method: input.method === "POST" ? "POST" : "GET", responsePath: input.responsePath, currency: typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : safePathExpr(input.currency) ? input.currency : "CNY", auth: input.auth === "header" ? "header" : "bearer", authHeader: input.auth === "header" && /^[A-Za-z0-9-]{1,64}$/.test(input.authHeader) ? input.authHeader : "Authorization", headers: safeHeaders(input.headers), usageWindows, timeoutSeconds, queryIntervalMinutes, valueDivisor, ...credential };
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
  return { id: input.id, name: input.name.trim(), providerId: typeof input.providerId === "string" && isId(input.providerId) ? input.providerId : "", endpoint, requestType: input.requestType === "custom" ? "custom" : "custom", method: "GET", headers: safeHeaders(input.headers), intervalSeconds, timeoutSeconds: Number.isFinite(Number(input.timeoutSeconds)) ? Math.max(1, Math.min(300, Number(input.timeoutSeconds))) : DEFAULT_REQUEST_TIMEOUT_SECONDS, modelListPath, fields, customFields, transforms: input.transforms && typeof input.transforms === "object" ? Object.fromEntries(Object.entries(input.transforms).filter(([key, value]) => Object.keys(EXTERNAL_STATUS_FIELDS).includes(key) && ["identity", "number", "percent", "status"].includes(value))) : {}, ttftUnit: input.ttftUnit === "s" ? "s" : "ms", responseUnit: input.responseUnit === "s" ? "s" : "ms", ...(preview === undefined ? {} : { preview }), ...(previewKeys === undefined ? {} : { previewKeys }) };
}
```

`packages/dsh-balance/lib/host/config-store.js`:
```javascript
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
```

**Verification**:
```bash
node --check packages/dsh-balance/lib/host/validate.js
node --check packages/dsh-balance/lib/host/config-store.js
```

---

### Task 4: Create External Status Pipeline (`external-status.js`)

**Files**:
- Create `packages/dsh-balance/lib/host/external-status.js`

**Why**: Encapsulate third-party monitoring data normalization, transform table, bounded JSON preview, and cached querying.

**Code**:

`packages/dsh-balance/lib/host/external-status.js`:
```javascript
import { requestPinnedJson } from "./net.js";
import { readJsonPath } from "./json-path.js";
import { HttpError, formatProviderError, PROVIDER_ERROR_MAX_LENGTH } from "./http-utils.js";
import { isId, validateExternalStatusSource } from "./validate.js";

const EXTERNAL_STATUS_DEFAULT_INTERVAL_SECONDS = 60;
const EXTERNAL_STATUS_MAX_HISTORY = 60;

export const externalStatusCache = new Map();

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
      error: source.fields.error ? normalizeExternalError(readMapped(record, source.fields.error)).slice(0, PROVIDER_ERROR_MAX_LENGTH) : undefined
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

export function previewExternalJson(value, depth = 0) {
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 5).map(item => previewExternalJson(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, previewExternalJson(item, depth + 1)]));
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  return value;
}

export function collectExternalPaths(value, prefix = "$", output = []) {
  if (output.length >= 200) return output;
  if (Array.isArray(value)) {
    if (value.length) collectExternalPaths(value[0], `${prefix}[]`, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    const path = `${prefix}.${key}`;
    output.push({ path, type: Array.isArray(item) ? "array" : item === null ? "null" : typeof item });
    collectExternalPaths(item, path, output);
  }
  return output;
}

export async function previewExternalStatusSource(input) {
  const source = await validateExternalStatusSource({ ...input, id: isId(input?.id) ? input.id : "preview-source", name: typeof input?.name === "string" && input.name ? input.name : "Preview" });
  const response = await requestPinnedJson({ ...source, method: "GET", timeoutSeconds: source.timeoutSeconds }, { accept: "application/json", ...source.headers });
  if (response.status < 200 || response.status >= 300) throw new HttpError(502, formatProviderError(response.status, response.text));
  let payload;
  try { payload = JSON.parse(response.text); } catch { throw new HttpError(502, "external status source returned invalid JSON"); }
  return { source: { ...source, preview: true }, preview: previewExternalJson(payload), keys: collectExternalPaths(payload), normalized: normalizeExternalStatus(source, payload) };
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
```

**Verification**:
```bash
node --check packages/dsh-balance/lib/host/external-status.js
```

---

### Task 5: Create Query Service & Route Table (`query.js`, `routes.js`)

**Files**:
- Create `packages/dsh-balance/lib/host/query.js`
- Create `packages/dsh-balance/lib/host/routes.js`

**Why**: Extract provider query caching, credentials resolution, and declarative route handler dispatching.

**Code**:

`packages/dsh-balance/lib/host/query.js`:
```javascript
import { requestPinnedJson } from "./net.js";
import { readJsonPath, readJsonPathExpr, resolveCurrency } from "./json-path.js";
import { HttpError, formatProviderError } from "./http-utils.js";
import { credentialRefForProvider, ownsCredential, readLegacyMacKeychain, removeLegacyMacKeychain } from "./security.js";
import { isId } from "./validate.js";

const DEFAULT_QUERY_INTERVAL_MINUTES = 30;
export const cache = new Map();

export function refreshDue(provider, syncedAt, now = Date.now()) {
  const intervalMinutes = Number(provider?.queryIntervalMinutes ?? DEFAULT_QUERY_INTERVAL_MINUTES);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return true;
  const syncedMs = typeof syncedAt === "string" ? Date.parse(syncedAt) : Number(syncedAt);
  return !Number.isFinite(syncedMs) || now - syncedMs >= intervalMinutes * 60_000;
}

export function redactProvider(provider) {
  const { apiKey, ...safe } = provider;
  return safe;
}

export function resolveBinding(config, model) {
  if (typeof model !== "string" || model.length === 0) return undefined;
  return config.bindings[model] || config.bindings[model.split("/")[0]];
}

export async function resolveProviderCredential(provider, credentials) {
  const ref = credentialRefForProvider(provider);
  const stored = await credentials.resolve(ref);
  if (stored?.value) return stored.value;
  if (!ownsCredential(provider)) return null;

  const legacy = await readLegacyMacKeychain(provider.id);
  if (!legacy) return null;
  await credentials.set(ref, legacy);
  await removeLegacyMacKeychain(provider.id);
  return legacy;
}

export async function query(provider, credentials, force = false, writeCache = true, draftSecret = null) {
  const cacheMs = Math.max(0, Number(provider.queryIntervalMinutes ?? DEFAULT_QUERY_INTERVAL_MINUTES)) * 60_000;
  const existing = cache.get(provider.id);
  if (writeCache && !force && cacheMs > 0 && existing && Date.now() - existing.at < cacheMs) return existing.value;
  const secret = draftSecret || await resolveProviderCredential(provider, credentials);
  if (!secret) throw new HttpError(502, "credential is missing in DSH credentials");
  const headers = { accept: "application/json", ...provider.headers };
  headers[provider.authHeader] = provider.auth === "bearer" ? `Bearer ${secret}` : secret;
  const response = await requestPinnedJson(provider, headers);
  if (response.status < 200 || response.status >= 300) throw new HttpError(502, formatProviderError(response.status, response.text));
  const text = response.text;
  let data;
  try { data = JSON.parse(text); } catch { throw new HttpError(502, "provider returned invalid JSON"); }
  const deepSeekBalance = provider.preset === "deepseek" && Array.isArray(data.balance_infos) ? data.balance_infos.find((item) => item?.currency === provider.currency) || data.balance_infos[0] : undefined;
  const rawAvailable = Number(deepSeekBalance?.total_balance ?? readJsonPathExpr(data, provider.responsePath));
  const available = provider.preset === "opencode-go" ? undefined : rawAvailable / Math.max(1, Number(provider.valueDivisor || 1));
  if (provider.preset !== "opencode-go" && !Number.isFinite(available)) throw new HttpError(502, "balance response does not contain a numeric value");
  const usageWindows = provider.usageWindows.map((window) => ({ type: window.type, percent: Math.max(0, Math.min(100, Number(readJsonPath(data, window.percentPath)) || 0)), resetAt: String(readJsonPath(data, window.resetAtPath) || "") }));
  const value = { id: provider.id, name: provider.name, ...(available === undefined ? {} : { available, currency: resolveCurrency(data, provider.currency) }), usageWindows, syncedAt: new Date().toISOString(), status: "ok" };
  if (writeCache) cache.set(provider.id, { at: Date.now(), value });
  return value;
}

export async function summary(config, model, credentials, force = false, requestedProviderId) {
  const providerId = isId(requestedProviderId) ? requestedProviderId : resolveBinding(config, model);
  const providers = providerId ? config.providers.filter((p) => p.id === providerId) : config.providers;
  return Promise.all(providers.map(async p => {
    try {
      return await query(p, credentials, force);
    } catch (error) {
      return { id: p.id, name: p.name, status: "error", error: error instanceof Error ? error.message : "request failed" };
    }
  }));
}
```

`packages/dsh-balance/lib/host/routes.js`:
```javascript
import { json, body, HttpError, errorStatus } from "./http-utils.js";
import { loadConfig, saveConfig, mutateConfig, normalizeExternalSources } from "./config-store.js";
import { validateProvider, validateExternalStatusSource, isId } from "./validate.js";
import { query, summary, redactProvider, cache } from "./query.js";
import { externalSummary, previewExternalStatusSource, externalStatusCache } from "./external-status.js";
import { ownsCredential, credentialRefForProvider } from "./security.js";

export function createRouter(ctx) {
  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url || "/", "http://local");
      const config = await loadConfig();

      if (req.method === "GET" && url.pathname === "/dsh-balance-quota/config") {
        return json(res, 200, { ok: true, config: { ...config, providers: config.providers.map(redactProvider) } });
      }
      if (req.method === "GET" && url.pathname === "/dsh-balance-quota/external-status") {
        return json(res, 200, { ok: true, sources: await externalSummary(config, url.searchParams.get("force") === "1", url.searchParams.get("source")) });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/external-status-preview") {
        return json(res, 200, { ok: true, ...(await previewExternalStatusSource(await body(req))) });
      }
      if (req.method === "GET" && url.pathname === "/dsh-balance-quota/summary") {
        return json(res, 200, { ok: true, providers: await summary(config, url.searchParams.get("model"), ctx.credentials, url.searchParams.get("force") === "1", url.searchParams.get("provider")) });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/external-status-source") {
        const input = await body(req);
        const source = await validateExternalStatusSource(input);
        await mutateConfig(async current => {
          current.externalStatusSources = normalizeExternalSources([...(Array.isArray(current.externalStatusSources) ? current.externalStatusSources : []).filter(item => item.id !== source.id && (!source.providerId || item.providerId !== source.providerId)), source]);
          await saveConfig(current);
        });
        externalStatusCache.delete(source.id);
        return json(res, 200, { ok: true, source });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/provider/test") {
        const input = await body(req);
        const provider = await validateProvider(input);
        const draftSecret = typeof input.apiKey === "string" && input.apiKey.length > 0 ? input.apiKey : null;
        if (!draftSecret && !input.credentialRef) throw new HttpError(400, "API Key 或凭据引用不能为空");
        return json(res, 200, { ok: true, result: await query(provider, ctx.credentials, true, false, draftSecret) });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/provider") {
        const input = await body(req);
        const provider = await validateProvider(input);
        if (typeof input.apiKey === "string" && input.apiKey.length > 0) {
          if (!ownsCredential(provider)) throw new Error("a provider using a shared credentialRef cannot replace that credential");
          await ctx.credentials.set(credentialRefForProvider(provider), input.apiKey);
        }
        await mutateConfig(async current => {
          current.providers = [...current.providers.filter(p => p.id !== provider.id), provider];
          await saveConfig(current);
        });
        cache.delete(provider.id);
        return json(res, 200, { ok: true, provider: redactProvider(provider) });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/preferences") {
        const input = await body(req);
        await mutateConfig(async current => {
          current.statusBar = typeof input.statusBar === "boolean" ? input.statusBar : current.statusBar;
          current.defaultProviderId = input.defaultProviderId === null || input.defaultProviderId === "" ? null : isId(input.defaultProviderId) && current.providers.some(p => p.id === input.defaultProviderId) ? input.defaultProviderId : current.defaultProviderId && current.providers.some(p => p.id === current.defaultProviderId) ? current.defaultProviderId : null;
          current.bindings = input.bindings && typeof input.bindings === "object" && !Array.isArray(input.bindings) ? Object.fromEntries(Object.entries(input.bindings).filter(([model, id]) => typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/.test(model) && isId(id) && current.providers.some(p => p.id === id))) : current.bindings;
          await saveConfig(current);
        });
        return json(res, 200, { ok: true });
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/dsh-balance-quota/external-status-source/")) {
        const id = decodeURIComponent(url.pathname.slice("/dsh-balance-quota/external-status-source/".length));
        if (!isId(id)) return json(res, 400, { ok: false, error: "invalid id" });
        await mutateConfig(async current => {
          current.externalStatusSources = (Array.isArray(current.externalStatusSources) ? current.externalStatusSources : []).filter(source => source.id !== id);
          await saveConfig(current);
        });
        externalStatusCache.delete(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/dsh-balance-quota/provider/")) {
        const id = decodeURIComponent(url.pathname.slice("/dsh-balance-quota/provider/".length));
        if (!isId(id)) return json(res, 400, { ok: false, error: "invalid id" });
        let removed;
        await mutateConfig(async current => {
          removed = current.providers.find(p => p.id === id);
          current.providers = current.providers.filter(p => p.id !== id);
          current.defaultProviderId = current.defaultProviderId === id ? null : current.defaultProviderId;
          current.bindings = Object.fromEntries(Object.entries(current.bindings || {}).filter(([, providerId]) => providerId !== id));
          await saveConfig(current);
        });
        if (ownsCredential(removed)) await ctx.credentials.unset(credentialRefForProvider(removed));
        cache.delete(id);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { ok: false, error: "unknown endpoint" });
    } catch (error) {
      return json(res, errorStatus(error), { ok: false, error: error instanceof Error ? error.message : "bad request" });
    }
  };
}
```

**Verification**:
```bash
node --check packages/dsh-balance/lib/host/query.js
node --check packages/dsh-balance/lib/host/routes.js
```

---

### Task 6: Host Composition Root & Export Compatibility (`lib/host/index.js`)

**Files**:
- Replace `packages/dsh-balance/lib/host/index.js`
- Modify `scripts/check.mjs` (register new host module files)

**Why**: Wire the composition root, export all 11 required public symbols, and verify with existing test suite.

**Code**:

`packages/dsh-balance/lib/host/index.js`:
```javascript
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { createRouter } from "./routes.js";

export const name = "balance-host";
export const inject = ["webServer", "credentials"];
export const SETTINGS_NAMESPACE = settingsNamespace("dsh-balance-quota");
const SETTINGS_SCHEMA = z.object({});

// Re-export all required public symbols for 100% backward compatibility with tests and callers
export { OFFICIAL_PROVIDERS, OFFICIAL_PROVIDER_IDS, isOfficialProvider } from "./presets.js";
export { formatProviderError } from "./http-utils.js";
export { validateProvider, validateExternalStatusSource } from "./validate.js";
export { readJsonPath, readJsonPathExpr } from "./json-path.js";
export { refreshDue, redactProvider, resolveBinding } from "./query.js";
export { normalizeExternalStatus, previewExternalStatusSource } from "./external-status.js";

export function apply(ctx) {
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register(SETTINGS_NAMESPACE, SETTINGS_SCHEMA);
  });

  const registration = {
    kind: "prefix",
    path: "/dsh-balance-quota",
    handler: createRouter(ctx)
  };

  ctx.effect(() => ctx.webServer.register(registration), "dsh-balance-quota: routes");
}
```

**Verification**:
```bash
node scripts/check.mjs
pnpm test
```

---

### Task 7: Client Internal Refactor (`lib/client/client.js`)

**Files**:
- Refactor `packages/dsh-balance/lib/client/client.js`

**Why**: Decompose monolithic `SettingsSection`, extract state management into cohesive functions/hooks, split 2000+ character single-lines into readable multi-line JSX/h structures, while maintaining zero-build single bundle factory contract.

**Verification**:
```bash
node scripts/check.mjs
pnpm test
```

---

### Task 8: Full Quality & Package Verification (`pnpm verify`)

**Files**:
- `scripts/check.mjs`
- `scripts/pack-check.mjs`

**Why**: Ensure syntax check, all 15 tests, pack dry-run, and release checks pass flawlessly.

**Verification**:
```bash
pnpm verify
```
