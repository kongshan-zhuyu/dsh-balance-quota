<div align="center">

# dsh-balance-quota

**Balance, quota, and model-health monitoring for DeepSeek Harness Web**

[![npm version](https://img.shields.io/npm/v/dsh-balance-quota?style=flat-square&color=4c8bf5)](https://www.npmjs.com/package/dsh-balance-quota)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg?style=flat-square)](https://github.com/kongshan-zhuyu/dsh-balance-quota)

**English** · [简体中文](./README.zh-CN.md)

</div>

`dsh-balance-quota` displays provider balance or quota below the DSH chat composer. It can also consume third-party JSON status APIs and show model health, availability, TTFT, response time, history, and custom metrics.

> Current development version: **0.3.3** · Previous npm release: **0.3.2**

## Complete feature map

| Area | Features |
| --- | --- |
| Official presets | DeepSeek balance and OpenCode Go rolling/weekly/monthly quota |
| Custom balance | Public HTTPS, GET/bodyless POST, custom headers, timeout, refresh interval |
| JSON extraction | Property paths, array indexes, optional chaining, up to five `??` fallbacks |
| Amount handling | Static/dynamic currency, amount divisor, unsaved-draft testing |
| Status bar | Balance, update time, force refresh, and health entry below the composer |
| Provider selection | Default provider, inline switching, per-conversation memory |
| Model settings | Model catalog, context window, text/image input, reasoning levels |
| Health monitoring | External JSON API, status, availability, TTFT, response time, history |
| Visual binding | Select a preview slot, then select a JSON field; preview updates immediately |
| All-model preview | Preview up to 50 models with current mappings without another request |
| Transforms | Text, number, percentage, status, status-value maps, percentage multipliers |
| Number formatting | Per-field input unit, display unit, and 0–2 decimal places |
| Custom fields | Error rate, empty response, common errors, or any model metric |
| Cache and refresh | Shared Host balance cache, health-preview cache, pause while hidden |
| Credential security | Reuses DSH credential refs; API keys never enter browser configuration |
| Network security | Public HTTPS, DNS pinning, rebinding protection, private-IP/redirect blocking |

## Installation

Requires **Node.js 22+** and the DSH CLI.

```bash
dsh plugin --profile web add dsh-balance-quota
dsh web
```

Restart `dsh web` after installation or upgrade. Verify installation with:

```bash
dsh plugin --profile web list
```

# Complete walkthrough

All seven screenshots come from the current plugin running in DSH Web. Provider names, URLs, balances, and model names were replaced with demo values; the UI layout and controls were not redrawn.

## 1. Where to configure balance

Open **Settings → Plugins → Plugin configuration → 供应商状态 (Provider Status)**.

This page controls balance queries, provider editing, Advanced Settings, the default provider, the chat status bar, and manual refresh.

![Provider status settings](./packages/dsh-balance/docs/images/01-provider-settings.png)

- DeepSeek and OpenCode Go can use built-in official presets.
- Click **编辑 (Edit)** for a custom balance API.
- **高级设置 (Advanced Settings)** contains Model Settings and Health Monitoring.
- The default-provider option controls new conversations.
- The status-bar option controls the strip below the chat composer.

## 2. Edit a balance provider

Click **编辑 (Edit)** on a provider row:

![Balance provider editor](./packages/dsh-balance/docs/images/02-balance-editor.png)

Configure the display name, endpoint, GET/bodyless POST, balance JSON path, static or dynamic currency, amount conversion, headers, refresh interval, and timeout.

```text
Balance: $.remaining ?? $.quota?.remaining ?? $.balance
Currency: $.unit ?? $.quota?.unit ?? "USD"
```

**测试 (Test)** validates only the current unsaved draft. It does not write formal configuration, credentials, or production cache. Save after the result is correct.

## 3. Advanced Settings tab 1: Model Settings

Click **高级设置 (Advanced Settings)**. The first tab is **模型设置 (Model Settings)**:

![Advanced Model Settings tab](./packages/dsh-balance/docs/images/03-advanced-models.png)

It manages the provider's model ID/display name, context window, text/image input capabilities, and default/available reasoning levels.

This is separate from balance and health: Edit owns balance settings; the second Advanced Settings tab owns external monitoring.

## 4. Advanced Settings tab 2: Health Monitoring

Switch to **健康监测 (Health Monitoring)**:

![Advanced Health Monitoring tab](./packages/dsh-balance/docs/images/04-health-monitor.png)

Setup flow:

1. Enable health monitoring.
2. Select a custom request.
3. Enter a public HTTPS GET JSON endpoint.
4. Click **测试 (Test)**.
5. Inspect the full JSON tree on the left.
6. Bind fields and preview status on the right.
7. Use **预览全部模型 (Preview all models)** to validate every mapping.
8. Save the monitor.

Health monitoring reads third-party monitoring data. It does not invoke chat models or consume model quota.

### Field binding

Bind the model list first: select the Model List slot on the right, then select an array such as `$.models` on the left.

| Field | Example path | Purpose |
| --- | --- | --- |
| Model name | `$.model` | Card title |
| Group | `$.group` | Group badge |
| Status | `$.status` | Healthy, failed, warning, unknown |
| Availability | `$.availability` | Current availability |
| TTFT | `$.ttft_ms` | Time to first token |
| Response time | `$.latency_ms` | Request duration |
| History array | `$.history` | Recent records |
| History status | `$.state` | Per-record state |
| History time | `$.time` | Per-record timestamp |
| History error | `$.message` | Per-record error |

### Transforms, status maps, and numeric formatting

- **Text** displays the original value.
- **Number** converts numeric values and applies units and precision.
- **Percentage** supports automatic scaling, forced ×100, or raw value plus `%`.
- **Status** converts values into healthy, failed, warning, or unknown.

Custom status values can use **值映射 (Value mapping)**:

```text
healthy → healthy
warning → warning
offline → failed
```

Selecting **Number** for a custom field reveals three settings:

| Setting | Values |
| --- | --- |
| Input unit | `ms`, `s` |
| Display unit | follow input, `ms`, `s` |
| Decimal places | 0, 1, 2 |

For example, `1250ms` displayed as seconds with two decimals becomes `1.25s`. Settings are stored independently per field.

## 5. Where the status bar appears

Enable **状态栏 (Status bar)** at the bottom of Provider Status, then return to any conversation. It appears **directly below the chat composer**:

![Balance status below the chat composer](./packages/dsh-balance/docs/images/05-chat-status-bar.png)

From left to right: health dot, current provider, balance/quota, update time, force refresh, and the health-monitor icon.

## 6. Switch providers

Click the provider name in the status bar:

![Provider switcher](./packages/dsh-balance/docs/images/06-provider-switcher.png)

- The active provider has a check mark.
- Selection is remembered independently per conversation.
- New conversations use the configured default provider.
- `↻` bypasses cache and refreshes the current balance immediately.

## 7. View health after enabling monitoring

After health monitoring is enabled and saved for the current provider, an ECG icon appears next to refresh. Click it to request the endpoint and open details:

![Model health details](./packages/dsh-balance/docs/images/07-health-details.png)

The dialog shows model/failure/warning counts, group and status, availability, average TTFT and response time, custom metrics, recent-history bars, and manual refresh.

Health represents the third-party monitor, not the current account itself.

## Refresh and caching

- Each balance provider has its own refresh interval; default is 30 minutes.
- Automatic refresh pauses while the page is hidden.
- Multiple conversations share Host balance cache.
- Manual refresh bypasses cache.
- Health JSON previews are cached per monitor.
- Deleting a monitor deletes its preview cache.

## FAQ

### The status bar is missing

Configure at least one provider, enable Status Bar at the bottom of Provider Status, and restart `dsh web` after installation or upgrade.

### The health icon is missing

Enable, test, and save Health Monitoring under Advanced Settings. The icon only appears when the current provider has an enabled health monitor.

### Saving reports `invalid external custom field`

Bind the model list first, then select a field inside a model item. Name and path must be non-empty; `$.last_errors[0]` is valid. Version 0.3.3 trims whitespace and ignores unfinished blank fields.

### A query fails

Confirm the endpoint is public HTTPS without redirects, the credential ref resolves, and JSON paths match the response. Private, loopback, and internal destinations are rejected.

## Security boundary

- API keys are managed by DSH `credentials` and never enter browser configuration.
- Only public HTTPS is allowed.
- Resolved public IPs are pinned to reduce DNS-rebinding risk.
- Private/loopback addresses, redirects, dangerous headers, and oversized responses are rejected.
- JSON paths reject `__proto__`, `constructor`, and `prototype`.
- Health monitoring does not execute page scripts, discover hidden browser APIs, or support Cookie/authenticated monitor endpoints.

See [`SECURITY.md`](./packages/dsh-balance/SECURITY.md).

## Development and verification

`packages/dsh-balance` is the only public package.

```bash
pnpm install
pnpm dev:install
pnpm check
pnpm test
pnpm pack:check
pnpm verify
```

## Project layout

```text
packages/dsh-balance/
├── lib/host/       # Secure queries, validation, cache, config, health normalization
├── lib/client/     # DSH Web status bar and settings UI
├── docs/images/    # Real redacted README screenshots
├── test/           # Unit and security tests
├── README.md       # npm package guide
└── SECURITY.md     # Security boundary
```

## License

[MIT](./LICENSE)
