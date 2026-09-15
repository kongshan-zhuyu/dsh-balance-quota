// 功能性回归脚本：复现用户报告的「点保存报 invalid provider identity + 点取消没反应」。
// 场景：对**未配置余额**的供应商（如 vulcanapi-gm-01）打开「余额设置」弹窗，
//   A. 校验表单已被预载（有 id/name/credentialRef，而非空白 blankForm）
//   B. 点「取消」必须真的关闭弹窗
//   C. 关闭后再次打开，不得残留上一次的测试结果/草稿
//   D. 对已有配置的供应商，点「保存」应成功并关闭弹窗（有配置则校验，无则跳过）
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-balance-flow.mjs <url-with-token>");

const probe = ["chromium-1217/chrome-win64/chrome.exe", "chromium-1148/chrome-win/chrome.exe"]
  .map((rel) => join(homedir(), "AppData", "Local", "ms-playwright", rel))
  .find((candidate) => existsSync(candidate));

const browser = await chromium.launch({ executablePath: probe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const out = { steps: {} };

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.getByText("设置", { exact: true }).last().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator("button").filter({ hasText: /^插件$/ }).last().click();
await page.waitForTimeout(3500);
await page.locator("button,div,section").filter({ hasText: /^供应商状态/ }).last().click().catch(() => {});
await page.waitForTimeout(4500);

const modalOpen = () => page.locator('.db-modal[aria-label="余额设置"]').count();
const readForm = () => page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  if (!m) return null;
  const val = (sel) => m.querySelector(sel)?.value ?? null;
  // 表单里的 input 顺序：显示名称、余额查询地址、…
  const inputs = Array.from(m.querySelectorAll('.db-form input:not([type=checkbox])'));
  return {
    name: inputs[0]?.value ?? null,
    endpoint: inputs[1]?.value ?? null,
    placeholderOfEndpoint: inputs[1]?.placeholder ?? null
  };
});

// —— A. 找一张「有余额设置按钮」的卡片，逐个尝试直到弹窗打开 ——
let targetLabel = null;
const cardCount = await page.locator(".db-provider-card").count();
out.steps.cardCount = cardCount;

for (let i = 0; i < Math.min(cardCount, 8); i += 1) {
  const card = page.locator(".db-provider-card").nth(i);
  const label = await card.locator(".db-provider-name").first().innerText().catch(() => "");
  const btn = card.getByText("余额设置", { exact: true }).first();
  if (!(await btn.count())) continue;
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (await modalOpen()) { targetLabel = label.trim(); break; }
}
out.steps.targetProvider = targetLabel;
out.formOnOpen = await readForm();
await page.screenshot({ path: "browser-screenshots/flow-01-open.png" });

// —— B. 点「取消」必须关闭弹窗 ——
const footerCancel = page.locator('.db-modal[aria-label="余额设置"] .db-modal-footer button').filter({ hasText: /^取消$/ }).first();
out.steps.cancelClicked = await footerCancel.click({ timeout: 8000 }).then(() => "ok", (e) => e.message.split("\n")[0]);
await page.waitForTimeout(1800);
out.steps.modalClosedByCancel = (await modalOpen()) === 0;
await page.screenshot({ path: "browser-screenshots/flow-02-after-cancel.png" });

// —— C. 重新打开：不应残留上一次的测试结果红字 ——
if (targetLabel) {
  const card = page.locator(".db-provider-card").filter({ hasText: targetLabel }).first();
  await card.getByText("余额设置", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  out.afterReopen = await page.evaluate(() => {
    const m = document.querySelector('.db-modal[aria-label="余额设置"]');
    if (!m) return null;
    const foot = m.querySelector(".db-modal-footer");
    return {
      open: true,
      footerMessages: Array.from(foot.querySelectorAll(".db-save-message")).map((p) => p.innerText.trim()),
      hasStaleError: Array.from(m.querySelectorAll("*")).some((el) => /测试失败/.test(el.textContent || "") && el.children.length === 0)
    };
  });
  await page.screenshot({ path: "browser-screenshots/flow-03-reopen.png" });

  // —— D. 填入合法地址后点「保存」——应真的提交并关闭弹窗 ——
  await page.evaluate(() => {
    const m = document.querySelector('.db-modal[aria-label="余额设置"]');
    const inputs = Array.from(m.querySelectorAll('.db-form input:not([type=checkbox])'));
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (inputs[0] && !inputs[0].value) setVal(inputs[0], "flow-test-provider");
    if (inputs[1]) setVal(inputs[1], "https://example.com/usage");
  });
  await page.waitForTimeout(900);

  const save = page.locator('.db-modal[aria-label="余额设置"] .db-modal-footer button').filter({ hasText: /^保存$/ }).first();
  out.steps.saveClicked = await save.click({ timeout: 8000 }).then(() => "ok", (e) => e.message.split("\n")[0]);
  await page.waitForTimeout(3500);
  out.saveResult = await page.evaluate(() => {
    const m = document.querySelector('.db-modal[aria-label="余额设置"]');
    const msg = document.querySelector(".db-message.error, .db-message.warn, .db-message");
    return {
      modalStillOpen: Boolean(m),
      footerMessage: m ? (m.querySelector(".db-save-message")?.innerText.trim() || "") : "",
      pageMessage: msg ? msg.innerText.trim() : ""
    };
  });
  await page.screenshot({ path: "browser-screenshots/flow-04-after-save.png" });
}

await browser.close();
out.consoleErrors = consoleErrors.slice(0, 10);
console.log(JSON.stringify(out, null, 2));
