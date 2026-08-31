<div align="center">

# dsh-balance-quota

**DeepSeek Harness Web 的余额、额度与模型健康监测插件**

[![npm](https://img.shields.io/npm/v/dsh-balance-quota?style=flat-square&color=4c8bf5)](https://www.npmjs.com/package/dsh-balance-quota)
[![license](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg?style=flat-square)](https://nodejs.org)

</div>

在 DSH 对话输入框下方显示供应商余额/额度；可接入第三方 JSON 状态接口，展示模型健康状态、可用率、TTFT、响应耗时、历史记录和自定义指标。

[GitHub English README](../../README.md) · [GitHub 中文 README](../../README.zh-CN.md)

> 当前版本：**0.3.3** · 上一个 npm 版本：**0.3.2**

## 安装

要求：Node.js 22+、DSH CLI。

```bash
dsh plugin --profile web add dsh-balance-quota
dsh web
```

安装或升级后需要重启 `dsh web`。

## 功能

- DeepSeek 余额与 OpenCode Go 额度官方方案；
- 自定义公网 HTTPS 余额接口和安全 JSON 路径；
- 默认供应商、会话独立记忆、一键切换、手动刷新；
- 保存前测试余额配置草稿，不写入正式配置或凭据；
- 高级模型目录、上下文窗口、输入能力和推理等级配置；
- 外部健康监测、可视化 JSON 绑定、全模型实时预览；
- 原文、数字、百分比、状态转换与状态值映射；
- 自定义数字字段独立设置接口单位、显示单位和小数位；
- Host 缓存、页面后台暂停刷新、预览缓存；
- API Key 隔离、SSRF 与 DNS 重绑定防护。

# 完整使用流程

以下截图来自当前版本的真实插件界面。供应商名、接口地址、余额和模型名已替换为演示值；布局和控件未修改。

## 1. 在哪里配置余额

打开：

**Settings → Plugins → Plugin configuration → 供应商状态**

这里可以：

- 开启/关闭余额查询；
- 查看余额或额度；
- 点击「编辑」配置余额接口；
- 点击「高级设置」配置模型与健康监测；
- 选择默认供应商；
- 开启状态栏并手动刷新。

![供应商状态入口](./docs/images/01-provider-settings.png)

## 2. 配置余额接口

在供应商行点击 **编辑**。

需要配置：

- 显示名称；
- 余额查询地址；
- GET 或无请求体 POST；
- 余额 JSON 路径；
- 币种或币种 JSON 表达式；
- 金额换算、请求头、刷新间隔和超时。

点击 **测试** 只验证当前未保存草稿，不会写入配置、凭据或正式缓存；确认结果后再点击 **保存**。

![真实余额编辑界面](./docs/images/02-balance-editor.png)

路径示例：

```text
余额：$.remaining ?? $.quota?.remaining ?? $.balance
币种：$.unit ?? $.quota?.unit ?? "USD"
```

支持 `?.` 可选链和最多 5 个 `??` 回退分支。

## 3. 高级设置：第一个 Tab「模型设置」

点击供应商行的 **高级设置**，默认进入 **模型设置**。

这个 Tab 用于管理当前供应商的：

- 模型目录；
- 显示名称；
- 上下文窗口；
- 文本/图片输入能力；
- 默认推理等级和可选推理等级。

它与余额查询互相独立：余额配置负责账户余额，模型设置负责 DSH 中可选择的模型能力。

![高级设置模型 Tab](./docs/images/03-advanced-models.png)

## 4. 高级设置：第二个 Tab「健康监测」

切换到 **健康监测**：

1. 勾选「启用健康监测」；
2. 填写公网 HTTPS、GET、JSON 接口；
3. 点击 **测试**；
4. 左侧出现完整 JSON 树；
5. 右侧出现实时状态预览。

![健康监测 Tab](./docs/images/04-health-monitor.png)

### 字段怎么绑定

必须先绑定 **模型列表**：点击右侧模型列表槽位，再点击左侧数组节点，例如 `$.models`。

之后用同样方式绑定：

| 字段 | 示例 |
| --- | --- |
| 模型名称 | `$.model` |
| 分组 | `$.group` |
| 状态 | `$.status` |
| 可用率 | `$.availability` |
| TTFT | `$.ttft_ms` |
| 响应耗时 | `$.latency_ms` |
| 历史数组 | `$.history` |
| 历史状态 | `$.state` |
| 历史时间 | `$.time` |
| 历史错误 | `$.message` |

绑定后右侧立即刷新；点击 **预览全部模型** 检查所有模型，无需重新请求接口。

### 数据转换

- **原文**：直接显示文本；
- **数字**：转为数值；
- **百分比**：自动、强制 ×100、原值加 `%`；
- **状态**：转为正常、失败、警告、未知。

状态不是标准词时，点击 **值映射**：

```text
healthy → 正常
warning → 警告
offline → 失败
```

配置映射后，未命中的值显示为未知，不回退内置词表。

### 自定义数字字段

点击指标区域的 `+`，输入名称并从左侧 JSON 树绑定字段。选择 **数字** 后，会出现三个真实配置项：

- 接口单位：`接口 ms` / `接口 s`；
- 显示单位：`显示跟随` / `显示 ms` / `显示 s`；
- 小数位：`整数` / `1 位` / `2 位`。

例如接口返回 `1250ms`，选择显示 `s`、保留 2 位，显示为 `1.25s`。每个自定义字段单独保存，不影响其他字段。

## 5. 配置完成后，状态栏在哪里

在设置页底部开启 **状态栏**。回到任意对话，余额栏显示在**对话输入框正下方**：

![对话输入框下方状态栏](./docs/images/05-chat-status-bar.png)

从左到右分别是：

1. 健康圆点；
2. 当前供应商；
3. 余额/额度；
4. 更新时间；
5. `↻` 强制刷新；
6. 心电图图标：查看健康监测。

点击供应商名称可以切换供应商。选择按会话独立记忆；新会话优先使用设置页中的默认供应商。

![状态栏供应商切换](./docs/images/06-provider-switcher.png)

## 6. 开启健康监测后怎么查看

启用健康监测并保存后，状态栏刷新按钮右侧会出现**心电图图标**。

点击它才会请求健康接口并打开详情，不会在后台持续消耗接口：

![健康监测详情](./docs/images/07-health-details.png)

详情展示：

- 模型总数、失败数、警告数；
- 分组、模型名和当前状态；
- 可用率、平均 TTFT、平均响应时间；
- 自定义字段，例如错误率、空回响、常见报错；
- 最近状态条；
- 手动刷新按钮。

健康数据来自第三方监控源，代表监控源结果，不等于当前账户本身状态，也不会调用聊天模型或消耗模型额度。

## 接口示例

### Input

```text
接口：     https://status.input.im/api/status
模型列表： $.services
模型名称： $.model
状态：     $.last.ok
可用率：   $.uptime_pct
历史：     $.history
```

### Neco

```text
接口：     https://speed.sbbbbbbbbb.xyz/api/pulse?window=604800
模型列表： $.models
模型名称： $.model
状态：     $.health
可用率：   $.success_rate
TTFT：     $.avg_ttft_ms
响应耗时： $.avg_resp_sec（接口单位选择 s）
```

## 刷新与缓存

- 余额默认每 30 分钟刷新；
- 页面在后台时不自动刷新；
- 多个会话共享 Host 缓存；
- 手动刷新绕过缓存；
- 健康 JSON 预览按监测源缓存；
- 删除监测源时同步删除预览缓存。

## 常见问题

### 状态栏没有出现

确认已配置至少一个供应商，并在供应商状态页底部开启「状态栏」。安装或升级插件后需要重启 `dsh web`。

### 看不到健康图标

在 **高级设置 → 健康监测** 中启用监测、测试成功并保存。健康图标只显示在当前已启用健康监测的供应商状态栏上。

### 保存提示自定义字段无效

先绑定模型列表，再从模型项内部选择字段。名称和路径不能为空；路径可以是 `$.last_errors[0]`。当前版本会清理前后空格并忽略未完成的空白字段。

### 查询失败

确认接口为公网 HTTPS、没有重定向，credential ref 可解析，JSON 路径与响应一致。插件会主动拒绝私网、回环地址和内部域名。

## 安全

- API Key 由 DSH `credentials` 服务管理，不进入浏览器配置；
- 只允许公网 HTTPS；
- DNS 解析后固定公网 IP；
- 拒绝私网/回环地址、重定向、危险请求头和超大响应；
- JSON 路径拒绝 `__proto__`、`constructor`、`prototype`。

详见 [SECURITY.md](./SECURITY.md)。

## 开发

```bash
pnpm install
pnpm dev:install
pnpm verify
```

## 许可证

[MIT](./LICENSE)
