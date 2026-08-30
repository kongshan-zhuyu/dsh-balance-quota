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
