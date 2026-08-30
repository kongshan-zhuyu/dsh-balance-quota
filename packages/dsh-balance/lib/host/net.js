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
