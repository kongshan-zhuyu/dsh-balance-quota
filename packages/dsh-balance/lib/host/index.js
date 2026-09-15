import z from "@deepseek-ai/schemastery";
import { createRouter } from "./routes.js";

export const name = "balance-host";
export const inject = ["webServer", "credentials"];
// DSH >= 0.1.5-rc.2: `settingsNamespace()` was removed; `settings.register()`
// now takes the raw lowercase-hyphenated namespace string directly.
export const SETTINGS_NAMESPACE = "dsh-balance-quota";
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
    // Registering the namespace is what lets the client render this plugin's
    // card in Settings -> Plugins -> Plugin configuration.
    settingsCtx.settings.register(SETTINGS_NAMESPACE, SETTINGS_SCHEMA);
  });

  const registration = {
    kind: "prefix",
    path: "/dsh-balance-quota",
    handler: createRouter(ctx)
  };

  ctx.effect(() => ctx.webServer.register(registration), "dsh-balance-quota: routes");
}
