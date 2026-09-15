import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OFFICIAL_PROVIDER_IDS, formatProviderError, isOfficialProvider, refreshDue, validateProvider, readJsonPath, readJsonPathExpr, redactProvider, resolveBinding, SETTINGS_NAMESPACE } from "../lib/host/index.js";
import { summarizeHtmlBody } from "../lib/host/http-utils.js";
import { sanitizeProviderError } from "../lib/host/http-utils.js";
import { balanceCredentialRef, credentialRefForProvider, ownsCredential } from "../lib/host/security.js";
import { privateIp } from "../lib/host/net.js";
import { BoundedCache } from "../lib/host/bounded-cache.js";
import { summary } from "../lib/host/query.js";

// Plain HTTP is allowed on purpose: gateways on a bare IP (no domain) cannot have a
// certificate, so requiring HTTPS would make them unusable. Everything that actually
// defends against SSRF must survive the relaxation — protocol allow-list, private
// addresses, embedded credentials, and the refusal to follow redirects.
test("accepts public HTTP but still rejects local, credentialed, and off-list endpoints", async () => {
  // A bare-IP gateway over plain HTTP is the case this relaxation exists for.
  const plain = await validateProvider({ id: "gateway", name: "Gateway", endpoint: "http://8.8.8.8:8080/usage", responsePath: "$.balance" });
  assert.equal(plain.endpoint, "http://8.8.8.8:8080/usage");
  const secured = await validateProvider({ id: "a", name: "a", endpoint: "https://8.8.8.8/balance", responsePath: "$.balance" });
  assert.equal(secured.endpoint, "https://8.8.8.8/balance");

  // Non-HTTP schemes stay refused.
  for (const endpoint of ["ftp://8.8.8.8/x", "file:///etc/passwd", "//8.8.8.8/x"]) {
    await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint, responsePath: "$.balance" }), `must reject ${endpoint}`);
  }
  // Private, loopback, and local-name targets stay refused over either scheme.
  for (const endpoint of [
    "http://127.0.0.1/a", "https://127.0.0.1/a", "http://10.0.0.1/a",
    "http://192.168.1.1/a", "http://169.254.169.254/latest/meta-data", "http://localhost/a",
    "http://foo.internal/a", "http://bar.local/a"
  ]) {
    await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint, responsePath: "$.balance" }), `must reject ${endpoint}`);
  }
  // Userinfo must never ride along, on http or https.
  for (const endpoint of ["http://u:p@8.8.8.8/a", "https://u:p@8.8.8.8/a"]) {
    await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint, responsePath: "$.balance" }), `must reject ${endpoint}`);
  }
});
test("plain HTTP can be switched off for deployments that require TLS", async () => {
  const previous = process.env.DSH_BALANCE_ALLOW_HTTP;
  process.env.DSH_BALANCE_ALLOW_HTTP = "0";
  try {
    await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint: "http://8.8.8.8/balance", responsePath: "$.balance" }));
    const secured = await validateProvider({ id: "a", name: "a", endpoint: "https://8.8.8.8/balance", responsePath: "$.balance" });
    assert.equal(secured.endpoint, "https://8.8.8.8/balance");
  } finally {
    if (previous === undefined) delete process.env.DSH_BALANCE_ALLOW_HTTP;
    else process.env.DSH_BALANCE_ALLOW_HTTP = previous;
  }
});
// The request must pick its transport from the *validated* endpoint and pin the port
// the endpoint named, so an http-only gateway on a custom port is reachable while the
// scheme can never be influenced by remote input.
test("request transport follows the validated scheme and pins the declared port", async () => {
  const source = await readFile(new URL("../lib/host/net.js", import.meta.url), "utf8");
  assert.match(source, /const transport = target\.secure \? https : http;/);
  assert.match(source, /port: target\.port/);
  // SNI/TLS verification is https-only, so http requests must not carry them.
  assert.match(source, /\.\.\.\(target\.secure \? \{ servername: target\.url\.hostname, rejectUnauthorized: true \} : \{\}\)/);
  // 重定向拒绝文案已本地化为中文（会原样显示给用户），此处断言新的中文文案；
  // 旧的英文 `provider redirect is not allowed` 不得复活（见下方本地化枚举断言）。
  assert.match(source, /供应商返回了重定向/);
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
  // 状态码后现在会附一句中文提示（404→核对地址、401/403→检查凭据、429→稍后重试、5xx→上游异常），
  // 让用户不必自己翻译状态码；上游返回的原始错误信息仍原样保留在后半段。
  assert.equal(formatProviderError(403, JSON.stringify({ error: { message: "API key is not allowed for this endpoint" } })), "供应商返回 HTTP 403（凭据无效或无权限，请检查 API Key）：API key is not allowed for this endpoint");
  assert.equal(formatProviderError(401, "invalid credentials"), "供应商返回 HTTP 401（凭据无效或无权限，请检查 API Key）：invalid credentials");
  const safe = formatProviderError(403, JSON.stringify({ message: "Bearer secret-token api_key=raw-secret" }));
  assert.equal(safe, "供应商返回 HTTP 403（凭据无效或无权限，请检查 API Key）：Bearer [redacted] api_key=[redacted]");
  // 上游细节本身被截断到 PROVIDER_ERROR_MAX_LENGTH(240)，加上状态码与中文提示的前缀，
  // 整条消息的上界约 300，仍然远小于「整页 HTML 原样贴出」的规模。
  assert.ok(formatProviderError(500, "x".repeat(1000)).length <= 300, "the upstream detail must stay truncated");
});
test("binding resolves an exact route first, then the provider prefix", () => {
  const config = { bindings: { "deepseek/deepseek-chat": "relay-a", "openai": "relay-b" } };
  assert.equal(resolveBinding(config, "deepseek/deepseek-chat"), "relay-a");
  assert.equal(resolveBinding(config, "openai/gpt-4o"), "relay-b");
  assert.equal(resolveBinding(config, "deepseek/deepseek-reasoner"), undefined);
  assert.equal(resolveBinding(config, ""), undefined);
  assert.equal(resolveBinding(config, undefined), undefined);
});

// DSH 0.1.5-rc.2 removed the `settingsNamespace()` helper from @deepseek-ai/dsh-settings.
// A plain lowercase-hyphenated string is now passed straight to `settings.register()`, and the
// client card is a keyed slot dispatched by that exact namespace. These assertions pin the
// contract so a future refactor cannot silently reintroduce the removed import.
test("settings namespace satisfies the DSH 0.1.5 contract and matches the package name", async () => {
  assert.equal(SETTINGS_NAMESPACE, "dsh-balance-quota");
  assert.match(SETTINGS_NAMESPACE, /^[a-z][a-z0-9-]*$/);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(SETTINGS_NAMESPACE, manifest.name);
  assert.match(manifest.peerDependencies["@deepseek-ai/dsh-settings"], /^\^0\.1\.5-rc\.2$/);
});
test("host entry never imports the removed settingsNamespace helper", async () => {
  const hostEntry = await readFile(new URL("../lib/host/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(hostEntry, /import\s*\{[^}]*\bsettingsNamespace\b[^}]*\}\s*from/);
});
test("settings card slot is keyed by the settings namespace", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  assert.match(bundle, /name:\s*"settings\.plugin\.item",\s*key:\s*"dsh-balance-quota"\s*\}/);
  assert.match(bundle, /name:\s*"conversation\.composer\.dock",\s*id:\s*"dsh-balance-quota"/);
});

// DSH 0.1.5-rc.2 also dropped the whole `connection.api.<ns>.<method>()` surface. Remote
// namespaces are now standalone cordis services reached through `ctx.get("remote.<ns>")`,
// and every call returns a flattened `{ ok, value } / { ok, error }` result. The old shape
// threw `Cannot read properties of undefined (reading 'llm')` and broke the advanced panel.
test("client bundle talks to Remote namespaces instead of the removed connection.api", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  // Strip line comments so this file's own migration notes cannot satisfy or defeat the guard.
  const code = bundle
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.doesNotMatch(code, /connection\.api/, "client must not dereference connection.api");
  assert.doesNotMatch(code, /\bapi\.llm\b/, "client must not reference the removed api.llm namespace");
  // Every declared Remote namespace the bundle actually reaches must be injected, otherwise
  // cordis never activates the plugin and the panel stays blank.
  const declared = bundle.match(/const inject = \[([^\]]*)\]/)?.[1] ?? "";
  for (const key of ["remote", "remote.llm", "remote.settings"]) {
    assert.ok(declared.includes(`"${key}"`), `client inject must declare ${key}`);
  }
  assert.match(code, /ctx\.get\("remote\.llm"\)/);
  assert.match(code, /ctx\.get\("remote\.settings"\)/);
  // The flattened contract: success reads `.ok` / `.value`, never the nested `.result` envelope.
  assert.match(code, /remoteNamespace\("settings"\)\.mutate\(/);
  assert.match(code, /remoteNamespace\("llm"\)\.listProviders\(\)/);
  assert.match(code, /remoteNamespace\("llm"\)\.listConfigurableProviders\(\)/);
});

// 模型设置是本插件的最高频操作，且读的是 DSH 的 LLM settings 命名空间，与余额 config.json
// 互不相干。历史实现把入口按钮只渲染在「已配置余额」的卡片里，导致必须先走完余额编辑
// 保存才能进模型设置。这里锁住解耦后的契约：模型设置**就地展开在供应商卡片内部**，
// 不经弹窗、不进 Tab；余额编辑退居独立的「余额设置」弹窗。
test("model settings expands inside the provider card without ever requiring a saved balance provider", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  const code = bundle
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  // 1. 卡片不再内联展开余额表单，也不再渲染「编辑」开关。
  assert.doesNotMatch(code, /isCurrentEditing && inlineEditor\(\)/, "cards must not inline the balance editor");
  assert.doesNotMatch(code, /beginEdit\(provider\)/, "cards must not keep the inline edit toggle");
  // 2. 模型设置就地展开在卡片内，而不是独立弹窗。
  assert.doesNotMatch(code, /const modelsModal =/, "model settings must not be its own modal anymore");
  assert.doesNotMatch(code, /advancedTab === "models"/, "the model tab must be gone from the legacy modal");
  assert.match(code, /className:\s*"db-models-inline"/, "the model section must live inline inside the card");
  assert.match(code, /modelsExpanded\s*&&/, "the inline model section must be gated by the expanded flag");
  assert.match(code, /h\(ModelSettingsTab,\s*\{/, "the inline section must render ModelSettingsTab directly");
  // 3. 展开态按 provider id 记录，保证同一时刻只有一张卡片展开、切换卡片不串。
  assert.match(code, /useState\(null\)[\s\S]{0,120}modelsExpandedFor|modelsExpandedFor,\s*setModelsExpandedFor\]\s*=\s*React\.useState\(null\)/);
  assert.match(code, /modelsExpandedFor === provider\.id/, "expansion must be keyed by provider id");
  // 4. 卡片主按钮一步直达，且不依赖余额配置（同一按钮再点即收起）。
  assert.match(code, /db-quiet db-models-open/, "the card must carry the model-settings entry button");
  assert.match(code, /onClick:\s*\(\)\s*=>\s*openModels\(provider\)/);
  assert.match(code, /current === provider\.id \? null : provider\.id/, "re-clicking the same card must collapse it");
  // 5. 余额设置留在独立弹窗，默认就停在余额页；且其顶部已不再有供应商下拉。
  assert.match(code, /useState\("balance"\)/, "the legacy modal must default to the balance tab");
  assert.match(code, /"余额设置"/);
  assert.match(code, /advancedProvider/, "the balance modal must still track its provider");
  assert.doesNotMatch(code, /db-modal-provider/, "the balance modal must no longer render a provider dropdown");
  assert.doesNotMatch(code, /selectAdvancedProvider/, "the provider dropdown handler must be gone");
  assert.doesNotMatch(code, /advancedProviderChoices/, "the now-unused provider choices memo must be gone");
});

// 余额表单很长，操作行（取消/测试/保存）若随内容一起滚走，用户改完靠底的字段后
// 还得再滚回去才能保存。健康监测页早已把页脚放在 .db-modal-content 之外（兄弟节点），
// 天然固定；余额页曾用「内容区内 sticky」的另一种做法，导致两个 tab 的页脚样式不统一。
// 这里锁住统一后的契约：**两页共用同一种页脚**——都渲染 .db-modal-footer，
// 都是内容区的兄弟节点，且按钮尺寸同源。
test("both tabs share one pinned modal footer instead of per-tab hacks", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  const code = bundle
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  // 1. 直接调用处必须恰好两处：余额页一个、健康监测页一个，都产出 .db-modal-footer。
  const footers = code.match(/className:\s*"db-modal-footer"/g) || [];
  assert.equal(footers.length, 2, "both tabs must render .db-modal-footer");
  assert.match(code, /const advancedBalanceFooter =/, "the balance tab must expose its own footer renderer");

  // 2. 余额页的操作行不再留在可滚动的内容区里——也就是说不能再有内联 sticky 的补丁规则。
  assert.doesNotMatch(
    code,
    /\.db-modal-content[^{]*\.db-form-actions\{/,
    "the balance action row must no longer be pinned by a sticky hack inside the scroll container"
  );
  // .db-form-actions 现在只服务卡片内就地展开的模型编辑区，不得再出现在弹窗内容区。
  assert.doesNotMatch(code, /db-form-actions[\s\S]{0,80}?db-balance-form/);

  // 3. 页脚按钮靠 form 属性关联内容区的表单，因此提起后仍能原生提交/回车提交。
  assert.match(code, /id:\s*"db-balance-form"/, "the balance form needs an id for the hoisted footer button");
  assert.match(code, /type:\s*"submit",\s*form:\s*"db-balance-form"/, "the footer save button must target the form via `form`");
  assert.match(code, /type:\s*"submit",\s*form:\s*"db-external-form"/, "the health footer must keep targeting its form the same way");

  // 4. 页脚样式必须同源地钉住按钮尺寸，否则两页仍会出现高度/圆角差异。
  const footerBtn = code.match(/\.db-modal-footer \.db-quiet,\.db-modal-footer \.db-primary\{([^}]*)\}/g) || [];
  assert.ok(footerBtn.length >= 1, "the footer must define shared button sizing");
  const sizing = footerBtn.join(" ");
  assert.match(sizing, /height:36px/, "shared footer buttons must pin their height");
  assert.match(sizing, /border-radius:18px/, "shared footer buttons must pin their radius");

  // 5. 两页页脚必须是同一个元素结构（分隔线 + 固定不滚动），靠 .db-modal-footer 的规则保证。
  const footerRule = code.match(/\.db-modal-footer\{([^}]*)\}/);
  assert.ok(footerRule, "the shared footer rule must exist");
  assert.match(footerRule[1], /flex:none/, "the footer must not be squeezed by the scrolling content");
  assert.match(footerRule[1], /border-top:/, "the footer needs a separator consistent across both tabs");
});

// 页脚只是「两个 tab 长得不一样」里最显眼的一处。这里把**表单外壳**也锁住：
// 余额页独有的 .db-inline-editor 是「余额表单内联在供应商卡片里」时代的残留样式
// （灰底 + 圆角 + 16px 内边距 + 12px 上边距）。搬进弹窗后它会让余额页比健康页
// 多一层灰色垫底、少 32px 可用宽度、顶部说明行缺失。两个外壳现在必须共用同一条规则。
test("both tab shells are identical plain containers with a shared intro row", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  const code = bundle
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  // 1. 两个外壳类必须写在同一条 CSS 规则里，且该规则不得带背景/内边距/圆角/外边距。
  const shell = code.match(/\.db-inline-editor,\.db-external-form\{([^}]*)\}/);
  assert.ok(shell, "the two tab shells must share a single rule so they cannot drift apart");
  const body = shell[1];
  assert.match(body, /background:transparent/, "the shell must not paint a grey card behind the balance form");
  assert.match(body, /padding:0/, "the shell must not inset the balance form (it used to lose 32px of width)");
  assert.match(body, /margin:0/, "the shell must not add a 12px top margin");
  assert.match(body, /border-radius:0/, "the shell must not round a background it no longer has");

  // 2. 旧的内联卡片样式不得复活（灰底 module-platform 只能出现在卡片内联场景）。
  assert.doesNotMatch(
    code,
    /\.db-inline-editor\{[^}]*bg-module-platform/,
    "the balance-only grey card style must stay removed"
  );

  // 3. 两个 tab 都必须有顶部说明行，且都用 .db-models-head（不得靠 inline style 调间距）。
  //    注意 .db-models-head 也被模型设置区复用，所以这里按外壳作用域取，不数全局出现次数。
  const balanceShell = code.match(/className:\s*"db-inline-editor"[\s\S]{0,400}?className:\s*"db-models-head"/);
  const healthShell = code.match(/className:\s*"db-external-form"[\s\S]{0,400}?className:\s*"db-models-head"/);
  assert.ok(balanceShell, "the balance tab must render an intro row right after its shell opens");
  assert.ok(healthShell, "the health tab must render an intro row right after its shell opens");
  assert.doesNotMatch(
    code,
    /className:\s*"db-models-head",\s*style:/,
    "the intro row must not be nudged with an inline style on only one tab"
  );

  // 4. 两个 tab 的第一行都应是「启用…监测」开关，结构对称。
  assert.match(code, /"开启余额监测"/);
  assert.match(code, /"启用健康监测"/);
});

// 用户报告：「点保存这些都会消失，报 invalid provider identity」。
// 根因是**未纳入余额配置**的供应商进「余额设置」时，表单预载的是 blankForm，
// 而 blankForm.id 是空串 → Host 的 validateProvider 拒绝保存。
// 这类供应商现在必须拿到一份带身份的可保存草稿。
test("unconfigured providers get a saveable draft instead of a blank form", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  const code = bundle
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  // 取出 initAdvancedBalanceForm 的函数体做定点断言，避免全文匹配误伤。
  const start = code.indexOf("const initAdvancedBalanceForm =");
  assert.ok(start > -1, "initAdvancedBalanceForm must exist");
  const body = code.slice(start, start + 1800);

  // 未配置分支必须补齐 id / name / credentialRef，而不是直接 setForm(blankForm)。
  assert.match(body, /id:\s*route/, "the draft must carry a real provider id or the host rejects it");
  assert.match(body, /name:\s*mp\?\.name\s*\|\|\s*provider\.name\s*\|\|\s*route/, "the draft must fall back to the model-page display name");
  assert.match(body, /credentialRef:\s*mp\?\.credentialRef\s*\|\|\s*""/, "the draft must reuse the model-page credential so no re-typing is needed");
  assert.match(body, /setEditing\(route\)/, "editing must be keyed to the same id the draft uses");

  // 「provider 为空」才是唯一允许回落到 blankForm 的路径。
  const blankFallbacks = body.match(/setForm\(blankForm\)/g) || [];
  assert.equal(blankFallbacks.length, 1, "blankForm may only be used when there is no provider context at all");

  // 提交前必须有本地校验，把可判断的问题用中文说清楚。
  assert.match(code, /const validateBalanceDraft =/, "a local pre-submit validator must exist");
  const validator = code.slice(code.indexOf("const validateBalanceDraft ="), code.indexOf("const validateBalanceDraft =") + 900);
  assert.match(validator, /缺少供应商标识/, "the validator must explain a missing identity in Chinese");
  assert.match(validator, /请填写显示名称/, "the validator must explain a missing name in Chinese");
  assert.match(validator, /请填写余额查询地址/, "the validator must explain a missing endpoint in Chinese");
});

// 用户报告第二半：「点击取消也没反应」。取消按钮只重置了表单却没关闭弹窗。
// 现在所有关闭入口都必须收敛到 closeAdvanced()。
test("every modal close path goes through closeAdvanced so cancel actually closes", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  const code = bundle
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  assert.match(code, /const closeAdvanced = \(\) =>/, "closeAdvanced must be the single close entry");

  const closeBody = code.slice(code.indexOf("const closeAdvanced = () =>"), code.indexOf("const closeAdvanced = () =>") + 700);
  // 必须真的关弹窗，并且把两页草稿与残留提示都清干净。
  assert.match(closeBody, /setAdvancedOpen\(false\)/, "closeAdvanced must actually close the modal (cancel used to only reset the form)");
  assert.match(closeBody, /setTestResult\(null\)/, "closeAdvanced must clear the balance test result or it leaks into the next open");
  assert.match(closeBody, /setExternalSaveMessage\(""\)/, "closeAdvanced must clear the health save message too");

  // 旧的裸调用不得复活：背景点击 / × 按钮 / 取消 都必须走 closeAdvanced。
  assert.doesNotMatch(
    code,
    /onClick:\s*\(\)\s*=>\s*setAdvancedOpen\(false\)/,
    "close buttons must not bypass closeAdvanced"
  );
  assert.doesNotMatch(
    code,
    /event\.target === event\.currentTarget\)\s*setAdvancedOpen\(false\)/,
    "the backdrop must not bypass closeAdvanced"
  );
  assert.match(code, /if \(event\.target === event\.currentTarget\) closeAdvanced\(\)/, "the backdrop must route through closeAdvanced");
  assert.match(code, /onClick: closeAdvanced, "aria-label": "关闭余额设置"/, "the × button must route through closeAdvanced");

  // 打开时也要对称重置：只清健康页、不清余额页，会让旧红字跟到下一次打开。
  const openBody = code.slice(code.indexOf("const openAdvanced ="), code.indexOf("const openAdvanced =") + 2200);
  assert.match(openBody, /setTestResult\(null\)/, "openAdvanced must clear the balance test result on open");
  assert.match(openBody, /setExternalTestState\("idle"\)/, "openAdvanced must keep clearing the health test state");
});

// The original guard matched address text with string prefixes, so any spelling the prefixes
// did not anticipate was treated as public. IPv4-mapped IPv6 was the worst case: the kernel
// routes `::ffff:127.0.0.1` to loopback, but the text starts with `::` and was let through.
test("blocks every non-public address spelling, including IPv4-mapped IPv6", () => {
  const blocked = [
    "0.0.0.0", "10.0.0.1", "10.255.255.255", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.1", "100.64.0.1",
    "198.18.0.1", "198.51.100.5", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    "::", "::1", "0:0:0:0:0:0:0:1", "fe80::1", "FE80::1", "fc00::1", "FC00::1",
    "fd12:3456::1", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:192.168.1.1", "::ffff:169.254.169.254",
    "64:ff9b::127.0.0.1", "2002:7f00:1::",
  ];
  for (const ip of blocked) assert.equal(privateIp(ip), true, `${ip} must be blocked`);
  // Anything unparseable is refused rather than assumed public.
  for (const ip of ["", "not-an-ip", "300.0.0.1", "1.2.3", "::gggg", undefined, null]) {
    assert.equal(privateIp(ip), true, `${String(ip)} must be blocked`);
  }
});
test("still allows ordinary public addresses", () => {
  const allowed = [
    "8.8.8.8", "1.1.1.1", "104.20.23.154", "172.66.147.243",
    "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.63.0.1", "100.128.0.1",
    "2001:4860:4860::8888", "2606:4700::1111",
  ];
  for (const ip of allowed) assert.equal(privateIp(ip), false, `${ip} must be allowed`);
});
test("rejects IPv4-mapped and expanded loopback endpoints end to end", async () => {
  await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint: "https://[::ffff:127.0.0.1]/x", responsePath: "$.balance" }), /仅允许公网地址/);
  await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint: "https://[0:0:0:0:0:0:0:1]/x", responsePath: "$.balance" }), /仅允许公网地址/);
  await assert.rejects(() => validateProvider({ id: "a", name: "a", endpoint: "https://[::1]/x", responsePath: "$.balance" }), /仅允许公网地址/);
});

test("bounded cache evicts oldest entries and never duplicates a re-set key", () => {
  const cache = new BoundedCache(3);
  cache.set("a", 1).set("b", 2).set("c", 3);
  assert.deepEqual([...cache.keys()], ["a", "b", "c"]);
  cache.set("d", 4);
  assert.deepEqual([...cache.keys()], ["b", "c", "d"], "oldest entry is evicted");
  assert.equal(cache.get("a"), undefined);
  // Re-setting a live key refreshes it without consuming an extra slot.
  cache.set("b", 20);
  assert.deepEqual([...cache.keys()], ["c", "d", "b"]);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("b"), 20);
  // A pathological insert loop cannot grow the map past the ceiling.
  for (let index = 0; index < 500; index += 1) cache.set(`k${index}`, index);
  assert.equal(cache.size, 3);
});
test("host response caches are bounded", async () => {
  const { cache } = await import("../lib/host/query.js");
  const { externalStatusCache } = await import("../lib/host/external-status.js");
  assert.ok(cache instanceof BoundedCache, "provider balance cache must be bounded");
  assert.ok(externalStatusCache instanceof BoundedCache, "external status cache must be bounded");
});

// 用户报告：「在余额设置里点击保存，对应供应商就会跑到最下面」。
// 根因是 Host 保存 provider 时的 upsert 写成了「先滤掉旧的、再追加到末尾」，
// 于是编辑任意一项都会把它挪到列表末位（卡片顺序直接来自 config.providers）。
// 保存已有供应商必须**保持原位**，只有新增才追加。
test("saving an existing provider preserves its list position", async () => {
  const source = await readFile(new URL("../lib/host/routes.js", import.meta.url), "utf8");

  // 旧的「过滤后追加」写法不得复活——它就是顺序被破坏的原因。
  assert.doesNotMatch(
    source,
    /current\.providers\s*=\s*\[\s*\.\.\.current\.providers\.filter/,
    "the provider upsert must not filter-then-append, which moves edited providers to the end"
  );

  // 必须按 id 定位后原位替换，且仅在找不到时才追加。
  assert.match(source, /const index = current\.providers\.findIndex\(p => p\.id === provider\.id\)/);
  assert.match(source, /index === -1/, "a missing provider must be the only append path");
  assert.match(
    source,
    /current\.providers\.map\(p => \(p\.id === provider\.id \? provider : p\)\)/,
    "an existing provider must be replaced in place to keep its position"
  );
});



// upsert 保序是一个**通用约束**，不是 providers 一处的特例：
// 客户端保存供应商、客户端保存监测源、Host 保存供应商、Host 保存监测源，
// 四处都可能写成「先滤掉旧的、再追加到末尾」，从而让被编辑的卡片跳到列表最后。
// 这里一次性锁住全部四处。
test("no upsert in the codebase reorders entries by filter-then-append", async () => {
  const targets = [
    ["../lib/client/client.js", await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8")],
    ["../lib/host/routes.js", await readFile(new URL("../lib/host/routes.js", import.meta.url), "utf8")],
  ];

  for (const [name, source] of targets) {
    // 形如 [...xxx.filter(x => x.id !== y), y] 的写法一律不允许。
    const offenders = source.match(/\.\.\.[^\n]{0,120}?\.filter\([^\n]{0,120}?\)\s*,\s*[A-Za-z_$][\w$]*\]/g) || [];
    assert.deepEqual(
      offenders,
      [],
      `${name} must not build a list by filtering-then-appending, which moves an edited entry to the end`
    );
  }

  // 两处 upsert 都必须走「先找位置」的分支。
  const routes = targets[1][1];
  assert.match(routes, /const index = current\.providers\.findIndex\(p => p\.id === provider\.id\)/, "host provider upsert must locate the existing entry first");
  assert.match(routes, /current\.providers\.map\(p => \(p\.id === provider\.id \? provider : p\)\)/, "host provider upsert must replace in place");
  assert.match(routes, /const carried = item =>/, "host source upsert must locate the existing entry first");
  assert.match(routes, /sources\.map\(item => \(carried\(item\) \? source : item\)\)/, "host source upsert must replace in place");

  const client = targets[0][1];
  assert.match(client, /const existingIndex = config\.providers\.findIndex/, "client provider upsert must locate the existing entry first");
  assert.match(client, /config\.providers\.map\(item => \(item\.id === data\.provider\.id \? saved : item\)\)/, "client provider upsert must replace in place");
  assert.match(client, /const carriedSource = item =>/, "client source upsert must locate the existing entry first");
  assert.match(client, /savedSources\.map\(item => \(carriedSource\(item\) \? data\.source : item\)\)/, "client source upsert must replace in place");
});

// 用户报告：余额/健康查询失败时，卡片上直接贴出上游返回的整页 HTML
//（`供应商返回 HTTP 404：<!doctype html><html lang="en"><head><title>…`），
// 一大片红色标签既读不出关键信息，又把卡片撑得很高。
// 上游返回 HTML 时必须只保留可读摘要（title/标题 + 响应体大小）。
test("upstream HTML error pages are summarized instead of dumped raw", () => {
  const html = '<!doctype html><html lang="en"><head><title>Example Domain</title>'
    + '<style>body{background:#eee}</style></head><body><h1>Example Domain</h1></body></html>';

  // 用户反馈：状态码 + 中文提示已说明问题，「返回了 HTML 页面「Example Domain」（559 B）」
  // 这类细节是噪音。常见状态码（有提示）的消息必须**止步于提示本身**；
  // 只有无提示的少见状态码才补页面标题当线索。
  const hinted = formatProviderError(404, html);

  // 1. 不得残留任何 HTML 标签或样式片段——这正是用户看到的「一片红标签」。
  assert.doesNotMatch(hinted, /[<>]/, "no angle brackets may survive into the user-facing error");
  assert.doesNotMatch(hinted, /doctype|<style|background:#eee|font-family/i, "raw markup and CSS must be stripped");

  // 2. 有提示的状态码：消息止步于状态码 + 提示，HTML 细节一概不出现。
  assert.match(hinted, /HTTP 404/, "the status code must stay visible");
  assert.match(hinted, /核对余额查询地址/, "404 must explain what to check");
  assert.doesNotMatch(hinted, /Example Domain/, "the page title is noise next to a status hint");
  assert.doesNotMatch(hinted, /返回了 HTML/, "the fact that it was HTML is noise too");
  assert.ok(hinted.length <= 60, `a hinted status must yield a short line, got: ${hinted}`);

  // 3. 无提示的少见状态码：补充页面标题作为唯一线索，且带大小。
  const unhinted = formatProviderError(418, html);
  assert.match(unhinted, /Example Domain/, "without a hint the page title is the only clue");
  assert.match(unhinted, /\d+(?:\.\d+)?\s?(?:B|KB)/, "the body size hints at what came back");
  assert.doesNotMatch(unhinted, /[<>]/, "no raw markup even in the unhinted path");

  // 4. 其余状态码提示仍在。
  assert.match(formatProviderError(401, ""), /检查 API Key/, "401 must point at the credential");
  assert.match(formatProviderError(429, ""), /稍后重试/, "429 must suggest retrying later");
  assert.match(formatProviderError(502, ""), /上游服务异常/, "5xx must be labelled as an upstream fault");

  // 5. 长度必须受控：历史缺陷是整页 HTML 撑出十几行红字。
  const long = "<html><title>" + "x".repeat(5000) + "</title></html>";
  assert.ok(formatProviderError(500, long).length <= 400, "even a huge page must collapse to a short line");

  // 6. 非 HTML 的路径不能被破坏：JSON 里的错误信息仍要原样透出（脱敏后）。
  const fromJson = formatProviderError(401, JSON.stringify({ error: { message: "invalid api key" } }));
  assert.match(fromJson, /invalid api key/, "JSON error messages must still surface");
  assert.match(formatProviderError(502, "upstream connect error"), /upstream connect error/);

  // 7. 脱敏规则对摘要路径同样生效：摘要函数自身就要负责脱敏，
  //    否则任何直接调用它的地方都可能把 title 里的凭据漏出去。
  const leaked = summarizeHtmlBody("<title>" + "Authorization: Bearer sk-abc123" + "</title>");
  assert.ok(!leaked.includes("sk-abc123"), "the summary path must not bypass redaction");
});

// summarizeHtmlBody 的边界：无 title 时回落到 h1，再没有就只说「HTML 页面」。
test("HTML summary degrades gracefully without a title", () => {
  assert.match(summarizeHtmlBody("<html><body><h1>Access Denied</h1></body></html>"), /Access Denied/);
  assert.match(summarizeHtmlBody("<html><body>plain</body></html>"), /返回了 HTML 页面/);
  assert.match(summarizeHtmlBody(""), /返回了 HTML 页面/);
});

// 修 HTML 摘要时用「title 里带 Bearer 密钥」自测，意外暴露两个真实缺陷，各锁一条：
//
// 缺陷 1（展示错误）：凭据正则用的字符类 [^\s,;]+ 的补集**包含中文标点与数字**，
//   于是 `Bearer sk-abcXYZ」（37 B）` 被当成一个 token 整体替换，
//   脱敏后残留 `Bearer [redacted] B）` —— 右括号和体积数字一起没了。
//   修复：token 边界显式排除 CJK 标点、全角字符与引号括号。
//
// 缺陷 2（安全）：标签正则只认 `api_key=` 这类下划线写法，
//   漏掉 `API key: …`（空格分隔，上游报错里最常见）与 `apiKey=…`（驼峰）。
//   更严重的是「无标签裸密钥」`Invalid key: sk-live-xxxx` 完全没有兜底，会原样泄露。
test("redaction boundaries do not eat surrounding text and cover every credential form", () => {
  // --- 缺陷 1：脱敏不得吞掉紧随其后的中文标点与体积标签 ---
  const summary = summarizeHtmlBody(
    "<html><head><title>Denied for Authorization: Bearer sk-abc123XYZ</title></head><body>y</body></html>"
  );
  assert.ok(!summary.includes("sk-abc123XYZ"), "the secret must be gone");
  assert.match(summary, /Bearer \[redacted\]」/, "the closing CJK bracket must survive redaction");
  assert.match(summary, /「[^」]*」（\d+ B）$/, "the size label must stay intact and well-formed");

  // --- 缺陷 2：三种标签写法 + 无标签裸密钥都必须覆盖 ---
  assert.ok(!sanitizeProviderError("Invalid API key: sk-secret").includes("sk-secret"), "space-separated label must redact");
  assert.ok(!sanitizeProviderError("apiKey=sk-camel-123").includes("sk-camel-123"), "camelCase label must redact");
  assert.ok(!sanitizeProviderError("api_key=sk-live-9999").includes("sk-live-9999"), "underscore label must redact");
  assert.ok(!sanitizeProviderError("token: abc.def").includes("abc.def"), "token label must redact");
  assert.ok(!sanitizeProviderError("Invalid key: sk-live-abcdef123").includes("sk-live-abcdef123"), "a bare sk- key must redact even with no label");
  assert.ok(!sanitizeProviderError("upstream said pk-test-998877").includes("pk-test-998877"), "a bare pk- key must redact too");

  // --- 不得过度脱敏：普通数字与百分号必须原样保留 ---
  assert.match(sanitizeProviderError("quota used: 37 %, retry later"), /37 %/, "normal numbers must not be swallowed");
});
// 用户反馈：「点引入新供应商不应该直接增加一个卡片吗」。历史行为是引入菜单项
// 只把草稿装进表单（setEditing），用户还得再手工保存——多一步、不符合直觉。
// 现行为：引入菜单项 = 用自动填充草稿直接 persistDraft 出卡片；仅「自定义接入」
//（无可自动填充的信息）与「直接保存失败」时才回落到表单编辑态。
test("importing a provider adds a card directly instead of opening a form", async () => {
  const code = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  const stripped = code
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  // 1. 必须存在「草稿直接持久化」的通道，且引入路径全部经由它。
  assert.match(stripped, /const persistDraft = async \(d, successMessage\)/, "a direct-persist channel must exist");
  assert.match(stripped, /const importDirectly = async \(draft\)/, "an import helper must exist");
  const importCalls = stripped.match(/importDirectly\(\{/g) || [];
  assert.ok(importCalls.length >= 3, "beginAdd(source) / beginPreset / beginNeco must all persist directly");

  // 2. 引入路径不得再把用户领进表单：begin* 函数体内不得出现 setEditing。
  const beginAddBody = stripped.match(/const beginAdd = \(source\) => \{([\s\S]*?)\n        \};/);
  assert.ok(beginAddBody, "beginAdd must exist");
  // beginAdd 的自定义接入分支（beginAdd(null)）合法地走 setEditing("__new") 表单路径，
  // 因此这里只禁止「带 source 的引入」进编辑态：体内必须直接持久化，
  // 且 setEditing 只允许出现在 `!source` 的自定义分支里、目标只能是 "__new"。
  assert.match(beginAddBody[1], /importDirectly\(\{/, "importing with a source must persist directly");
  const beginAddEditing = beginAddBody[1].match(/setEditing\([^)]*\)/g) || [];
  for (const call of beginAddEditing) {
    assert.match(call, /^setEditing\("__new"\)$/, `only the custom (no-source) branch may enter the form, got: ${call}`);
  }
  const beginPresetBody = stripped.match(/const beginPreset = \(source, preset = "deepseek"\) => \{([\s\S]*?)\n        \};/);
  assert.ok(beginPresetBody, "beginPreset must exist");
  assert.doesNotMatch(beginPresetBody[1], /setEditing\(/, "preset import must not enter the editing form");
  const beginNecoBody = stripped.match(/const beginNeco = \(source\) => \{([\s\S]*?)\n        \};/);
  assert.ok(beginNecoBody, "beginNeco must exist");
  assert.doesNotMatch(beginNecoBody[1], /setEditing\(/, "neco import must not enter the editing form");

  // 3. 两个合法的表单回落必须保留：自定义接入（无信息可填）与直接保存失败。
  assert.match(beginAddBody[1], /if \(!source\)/, "custom import must still open the form");
  const importDirectlyBody = stripped.match(/const importDirectly = async \(draft\) => \{([\s\S]*?)\n        \};/);
  assert.ok(importDirectlyBody, "importDirectly must exist");
  assert.match(importDirectlyBody[1], /setForm\(draft\)/, "a failed direct import must fall back to the editing form");
  assert.match(importDirectlyBody[1], /setEditing\(/, "the fallback must enter the editing state");
});
// Host 抛出的 HttpError 文案会**原样透传到供应商卡片与弹窗页脚**，
// 因此必须是可读中文。历史实现散落着 `credential is missing in DSH credentials`、
// `provider response too large`、`balance response does not contain a numeric value`
// 等英文句子，用户直接在界面上看到英文。
// 这里做枚举式约束：宿主层每个 `new HttpError(<code>, "…")` 的字面量消息
// 都不允许是「以小写字母开头的纯英文句子」。
// 例外：`formatProviderError(...)` 这类函数调用（它内部已产出中文）不算字面量。
test("every host-side user-facing error message is localized", async () => {
  const hostDir = new URL("../lib/host/", import.meta.url);
  const files = ["net.js", "query.js", "routes.js", "config-store.js", "external-status.js", "validate.js"];
  const offenders = [];
  for (const name of files) {
    const code = await readFile(new URL(name, hostDir), "utf8");
    const stripped = code
      .split(/\r?\n/)
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // 只匹配字面量字符串消息；函数调用（含括号）不在此模式内。
    const re = /new HttpError\(\s*\d+\s*,\s*"([^"\\]*)"/g;
    let m;
    while ((m = re.exec(stripped))) {
      const msg = m[1];
      const isAsciiSentence = /^[a-z][a-z0-9 ,.'\-]*$/i.test(msg);
      const hasCjk = /[\u4e00-\u9fff]/.test(msg);
      if (isAsciiSentence && !hasCjk) offenders.push(`${name}: ${msg}`);
    }
  }
  assert.deepEqual(offenders, [], `host-side error text must be Chinese, found English: ${offenders.join(" | ")}`);
});
// 上一轮只修了卡片（balanceMeta）与状态栏，漏了**弹窗页脚**的测试结果行
// （截图里的 `测试失败：供应商返回 HTTP 404：<!doctype html>…`）。
// 三处都是「把 testResult.error / selected.error 直接放进 JSX」，
// 所以这里做的是**覆盖面**断言：所有把错误塞进用户可见元素的地方，
// 都必须经过收敛后的文案，且样式必须限高。
test("every user-facing error surface is bounded and constrained", async () => {
  const bundle = await readFile(new URL("../lib/client/client.js", import.meta.url), "utf8");
  const code = bundle
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  // 1. 卡片错误行：必须独占整行、可换行、限高。
  const metaErr = code.match(/\.db-meta-error\{([^}]*)\}/);
  assert.ok(metaErr, "the card error style must exist");
  assert.match(metaErr[1], /flex:1 1 100%/, "the card error must take its own row instead of squeezing between buttons");
  assert.match(metaErr[1], /min-width:0/, "without min-width:0 a flex child refuses to wrap");
  assert.match(metaErr[1], /overflow-wrap:anywhere/, "long unbroken bodies must be allowed to break");
  assert.match(metaErr[1], /-webkit-line-clamp:\d/, "the card error must be clamped to a few lines");

  // 2. 弹窗页脚错误行：必须限高 + 可滚动 + 可断词（截图就是这里溢出成一片 HTML）。
  const saveMsg = code.match(/\.db-save-message\{([^}]*)\}/);
  assert.ok(saveMsg, "the modal footer message style must exist");
  assert.match(saveMsg[1], /max-height:\d+px/, "the footer message must be capped so a long body cannot bloat the footer");
  assert.match(saveMsg[1], /overflow-y:auto/, "an over-long footer message must scroll instead of stretching the modal");
  assert.match(saveMsg[1], /overflow-wrap:anywhere/, "the footer message must break long unbroken text");

  // 3. 状态栏错误：窄容器里必须能收缩省略，否则长报错会撑破 dock。
  const dockValue = code.match(/\.dsh-balance-value\{([^}]*)\}/);
  assert.ok(dockValue, "the status bar value style must exist");
  assert.doesNotMatch(dockValue[1], /flex:none/, "the status bar value must be shrinkable, not fixed-width");
  assert.match(dockValue[1], /text-overflow:ellipsis/, "the status bar must ellipsize rather than overflow");

  // 4. 三个展示点都要把完整文本挂到 title，限高后信息仍可取回。
  assert.match(code, /title: s\.error \|\| "查询失败"/, "the card error must expose the full text via title");
  assert.match(code, /errorSpan\.title = selected\.error/, "the status bar error must expose the full text via title");

  // 5. 前端不得自行拼接上游响应体：错误文案只能来自 Host 已收敛的 message。
  assert.doesNotMatch(
    code,
    /textContent\s*=\s*(?:selected\.\w+|testResult\.error|data\.\w+)\.(?:text|body)\b/,
    "the client must not render a raw upstream response body"
  );
});
