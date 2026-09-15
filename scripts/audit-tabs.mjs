// 一次性审计脚本：在同一弹窗的两个 tab 之间逐项对比渲染结果，
// 找出背景色、间距、标签/输入/说明文字等所有不一致处（不仅页脚）。
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/audit-tabs.mjs <url-with-token>");

const probe = ["chromium-1217/chrome-win64/chrome.exe", "chromium-1148/chrome-win/chrome.exe"]
  .map((rel) => join(homedir(), "AppData", "Local", "ms-playwright", rel))
  .find((candidate) => existsSync(candidate));

const browser = await chromium.launch({ executablePath: probe });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.getByText("设置", { exact: true }).last().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator("button").filter({ hasText: /^插件$/ }).last().click();
await page.waitForTimeout(3500);
await page.locator("button,div,section").filter({ hasText: /^供应商状态/ }).last().click().catch(() => {});
await page.waitForTimeout(4500);
await page.locator(".db-provider-card").first().getByText("余额设置", { exact: true }).first()
  .click({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);

// 在指定 tab 上采样「内容区直接子元素 + 表单元信息」的渲染值
const sample = async (tabLabel) => {
  await page.locator('.db-modal[aria-label="余额设置"] .db-modal-tabs button')
    .filter({ hasText: tabLabel }).first().click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2200);
  return page.evaluate(() => {
    const modal = document.querySelector('.db-modal[aria-label="余额设置"]');
    const content = modal.querySelector(".db-modal-content");
    const form = content.querySelector("form.db-form");
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const px = (v) => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);

    const contentStyle = cs(content);
    const formStyle = cs(form);

    // 内容区的直接子元素（看是否有内嵌圆角/垫底的卡片包裹）
    const children = Array.from(content.children).map((el) => {
      const s = getComputedStyle(el);
      return {
        cls: el.className,
        padding: s.padding,
        margin: s.margin,
        borderRadius: s.borderRadius,
        background: s.backgroundColor,
        border: s.borderTopWidth + " " + s.borderTopColor
      };
    });

    // 第一个 label / input / 说明文字，用于对比字段级排版
    const label = content.querySelector(".db-field label, .db-field > label");
    const input = content.querySelector(".db-field input:not([type=checkbox])");
    const help = content.querySelector(".db-field-help");
    const toggle = content.querySelector(".db-monitor-toggle");
    const toggleCopy = content.querySelector(".db-monitor-toggle-copy");

    return {
      contentPadding: contentStyle.padding,
      contentBackground: contentStyle.backgroundColor,
      contentGap: contentStyle.rowGap,
      contentDisplay: contentStyle.display,
      formGap: formStyle ? formStyle.rowGap : null,
      formColumns: formStyle ? formStyle.gridTemplateColumns : null,
      formMargin: formStyle ? formStyle.margin : null,
      children,
      firstLabel: label ? { fontSize: cs(label).fontSize, color: cs(label).color, fontWeight: cs(label).fontWeight } : null,
      firstInput: input
        ? { height: px(cs(input).height), radius: cs(input).borderRadius, fontSize: cs(input).fontSize, padding: cs(input).padding, background: cs(input).backgroundColor }
        : null,
      help: help ? { fontSize: cs(help).fontSize, color: cs(help).color, margin: cs(help).margin } : null,
      toggle: toggle
        ? { padding: cs(toggle).padding, radius: cs(toggle).borderRadius, background: cs(toggle).backgroundColor, margin: cs(toggle).margin }
        : null,
      toggleCopy: toggleCopy ? { gap: cs(toggleCopy).gap } : null,
      // 顶部是否有说明行
      hasIntroLine: Boolean(content.querySelector(".db-models-head")),
      introText: (content.querySelector(".db-models-head")?.innerText || "").trim().slice(0, 60)
    };
  });
};

const balance = await sample("余额设置");
const health = await sample("健康监测");

await browser.close();

// 逐项比对，输出差异清单
const diffs = [];
const cmp = (path, a, b) => {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) diffs.push({ path, balance: a, health: b });
};

for (const key of ["contentPadding", "contentBackground", "contentGap", "contentDisplay", "formGap", "formColumns", "formMargin", "hasIntroLine", "introText"]) {
  cmp(key, balance[key], health[key]);
}
for (const key of ["firstLabel", "firstInput", "help", "toggle", "toggleCopy"]) {
  cmp(key, balance[key], health[key]);
}
cmp("childrenClasses", balance.children.map((c) => c.cls), health.children.map((c) => c.cls));
cmp("childrenBoxes", balance.children.map((c) => [c.padding, c.borderRadius, c.background]), health.children.map((c) => [c.padding, c.borderRadius, c.background]));

console.log(JSON.stringify({ diffs, balance, health }, null, 2));
