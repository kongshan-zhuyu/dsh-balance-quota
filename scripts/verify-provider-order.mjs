// 用户报告：「在余额设置里点击保存，对应供应商就会跑到最下面」。
// 本脚本记录**保存前后**的卡片顺序，断言被编辑的那张卡片位置不变。
// 关键在于挑选一张**不在末位**的卡片：若挑到最后一张，顺序错乱也看不出来。
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-provider-order.mjs <url-with-token>");

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

const readOrder = () => page.evaluate(() =>
  Array.from(document.querySelectorAll(".db-provider-card .db-provider-name")).map((el) => el.innerText.trim())
);

const before = await readOrder();
out.phases.beforeOrder = before;
out.steps.cardCount = before.length;

// 挑第二张卡片（索引 1）——它既不是首位也不是末位，位置变化一眼可辨。
const targetIndex = before.length >= 3 ? 1 : 0;
const targetName = before[targetIndex];
out.steps.targetIndex = targetIndex;
out.steps.targetName = targetName;

// 打开该卡片的余额设置并直接保存（草稿已预载，无需改任何字段）。
const card = page.locator(".db-provider-card").nth(targetIndex);
await card.getByText("余额设置", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2500);
out.steps.modalOpened = (await page.locator('.db-modal[aria-label="余额设置"]').count()) > 0;

const saveBtn = page.locator('.db-modal[aria-label="余额设置"] .db-modal-footer button').filter({ hasText: /^保存$/ }).first();
out.steps.saveClicked = await saveBtn.click({ timeout: 8000 }).then(() => "ok", (e) => e.message.split("\n")[0]);
await page.waitForTimeout(4000);
await page.screenshot({ path: "browser-screenshots/order-01-after-save.png" });

const after = await readOrder();
out.phases.afterOrder = after;
out.steps.modalClosedAfterSave = (await page.locator('.db-modal[aria-label="余额设置"]').count()) === 0;
out.steps.targetIndexAfter = after.indexOf(targetName);

// 核心断言：顺序必须与保存前完全一致。
out.steps.orderUnchanged = JSON.stringify(before) === JSON.stringify(after);
out.steps.targetStayedAtSameIndex = out.steps.targetIndexAfter === targetIndex;

// 额外验证：把配置里记录的 id 顺序读出来，确认不是前端渲染顺序的假象。
out.phases.configProviderOrder = await page.evaluate(async () => {
  try {
    const r = await fetch("/dsh-balance-quota/config", { credentials: "include" });
    const j = await r.json();
    return (j.config?.providers || []).map((p) => p.name);
  } catch { return null; }
});

await browser.close();
out.consoleErrors = consoleErrors.slice(0, 10);
console.log(JSON.stringify(out, null, 2));
