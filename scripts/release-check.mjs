import { readFile } from "node:fs/promises";

const tag = process.argv.find((value) => value.startsWith("--tag="))?.slice("--tag=".length) || null;
const root = JSON.parse(await readFile("package.json", "utf8"));
const published = JSON.parse(await readFile("packages/dsh-balance/package.json", "utf8"));
const rootChangelog = await readFile("CHANGELOG.md", "utf8");
const packageChangelog = await readFile("packages/dsh-balance/CHANGELOG.md", "utf8");
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
if (!versionPattern.test(root.version) || root.version !== published.version) throw new Error(`root and published versions must match: ${root.version} / ${published.version}`);
const expected = tag ? tag.match(/^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)?.[1] : root.version;
if (!expected) throw new Error(`invalid release tag: ${tag}`);
if (expected !== published.version) throw new Error(`tag ${tag} does not match package version ${published.version}`);
const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sectionPattern = new RegExp(`^## ${escaped}(?: - [^\\n]+)?$`);
const readSection = (changelog) => {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => sectionPattern.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n").trim();
};
const rootSection = readSection(rootChangelog);
const packageSection = readSection(packageChangelog);
if (!rootSection || !packageSection) throw new Error(`changelog section ${expected} cannot be empty`);
if (rootSection !== packageSection) throw new Error(`root and package changelog sections differ for ${expected}`);
console.log(JSON.stringify({ package: published.name, version: published.version, tag: tag || null, notes: rootSection }, null, 2));
