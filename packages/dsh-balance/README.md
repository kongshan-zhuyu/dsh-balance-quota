# dsh-balance-quota

> DeepSeek Harness (DSH) Web 的余额、额度与模型健康监测插件。

[![npm version](https://img.shields.io/npm/v/dsh-balance-quota?style=flat-square&color=4c8bf5)](https://www.npmjs.com/package/dsh-balance-quota)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg?style=flat-square)](https://nodejs.org)

当前发布版本：**0.3.3**。上一版 npm 发布版本为 **0.3.2**。

## 界面预览

### 测试健康监测接口并预览 JSON

![填写健康监测接口并解析 JSON](https://raw.githubusercontent.com/kongshan-zhuyu/dsh-balance-quota/main/packages/dsh-balance/docs/images/health-endpoint-test.png)

### 绑定字段并设置转换方式

![健康监测字段映射](https://raw.githubusercontent.com/kongshan-zhuyu/dsh-balance-quota/main/packages/dsh-balance/docs/images/health-monitor-mapping.png)

> 如果你正在本地预览尚未推送的 README，可以直接打开包内图片：
> [`health-endpoint-test.png`](./docs/images/health-endpoint-test.png) ·
> [`health-monitor-mapping.png`](./docs/images/health-monitor-mapping.png)

## 功能

- 在 DSH 对话输入框下方显示供应商余额或额度。
- 内置经过验证的 DeepSeek 余额与 OpenCode Go 额度方案。
- 支持任意公开 HTTPS 余额/额度接口，并通过 JSON 路径提取数值。
- 支持每个会话独立记忆供应商选择、手动刷新和供应商路由绑定。
- 支持外部模型健康监测：状态、可用率、TTFT、响应耗时、历史记录和自定义字段。
- 自定义数字字段支持独立设置接口单位、显示单位和小数位。
- API Key 由 DSH `credentials` 服务管理，不写入浏览器配置或余额 JSON。

## 安装

需要 Node.js 22+ 和可用的 DSH CLI。

```bash
dsh plugin --profile web add dsh-balance-quota
dsh web
```

安装或升级后请重启 Web Profile。检查插件是否安装成功：

```bash
dsh plugin --profile web list
```

卸载命令以当前版本 `dsh plugin --help` 输出为准，不同 DSH 版本的参数可能不同。

## 快速开始

1. 打开 DSH 的 **设置 → 插件 → 供应商状态**。
2. 使用 DeepSeek 或 OpenCode Go 时，点击对应供应商的 **使用官方方案**。
3. 插件会复用 DSH「模型」页中已有的 credential ref，不需要重复填写 API Key。
4. 返回对话页面，在输入框下方查看余额/额度状态栏。
5. 点击状态栏中的供应商名称，可以切换供应商；选择会按会话分别记忆。
6. 点击刷新按钮，可以绕过缓存立即查询。

## 配置自定义余额供应商

在「供应商状态」中选择 **接入余额查询**，填写公开 HTTPS 接口和返回值路径。

示例：

```text
余额路径：$.remaining ?? $.quota?.remaining ?? $.balance
币种：    $.unit ?? "USD"
```

支持：

- 公网 HTTPS；
- `GET` 或无请求体 `POST`；
- JSON 属性路径、`?.` 可选链和最多 5 个 `??` 回退分支；
- 固定 ISO 4217 币种或从响应读取币种；
- 自定义请求头、超时、刷新间隔和金额除数。

## 外部健康监测

供应商行右侧的 **高级设置** 可以添加健康监测源。此功能读取第三方公开监控接口，不调用模型接口，不保存模型凭据，也不会消耗模型额度。

当前限制：只支持公网 HTTPS、GET、JSON 和安全 JSON 字段映射；不执行网页脚本，不自动发现网页内部接口，不支持 Cookie 或鉴权监控接口。

### 完整操作步骤

#### 1. 打开健康监测编辑器

进入 **设置 → 插件 → 供应商状态**，找到目标供应商，点击右侧 **高级设置**，再进入 **健康监测**。

先填写监测接口地址并点击 **测试/解析 JSON**。解析成功后，左侧会显示接口返回的 JSON 树，右侧会显示健康监测预览卡片。


#### 2. 绑定模型列表

右侧预览卡片中的 **模型列表** 是第一步，也是自定义字段绑定的基础：

1. 点击右侧的「模型列表」槽位。
2. 在左侧 JSON 树中点击一个数组节点，例如 `$.models` 或 `$.services`。
3. 绑定成功后，右侧会出现模型项预览。

如果没有先绑定模型列表，自定义字段无法确定应该从哪个模型项读取。

#### 3. 绑定固定指标

点击右侧对应的虚线槽位，再点击左侧 JSON 树中的字段即可完成绑定。常见字段如下：

| 预览槽位 | 含义 | 示例路径 |
| --- | --- | --- |
| 模型名称 | 模型显示名称 | `$.model` |
| 分组 | 模型分组，可选 | `$.group` |
| 健康状态 | 正常、失败或警告 | `$.health` |
| 可用率 | 百分比数值 | `$.success_rate` |
| TTFT | 首 token 延迟 | `$.avg_ttft_ms` |
| 响应耗时 | 接口响应耗时 | `$.avg_resp_sec` |
| 最近记录 | 历史记录数组 | `$.history` |

状态、时间和错误字段可以继续从历史记录数组中绑定。绑定后会在预览卡片底部显示历史状态条。

#### 4. 添加自定义字段

在指标区域点击 **+**：

1. 输入字段名称，例如「常见报错」。
2. 点击字段卡片，再点击左侧 JSON 中的目标字段。
3. 字段路径会显示在卡片上，例如 `$.last_errors[0]`。
4. 根据返回值选择转换方式：**原文、数字、百分比、状态**。

路径必须是 JSON 字段路径，不能填写网页 URL、JavaScript 表达式或数组之外的文本。字段名称和路径不能为空。


#### 5. 数字字段的三个配置

当自定义字段选择 **数字** 后，卡片底部会显示三个下拉选项：

| 配置 | 作用 | 示例 |
| --- | --- | --- |
| 接口单位 | 说明接口返回值的原始单位 | `接口 ms`、`接口 s` |
| 显示单位 | 控制卡片最终显示单位 | `显示跟随`、`显示 ms`、`显示 s` |
| 小数位 | 控制显示精度 | `整数`、`1 位`、`2 位` |

例如接口返回 `1.25`，接口单位选择「接口 s」，显示单位选择「显示 ms」，最终会显示为 `1250ms`。三个配置保存在当前自定义字段上，不会影响其他字段。

#### 6. 测试并保存

1. 点击 **测试**，确认接口请求、JSON 解析和预览数据都正确。
2. 检查模型名称、状态、可用率和自定义字段是否符合预期。
3. 点击 **保存监测源**。

测试未保存的草稿不会写入正式配置、凭据或正式缓存。

## 监测接口示例

### Input

```text
接口：       https://status.input.im/api/status
模型列表：   $.services
模型名称：   $.model
状态：       $.last.ok
可用率：     $.uptime_pct
历史记录：   $.history
```

### Neco

```text
接口：       https://speed.sbbbbbbbbb.xyz/api/pulse?window=604800
模型列表：   $.models
模型名称：   $.model
状态：       $.health
可用率：     $.success_rate
TTFT：       $.avg_ttft_ms
响应耗时：   $.avg_resp_sec（接口单位选择“接口 s”）
```

## 刷新与性能

- 每个供应商独立设置 `queryIntervalMinutes`，默认 30 分钟。
- 页面处于后台时不会自动刷新。
- 页面恢复可见时，仅在达到刷新间隔后查询。
- Host 按供应商共享缓存，多个会话可复用结果。
- 状态栏刷新按钮会强制绕过缓存。

## 常见问题

### 保存时提示 `invalid external custom field`

请检查每个自定义字段：

- 字段名称不能为空；
- 字段路径不能为空；
- 先绑定模型列表，再从模型项内部选择字段；
- 路径应类似 `$.last_errors[0]`，不要填写接口 URL；
- 如果有未完成的空白字段卡片，请删除，或填写完整后再保存。

`$.last_errors[0]` 是合法的安全 JSON 路径。当前版本保存时会自动清理名称和路径前后空格，并忽略未完成的空字段。

### 状态栏显示查询失败

插件会主动拒绝私网、回环地址、内部域名、重定向和非 HTTPS 接口。请同时检查 credential ref 是否有效，以及 JSON 路径是否匹配实际响应结构。可以点击刷新按钮强制重新查询。

### 为什么看不到余额

请确认已经配置至少一个供应商，并且状态栏总开关已开启。新会话会使用设置页指定的默认供应商；没有指定默认供应商时使用第一个已配置供应商。

## 安全边界

插件只允许公网 HTTPS 请求，并执行 DNS 解析校验、防 DNS 重绑定、重定向拦截、危险请求头过滤和响应大小限制。API Key 通过 DSH `credentials` 服务管理，不进入余额 JSON 配置，也不会通过浏览器配置 API 返回。

详见 [SECURITY.md](./SECURITY.md)。

## 开发与验证

```bash
pnpm install
pnpm dev:install
pnpm check
pnpm test
pnpm pack:check
pnpm verify
```

## 发布说明

只有 `dsh-balance-quota` 是对外发布包。发布前请：

1. 同步根目录和 `packages/dsh-balance/CHANGELOG.md`。
2. 更新根目录与包目录版本号。
3. 运行 `pnpm verify` 和 `pnpm pack:check`。
4. 确认 `npm pack --dry-run` 包含 `docs/images` 截图。
5. 创建对应的 `vX.Y.Z` tag，再发布 npm。

## 许可证

[MIT](./LICENSE)
