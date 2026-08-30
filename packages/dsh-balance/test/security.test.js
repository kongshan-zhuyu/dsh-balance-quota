import test from "node:test";
import assert from "node:assert/strict";
import { OFFICIAL_PROVIDER_IDS, formatProviderError, isOfficialProvider, refreshDue, validateProvider, readJsonPath, readJsonPathExpr, redactProvider, resolveBinding } from "../lib/host/index.js";
import { balanceCredentialRef, credentialRefForProvider, ownsCredential } from "../lib/host/security.js";
import { summary } from "../lib/host/query.js";

test("rejects insecure or local endpoints", async () => {
  await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint: "http://example.com", responsePath: "$.balance" }));
  await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint: "https://127.0.0.1/a", responsePath: "$.balance" }));
});
test("allows a normal HTTPS provider and only safe JSON paths", async () => {
  const p = await validateProvider({ id: "open-code", name: "OpenCode", endpoint: "https://example.com/balance", responsePath: "$.data.balance" });
  assert.equal(p.id, "open-code");
  assert.equal(readJsonPath({ data: { balance: 12 } }, "$.data.balance"), 12);
  assert.throws(() => readJsonPath({}, "$['constructor']"));
  assert.equal(redactProvider({ ...p, apiKey: "never" }).apiKey, undefined);
  assert.equal(p.balanceEnabled, true);
});

test("disabled balance monitoring skips credentials and external requests", async () => {
  const provider = await validateProvider({ id: "disabled", name: "Disabled", endpoint: "https://example.com/balance", responsePath: "$.balance", balanceEnabled: false });
  let credentialReads = 0;
  const credentials = { resolve: async () => { credentialReads += 1; throw new Error("must not resolve credentials"); } };
  const result = await summary({ providers: [provider], bindings: {} }, undefined, credentials, true, provider.id);
  assert.deepEqual(result, [{ id: "disabled", name: "Disabled", status: "disabled" }]);
  assert.equal(credentialReads, 0);
  assert.equal(refreshDue(provider, undefined), false);
});
test("path expressions support ?? fallback chains, optional chaining, and the response alias", () => {
  const data = { balance: 0.28, quota: { remaining: 5, unit: "CNY" } };
  assert.equal(readJsonPathExpr(data, "$.remaining ?? $.quota.remaining ?? $.balance"), 5);
  assert.equal(readJsonPathExpr({ balance: 0.28 }, "$.remaining ?? $.quota.remaining ?? $.balance"), 0.28);
  assert.equal(readJsonPathExpr({ remaining: 3, quota: { remaining: 5 }, balance: 0.28 }, "$.remaining ?? $.quota.remaining ?? $.balance"), 3);
  assert.equal(readJsonPathExpr(data, "$.quota?.remaining ?? $.balance"), 5);
  assert.equal(readJsonPathExpr(data, "response?.quota?.remaining ?? response?.balance"), 5);
  assert.equal(readJsonPathExpr({ quota: { remaining: 0 } }, "$.quota.remaining ?? $.balance"), 0);
  assert.equal(readJsonPathExpr({ unit: "USD" }, "$.unit ?? $.quota?.unit ?? \"USD\""), "USD");
  assert.equal(readJsonPathExpr({ quota: { unit: "USD" } }, "$.unit ?? $.quota?.unit ?? \"CNY\""), "USD");
  assert.equal(readJsonPathExpr({}, "$.unit ?? $.quota?.unit ?? \"USD\""), "USD");
  assert.equal(readJsonPathExpr({}, "$.unit ?? \"USD\""), "USD");
  assert.equal(readJsonPathExpr({ balance: "0.5" }, "$.balance"), "0.5");
  assert.equal(readJsonPathExpr({ remaining: null, balance: 1 }, "$.remaining ?? $.balance"), 1);
  assert.throws(() => readJsonPathExpr({}, "$.constructor ?? $.x"));
  assert.throws(() => readJsonPathExpr({}, "$.a.__proto__.b"));
  assert.throws(() => readJsonPathExpr({}, "eval(\"1\")"));
  assert.throws(() => readJsonPathExpr({}, "`${x}`"));
  assert.throws(() => readJsonPathExpr({}, "$[0]"));
  assert.throws(() => readJsonPathExpr({}, "$.a ?? $.b ?? $.c ?? $.d ?? $.e ?? $.f"));
  assert.throws(() => readJsonPathExpr({}, "response"));
  assert.throws(() => readJsonPathExpr({}, "$..a"));
  assert.throws(() => readJsonPathExpr({}, "$.a?"));
  assert.throws(() => readJsonPathExpr({}, 42));
});
test("validateProvider accepts expression responsePath and dynamic currency", async () => {
  const p = await validateProvider({ id: "relay", name: "Relay", endpoint: "https://example.com/usage", responsePath: "$.remaining ?? $.quota?.remaining ?? $.balance", currency: "$.unit ?? \"USD\"" });
  assert.equal(p.responsePath, "$.remaining ?? $.quota?.remaining ?? $.balance");
  assert.equal(p.currency, "$.unit ?? \"USD\"");
  await assert.rejects(() => validateProvider({ id: "relay", name: "Relay", endpoint: "https://example.com/usage", responsePath: "$.constructor", currency: "USD" }));
  const coerced = await validateProvider({ id: "relay", name: "Relay", endpoint: "https://example.com/usage", responsePath: "$.balance", currency: "`USD`" });
  assert.equal(coerced.currency, "CNY");
  await assert.rejects(() => validateProvider({ id: "relay", name: "Relay", endpoint: "https://example.com/usage", responsePath: "$.balance ?? process", currency: "USD" }));
});
test("balance credential references are stable and preserve shared ownership", async () => {
  assert.equal(balanceCredentialRef("my-provider"), "DSH_BALANCE_MY_PROVIDER");
  const owned = await validateProvider({ id: "my-provider", name: "My Provider", endpoint: "https://example.com/usage", responsePath: "$.balance" });
  assert.equal(owned.credentialRef, "DSH_BALANCE_MY_PROVIDER");
  assert.equal(ownsCredential(owned), true);
  assert.equal(credentialRefForProvider(owned), "DSH_BALANCE_MY_PROVIDER");
  const shared = await validateProvider({ id: "shared", name: "Shared", endpoint: "https://example.com/usage", responsePath: "$.balance", credentialRef: "OPENAI_API_KEY" });
  assert.equal(shared.credentialRef, "OPENAI_API_KEY");
  assert.equal(ownsCredential(shared), false);
  assert.equal(credentialRefForProvider(shared), "OPENAI_API_KEY");
});
test("official presets are limited to verified official balance and quota APIs", async () => {
  assert.deepEqual(OFFICIAL_PROVIDER_IDS, ["deepseek", "opencode-go"]);
  const deepseek = await validateProvider({ id: "deepseek", name: "DeepSeek", preset: "deepseek", credentialRef: "DEEPSEEK_API_KEY" });
  assert.equal(deepseek.endpoint, "https://api.deepseek.com/user/balance");
  assert.equal(deepseek.balanceEnabled, true);
  assert.equal(isOfficialProvider(deepseek), true);
  const opencode = await validateProvider({ id: "opencode-go", name: "OpenCode Go", preset: "opencode-go", credentialRef: "OPENCODE_API_KEY" });
  assert.equal(opencode.usageWindows.length, 3);
  assert.equal(isOfficialProvider(opencode), true);
  const custom = await validateProvider({ id: "relay", name: "Relay", endpoint: "https://example.com/usage", responsePath: "$.balance" });
  assert.equal(isOfficialProvider(custom), false);
});
test("refreshDue follows each provider query interval", () => {
  const provider = { queryIntervalMinutes: 30 };
  assert.equal(refreshDue(provider, "2025-01-01T00:00:00.000Z", Date.parse("2025-01-01T00:29:59.999Z")), false);
  assert.equal(refreshDue(provider, "2025-01-01T00:00:00.000Z", Date.parse("2025-01-01T00:30:00.000Z")), true);
  assert.equal(refreshDue(provider, "not-a-date", Date.parse("2025-01-01T00:00:00.000Z")), true);
  assert.equal(refreshDue({ queryIntervalMinutes: 0 }, "2025-01-01T00:00:00.000Z", Date.parse("2025-01-01T00:00:01.000Z")), true);
});
test("provider HTTP errors preserve safe response details", () => {
  assert.equal(formatProviderError(403, JSON.stringify({ error: { message: "API key is not allowed for this endpoint" } })), "供应商返回 HTTP 403：API key is not allowed for this endpoint");
  assert.equal(formatProviderError(401, "invalid credentials"), "供应商返回 HTTP 401：invalid credentials");
  const safe = formatProviderError(403, JSON.stringify({ message: "Bearer secret-token api_key=raw-secret" }));
  assert.equal(safe, "供应商返回 HTTP 403：Bearer [redacted] api_key=[redacted]");
  assert.ok(formatProviderError(500, "x".repeat(1000)).length <= 260);
});
test("binding resolves an exact route first, then the provider prefix", () => {
  const config = { bindings: { "deepseek/deepseek-chat": "relay-a", "openai": "relay-b" } };
  assert.equal(resolveBinding(config, "deepseek/deepseek-chat"), "relay-a");
  assert.equal(resolveBinding(config, "openai/gpt-4o"), "relay-b");
  assert.equal(resolveBinding(config, "deepseek/deepseek-reasoner"), undefined);
  assert.equal(resolveBinding(config, ""), undefined);
  assert.equal(resolveBinding(config, undefined), undefined);
});
