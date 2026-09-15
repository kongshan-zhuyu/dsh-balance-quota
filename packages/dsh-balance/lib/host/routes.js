import { json, body, HttpError, errorStatus } from "./http-utils.js";
import { loadConfig, saveConfig, mutateConfig, normalizeExternalSources } from "./config-store.js";
import { validateProvider, validateExternalStatusSource, isId } from "./validate.js";
import { query, summary, redactProvider, cache } from "./query.js";
import { deriveExternalPreview, externalPreviewStage, externalSummary, previewExternalStatusSource, externalStatusCache } from "./external-status.js";
import { deleteExternalPreviewCache, externalPreviewFingerprint, readExternalPreviewCache, writeExternalPreviewCache } from "./external-preview-cache.js";
import { ownsCredential, credentialRefForProvider } from "./security.js";

export function createRouter(ctx, options = {}) {
  const previewCacheOptions = options.previewCache || {};
  const configStore = options.configStore || { loadConfig, mutateConfig, saveConfig };
  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url || "/", "http://local");
      const config = await configStore.loadConfig();

      if (req.method === "GET" && url.pathname === "/dsh-balance-quota/config") {
        return json(res, 200, { ok: true, config: { ...config, providers: config.providers.map(redactProvider) } });
      }
      if (req.method === "GET" && url.pathname === "/dsh-balance-quota/external-status") {
        return json(res, 200, { ok: true, sources: await externalSummary(config, url.searchParams.get("force") === "1", url.searchParams.get("source")) });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/external-status-preview") {
        return json(res, 200, { ok: true, ...(await previewExternalStatusSource(await body(req))) });
      }
      if (req.method === "GET" && url.pathname.startsWith("/dsh-balance-quota/external-status-preview/")) {
        const id = decodeURIComponent(url.pathname.slice("/dsh-balance-quota/external-status-preview/".length));
        if (!isId(id)) return json(res, 400, { ok: false, error: "invalid id" });
        const source = config.externalStatusSources.find(item => item.id === id);
        if (!source) return json(res, 404, { ok: false, error: "preview cache not found" });
        const cached = await readExternalPreviewCache(source, previewCacheOptions);
        if (!cached) return json(res, 404, { ok: false, error: "preview cache not found" });
        return json(res, 200, { ok: true, cached: true, ...deriveExternalPreview(source, cached.payload, cached.fetchedAt, true) });
      }
      if (req.method === "GET" && url.pathname === "/dsh-balance-quota/summary") {
        return json(res, 200, { ok: true, providers: await summary(config, url.searchParams.get("model"), ctx.credentials, url.searchParams.get("force") === "1", url.searchParams.get("provider")) });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/external-status-source") {
        const input = await body(req);
        const source = await validateExternalStatusSource(input);
        await configStore.mutateConfig(async current => {
          // 与 providers 的 upsert 同理：编辑已有监测源必须保持原位，
          // 只有新增才追加到末尾。历史上这里也是「先滤掉旧的、再追加」，
          // 会让被编辑的监测源卡片跳到列表最后。
          // 匹配条件保持原语义：同 id，或同一个 providerId（每个供应商只保留一个源）。
          const sources = Array.isArray(current.externalStatusSources) ? current.externalStatusSources : [];
          const carried = item => item.id === source.id || Boolean(source.providerId && item.providerId === source.providerId);
          const index = sources.findIndex(carried);
          current.externalStatusSources = normalizeExternalSources(
            index === -1 ? [...sources, source] : sources.map(item => (carried(item) ? source : item))
          );
          await configStore.saveConfig(current);
        });
        externalStatusCache.delete(source.id);
        const staged = externalPreviewStage.get(source.id);
        let warning;
        if (staged?.requestFingerprint === externalPreviewFingerprint(source)) {
          const result = await writeExternalPreviewCache({ sourceId: source.id, ...staged }, previewCacheOptions);
          warning = result.warning;
        }
        externalPreviewStage.delete(source.id);
        return json(res, 200, { ok: true, source, ...(warning ? { warning } : {}) });
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
        await configStore.mutateConfig(async current => {
          // upsert 时**必须保持原有顺序**：历史实现是「先滤掉旧的、再追加到末尾」，
          // 于是编辑任何一个已有供应商并保存后，它都会被挪到列表最后一名，
          // 用户看到的就是「点完保存，这张卡片跑到最下面去了」。
          // 新建才追加到末尾；编辑则在原位替换。
          const index = current.providers.findIndex(p => p.id === provider.id);
          current.providers = index === -1
            ? [...current.providers, provider]
            : current.providers.map(p => (p.id === provider.id ? provider : p));
          await configStore.saveConfig(current);
        });
        cache.delete(provider.id);
        return json(res, 200, { ok: true, provider: redactProvider(provider) });
      }
      if (req.method === "POST" && url.pathname === "/dsh-balance-quota/preferences") {
        const input = await body(req);
        await configStore.mutateConfig(async current => {
          current.statusBar = typeof input.statusBar === "boolean" ? input.statusBar : current.statusBar;
          current.defaultProviderId = input.defaultProviderId === null || input.defaultProviderId === "" ? null : isId(input.defaultProviderId) && current.providers.some(p => p.id === input.defaultProviderId) ? input.defaultProviderId : current.defaultProviderId && current.providers.some(p => p.id === current.defaultProviderId) ? current.defaultProviderId : null;
          current.bindings = input.bindings && typeof input.bindings === "object" && !Array.isArray(input.bindings) ? Object.fromEntries(Object.entries(input.bindings).filter(([model, id]) => typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/.test(model) && isId(id) && current.providers.some(p => p.id === id))) : current.bindings;
          await configStore.saveConfig(current);
        });
        return json(res, 200, { ok: true });
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/dsh-balance-quota/external-status-source/")) {
        const id = decodeURIComponent(url.pathname.slice("/dsh-balance-quota/external-status-source/".length));
        if (!isId(id)) return json(res, 400, { ok: false, error: "invalid id" });
        await configStore.mutateConfig(async current => {
          current.externalStatusSources = (Array.isArray(current.externalStatusSources) ? current.externalStatusSources : []).filter(source => source.id !== id);
          await configStore.saveConfig(current);
        });
        externalStatusCache.delete(id);
        externalPreviewStage.delete(id);
        const cacheDelete = await deleteExternalPreviewCache(id, previewCacheOptions);
        return json(res, 200, { ok: true, ...(cacheDelete.warning ? { warning: cacheDelete.warning } : {}) });
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/dsh-balance-quota/provider/")) {
        const id = decodeURIComponent(url.pathname.slice("/dsh-balance-quota/provider/".length));
        if (!isId(id)) return json(res, 400, { ok: false, error: "invalid id" });
        let removed;
        await configStore.mutateConfig(async current => {
          removed = current.providers.find(p => p.id === id);
          current.providers = current.providers.filter(p => p.id !== id);
          current.defaultProviderId = current.defaultProviderId === id ? null : current.defaultProviderId;
          current.bindings = Object.fromEntries(Object.entries(current.bindings || {}).filter(([, providerId]) => providerId !== id));
          await configStore.saveConfig(current);
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
