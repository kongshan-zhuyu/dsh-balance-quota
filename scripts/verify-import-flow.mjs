// 验证「引入供应商」菜单的直接出卡片行为：
// 点击菜单项（从"模型"页引入）后，供应商列表应**立即**多出一张卡片，
// 不应弹出表单或需要用户再手工保存。用户反馈「点引入新供应商不应该
// 直接增加一个卡片吗」。失败时回落到编辑态（卡片带「配置中」编辑器）。
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-import-flow.mjs <url-with-token>");

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

// 进入 插件 → 供应商状态 面板
await page.getByText("设置", { exact: true }).last().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator("button").filter({ hasText: /^插件$/ }).last().click();
await page.waitForTimeout(3000);
await page.locator("button,div,section").filter({ hasText: /^供应商状态/ }).last().click().catch(() => {});
await page.waitForTimeout(4500);

// 记录引入前的卡片数
const countCards = () => page.locator(".db-provider-card").count();
out.steps.cardsBefore = await countCards();

// 打开「+ 引入供应商 ▾」菜单
const importButton = page.locator("button").filter({ hasText: "引入供应商" }).last();
await importButton.scrollIntoViewIfNeeded().catch(() => {});
await importButton.click();
await page.waitForTimeout(900);
await page.screenshot({ path: "browser-screenshots/import-01-menu.png" });

// 记录菜单项并点击「从"模型"页引入供应商」分组的第一个未配置供应商
const menuItems = page.locator(".db-import-item");
out.steps.menuItemCount = await menuItems.count();
const itemNames = await menuItems.locator(".db-import-item-name").allInnerTexts();
out.phases.menuItems = itemNames;

// 选一个肯定未配置的项（排除「新建自定义余额供应商」——它合法地进表单）
const target = menuItems.filter({ hasNotText: "新建自定义余额供应商" }).first();
out.steps.clickedItem = await target.locator(".db-import-item-name").innerText().catch(() => "(unknown)");
await target.click();
await page.waitForTimeout(2500);

out.steps.cardsAfter = await countCards();

// 判定：直接出卡片 = 卡片数 +1，且没有「配置中」编辑器、没有弹窗。
out.steps.modalOpened = await page.locator(".db-modal-footer").isVisible().catch(() => false);
out.steps.inlineEditorShown = await page.locator("text=正在添加：").first().isVisible().catch(() => false);
out.steps.directCardAdded = out.steps.cardsAfter === out.steps.cardsBefore + 1 && !out.steps.modalOpened && !out.steps.inlineEditorShown;

// 新卡片的名称应出现在列表里
const newName = out.steps.clickedItem;
out.steps.newCardVisible = newName && newName !== "(unknown)"
  ? await page.locator(".db-provider-card").filter({ hasText: newName }).first().isVisible().catch(() => false)
  : false;

await page.screenshot({ path: "browser-screenshots/import-02-after-click.png" });

console.log(JSON.stringify(out, null, 2));
await browser.close();
