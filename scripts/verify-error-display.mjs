// 验证错误展示优化：让一个供应商的余额地址指向会返回 HTML 404 页的地址，
// 断言卡片上展示的是**可读摘要**而不是整页 HTML 标签。
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-error-display.mjs <url-with-token>");

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

// 直接通过接口造一个「会返回 HTML 404」的供应商，避免手工点表单。
out.steps.created = await page.evaluate(async (BASE) => {
  const r = await fetch(`${BASE}/provider`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      id: "err-display-probe",
      name: "err-display-probe",
      endpoint: "https://example.com/definitely-not-a-usage-endpoint",
      method: "GET",
      responsePath: "$.balance",
      currency: "USD",
      apiKey: "sk-probe-not-real"
    })
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.ok === true, error: j.error || "" };
}, BASE);

// 强制查询这一条，拿到真实的错误文本。
out.phases.rawError = await page.evaluate(async (BASE) => {
  const r = await fetch(`${BASE}/summary?force=1&provider=err-display-probe`, { credentials: "include" });
  const j = await r.json().catch(() => ({}));
  const entry = (j.providers || [])[0] || {};
  return { status: entry.status, error: entry.error || "" };
}, BASE);

const err = out.phases.rawError.error || "";
out.steps.errorHasAngleBrackets = /[<>]/.test(err);
out.steps.errorLength = err.length;
// 用户反馈：404 等常见状态码的消息应止步于「状态码 + 中文提示」，
// 「返回了 HTML 页面…」是噪音。因此这里断言的是**不含** HTML 摘要。
out.steps.omitsHtmlSummary = !/返回了 HTML 页面/.test(err);
out.steps.hasChineseHint = /核对余额查询地址|凭据|稍后重试|上游服务异常/.test(err);

// 打开设置面板，读卡片上真实渲染出来的错误文本与它的容器尺寸。
await page.getByText("设置", { exact: true }).last().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator("button").filter({ hasText: /^插件$/ }).last().click();
await page.waitForTimeout(3500);
await page.locator("button,div,section").filter({ hasText: /^供应商状态/ }).last().click().catch(() => {});
await page.waitForTimeout(4500);

// 卡片可能不在视口内，先滚动到它再读尺寸，否则 getBoundingClientRect 拿到的是 0。
const card = page.locator(".db-provider-card").filter({ hasText: "err-display-probe" }).first();
await card.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(1200);

out.phases.rendered = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".db-provider-card"));
  const target = cards.find((el) => /err-display-probe/.test(el.innerText));
  if (!target) return { errorSpanFound: false, reason: "card not found", cardCount: cards.length };
  const span = target.querySelector(".db-meta-error");
  if (!span) return { errorSpanFound: false, reason: "no .db-meta-error in card" };
  const rect = span.getBoundingClientRect();
  const styles = getComputedStyle(span);
  return {
    errorSpanFound: true,
    text: span.innerText,
    textLength: span.innerText.length,
    hasAngleBrackets: /[<>]/.test(span.innerText),
    hasTitle: Boolean(span.getAttribute("title")),
    height: Math.round(rect.height),
    width: Math.round(rect.width),
    lineClamp: styles.webkitLineClamp,
    overflowWrap: styles.overflowWrap,
    flexBasis: styles.flexBasis
  };
});
await card.scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: "browser-screenshots/err-display-01.png" });

// 清理探针供应商
out.steps.cleaned = await page.evaluate(async (BASE) => {
  const r = await fetch(`${BASE}/provider/err-display-probe`, { method: "DELETE", credentials: "include" });
  return r.status;
}, BASE);

await browser.close();
out.consoleErrors = consoleErrors.slice(0, 10);
console.log(JSON.stringify(out, null, 2));
