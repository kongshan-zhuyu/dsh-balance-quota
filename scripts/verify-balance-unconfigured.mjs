// 功能性回归脚本（针对用户报告的真实缺陷场景）：
// 「未配置余额的供应商 → 打开余额设置 → 点保存」过去直接撞 Host 的
// "invalid provider identity"，因为表单预载的是 blankForm（id 为空串）。
//
// 本脚本专门挑一张**未配置余额**的供应商卡片（卡片上没有「已绑定」标记，
// 或页面上没有该供应商的余额配置）走完整流程，断言：
//   A. 表单已带上可保存的完整草稿（id/name 非空，且 name 来自模型页）
//   B. 直接点「测试」不会出现英文本地化缺失的报错，而是中文指引或真实请求结果
//   C. 补齐合法地址后点「保存」成功关闭弹窗，且不出现 invalid provider identity
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-balance-unconfigured.mjs <url-with-token>");

const probe = ["chromium-1217/chrome-win64/chrome.exe", "chromium-1148/chrome-win/chrome.exe"]
  .map((rel) => join(homedir(), "AppData", "Local", "ms-playwright", rel))
  .find((candidate) => existsSync(candidate));

const browser = await chromium.launch({ executablePath: probe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const out = { steps: {}, phases: {} };

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.getByText("设置", { exact: true }).last().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator("button").filter({ hasText: /^插件$/ }).last().click();
await page.waitForTimeout(3500);
await page.locator("button,div,section").filter({ hasText: /^供应商状态/ }).last().click().catch(() => {});
await page.waitForTimeout(4500);

const modalOpen = () => page.locator('.db-modal[aria-label="余额设置"]').count();

// 先把 Host 侧已有的余额配置 id 全部读出来，才能确定哪张卡片是「未配置」的。
const configuredIds = await page.evaluate(async () => {
  try {
    const r = await fetch("/api/balance/config", { credentials: "include" });
    const j = await r.json();
    return (j.providers || []).map((p) => p.id);
  } catch { return []; }
});
out.steps.configuredIds = configuredIds;

const cards = page.locator(".db-provider-card");
const cardCount = await cards.count();
out.steps.cardCount = cardCount;

// 挑选目标卡片。必须挑**非 preset** 的供应商，否则：
//   1) preset 不渲染 endpoint / API Key 字段，按位置取 inputs[1] 会串到「刷新间隔」，
//      读到 "30" 这种假数据；
//   2) 凭据校验对 preset 有豁免（preset 自带官方接口与凭据约定），
//      校验分支根本不会执行 → 断言等于没测。
// 因此只接受非 preset 的候选，并记录选中的是谁。
const presetIds = ["deepseek", "opencode-go"];
let targetLabel = null;
let targetId = null;
let targetIsPreset = null;
let skipped = [];
for (let i = 0; i < cardCount; i += 1) {
  const card = cards.nth(i);
  const btn = card.getByText("余额设置", { exact: true }).first();
  if (!(await btn.count())) continue;
  const label = (await card.locator(".db-provider-name").first().innerText().catch(() => "")).trim();
  const guessedId = (await card.getAttribute("data-provider-id")) || label;
  if (configuredIds.includes(guessedId)) { skipped.push(`${guessedId}:configured`); continue; }
  if (presetIds.includes(guessedId)) { skipped.push(`${guessedId}:preset`); continue; }
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (await modalOpen()) { targetLabel = label; targetId = guessedId; targetIsPreset = false; break; }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
}

out.steps.cardCount = cardCount;
out.steps.skipped = skipped;
out.steps.targetProvider = targetLabel;
out.steps.targetIsPreset = targetIsPreset;
out.steps.targetLooksUnconfigured = Boolean(targetLabel) && !configuredIds.includes(targetId);
await page.screenshot({ path: "browser-screenshots/unconf-01-open.png" });

// 注意：id / credentialRef 只活在 React state 里，不会渲染成 DOM 字段，
// 所以**不能**用 input[type=hidden] 去读（历史版本这么写过，拿到空数组，
// 断言永远为真 = 假绿）。这里改读「由 state 派生出的可见信号」：
//   - credentialRef 非空 → 渲染「将复用模型页凭据：…」提示行，且**不**渲染 API Key 输入框
//   - id 非空 → 保存能过 Host 的 isId 校验（由 C 阶段结果间接证明）
const readDraft = () => page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  if (!m) return null;
  const inputs = Array.from(m.querySelectorAll('.db-form input:not([type=checkbox])'));
  const reuseLine = Array.from(m.querySelectorAll(".db-message"))
    .map((p) => p.innerText.trim())
    .find((t) => t.startsWith("将复用模型页凭据")) || "";
  return {
    // 按 id 取字段，避免 preset / 非 preset 之间输入框数量不同导致串位。
    name: m.querySelector("#db-name")?.value ?? null,
    endpoint: m.querySelector("#db-endpoint")?.value ?? null,
    // credentialRef 的可见代理信号：提示行存在 ⇔ form.credentialRef 非空。
    reusesModelCredential: Boolean(reuseLine),
    reuseLine,
    hasApiKeyInput: Boolean(m.querySelector("#db-apiKey")),
    footerButtons: Array.from(m.querySelectorAll(".db-modal-footer button")).map((b) => b.innerText.trim())
  };
});

out.phases.A_prefilledDraft = await readDraft();

// —— B. 直接点「测试」：过去这里会抛 invalid provider identity ——
const testBtn = page.locator('.db-modal[aria-label="余额设置"] .db-modal-footer button').filter({ hasText: /^测试$/ }).first();
out.steps.testClicked = await testBtn.click({ timeout: 8000 }).then(() => "ok", (e) => e.message.split("\n")[0]);
await page.waitForTimeout(6000);
out.phases.B_testWithCredentialOnly = await page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  const msg = m?.querySelector(".db-save-message")?.innerText.trim() || "";
  return {
    footerMessage: msg,
    mentionsEnglishIdentityError: /invalid provider identity/i.test(msg),
    // 地址为空时必须被本地校验拦住，且是中文指引。
    isChineseGuidance: /请填写|缺少/.test(msg),
    // 这次复用到了模型页凭据（OPENCODE_GO_API_KEY 一类），所以不该再报凭证缺失。
    mentionsMissingCredential: /credential is missing/i.test(msg)
  };
});
await page.screenshot({ path: "browser-screenshots/unconf-02-test.png" });

// —— C. 补齐合法地址后保存：必须成功关闭，且不得出现 invalid provider identity ——
// 注意：先确保地址与名称已填，**保留** credentialRef（这条路径验证「仅补地址即可保存」）。
await page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const name = m.querySelector("#db-name");
  const endpoint = m.querySelector("#db-endpoint");
  if (name && !name.value) setVal(name, "unconf-flow-provider");
  if (endpoint) setVal(endpoint, "https://example.com/usage");
});
await page.waitForTimeout(900);

const saveBtn = page.locator('.db-modal[aria-label="余额设置"] .db-modal-footer button').filter({ hasText: /^保存$/ }).first();
out.steps.saveClicked = await saveBtn.click({ timeout: 8000 }).then(() => "ok", (e) => e.message.split("\n")[0]);
await page.waitForTimeout(4000);
out.phases.C_saveResult = await page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  const pageMsg = document.querySelector(".db-message");
  const allText = document.body.innerText;
  return {
    modalStillOpen: Boolean(m),
    footerMessage: m ? (m.querySelector(".db-save-message")?.innerText.trim() || "") : "",
    pageMessage: pageMsg ? pageMsg.innerText.trim() : "",
    mentionsEnglishIdentityError: /invalid provider identity/i.test(allText)
  };
});
await page.screenshot({ path: "browser-screenshots/unconf-03-after-save.png" });

// —— D. 取消路径复查（用户报告的第二个症状）——
const reopenBtn = page.locator(".db-provider-card").filter({ hasText: targetLabel || "" }).first()
  .getByText("余额设置", { exact: true }).first();
await reopenBtn.click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2500);
const openedAgain = (await modalOpen()) > 0;

// 打开后再次确认：不得残留上一轮的红字，且表单是干净草稿。
out.phases.D_reopenState = await page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  if (!m) return null;
  return {
    footerMessages: Array.from(m.querySelectorAll(".db-save-message")).map((p) => p.innerText.trim()).filter(Boolean),
    name: m.querySelector("#db-name")?.value ?? null
  };
});

const cancelBtn = page.locator('.db-modal[aria-label="余额设置"] .db-modal-footer button').filter({ hasText: /^取消$/ }).first();
out.steps.cancelClicked = await cancelBtn.click({ timeout: 8000 }).then(() => "ok", (e) => e.message.split("\n")[0]);
await page.waitForTimeout(1800);
out.phases.D_cancel = { openedAgain, closedAfterCancel: (await modalOpen()) === 0 };
await page.screenshot({ path: "browser-screenshots/unconf-04-after-cancel.png" });

// —— E. 裸路径：无凭据、无 credentialRef 时，Host 会返回什么 ——
// 目的是证明「未本地化的英文报错」确实源自后端，前端护栏是唯一防线：
// 若这里拿到 credential is missing，就说明前端 validateBalanceDraft 必须拦住它，
// 否则用户又会看到一句看不懂的英文。
out.phases.E_hostRawError = await page.evaluate(async () => {
  try {
    const r = await fetch("/dsh-balance-quota/provider/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        id: "guard-probe", name: "guard-probe", endpoint: "https://example.com/usage",
        method: "GET", responsePath: "$.remaining", currency: "USD"
      })
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, message: j.error || j.result?.error || "" };
  } catch (e) { return { status: 0, message: String(e.message || e) }; }
});

await browser.close();
out.consoleErrors = consoleErrors.slice(0, 10);
console.log(JSON.stringify(out, null, 2));
