// 一次性 UI 验证脚本：打开 DSH Web → 设置 → 插件 → 余额插件卡片，
// 验证「模型设置」是在供应商卡片内**就地展开**（不经弹窗、不进 Tab），
// 展开态按 provider id 记录且同一时刻只有一张卡片展开；并截图留档。
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-ui.mjs <url-with-token>");

// 本机已安装的 Chromium 版本常与 playwright 期望的 revision 不一致，
// 这里直接按目录探测可用的 chrome.exe，避免为了截图去下载整套浏览器。
const probe = ["chromium-1217/chrome-win64/chrome.exe", "chromium-1148/chrome-win/chrome.exe"]
  .map((rel) => join(homedir(), "AppData", "Local", "ms-playwright", rel))
  .find((candidate) => existsSync(candidate));

const browser = await chromium.launch({ executablePath: probe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

const steps = {};
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

steps.settings = await page.getByText("设置", { exact: true }).last().click().then(() => "ok", (e) => e.message);
await page.waitForTimeout(2500);
await page.locator("button").filter({ hasText: /^插件$/ }).last().click();
await page.waitForTimeout(3500);

// 展开余额插件卡片（卡片标题是「供应商状态」，不是包名）
await page.locator("button,div,section").filter({ hasText: /^供应商状态/ }).last().click().catch(() => {});
await page.waitForTimeout(4500);
await page.locator(".db-settings").first().scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: "browser-screenshots/verify-01-card.png" });

// 卡片上的操作应是「模型设置 / 余额设置 / 删除」，且不再内联余额表单
steps.cardButtons = await page.evaluate(() => {
  const card = document.querySelector(".db-provider-card");
  if (!card) return null;
  return Array.from(card.querySelectorAll("button")).map((b) => b.textContent.trim());
});
steps.cardInlineBalanceEditor = await page.evaluate(
  () => document.querySelectorAll(".db-provider-card .db-inline-editor").length
);

// 点「模型设置」——应在**该卡片内部**就地展开，而不是弹出任何 dialog
const before = await page.locator(".db-models-inline").count();
const modelsBtn = page.locator("button.db-models-open").first();
await modelsBtn.scrollIntoViewIfNeeded().catch(() => {});
await modelsBtn.click({ timeout: 15000 }).catch((e) => { steps.openErr = e.message.split("\n")[0]; });
await page.waitForTimeout(4500);
await page.screenshot({ path: "browser-screenshots/verify-02-models-inline.png" });

const inline = await page.evaluate(() => {
  const sections = Array.from(document.querySelectorAll(".db-models-inline"));
  return {
    count: sections.length,
    // 展开的模型区必须位于某张供应商卡片内部（就近向上找到 .db-provider-card）
    insideCard: sections.map((s) => Boolean(s.closest(".db-provider-card"))),
    dataProvider: sections.map((s) => s.getAttribute("data-provider")),
    modelRows: sections.map((s) => s.querySelectorAll(".db-model-id").length),
    textHead: (sections[0]?.innerText || "").slice(0, 400)
  };
});

// 同一时刻只能有一张卡片展开：点第二张卡片的「模型设置」后，仍只有一个 .db-models-inline
const allBtns = await page.locator("button.db-models-open").count();
let afterSwitch = null;
if (allBtns > 1) {
  await page.locator("button.db-models-open").nth(1).scrollIntoViewIfNeeded().catch(() => {});
  await page.locator("button.db-models-open").nth(1).click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  afterSwitch = await page.locator(".db-models-inline").count();
}

// 余额设置弹窗顶部不应再有供应商下拉
await page.locator(".db-provider-card").first().getByText("余额设置", { exact: true }).first()
  .click({ timeout: 15000 }).catch((e) => { steps.balanceErr = e.message.split("\n")[0]; });
await page.waitForTimeout(2500);
await page.screenshot({ path: "browser-screenshots/verify-03-balance-modal.png" });

const balanceModal = await page.evaluate(() => {
  const m = document.querySelector('.db-modal[aria-label="余额设置"]');
  if (!m) return null;
  return {
    headText: (m.querySelector(".db-modal-head")?.innerText || "").trim(),
    tabs: Array.from(m.querySelectorAll(".db-modal-tabs button")).map((b) => b.textContent.trim()),
    providerSelect: m.querySelectorAll(".db-modal-provider").length,
    hasEditor: Boolean(m.querySelector(".db-inline-editor"))
  };
});

// 两个 tab 的页脚必须统一：都是 .db-modal-footer（内容区的兄弟节点，固定不滚动），
// 按钮尺寸/圆角一致。这里分别切到两页取样对比。
const footerProbe = async (tabLabel) => {
  await page.locator('.db-modal[aria-label="余额设置"] .db-modal-tabs button')
    .filter({ hasText: tabLabel }).first().click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const modal = document.querySelector('.db-modal[aria-label="余额设置"]');
    if (!modal) return null;
    const content = modal.querySelector(".db-modal-content");
    const footer = modal.querySelector(".db-modal-footer");
    if (!content || !footer) return { contentPresent: Boolean(content), footerPresent: Boolean(footer) };
    const fRect = footer.getBoundingClientRect();
    const mRect = modal.getBoundingClientRect();
    const btn = footer.querySelector("button");
    const bRect = btn?.getBoundingClientRect();
    const style = btn ? getComputedStyle(btn) : null;
    return {
      footerPresent: true,
      // 页脚必须是内容区的兄弟节点（不在 .db-modal-content 内），才不会被一起滚走
      isSiblingOfContent: footer.parentElement === content.parentElement,
      insideScrollArea: content.contains(footer),
      // 页脚底部应贴合弹窗底部
      flushedToModalBottom: Math.abs(fRect.bottom - mRect.bottom) <= 1,
      hasSeparator: parseFloat(getComputedStyle(footer).borderTopWidth) > 0,
      buttonHeight: bRect ? Math.round(bRect.height) : null,
      buttonRadius: style ? style.borderRadius : null,
      buttonFontSize: style ? style.fontSize : null,
      buttons: Array.from(footer.querySelectorAll("button")).map((b) => b.textContent.trim())
    };
  });
};

const footerBalance = await footerProbe("余额设置");
const footerHealth = await footerProbe("健康监测");
await page.screenshot({ path: "browser-screenshots/verify-05-footer-health.png" });
await footerProbe("余额设置");
await page.screenshot({ path: "browser-screenshots/verify-04-footer-balance.png" });

// 页脚固定性验证：把内容区滚到底，余额页页脚不得移动。
const footerPinned = await page.evaluate(async () => {
  const modal = document.querySelector('.db-modal[aria-label="余额设置"]');
  const content = modal?.querySelector(".db-modal-content");
  const footer = modal?.querySelector(".db-modal-footer");
  if (!content || !footer) return null;
  const before = footer.getBoundingClientRect().top;
  const scrollable = content.scrollHeight > content.clientHeight + 1;
  content.scrollTop = content.scrollHeight;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = footer.getBoundingClientRect().top;
  return { scrollable, movedPx: Math.round(Math.abs(after - before)) };
});

await browser.close();

const unifiedFooter = footerBalance && footerHealth
  ? {
      bothHaveFooter: footerBalance.footerPresent && footerHealth.footerPresent,
      bothSiblingOfContent: footerBalance.isSiblingOfContent && footerHealth.isSiblingOfContent,
      neitherInsideScrollArea: !footerBalance.insideScrollArea && !footerHealth.insideScrollArea,
      sameButtonHeight: footerBalance.buttonHeight === footerHealth.buttonHeight,
      sameButtonRadius: footerBalance.buttonRadius === footerHealth.buttonRadius,
      sameButtonFontSize: footerBalance.buttonFontSize === footerHealth.buttonFontSize,
      balance: footerBalance,
      health: footerHealth
    }
  : { balance: footerBalance, health: footerHealth };

console.log(JSON.stringify({
  steps,
  cardButtons: steps.cardButtons,
  cardInlineBalanceEditor: steps.cardInlineBalanceEditor,
  inlineExpanded: inline.count,
  inlineInsideCard: inline.insideCard,
  inlineDataProvider: inline.dataProvider,
  inlineSectionsAfterSwitchingCard: afterSwitch,
  balanceModal,
  unifiedFooter,
  footerPinned,
  consoleErrors: consoleErrors.slice(0, 12),
}, null, 2));
