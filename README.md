<div align="center">

# dsh-balance-quota

**Know your spend before you send.** A secure balance & quota status bar for
[DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH) Web.

[![npm version](https://img.shields.io/npm/v/dsh-balance-quota?style=flat-square&color=4c8bf5)](https://www.npmjs.com/package/dsh-balance-quota)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg?style=flat-square)](https://github.com/kongshan-zhuyu/dsh-balance-plugin)

**English** · [简体中文](./README.zh-CN.md)

</div>

---

`dsh-balance-quota` grounds your AI provider balance and quota into the DSH Web chat
composer, so you never burn through a quota mid-conversation again. It ships as a
single installable package that converges the Host query, the Web status bar, the
settings page, and the release bundle.

> **🎯 What it does** — Shows a live balance/quota strip in the composer, with
> per-conversation provider memory and a one-click switch menu.
> **🧩 Compatibility** — DSH Web, Node.js 22+; official presets for DeepSeek and
> OpenCode Go, plus any public HTTPS balance endpoint.
> **🔐 Security** — HTTPS-only, DNS-rebinding protected; API keys stay host-side in
> the DSH keychain and never reach the browser.

- ✅ **Official presets** — DeepSeek balance and OpenCode Go quota out of the box.
- 🔐 **Secure by default** — HTTPS-only, DNS-rebinding protected, credentials in the DSH keychain.
- 🎯 **Custom any provider** — plug in any public HTTPS balance/quota endpoint with JSON-path extraction.
- 🧠 **Per-conversation memory** — each chat remembers the provider you picked for it.

---

## 🖥️ Interface at a glance

The plugin paints a compact strip **right below the message input** in every chat:

```text
  ● DeepSeek  · 可用余额  ¥12.34    3 分钟前更新  [↻]
   └─ green dot = healthy        bold = the value        ↻ = force refresh
```

- **Status bar** — a small, unobtrusive line: a healthy/unhealthy dot, the provider
  name, then the balance (`· 可用余额 ¥12.34`) or usage windows
  (`· 滚动 12% · 每周 45%` for OpenCode Go), a last-updated hint, and a ↻ refresh
  button.
- **Provider menu** — click the provider name and a small dropdown opens, listing
  every configured provider with its current value and a ✓ on the active one.
- **Settings** — a **供应商状态 / Provider Status** card under **Settings → Plugins** lists
  providers with a live status dot, per-provider meta (balance or usage %), an
  "Edit / Delete" action, a model-route binding selector, a default-provider selector,
  plus a global status-bar on/off toggle and a refresh button. The provider editor also
  has a **Test** action for checking the unsaved draft without saving it.

---

## ✨ Features

- **Balance & quota at a glance** — shows available balance for DeepSeek, or
  rolling / weekly / monthly usage for OpenCode Go, right in the composer.
- **One-click provider switching** — click the provider name in the status bar to
  open a menu and swap providers on the fly.
- **Per-conversation memory** — the provider you choose sticks to that conversation
  and is restored when you return; new or unselected conversations use the configured
  default provider, then fall back to the first configured provider.
- **Official presets** — DeepSeek `/user/balance` and OpenCode Go usage, verified.
- **Custom providers** — any public HTTPS balance/quota endpoint, `GET` or body-less
  `POST`, custom headers, timeout, cache interval, currency, and amount conversion.
- **Powerful JSON-path extraction** — optional chaining (`?.`) and up to five
  `??` fallbacks, e.g. `$.remaining ?? $.quota?.remaining ?? $.balance`.
- **Reuses your model config** — prefers the base URL and credential ref already
  configured on the DSH Models page.
- **Efficient** — per-provider refresh interval (default 30 min), no background
  polling, shared Host cache, and a manual force-refresh button.

## 📦 Installation

Requires **Node.js 22+** and the DSH CLI.

Install the latest release:

```bash
dsh plugin --profile web add dsh-balance-quota
```

Restart the Web profile after installing or updating:

```bash
dsh web
```

Verify it is installed:

```bash
dsh plugin --profile web list
```

> [!NOTE]
> Removal uses the `plugin remove` command shown in your current `dsh plugin --help`;
> the remove flag varies across DSH releases, so this repo does not hard-code an
> unverified variant.

### Local development

```bash
pnpm install
pnpm dev:install   # installs only packages/dsh-balance, picks the right DSH CLI per OS
```

## ⚙️ Configuration

Open **Settings → Plugins → Provider Status (供应商状态)**.

1. For **DeepSeek** or **OpenCode Go**, click **Use official preset** on the matching
   model provider.
2. The plugin reuses the credential ref from the Models page — it never overwrites
   or deletes that shared credential.
3. For any other provider, choose **Add balance query**, enter the public HTTPS
   balance/quota endpoint and the JSON path.

You can choose a default provider at the bottom of the settings section, enable or
disable the status bar, and bind a provider to a model route for tidier organization.
The **Test** button in the provider editor checks the current unsaved form and never
saves the provider or updates the formal cache.

### Custom provider example

```text
Balance path:    $.remaining ?? $.quota?.remaining ?? $.balance
Currency:        $.unit ?? "USD"
```

Supported: public HTTPS endpoints only, `GET` or body-less `POST`, JSON property
paths with `?.` and up to five `??` branches, fixed ISO 4217 currency or read-from-
response, custom request headers, timeout, cache interval, and amount conversion.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `statusBar` | `true` | Show/hide the balance bar in the composer. |
| `queryIntervalMinutes` | `30` | Per-provider refresh interval (0 disables auto refresh). |
| `timeoutSeconds` | `10` | Request timeout for a custom provider. |
| `method` | `GET` | `GET` or body-less `POST`. |
| `responsePath` | — | JSON path to the balance value, with `?.` / `??` support. |
| `currency` | `"USD"` | Fixed ISO 4217 code, or an expression like `$.unit ?? "USD"`. |
| `valueDivisor` | `1` | Raw value ÷ divisor = displayed amount (for unit-based quotas). |
| `headers` | `{}` | Extra request headers (`Authorization` is auto-injected).

## 📡 External model status

The supplier settings card includes a “Supplier health monitoring” section that accepts user-configured **public HTTPS + GET + JSON** status APIs. Enter an API URL and JSON-path mappings; the Host fetches and normalizes model status, availability, TTFT, response time, and history.

This feature only reads third-party monitoring data. It does not call your model APIs, store model credentials, or consume model quota. The result represents the external monitor, not your current account health.

Example Input mapping:

```text
API:          https://status.input.im/api/status
Model list:   $.services
Model:        $.model
Status:       $.last.ok
Availability: $.uptime_pct
History:      $.history
```

Example Neco mapping:

```text
API:          https://speed.sbbbbbbbbb.xyz/api/pulse?window=604800
Model list:   $.models
Model:        $.model
Status:       $.health
Availability: $.success_rate
TTFT:         $.avg_ttft_ms
Response:     $.avg_resp_sec (unit: seconds)
```

Only JSON field mappings are supported; the plugin does not execute webpage scripts or discover hidden page APIs, and does not support POST, cookies, or authentication in this version. The API URL still undergoes public HTTPS, DNS, redirect, response-size, and safe-path validation.

## 🧠 Provider selection

The status bar always shows the provider **you** selected. The menu remembers the
choice **per conversation** — switch conversations and the bar restores that
conversation's last choice. Conversations you haven't touched show the first
configured provider. Settings binding is organizational; the bar no longer
auto-switches based on the conversation's model.

## 🔄 Refresh & performance

- Each provider has its own `queryIntervalMinutes` (default **30 min**).
- The plugin does **not** auto-refresh while the page is in the background.
- On returning to visibility, it refreshes only when the current provider is due.
- The Host caches per provider, so multiple conversations on the same provider share one result.
- The status bar's ↻ button force-refreshes, bypassing the cache.

## 🚀 Release workflow

Only `dsh-balance-quota` is independently released. Update the root and package changelogs,
run `pnpm verify`, commit the version, and create a `vX.Y.Z` tag. GitHub Actions validates
the tag and changelog, then creates the GitHub Release. Ordinary commits do not create tags
or Releases.

## 🔐 Credentials & security

Credentials are stored and resolved through the DSH `credentials` service — no OS
special-casing. Custom API keys never land in the balance JSON config and are never
returned through the browser config API, and your shared Models-page credentials
are never overwritten or deleted by the plugin.

Balance endpoints must be **public HTTPS**. The plugin rejects private/loopback
addresses, internal hostnames, redirects, dangerous request headers, and oversized
responses, and re-validates DNS on every request to mitigate DNS-rebinding attacks.
See [SECURITY.md](./SECURITY.md) for details.

## ❓ FAQ

**Why does the status bar show "未配置余额供应商" (no provider configured)?**
No provider is configured yet — or none is bound to the current conversation.
Open **Settings → Plugins → Balance** and configure a provider, then the bar will
pick the first configured one.

**My key shows "查询失败" (query failed) but the endpoint is correct.**
The plugin only calls public HTTPS endpoints and will refuse private/loopback
addresses, internal hostnames, and redirects on purpose. Also make sure the
credential ref resolves (see the Models page) and the JSON path matches the
response shape. Use the ↻ button to force a fresh query.

**Does the plugin know which account I'm using?** It reuses the credential ref and
base URL already configured on the DSH Models page, so it tracks whatever model
account DSH is using — and it never overwrites or deletes that shared credential.

**Will it poll and drain my quota?** No. The page auto-refreshes at most every
`queryIntervalMinutes` (default 30 min) and only while visible; it never polls in
the background. The host caches per provider, so multiple conversations share one
query result.

**Is my API key safe in the browser?** The key never lives in the balance JSON
config and is never returned through the browser config API — it is resolved
host-side through the DSH `credentials` service. See [SECURITY.md](./SECURITY.md).

## 🗂️ Project structure

```text
packages/
├─ dsh-balance/          # The shipped package: Host, Client, Bundle, tests, docs
├─ dsh-host-balance/     # Legacy internal Host, kept as a migration regression baseline
├─ dsh-client-balance/   # Legacy internal Client, kept as a migration regression baseline
└─ dsh-bundle-balance/   # Legacy internal Bundle, kept as a migration regression baseline
```

New installs use only `dsh-balance-quota`. The three legacy packages are retained
solely as regression references and are not published independently.

## ✅ Quality

```bash
pnpm check
pnpm test
pnpm pack:check
pnpm verify
```

CI runs the same checks on Ubuntu, Windows, and macOS across Node.js 22 and 24.
The published package uses a `files` allowlist containing only runtime code and docs.

## 📚 Docs

- [Package README](./packages/dsh-balance/README.md)
- [Security policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## 📄 License

[MIT](./LICENSE) © kongshan-zhuyu
