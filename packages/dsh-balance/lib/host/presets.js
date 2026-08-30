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
