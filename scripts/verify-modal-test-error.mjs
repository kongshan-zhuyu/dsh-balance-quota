// 复现用户截图：在弹窗「余额设置」页点「测试」，读取页脚错误文案。
// 用于确认弹窗页脚展示的是摘要而不是整页 HTML。
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-modal-test-error.mjs <url-with-token>");

const probe = ["chromium-1217/chrome-win64/chrome.exe", "chromium-1148/chrome-win/chrome.exe"]
  .map((rel) => join(homedir(), "AppData", "Local", "ms-playwright", rel))
  .find((candidate) => existsSync(candidate));

const browser = await chromium.launch({ executablePath: probe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const out = { steps: {}, phases: {} };
const BASE = "/dsh-balance-quota";

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

// 造一个指向 HTML 404 页的供应商，providerId 绑定到一张已有卡片上以便打开弹窗。
await page.evaluate(async (BASE) => {
  await fetch(`${BASE}/provider`, {
    method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
    body: JSON.stringify({
      id: "modal-err-probe", name: "modal-err-probe",
      endpoint: "https://example.com/definitely-missing", method: "GET",
      responsePath: "$.balance", currency: "USD", apiKey: "sk-probe-not-real"
    })
  });
}, BASE);

await page.getByText("设置", { exact: true }).last().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator("button").filter({ hasText: /^插件$/ }).last().click();
await page.waitForTimeout(3500);
await page.locator("button,div,section").filter({ hasText: /^供应商状态/ }).last().click().catch(() => {});
await page.waitForTimeout(4500);

const card = page.locator(".db-provider-card").filter({ hasText: "modal-err-probe" }).first();
await card.scrollIntoViewIfNeeded().catch(() => {});
await card.getByText("余额设置", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2500);
out.steps.modalOpened = (await page.locator('.db-modal[aria-label="余额设置"]').count()) > 0;

const testBtn = page.locator('.db-modal[aria-label="余额设置"] .db-modal-footer button').filter({ hasText: /^测试$/ }).first();
out.steps.testClicked = await testBtn.click({ timeout: 8000 }).then(() => "ok", (e) => e.message.split("\n")[0]);
await page.waitForTimeout(7000);

out.phases.footer = await page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  const p = m?.querySelector(".db-modal-footer .db-save-message");
  if (!p) return null;
  const rect = p.getBoundingClientRect();
  const styles = getComputedStyle(p);
  return {
    text: p.innerText,
    textLength: p.innerText.length,
    hasAngleBrackets: /[<>]/.test(p.innerText),
    // 用户反馈：常见状态码的消息应止步于「状态码 + 中文提示」，不再拼接 HTML 摘要。
    omitsHtmlSummary: !/返回了 HTML 页面/.test(p.innerText),
    hasChineseHint: /核对余额查询地址|凭据|稍后重试|上游服务异常/.test(p.innerText),
    height: Math.round(rect.height),
    maxHeight: styles.maxHeight,
    overflow: styles.overflowY,
    overflowWrap: styles.overflowWrap,
    whiteSpace: styles.whiteSpace
  };
});
await page.screenshot({ path: "browser-screenshots/modal-err-01.png" });

await page.evaluate(async (BASE) => {
  await fetch(`${BASE}/provider/modal-err-probe`, { method: "DELETE", credentials: "include" });
}, BASE);

await browser.close();
out.consoleErrors = consoleErrors.slice(0, 10);
console.log(JSON.stringify(out, null, 2));
