# AGENTS.md — dsh-balance-quota AI 开发指南

本项目是为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）Web 界面提供余额与额度状态栏的插件。
任何参与本仓库开发的 AI Agent 或协同工具，必须严格遵守以下设计理念、架构红线与扩展接缝规范。

---

## 🧭 1. 全局原则与哲学

1. **中文交流**：优先使用中文与开发者沟通和撰写文档说明。
2. **零构建哲学（Zero-Build）**：
   - 保持“**源码即发布包**”的纯粹性，**严禁**引入 rollup、esbuild、webpack 等打包器或将源码预编译为产物。
   - 依赖保持最小化，严禁随意引入第三方 runtime 依赖（Node 内建模块优先）。
3. **可观察行为零破坏**：任何重构或功能增补，必须保证现有 21 个测试断言与对外导出的 11 个公共符号 100% 兼容。
4. **遗留包防腐隔离**：
   - `packages/dsh-balance` 是**唯一定位对外发布和日常开发**的主包。
   - `packages/dsh-host-balance`、`packages/dsh-client-balance`、`packages/dsh-bundle-balance` 为迁移兼容基线，**绝不修改、绝不删除、绝不独立发布**。

---

## 🏗️ 2. Host 端架构与模块职责划分

Host 端位于 `packages/dsh-balance/lib/host/`，采用分层解耦架构，严禁随意堆叠逻辑：

| 模块文件 | 设计模式 | 职责与归属规则 |
| :--- | :--- | :--- |
| `net.js` | **安全防腐层** | 负责 DNS 提前解析、公网 IP 固定（`requestPinnedJson`）、拦截私网/回环与 3xx 重定向。网络底层改动仅能发生在此。 |
| `http-utils.js` | **HTTP 适配器** | 统一 `json()` 响应、`body()` 流式解析与 `sanitizeProviderError()` 错误脱敏（剔除 Bearer Token）。 |
| `json-path.js` | **解释器模式** | JSON 提取引擎，纯结构化解析 `?.`、`??` 回退链与字面量兜底。**绝对禁止使用 eval 或 new Function**。 |
| `presets.js` | **策略模式 / 注册表** | **官方预设供应商注册表**（如 DeepSeek、OpenCode Go）。静态配置与响应提取逻辑在此注册。 |
| `validate.js` | **规格模式** | 校验供应商与外部监控源的输入 Payload 合法性及请求头白名单。 |
| `external-status.js` | **转换管道** | 外部监控数据归一化、有界 JSON 预览提取与 `EXTERNAL_TRANSFORMS` 转换映射表。 |
| `config-store.js` | **门面模式 (Facade)** | 独占 `~/.dsh/balance/config.json` 的原子写入（tmp+rename）与 Promise 串行化防并发竞争。 |
| `query.js` | **查询服务** | 凭据调度、缓存维护（`cache` Map）、过期判定与批量 Summary 编排。 |
| `routes.js` | **命令模式 / 路由表** | 声明式路由请求派发，处理 10 个 API 端点。消灭巨型 `if-else` 分支。 |
| `security.js` | **凭据隔离** | 凭据引用生成（`DSH_BALANCE_*`）、所有权标记判定及旧版 macOS Keychain 一次性迁移。 |
| `index.js` | **组合根 (Composition Root)** | 仅负责 DSH 插件生命周期注入（`apply`）及重新聚合导出公共 API，**不写具体业务实现**。 |

---

## 🖥️ 3. Client 端架构规范 (`lib/client/client.js`)

1. **单文件 Bundle 约束**：
   - 受 DSH 平台 `window.__ModuleLoader__` 机制限制，浏览器端无法通过相对路径 `require('./sub.js')` 加载文件。
   - `lib/client/client.js` 必须维持**自包含的单文件 Bundle**。
2. **内部组件与状态规范**：
   - 复杂的异步副作用与连接管理应抽离为**自定义 Hook**（如 `useModelProviders`）。
   - 视图渲染应按功能拆分为结构化的子函数（如 `inlineEditor`, `externalEditor`, `jsonTree`），严禁写入长达千字符的无换行代码。
   - DOM 状态栏注入通过 `dockListeners` 与 React `BalanceDock` 协同，严禁强行重写为与插槽脱节的全局覆盖层。

---

## 🛠️ 4. 扩展新功能作业指导（Extension Playbook）

当需要为插件添加新功能时，请严格按以下落位点操作：

### 场景 A：新增一个官方模型预设（Preset）
1. 在 `packages/dsh-balance/lib/host/presets.js` 的 `OFFICIAL_PROVIDERS` 对象中添加配置项（包含 `id`, `endpoint`, `responsePath`, `currency`, `usageWindows` 等）。
2. 在 `packages/dsh-balance/lib/host/query.js` 中按需添加该 preset 的专属余额提取逻辑。
3. **严禁**在其他模块分散硬编码 `if (provider.preset === "xxx")`。

### 场景 B：新增一个 HTTP API 端点
1. 打开 `packages/dsh-balance/lib/host/routes.js`。
2. 在 `handleRequest` 派发链中追加处理分支，统一使用 `json(res, 200, ...)` 返回或抛出 `HttpError`。
3. 如果引入了新的数据持久化字段，在 `config-store.js` 的 `DEFAULT_CONFIG` 中注册默认值。

### 场景 C：新增外部监控源转换逻辑（Transform）
1. 打开 `packages/dsh-balance/lib/host/external-status.js`。
2. 在 `EXTERNAL_TRANSFORMS` 映射表中注册新的格式化函数。

### 场景 D：拆分新文件
1. 若在 `lib/host/` 下创建了新文件，**必须**同步将该文件路径加入 `scripts/check.mjs` 的 `files` 数组中以接受语法检查。

---

## 🔒 5. 安全红线（不可妥协）

- 🚫 **SSRF 防御**：所有出站请求必须强制校验公网 HTTPS，拦截私网 IP（`10.*`, `192.168.*`, `172.16-31.*`, `127.*`, `::1` 等）、`localhost` 与 `.internal` 域名。
- 🚫 **DNS 重绑定防御**：请求必须通过 `requestPinnedJson` 直连经 DNS 解析后固定的 IP，禁止直接使用带域名的原生请求。
- 🚫 **凭据防泄露**：API Key 仅能存入 DSH `credentials` 服务或临时保存在内存，严禁写入 `config.json`，严禁在 GET 接口中明文返回，错误日志中必须脱敏。
- 🚫 **无恶意执行**：JSON 路径禁止引入任意 JS 执行能力，严格过滤 `__proto__`、`constructor` 和 `prototype`。

---

## 🧪 6. 验证流程

每次修改完毕后，必须运行并全绿通过以下流程：

```bash
# 1. 语法检查 + Release 校验
pnpm check

# 2. 单元与安全测试（21 个测试断言）
pnpm test

# 3. 打包白名单与文件完整性校验
pnpm pack:check

# 4. 全流程流水线（必须全部通过）
pnpm verify

# 5. 同步本地代码图谱
codegraph sync
```
