# AGENTS.md — dsh-balance-quota AI 开发指南

本项目是为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）Web 界面提供余额与额度状态栏的插件。
任何参与本仓库开发的 AI Agent 或协同工具，必须严格遵守以下设计理念、架构红线与扩展接缝规范。

---

## 🧭 1. 全局原则与哲学

1. **中文交流**：优先使用中文与开发者沟通和撰写文档说明。
2. **零构建哲学（Zero-Build）**：
   - 保持“**源码即发布包**”的纯粹性，**严禁**引入 rollup、esbuild、webpack 等打包器或将源码预编译为产物。
   - 依赖保持最小化，严禁随意引入第三方 runtime 依赖（Node 内建模块优先）。
3. **可观察行为零破坏**：任何重构或功能增补，必须保证现有 52 个测试断言与对外导出的 11 个公共符号 100% 兼容。
4. **遗留包防腐隔离**：
   - `packages/dsh-balance` 是**唯一定位对外发布和日常开发**的主包。
   - `packages/dsh-host-balance`、`packages/dsh-client-balance`、`packages/dsh-bundle-balance` 为迁移兼容基线，**绝不修改、绝不删除、绝不独立发布**。

---

## 🏗️ 2. Host 端架构与模块职责划分

Host 端位于 `packages/dsh-balance/lib/host/`，采用分层解耦架构，严禁随意堆叠逻辑：

| 模块文件 | 设计模式 | 职责与归属规则 |
| :--- | :--- | :--- |
| `net.js` | **安全防腐层** | 负责协议白名单（http/https）、DNS 提前解析、公网 IP 固定（`requestPinnedJson`）、`privateIp` 内网判定与 3xx 重定向拦截。网络底层改动仅能发生在此。 |
| `bounded-cache.js` | **数据结构** | `BoundedCache`：有上限的 Map，按插入顺序淘汰。所有按 id 增长的内存缓存必须使用它，禁止裸 `Map`。 |
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
   - 供应商卡片（`providerCard`）是**自包含**的渲染单元：操作行放该供应商的既有动作，
     需要「就地展开」的内容（如模型设置）挂在卡片内部、由 provider id 驱动的展开态控制，
     不要为了展示某个供应商的细节去引入全局弹窗或全局下拉。
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

### 场景 E：改动模型设置 / 余额设置的结构

Client 端的两个能力各有**不同的承载方式**，职责边界不可混淆：

| 能力 | 承载方式 | 内容 | 入口 |
| :--- | :--- | :--- | :--- |
| 模型设置 | **卡片内就地展开** `.db-models-inline`（非弹窗、非 Tab） | `ModelSettingsTab` | 供应商卡片主按钮「模型设置」 |
| 余额设置 | 弹窗 `advancedModal`（`aria-label="余额设置"`） | Tab：余额设置（默认）/ 健康监测 | 卡片「余额设置」按钮 |

约定：
1. **模型设置不得依赖余额配置**。它读 DSH 的 LLM settings 命名空间，与
   `config.json` 完全独立。任何新增的模型相关能力都应落在 `ModelSettingsTab` 内，
   **不要**重新引入「必须先保存余额」的前置条件。
2. **模型设置不得退回弹窗**。它是最高频操作，必须一步直达；展开态由
   `modelsExpandedFor`（存 provider id，而非布尔值）控制，保证同一时刻只有一张卡片
   展开、切换卡片不串。新增「展开型」卡片区域请沿用这一模式。
3. **余额设置弹窗不再有供应商下拉**。供应商上下文由「从哪张卡片点的」决定，
   弹窗标题渲染为 `余额设置 · 供应商名`。若要在弹窗里切换供应商，等于重新引入
   一个全局上下文——**先与维护者确认**。
4. **弹窗/展开区的渲染顺序必须保持 hooks 位置稳定**。任何 `useMemo` / `useState`
   都必须位于 `if (!config) return` **之前**，否则渲染期 hook 数量会随数据就绪而变化，
   React 抛 error #310（Rendered more hooks than during the previous render）。
5. 卡片上的按钮点击依赖 React 合成事件——自动化验证必须用 Playwright 原生
   `locator.click()`。
6. **长表单的操作行必须固定，且两个 tab 必须共用同一种页脚**。`.db-modal-content` 是滚动容器，
   放进它里面的表单若把操作行留在文档流末尾，用户改完靠底字段后得再滚回去才能保存。
   标准做法**只有一种**：把操作行作为 `.db-modal-content` 的**兄弟节点**渲染成 `.db-modal-footer`
   （余额设置页与健康监测页均如此）。按钮用 `form="<表单id>"` 关联内容区的 `<form>`，
   因此仍支持原生提交与回车提交。
   - 🚫 **禁止**在滚动容器内用 `position:sticky` + 负外边距自己钉一份操作行——
     这是历史遗留的临时做法，会让两个 tab 的页脚在尺寸、内边距、分隔线上出现肉眼可见的差异。
   - 页脚按钮尺寸由 `.db-modal-footer .db-quiet/.db-primary` 统一钉住（高度 36px / 圆角 18px），
     新增页脚按钮不要另写尺寸。
   - 若某页确实没有表单（如空状态引导页），页脚可以整体不渲染，但**不要**渲染成另一种结构。
7. **同一个弹窗里的多个 tab，必须做到「肉眼与计算样式双重一致」**。踩过的坑：
   - 余额页的 `.db-inline-editor` 是「表单内联在卡片里」时代的残留样式（灰底 + 圆角 + 内边距），
     搬进弹窗后让余额页比健康页**多一层灰底、少 32px 可用宽度**；
   - 只有健康页有顶部说明行，且靠 inline `style` 调间距。
   约定：
   - 两个 tab 的外壳类**必须写在同一条 CSS 规则里**（如 `.db-inline-editor,.db-external-form{...}`），
     共享类名不等于共享样式——分别定义迟早会跑偏。
   - 弹窗内的外壳只能是**纯排版容器**：不得带背景、内边距、圆角、外边距。
   - 两个 tab 都要有对称的顶部说明行，且**不得用 inline style** 单独调间距。
   - 改完必须跑 `pnpm dev:audit-tabs "<url>"` 把两个 tab 的渲染值逐项比对，**直到差异清单只剩
     业务上必然不同的项**（如各自的说明文案、各自特有的字段）。仅靠肉眼容易漏掉
     32px 宽度差这类不显眼的偏移。
8. **弹窗的开关状态必须收敛到唯一入口**。踩过的坑：把页脚按钮提取成独立渲染函数时，
   余额页的「取消」只重置了表单却忘了关弹窗（健康页那侧是关的），用户看到的就是「点了没反应」。
   约定：
   - 必须存在 `closeAdvanced()` 作为**唯一关闭入口**，背景点击、右上角 ×、两页的「取消」、
     保存成功后的收尾，全部走它，禁止出现 `setAdvancedOpen(false)` 的裸调用。
   - `closeAdvanced()` 必须同时清空**两页**的草稿与残留提示（`setTestResult(null)` /
     `setExternalSaveMessage("")` 等），否则下一次打开会看到上一次的空表单或红字报错。
   - `openAdvanced()` 必须**对称重置两页**的测试状态。只清一侧的后果是：上一次的
     `测试失败：…` 会跟到下一次打开，用户刚保存成功、再进来却看到旧报错，很像「没保存上」。
9. **未配置的供应商也必须拿到「可保存」的草稿**。踩过的坑：进入「余额设置」页时表单预载的是
   `blankForm`，而 `blankForm.id` 是空串，提交被 Host 的 `validateProvider` 以 `isId` 规则拒绝，
   用户只看到一句英文报错 `invalid provider identity`。约定：
   - 任何能进入编辑态的表单，`id` **不得为空**：优先取绑定路由，其次取模型页 provider id。
   - 能自动推导的字段一律补齐（显示名取模型页、`endpointBase` 取模型页 `baseURL`、
     `credentialRef` 复用模型页凭据），让用户只填真正必须手工提供的那一项。
   - 提交前必须过 `validateBalanceDraft()` 之类的本地校验，用**中文**说清缺什么、该在哪里补。
   - Host 侧新增校验错误文案时**必须中文化**（错误会原样回显给用户），且按成因分别给出指引，
     不要复用一句笼统的英文。
   - 同一类校验**只在一处维护**：Host 已返回中文错误（如 `/provider/test` 的
     「API Key 或凭据引用不能为空」）时，前端不要重复实现，避免双重逻辑与误伤。
10. **列表的 upsert 必须保持原有顺序**。踩过的坑：保存 provider 写成「先滤掉旧的、再追加到末尾」
    （`[...list.filter(x => x.id !== item.id), item]`），于是编辑任意一项都会把它挪到列表最后一名，
    用户看到的就是「点完保存，这张卡片跑到最下面去了」。约定：
    - 必须**先 `findIndex` 定位**，命中则 `map` 原位替换，未命中才追加到末尾。
    - 这条约束对 **Host 与 Client 两侧同时成立**。`providers` 与 `externalStatusSources` 的保存逻辑
      在两侧各有一份：**只修 Host 是无效的**——配置里存的顺序虽然对了，但前端那份本地副本会立刻
      按老逻辑重排，界面照样跳。改一处必须改一对。
    - 禁止出现 `[...xxx.filter(...), item]` 形式的列表重建（测试已全局拦截）。
    - 验证必须跑 `pnpm dev:verify-order "<url>"`，且脚本要挑**非末位**的卡片来测——
      挑最后一张时顺序错乱也看不出来。
11. **用户可见的错误文案必须经过收敛**，禁止把上游响应体原样贴出。踩过的坑：上游返回 HTML 错误页
    （网关 404/502、Cloudflare 拦截页）时，整段 `<!doctype html><html …><style>…` 被拼进错误信息，
    卡片上出现一大片红色标签，既读不出关键信息又把卡片撑高。约定：
    - 识别到 HTML 响应体时必须走 `summarizeHtmlBody()` 之类的**摘要**路径：只保留 `<title>`/`<h1>`
      的可读文本与响应体大小，例如 `返回了 HTML 页面「Example Domain」（559 B）`。
    - 错误信息要带**中文性质提示**（404→核对地址、401/403→检查凭据、429→稍后重试、5xx→上游异常），
      不要让用户自己翻译状态码。
    - **摘要函数自身必须脱敏**（内部调用 `sanitizeProviderError`）。错误页的 `title` 可能回显
      `Authorization: Bearer …`，不能依赖「调用方会脱敏」——这类函数是导出的，任何调用点都要安全。
    - 前端展示必须限制膨胀：错误行独占整行（`flex:1 1 100%` + `min-width:0`）、允许换行、
      用 `-webkit-line-clamp` 限高，并把完整文本挂到 `title` 供悬停查看。状态栏这类窄容器要能收缩省略。
    - 验证跑 `pnpm dev:verify-error "<url>"`：断言接口返回与卡片渲染文本**均不含 `<>`**。

---

## 🔒 5. 安全红线（不可妥协）

- 🚫 **SSRF 防御**：所有出站请求必须强制校验公网 HTTP/HTTPS，拦截私网 IP、`localhost` 与 `.internal` 域名。
  - 协议白名单**仅允许 `http:` 与 `https:`**。明文 HTTP 是刻意放开的：网关常部署在无域名的裸 IP 上，无法签发证书。
    可通过 `DSH_BALANCE_ALLOW_HTTP=0` 强制仅 HTTPS，默认开启。
  - 传输协议由**校验后的 `endpoint`** 决定（`target.secure ? https : http`），禁止由任何远端输入（如重定向目标）影响。
  - 端口必须取 `endpoint` 声明的端口（缺省按协议回落 80/443），禁止硬编码 443。
  - 内网判定必须走 `net.js` 的 `privateIp`，采用**数值区间比较**，禁止新增字符串前缀/正则匹配——前缀匹配漏掉了 IPv4-mapped 等等价写法（历史缺陷）。
  - 判定前必须先还原 `::ffff:a.b.c.d`（IPv4-mapped）、`::a.b.c.d`（IPv4-compatible）、NAT64 `64:ff9b::/96` 与 6to4 `2002::/16` 中的内嵌 IPv4。
  - 大小写与展开写法（`FC00::1`、`0:0:0:0:0:0:0:1`）不得影响判定；无法解析为合法 IP 的输入一律拒绝，禁止默认放行。
  - `servername` / `rejectUnauthorized` 属 https 专属选项，明文 HTTP 请求禁止携带（否则会被当作 TLS 尝试）。
- 🚫 **DNS 重绑定防御**：请求必须通过 `requestPinnedJson` 直连经 DNS 解析后固定的 IP，禁止直接使用带域名的原生请求。
- 🚫 **凭据防泄露**：API Key 仅能存入 DSH `credentials` 服务或临时保存在内存，严禁写入 `config.json`，严禁在 GET 接口中明文返回，错误日志中必须脱敏。
- 🚫 **无恶意执行**：JSON 路径禁止引入任意 JS 执行能力，严格过滤 `__proto__`、`constructor` 和 `prototype`。

---

## 🧪 6. 验证流程

每次修改完毕后，必须运行并全绿通过以下流程：

```bash
# 1. 语法检查 + Release 校验
pnpm check

# 2. 单元与安全测试（52 个测试断言）
pnpm test

# 3. 打包白名单与文件完整性校验
pnpm pack:check

# 4. 全流程流水线（必须全部通过）
pnpm verify

# 5. 同步本地代码图谱
codegraph sync
```

### 6.1 UI 改动必须做真实浏览器验证

任何触及 `lib/client/client.js` 渲染结构的改动，`pnpm verify` 全绿**不足以**证明可用——
本项目的两次真实崩溃（React error #310 hooks 数量不一致、未定义变量导致分区渲染失败）
在测试断言里全是绿的，只在浏览器截图里暴露。请启动 `dsh web` 后运行：

```bash
pnpm dev:verify-ui "http://127.0.0.1:<port>/?token=<token>"
```

它会走完「设置 → 插件 → 展开『供应商状态』→ 点卡片『模型设置』→ 点卡片『余额设置』→
在两个 tab 间切换」链路并截图到 `browser-screenshots/`，同时回报卡片按钮组、
模型区是否**在卡片内部**展开、展开态是否唯一、余额弹窗是否还残留供应商下拉、
两个 tab 的页脚是否统一，以及 console error。
**务必人工查看截图**，并以
`consoleErrors` 为空、`inlineInsideCard` 全为 `true`、
`inlineSectionsAfterSwitchingCard === 1`、`balanceModal.providerSelect === 0`、
`unifiedFooter.bothSiblingOfContent === true`、`unifiedFooter.sameButtonHeight/Radius/FontSize` 全为 `true`、
`footerPinned.movedPx === 0` 作为通过标准。

**跨 tab 一致性另跑一个审计脚本**（页脚只是最显眼的一处，其余差异靠它找全）：

```bash
pnpm dev:audit-tabs "http://127.0.0.1:<port>/?token=<token>"
```

它会在两个 tab 之间逐项对比渲染值（外壳背景/内边距/外边距/圆角、表单栅格宽度与间距、
label、input、说明文字、toggle、页脚），输出 `diffs` 清单。**通过标准是：清单里只剩业务上
必然不同的项**（各自的说明文案、各自特有的字段），不应再有尺寸/颜色/间距类差异。

**表单交互（保存 / 取消 / 校验）必须跑功能复现脚本**。样式一致不代表能存上——
「点保存报错」「点取消没反应」这类缺陷在 UI 脚本里全是绿的：

```bash
pnpm dev:verify-flow        "http://127.0.0.1:<port>/?token=<token>"   # 已配置供应商路径
pnpm dev:verify-unconfigured "http://127.0.0.1:<port>/?token=<token>"  # 未配置供应商路径（缺陷高发区）
```

通过标准：
- `modalClosedByCancel === true` 且 `cancelClicked === "ok"`——「取消」必须真的关闭弹窗；
- `hasStaleError === false`、`footerMessages === []`——重开不得残留上一次的红字；
- `saveResult.modalStillOpen === false` 且有成功提示——「保存」必须关闭弹窗并给出反馈；
- `mentionsEnglishIdentityError === false`——不得再出现 `invalid provider identity`；
- `reuseLine` 非空——未配置供应商的草稿确实复用了模型页凭据；
- `consoleErrors` 为空。

**列表顺序改动必须跑保序脚本**（顺序错乱时功能脚本全是绿的，肉眼也容易漏）：

```bash
pnpm dev:verify-order "http://127.0.0.1:<port>/?token=<token>"
```

通过标准：`orderUnchanged === true`、`targetStayedAtSameIndex === true`、
且 `afterOrder` 与 `configProviderOrder` 完全一致（防止「前端顺序对、存储顺序错」的假绿）。

**「引入供应商」交互改动必须跑引入脚本**（`pnpm dev:verify-import "<url>"`）：
引入菜单项 = 用自动填充草稿**直接保存出卡片**，不是进表单。
通过标准：`directCardAdded === true`（卡片数 +1 且无弹窗、无「配置中」编辑器）、
`newCardVisible === true`。仅「自定义接入」与「直接保存失败」允许出现表单。
**断言必须能失败**。写回归用例时，请人为把缺陷改回去（变异测试）确认用例确实报错，
否则容易写出「永远为真」的空断言（本项目就踩过：用 `input[type=hidden]` 去读只存在于
React state 里的 `credentialRef`，拿到空数组却断言通过）。

注意事项：
- 本机 `agent-browser` 未安装，脚本复用项目自带的 `playwright`；其 Chromium revision
  常与已安装版本不匹配，脚本已用 `existsSync` 探测 `chromium-1217` 并传入 `executablePath`。
- 设置面板是 `[role="dialog"]`，其左侧导航项文案为 `插件`；插件卡片标题是 **「供应商状态」**
  （不是包名 `dsh-balance-quota`）。点击必须用 Playwright 原生 `locator.click()`——
  `element.click()` 触发不到 React 合成事件。
- 设置面板内容区可滚动，点按钮前需 `scrollIntoViewIfNeeded()`。
- 模型区**不是弹窗**，断言用 `.db-models-inline`（带 `data-provider` 属性）且
  `closest(".db-provider-card")` 必须非空；余额设置才是弹窗，用
  `.db-modal[aria-label="余额设置"]` 定位。

### 6.2 发布流程（tag 触发自动 Release）

1. 版本对齐：`packages/dsh-balance/package.json` 版本号与 CHANGELOG 双文件的
   `## X.Y.Z - Released` 小节同步，`pnpm release:check --tag=vX.Y.Z` 校验通过。
2. 提交并推送 main 后打注解 tag（message 用 `dsh-balance-quota vX.Y.Z` 风格），
   `git push origin main vX.Y.Z`。
3. **推送 tag 会触发 `.github/workflows/release.yml`**：在 CI 里重跑 `release:check` 与
   `verify`，全部通过后自动创建/更新 GitHub Release（`softprops/action-gh-release`，已存在则更新）。
4. Release 正文优先取 **`release-notes/vX.Y.Z.md`**（人工分组摘要：亮点 / 体验改进 / 修复）；
   不存在时回落 CHANGELOG 对应小节全文。需要简约说明就在打 tag 前提交该文件。
5. ⚠️ **改动依赖后必须重新生成并提交 `pnpm-lock.yaml`**：CI 用 `--frozen-lockfile` 安装，
   lockfile 与 package.json 的 specifiers 不一致会拦下全部工作流（v0.3.7 时
   `@deepseek-ai/dsh-settings` 曾因此三工作流齐挂、Release 页空白）。
6. 发布页正文的事后修改用 `gh release edit vX.Y.Z --notes-file <文件>`。

---

## 🧩 7. DSH 平台兼容性（升级 DSH 时必读）

插件跟随 DSH 的 API 演进，升级 DSH 后必须重新核对以下契约：

| 契约点 | 落位 | 现状（DSH 0.1.5-rc.1 基线） |
| :--- | :--- | :--- |
| **Settings 命名空间注册** | `lib/host/index.js` | `settings.register(ns, schema)` 直接接收小写连字符字符串。`settingsNamespace()` 辅助函数**已移除**，禁止再引入。命名空间必须匹配 `/^[a-z][a-z0-9-]*$/`。 |
| **Settings 卡片槽位** | `lib/client/client.js` | `settings.plugin.item` 是 **keyed 槽位**，只接受 `name` 与 `key`；`key` 必须等于 Host 端注册的 settings 命名空间。`id` / `order` / `label` 会被忽略，卡片由 `settingsScope.describe()` 按命名空间派发。 |
| **状态栏槽位** | `lib/client/client.js` | `conversation.composer.dock` 为 list 槽位，使用 `id` + `order`，契约未变。 |
| **Remote 命名空间** | `lib/client/client.js` | `connection.api.<ns>.<method>()` **已移除**。Remote 命名空间是独立 cordis 服务，必须 `ctx.get("remote.llm")` / `ctx.get("remote.settings")`，且在 `inject` 中显式声明 `remote`、`remote.llm`、`remote.settings`。返回值为扁平契约 `{ ok: true, value }` / `{ ok: false, error: { code, message } }`，**不再**是 `{ result: { ok, value } }`。 |
| **供应商目录** | `lib/client/client.js` | 旧 `llm.providers()` 已拆为 `llm.listProviders()`（已注册路由，仅 `id`/`name`）与 `llm.listConfigurableProviders()`（可配置声明，带 `settingsNs`/`settingsPath`），前端需自行 join（见 `joinProviderDirectory`）。 |
| **路由注册** | `lib/host/index.js` | `webServer.register({ kind: "prefix", path, handler })`，契约未变。 |
| **凭据服务** | `lib/host/query.js` | `ctx.credentials.resolve/set/unset`，契约未变。 |

**升级 DSH 后的核查清单：**

1. 确认 `@deepseek-ai/dsh-settings` 实际版本，并同步 `packages/dsh-balance/package.json` 的 `peerDependencies`。
2. 若 `dsh-settings` 的导出面变化，重新核对命名空间注册方式（参考内置包的 `settings.register` 用法，如 `dsh-agent-presets`）。
3. 若设置页卡片不再显示，优先检查 keyed 槽位的 `key` 是否与 Host 命名空间一致。
4. **若高级设置面板报 `Cannot read properties of undefined (reading 'llm' / 'settings')`**，说明 Remote 契约再次变动：到
   `node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.remote-client.d.ts` 与
   `@deepseek-ai/dsh-api-settings-controller/lib/typert.remote-client.d.ts` 核对生成的方法签名与返回形状。
5. 运行 `pnpm verify`；`scripts/check.mjs` 已内置命名空间一致性守卫，测试套件亦断言客户端不再解引用 `connection.api`，会拦截回退到已移除 API 的改动。

> 注意：Windows 下 `pnpm test` / `pnpm verify` 的 TAP 输出可能被管道吞掉。需查看详情时直接运行
> `node --test packages/dsh-balance/test/*.test.js` 并重定向到文件后读取。
