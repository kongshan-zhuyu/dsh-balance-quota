<div align="center">

# dsh-balance-quota

**DeepSeek Harness Web 的余额、额度与模型健康监测插件**

[![npm](https://img.shields.io/npm/v/dsh-balance-quota?style=flat-square&color=4c8bf5)](https://www.npmjs.com/package/dsh-balance-quota)
[![license](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg?style=flat-square)](https://nodejs.org)

</div>

`dsh-balance-quota` 在 DSH 对话输入框下方显示供应商余额/额度，并可接入第三方 JSON 状态接口，展示模型可用率、健康状态、延迟和历史记录。

> 当前版本：**0.3.3** · 上一个 npm 版本：**0.3.2**

## 界面预览

### 测试接口并预览返回 JSON

![测试健康监测接口并预览 JSON](./docs/images/health-endpoint-test.png)

### 绑定字段、转换数据并实时预览

![绑定健康监测字段](./docs/images/health-monitor-mapping.png)

## 功能一览

| 功能 | 说明 |
| --- | --- |
| 余额/额度状态栏 | 在对话输入框下方显示余额、滚动额度、周额度或月额度 |
| 官方方案 | 内置 DeepSeek 余额和 OpenCode Go 额度接口 |
| 自定义余额接口 | 支持公网 HTTPS、GET/无请求体 POST、自定义请求头和 JSON 路径 |
| 供应商切换 | 状态栏一键切换；每个会话独立记忆选择 |
| 默认供应商 | 新会话优先使用设置页指定的默认供应商 |
| 草稿测试 | 保存前测试供应商配置，不写入凭据、配置或正式缓存 |
| 健康监测 | 展示模型状态、可用率、TTFT、响应耗时和历史记录 |
| 可视化字段绑定 | 点击右侧槽位，再点击左侧 JSON 字段完成绑定 |
| 数据转换 | 支持原文、数字、百分比和状态转换 |
| 数字格式 | 每个数字字段独立设置接口单位、显示单位和 0–2 位小数 |
| 状态值映射 | 将自定义原始值映射为正常、失败、警告或未知 |
| 自定义字段 | 添加任意模型字段并显示在健康卡片中 |
| 全模型预览 | 使用当前绑定实时预览最多 50 个模型 |
| 安全请求 | 公网 HTTPS、DNS 固定、私网拦截、禁止重定向、凭据隔离 |

## 安装

要求：**Node.js 22+**、DSH CLI。

```bash
dsh plugin --profile web add dsh-balance-quota
dsh web
```

升级后也需要重启 `dsh web`。检查安装状态：

```bash
dsh plugin --profile web list
```

## 3 分钟上手

1. 打开 **设置 → 插件 → 供应商状态**。
2. DeepSeek/OpenCode Go：点击 **使用官方方案**。
3. 其他供应商：点击 **接入余额查询**，填写接口和余额 JSON 路径。
4. 打开状态栏总开关并选择默认供应商。
5. 返回对话页面查看余额；点击供应商名称切换，点击刷新按钮强制查询。

插件优先复用 DSH「模型」页已有的 credential ref，不覆盖或删除共享凭据。

## 自定义余额接口

示例：

```text
余额路径：$.remaining ?? $.quota?.remaining ?? $.balance
币种：    $.unit ?? "USD"
```

支持：

- `GET` 或无请求体 `POST`；
- `?.` 可选链；
- 最多 5 个 `??` 回退分支；
- 固定 ISO 4217 币种或从响应读取币种；
- 自定义请求头、超时、刷新间隔和金额除数。

## 健康监测使用方法

入口：**供应商状态 → 高级设置 → 健康监测**。

健康监测只读取第三方监控数据，不请求模型聊天接口，不消耗模型额度。

### 1. 测试接口

填写公网 HTTPS JSON 接口，点击 **测试**。成功后左侧显示完整 JSON 树，并缓存预览供下次编辑使用。

### 2. 绑定模型列表

先点击右侧 **模型列表**，再点击左侧数组节点，例如：

```text
$.models
$.services
```

模型列表是其他字段的作用域，必须最先绑定。

### 3. 绑定监测字段

点击右侧字段槽位，再点击左侧模型项中的字段。

| 字段 | 示例 | 用途 |
| --- | --- | --- |
| 模型名称 | `$.model` | 健康卡片标题 |
| 分组 | `$.group` | 模型分组标签 |
| 健康状态 | `$.health` | 正常/失败/警告/未知 |
| 可用率 | `$.success_rate` | 百分比和近似历史条 |
| TTFT | `$.avg_ttft_ms` | 首 Token 延迟 |
| 响应耗时 | `$.avg_resp_sec` | 请求响应时间 |
| 最近记录 | `$.history` | 历史状态数组 |
| 历史状态 | `$.ok` | 每条历史记录状态 |
| 历史时间 | `$.ts` | 每条历史记录时间 |
| 历史错误 | `$.error` | 每条历史记录错误 |

绑定后右侧卡片立即刷新，无需重新请求接口。点击 **预览全部模型** 可检查全部映射结果。

### 4. 选择数据转换

| 转换 | 适用数据 | 行为 |
| --- | --- | --- |
| 原文 | 文本、错误信息 | 原样显示 |
| 数字 | 延迟、计数 | 转为数值并应用单位和精度 |
| 百分比 | 可用率、成功率 | 自动、强制 ×100 或原值加 `%` |
| 状态 | `ok`、`warn`、布尔值等 | 转为正常/失败/警告/未知 |

#### 状态值映射

当接口使用自定义状态值时，点击 **值映射**：

```text
healthy  → 正常
warning  → 警告
offline  → 失败
```

配置映射后，未命中的值显示为“未知”，不会误用内置词表。

#### 百分比倍率

- **自动**：`0–1` 自动乘 100，其他值按百分数处理；
- **×100**：始终乘 100；
- **原值加 %**：接口值已经是百分数。

#### 数字单位和精度

选择 **数字** 后出现三个设置：

| 设置 | 可选值 |
| --- | --- |
| 接口单位 | `接口 ms`、`接口 s` |
| 显示单位 | `显示跟随`、`显示 ms`、`显示 s` |
| 小数位 | `整数`、`1 位`、`2 位` |

例如接口返回 `1.25` 秒，选择 `接口 s + 显示 ms + 整数`，显示结果为 `1250ms`。

### 5. 添加自定义字段并保存

点击指标区域的 **+**：

1. 输入名称，例如“常见报错”；
2. 点击字段卡片；
3. 在左侧选择字段，例如 `$.last_errors[0]`；
4. 选择原文、数字、百分比或状态；
5. 点击 **保存监测源**。

空白自定义字段不会提交；名称和路径会自动清除前后空格。

## 配置示例

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

- 余额供应商默认每 30 分钟刷新；
- 页面在后台时不自动刷新；
- 多个会话共享 Host 缓存；
- 手动刷新绕过缓存；
- 健康监测的 JSON 预览按源缓存，重新打开编辑器无需重复请求；
- 删除监测源时同步删除其预览缓存。

## 常见问题

### README 中看不到截图

截图已包含在 npm 包的 `docs/images` 中。GitHub/npm 在线展示前，需要先把 README 和图片推送到仓库默认分支。

### 保存提示自定义字段无效

先绑定模型列表，再从模型项内选择字段。名称和路径都不能为空；路径应类似 `$.last_errors[0]`。当前版本会忽略未完成的空白字段。

### 查询失败

确认接口为公网 HTTPS、没有重定向，credential ref 可解析，并且 JSON 路径与实际响应一致。插件会主动拒绝私网、回环地址和内部域名。

### 状态栏没有余额

确认至少配置一个余额供应商、开启状态栏，并设置默认供应商。可点击刷新按钮强制查询。

## 安全

- API Key 由 DSH `credentials` 服务管理，不进入浏览器配置；
- 只允许公网 HTTPS；
- DNS 解析后固定公网 IP，降低 DNS 重绑定风险；
- 拒绝私网/回环地址、重定向、危险请求头和超大响应；
- JSON 路径禁止 `__proto__`、`constructor`、`prototype`。

详见 [SECURITY.md](./SECURITY.md)。

## 开发

```bash
pnpm install
pnpm dev:install
pnpm verify
```

## 许可证

[MIT](./LICENSE)
