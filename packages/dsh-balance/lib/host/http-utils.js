export const PROVIDER_ERROR_MAX_LENGTH = 240;
const MAX_BODY = 512 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 凭据 token 的边界必须止步于「空白、常见标点、以及任何中日韩字符」。
// 历史实现用的是 `[^\s,;]+`，它的补集**包含中文标点与数字**，于是
// `Bearer sk-abcXYZ」（37 B）` 会被整体当成一个 token 吞掉——
// 脱敏后残留 `Bearer [redacted] B）`，把摘要里的体积信息连右括号一起吃没了。
// 显式排除 \u3000-\u303f（CJK 标点）、\uff00-\uffef（全角字符/括号）与引号括号后
// 才能保证脱敏只切凭据本身，不动周围的展示文本。
const TOKEN_END = "[^\\s,;\"'`()<>\\[\\]{}，。；：！？、（）「」『』【】\\u3000-\\u303f\\uff00-\\uffef]";
const BEARER_PATTERN = new RegExp(`Bearer\\s+${TOKEN_END}+`, "gi");
// 标签写法有三种必须都覆盖，历史实现只认得第一种：
//   1. `api_key=…` / `api-key: …`（下划线或连字符）——原本已覆盖
//   2. `API key: …`（**空格分隔**）——上游报错文本里最常见的自然人写法，原先漏网
//   3. `apiKey=…`（驼峰）——SDK 抛错时常这么写，原先也漏网
// 另外补一条**无标签兜底**：`sk-`/`sk_`/`pk-`/`rk-` 开头的裸密钥。
// 上游常见 `Invalid key: sk-live-xxxx` 这类没有 key= 前缀的回显，
// 只靠标签匹配会原样泄露。兜底规则放在标签规则之后，避免重复替换。
const SECRET_LABEL_PATTERN = new RegExp(
  `((?:api[_-]?\\s*key|apikey|token|secret|password)\\s*[:=]\\s*)${TOKEN_END}+`,
  "gi"
);
const BARE_KEY_PATTERN = /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{6,}/g;

export function sanitizeProviderError(value) {
  return String(value || "")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(SECRET_LABEL_PATTERN, "$1[redacted]")
    .replace(BARE_KEY_PATTERN, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, PROVIDER_ERROR_MAX_LENGTH);
}

// 上游返回 HTML 时（网关 404/502 页、Cloudflare 拦截页、CDN 错误页等），
// 把整段 `<html>…</html>` 原样贴给用户会变成一大片红色标签，
// 既读不出关键信息，也把卡片撑得老高。
// 这里识别出 HTML 后只保留能说明问题的部分：<title> 文本 + 响应体大小。
// 常见错误页的 title（如 "404 Not Found"、"Example Domain"）恰好是最有信息量的一行。
const HTML_SNIFF = /^\s*(?:<!doctype\s+html|<\/?(?:html|head|body|div|p|span|center|h1|h2|table)\b)/i;

export function summarizeHtmlBody(text) {
  const raw = String(text || "");
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const heading = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  // 去掉标签本身与多余空白，只留可读文字。
  const clean = (value) => String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const label = clean(title) || clean(heading);
  const size = Buffer.byteLength(raw, "utf8");
  const sizeLabel = size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
  const summary = label ? `返回了 HTML 页面「${label}」（${sizeLabel}）` : `返回了 HTML 页面（${sizeLabel}）`;
  // 摘要自身就脱敏：错误页的 title 里可能带 `Authorization: Bearer …` 之类的回显，
  // 不能因为「调用方会脱敏」就省略这一步——这个函数是导出的，任何直接调用点都要安全。
  return sanitizeProviderError(summary);
}

export function formatProviderError(status, text) {
  let detail = "";
  const raw = String(text || "");
  // HTTP 状态码本身就能说明性质，补一句中文提示，避免用户只看到裸状态码。
  // 提示要先算出来：HTML 摘要是否拼接取决于「有没有提示」——
  // 用户反馈：状态码 + 提示已经说明问题（404 就是地址错、401 就是 Key 错），
  // 「返回了 HTML 页面「Example Domain」（559 B）」这种细节是噪音，不必展示。
  // 只有在无提示的少见状态码下才补页面标题当线索。
  const hint = status === 404 ? "（该地址不存在，请核对余额查询地址）"
    : status === 401 || status === 403 ? "（凭据无效或无权限，请检查 API Key）"
      : status === 429 ? "（请求过于频繁，请稍后重试）"
        : status >= 500 ? "（上游服务异常，请稍后重试）"
          : "";
  if (HTML_SNIFF.test(raw)) {
    // 这类响应体几乎不可能含有效 JSON，走摘要分支避免把整页标签塞进错误信息。
    detail = hint ? "" : summarizeHtmlBody(raw);
  } else {
    try {
      const data = JSON.parse(text);
      const candidate = data?.error?.message || data?.error?.detail || data?.error || data?.message || data?.detail || data?.msg || data?.code;
      detail = typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : "";
    } catch {
      detail = raw;
    }
  }
  detail = sanitizeProviderError(detail);
  return `供应商返回 HTTP ${status}${hint}${detail ? `：${detail}` : ""}`;
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
