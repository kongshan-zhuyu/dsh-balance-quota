const PATH_EXPR_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PATH_EXPR_RE = /^(?:\$|response)(?:(?:\.|\?\.)[A-Za-z_$][A-Za-z0-9_$]*){1,8}$/;
const PATH_EXPR_LITERAL = /^"[A-Za-z0-9 _./:-]{1,32}"$/;
// 安全 JSON 路径：`$.key` 与 `[数字]` 数组索引段（外部状态源绑定嵌套数组时使用）。
const SAFE_PATH_RE = /^\$(?:(?:\.[A-Za-z_$][A-Za-z0-9_$]*)|(?:\[\d{1,9}\])){1,16}$/;

export function safePath(value) {
  return typeof value === "string" && SAFE_PATH_RE.test(value) && !/(?:__proto__|constructor|prototype)/.test(value);
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
  const segments = [];
  const rest = path.slice(1); // 跳过 `$`，保留开头的 `.` 或 `[`
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === ".") {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest.slice(i + 1));
      if (!match) throw new Error("unsafe JSON path");
      segments.push({ kind: "key", value: match[0] });
      i += 1 + match[0].length;
    } else if (rest[i] === "[") {
      const match = /^\[(\d{1,9})\]/.exec(rest.slice(i));
      if (!match) throw new Error("unsafe JSON path");
      segments.push({ kind: "index", value: Number(match[1]) });
      i += match[0].length;
    } else {
      throw new Error("unsafe JSON path");
    }
  }
  return segments.reduce((value, segment) => {
    if (value === null || value === undefined) return undefined;
    if (segment.kind === "index") return Array.isArray(value) ? value[segment.value] : undefined;
    return typeof value === "object" ? value[segment.value] : undefined;
  }, data);
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
