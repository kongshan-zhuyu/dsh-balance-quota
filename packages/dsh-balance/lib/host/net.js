import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { HttpError } from "./http-utils.js";

export const MAX_BODY = 512 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 10;

const badHost = /(^localhost$|\.local$|\.internal$)/i;

// 这条错误会经 validateProvider 原样回显给用户，必须是可读中文。
const PRIVATE_ENDPOINT_ERROR = "余额地址指向内网、回环或保留地址，仅允许公网地址";

/**
 * Whether plain HTTP is accepted for outbound provider requests.
 *
 * Some deployments run their gateway on a bare IP with no domain, so no
 * certificate can exist for it and HTTPS is simply unavailable. Requiring
 * HTTPS there makes the plugin unusable, so HTTP is allowed — but the whole
 * SSRF defence still applies: the hostname is resolved here, every answer must
 * be public, no redirect is followed, and the connection is pinned to the
 * resolved address. Opt out by setting `DSH_BALANCE_ALLOW_HTTP=0`.
 */
export function allowHttp() {
  const raw = process.env.DSH_BALANCE_ALLOW_HTTP;
  if (raw === undefined || raw === "") return true;
  return !/^(0|false|no|off)$/i.test(raw.trim());
}

/** Default port per scheme; an explicit port on the endpoint still wins. */
function defaultPort(protocol) {
  return protocol === "http:" ? 80 : 443;
}

/**
 * Expand an IPv6 address into its eight 16-bit groups.
 * Returns null when the input is not a parseable IPv6 literal.
 * Handles `::` compression and an embedded dotted-quad tail (`::ffff:1.2.3.4`).
 */
function expandIpv6(ip) {
  let head = ip;
  let tail = [];
  // A dotted-quad tail is only legal in the last 32 bits; rewrite it as two groups.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (dotted) {
    const octets = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number);
    if (octets.some((value) => value > 255)) return null;
    head = dotted[1];
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const parse = (part) => (part === "" ? [] : part.split(":").map((group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return NaN;
    return parseInt(group, 16);
  }));
  const left = parse(halves[0]);
  const right = halves.length === 2 ? parse(halves[1]) : [];
  if ([...left, ...right, ...tail].some((value) => Number.isNaN(value))) return null;
  if (halves.length === 1) {
    const groups = [...left, ...tail];
    return groups.length === 8 ? groups : null;
  }
  const missing = 8 - left.length - right.length - tail.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right, ...tail];
}

/**
 * Decide whether an address is non-public and must be blocked.
 *
 * Accepts any IPv4 or IPv6 literal. IPv4-mapped (`::ffff:a.b.c.d`) and
 * IPv4-compatible forms are unwrapped first, because a mapped address reaches
 * exactly the same host as its IPv4 spelling and would otherwise slip past a
 * naive prefix check. Comparison is numeric rather than textual so that
 * leading-zero and uppercase spellings cannot dodge the ranges.
 */
export function privateIp(ip) {
  if (typeof ip !== "string" || ip.length === 0 || ip.length > 64) return true;
  const family = net.isIP(ip);
  if (family === 4) return privateIpv4(ip);

  if (family !== 6) {
    // Not an IP literal at all: refuse rather than guess.
    return true;
  }

  const groups = expandIpv6(ip.toLowerCase());
  if (!groups) return true;

  // Unwrap IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) addresses.
  const isMapped = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && (groups[5] === 0xffff || groups[5] === 0);
  if (isMapped) {
    return privateIpv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`);
  }

  const first = groups[0];
  // ::/128 unspecified, ::1/128 loopback
  if (groups.every((value) => value === 0)) return true;
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) return true;
  // fec0::/10 deprecated site-local
  if ((first & 0xffc0) === 0xfec0) return true;
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return true;
  // 64:ff9b::/96 NAT64 and 2002::/16 6to4 embed an IPv4 address that may be private.
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    return privateIpv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`);
  }
  if (first === 0x2002) {
    return privateIpv4(`${groups[1] >> 8}.${groups[1] & 0xff}.${groups[2] >> 8}.${groups[2] & 0xff}`);
  }
  return false;
}

/** Numeric IPv4 range check covering every non-public block. */
function privateIpv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((value) => Number.isNaN(value) || value > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true;                                    // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                   // 10.0.0.0/8 private
  if (a === 127) return true;                                  // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;                     // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;                     // 192.168.0.0/16 private
  if (a === 192 && b === 0 && octets[2] === 0) return true;    // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && octets[2] === 2) return true;    // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;        // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true;  // 203.0.113.0/24 TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true;           // 100.64.0.0/10 CGNAT
  if (a >= 224) return true;                                   // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

export async function resolvePublicEndpoint(raw) {
  const url = new URL(raw);
  const secure = url.protocol === "https:";
  if ((!secure && url.protocol !== "http:") || (url.protocol === "http:" && !allowHttp())) {
    throw new Error(secure ? "endpoint must be public HTTPS" : "endpoint must be public HTTP or HTTPS");
  }
  if (url.username || url.password || badHost.test(url.hostname)) {
    throw new Error("endpoint must be a public HTTP(S) URL without credentials");
  }
  let port;
  try {
    port = url.port ? Number(url.port) : defaultPort(url.protocol);
  } catch {
    throw new Error("endpoint has an invalid port");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("endpoint has an invalid port");
  // IP 字面量不走 getaddrinfo：各平台解析器行为不一致（Linux 对
  // `[::ffff:7f00:1]` 这类非规范写法直接 ENOTFOUND，错误形态会绕开防线提示），
  // 且字面量本就无需解析。本地解析后直接交给 privateIp 防线，跨平台行为一致。
  const literal = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const literalFamily = net.isIP(literal);
  if (literalFamily) {
    if (privateIp(literal)) throw new Error(PRIVATE_ENDPOINT_ERROR);
    return { url, records: [{ address: literal, family: literalFamily }], port, secure };
  }
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => privateIp(record.address))) {
    throw new Error(PRIVATE_ENDPOINT_ERROR);
  }
  return { url, records, port, secure };
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
    // http/https selection happens here and nowhere else: the scheme is decided by
    // the validated endpoint, never by remote input such as a redirect target.
    const transport = target.secure ? https : http;
    const request = transport.request({
      protocol: target.secure ? "https:" : "http:",
      hostname: address.address,
      family: address.family,
      port: target.port,
      method: provider.method,
      path: `${target.url.pathname}${target.url.search}`,
      headers: { ...headers, host: target.url.host },
      // `servername` drives SNI and is an https-only option; dropping it over http
      // also keeps the request from looking like a TLS attempt to plain-HTTP servers.
      ...(target.secure ? { servername: target.url.hostname, rejectUnauthorized: true } : {}),
      timeout: timeoutMs,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        // 这些文案会原样显示在供应商卡片与弹窗页脚，必须是可读中文，
        // 与 formatProviderError 的状态码提示风格保持一致。
        reject(new HttpError(502, "供应商返回了重定向（余额查询地址不应跳转，请直接填写最终地址）"));
        return;
      }
      const contentLength = Number(response.headers["content-length"] || 0);
      if (contentLength > MAX_BODY) {
        response.resume();
        reject(new HttpError(502, "供应商响应体过大（超过 512 KB），请确认该地址返回的是余额数据"));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          response.destroy(new HttpError(502, "供应商响应体过大（超过 512 KB），请确认该地址返回的是余额数据"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new HttpError(502, "供应商请求超时（请检查该地址是否可达）")));
    request.on("error", reject);
    request.end();
  });
}
