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
