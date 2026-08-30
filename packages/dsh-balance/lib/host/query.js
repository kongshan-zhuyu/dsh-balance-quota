import { requestPinnedJson } from "./net.js";
import { readJsonPath, readJsonPathExpr, resolveCurrency } from "./json-path.js";
import { HttpError, formatProviderError } from "./http-utils.js";
import { credentialRefForProvider, ownsCredential, readLegacyMacKeychain, removeLegacyMacKeychain } from "./security.js";
import { isId } from "./validate.js";

const DEFAULT_QUERY_INTERVAL_MINUTES = 30;
export const cache = new Map();

export function refreshDue(provider, syncedAt, now = Date.now()) {
  if (provider?.balanceEnabled === false) return false;
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
    if (p.balanceEnabled === false) return { id: p.id, name: p.name, status: "disabled" };
    try {
      return await query(p, credentials, force);
    } catch (error) {
      return { id: p.id, name: p.name, status: "error", error: error instanceof Error ? error.message : "request failed" };
    }
  }));
}
