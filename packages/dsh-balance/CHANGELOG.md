# Changelog

## 0.3.7 - Released

- 出站请求放开明文 HTTP：网关部署在无域名裸 IP 上时无法签发证书，此前强制 HTTPS 会直接拦住余额查询与健康监测。
- 协议改为白名单（仅 `http:` / `https:`），传输通道由**校验后的 endpoint** 决定，端口取 endpoint 声明的端口（缺省按协议回落 80/443），不再硬编码 443。
- 明文 HTTP 请求不再携带 `servername` / `rejectUnauthorized`（https 专属选项），避免被对端当作 TLS 握手。
- 新增 `DSH_BALANCE_ALLOW_HTTP` 环境变量，设为 `0` 可恢复「仅 HTTPS」策略，默认允许。
- SSRF 防线不因放开 HTTP 而放宽：公网地址校验、DNS 解析后固定 IP、禁止 3xx 重定向、拒绝内嵌凭据与私网/回环/内部域名全部保留。
- 前端同步放开：健康监测地址校验由「必须 HTTPS」改为「http:// 或 https://」，余额查询地址文案与输入框占位符一并更新。
- 测试 37 → 39：新增公网 HTTP 放行、私网/凭据/非 HTTP 协议仍拒绝、`DSH_BALANCE_ALLOW_HTTP=0` 开关、传输选择与端口固定等断言。
- **模型设置在供应商卡片内就地展开**：卡片主按钮「模型设置」点击后直接在**该卡片内部**展开模型列表，不经弹窗、不进 Tab，一步直达。它是本插件的最高频操作，而它读的是 DSH 的 LLM settings 命名空间，与余额 `config.json` 无关，此前必须先完成余额编辑并保存才能进入的阻塞被彻底移除。展开态按 provider id 记录，同一时刻只有一张卡片展开，切换卡片不会串。
- **余额编辑退居次级入口**：卡片上的「余额设置」按钮打开原「高级设置」弹窗，内含「余额设置 / 健康监测」两页并默认停在余额页；原「模型设置」页已从该弹窗移出。弹窗顶部的供应商下拉已移除（供应商上下文由触发它的卡片决定），标题改为「余额设置 · 供应商名」。余额表单不再内联在卡片里，卡片收敛为 `模型设置 | 余额设置 | 删除` 三个操作。
- 未配置余额的供应商进入「余额设置」页时会被自动填成一份可直接保存的新表单（地址按模型页 `baseURL` 推导、凭据自动复用），无需先去余额编辑再回来。
- 修正 `+ 新建自定义 HTTPS 供应商` 的陈旧文案（0.3.7 已放开 HTTP），改为「+ 新建自定义余额供应商」。
- 测试 39 → 40：重写契约断言为「模型设置就地展开在供应商卡片内且永不依赖已保存的余额供应商」，锁住卡片内联模型区存在、展开态按 provider id 记录、同一时刻仅一张卡片展开、旧弹窗不再含模型页与供应商下拉。
- **两个 tab 的页脚统一**：余额设置的「取消 / 测试 / 保存」原先内联在表单末尾，随内容一起滚走（改完靠底字段还得滚回去才能保存），而健康监测页的页脚是弹窗的兄弟节点、天然固定——两页样式与行为不一致。现把余额表单的操作行**提到弹窗的兄弟页脚** ，与健康监测页共用同一结构与样式：都固定在弹窗底部、都不随内容滚动，按钮高度/圆角/字号同源，分隔线与内边距一致。保存按钮通过 `form="db-balance-form"` 关联内容区表单，仍支持原生提交与回车提交。原先为余额页临时加的 sticky 补丁规则已删除。
- **两个 tab 的表单外壳与顶部说明行统一**：余额页独有的 `.db-inline-editor` 是「余额表单内联在供应商卡片里」时代的残留样式（灰底圆角卡片 + 16px 内边距 + 12px 上边距）。表单搬进弹窗后，它让余额页比健康监测页**多一层灰色垫底、少 32px 可用宽度（684px vs 716px）、且顶部缺少说明行**。现两个外壳共用同一条规则（`transparent` / `padding:0` / `margin:0` / `border-radius:0` + 统一 `gap`），并为余额页补上对称的说明行「配置余额查询端点…」；健康页说明行原先靠 inline style 调间距，已改用共享类。
- 新增 `scripts/audit-tabs.mjs`（`pnpm dev:audit-tabs`）：在同一弹窗的两个 tab 之间逐项对比渲染值（外壳背景/内边距/外边距/圆角、表单栅格宽度与间距、label、input、说明文字、toggle、页脚），输出差异清单。页脚问题只是「两页不一致」里最显眼的一处，这个脚本用于把其余差异一次性找全。
- 测试 41 → 42：新增断言锁住「两个 tab 的外壳是同一种无样式容器且都有顶部说明行」——共享 CSS 规则存在且不带背景/内边距/圆角/外边距、旧的灰底卡片样式不得复活、两个外壳各自紧随一个说明行、说明行不得靠 inline style 调间距。
- **优化错误展示：上游返回 HTML 时不再把整页标签贴给用户**。此前网关/网关型上游返回 404 或 502 的 HTML 错误页（如 `Example Domain`、Cloudflare 拦截页）时，响应体会被原样拼进错误信息，卡片上出现一大片红色标签（`供应商返回 HTTP 404：<!doctype html><html lang="en"><head><title>…`），既读不出关键信息，又把卡片撑高。现新增 `HTML_SNIFF` 识别 + `summarizeHtmlBody()` 摘要：只保留 `<title>`/`<h1>` 的可读文本与响应体大小，输出形如 `返回了 HTML 页面「Example Domain」（559 B）`。
- 错误信息按状态码补中文提示，用户不必自己翻译：404→「该地址不存在，请核对余额查询地址」、401/403→「凭据无效或无权限，请检查 API Key」、429→「请求过于频繁，请稍后重试」、5xx→「上游服务异常，请稍后重试」。
- `summarizeHtmlBody()` 自身即调用 `sanitizeProviderError()` 脱敏：错误页的 `title` 可能回显 `Authorization: Bearer …`，该函数是导出的，任何直接调用点都必须安全，不能依赖「调用方会脱敏」。
- 卡片错误行改为**独占整行**（`flex:1 1 100%`）并允许换行（`min-width:0` + `overflow-wrap:anywhere`），再加 `-webkit-line-clamp:3` 限高，避免超长响应体把卡片撑破；完整文本挂到 `title`，悬停仍可查看全文。
- 状态栏（`.dsh-balance-value`）由 `flex:none` 改为可收缩 + 省略号（`max-width:340px`），长报错不再撑破极窄的状态栏；同样补 `title` 供悬停查看。
- 顺带本地化健康监测的两处英文报错：`external status source returned invalid JSON` → 「监控源返回的不是合法 JSON，请确认该地址返回 JSON 数据」。
- 新增 `scripts/verify-error-display.mjs`（`pnpm dev:verify-error`）：造一个指向 HTML 404 页的供应商，断言接口返回与卡片渲染文本均**不含尖括号**、含摘要与中文提示，并测量错误行的实际高度与 `line-clamp`。
- 测试 46 → 48：新增「上游 HTML 错误页必须被摘要而非原样贴出」（含脱敏不被绕过、长度受控、非 HTML 路径不受影响）与「HTML 摘要无 title 时优雅降级」两条断言；同时更新既有断言以覆盖新增的中文状态码提示。
- **错误展示加固：把「用户可见的每一个错误面」全部收口**。上一轮的摘要修复只覆盖了卡片与状态栏两处，而弹窗页脚（`.db-save-message`，显示 `测试失败：…`）是第三个渲染点——同一段上游响应会经三条不同路径显示。现为页脚补 `overflow-wrap:anywhere` 与 `max-height` 滚动，使长报错既不撑破弹窗也不被裁掉。
- 状态栏（`.dsh-balance-value`）从 `flex:none` 改为 `flex:0 1 auto` + `min-width:0` + `max-width:340px` + 省略号：它是整条界面里最窄的位置，此前一个长报错会把整条状态栏撑破。
- 新增覆盖率式断言「每一个用户可见的错误面都必须受限」：逐条锁定卡片错误行（`flex:1 1 100%` / `min-width:0` / `overflow-wrap:anywhere` / `-webkit-line-clamp`）、页脚（`max-height` + `overflow-y:auto` + `overflow-wrap:anywhere`）、状态栏（不得为 `flex:none`、必须有 `text-overflow:ellipsis`），要求卡片与状态栏的错误文本都必须通过 `title` 暴露全文，并禁止前端出现「拼接原始响应体」的写法（`textContent = selected.x.text` 之类）。这条断言的目的是防止同一类回归在第四个渲染点再次出现——逐个修补已经漏了两次。
- 新增 `scripts/verify-modal-test-error.mjs`：复现用户截图中的路径（在指向 HTML 404 页的供应商上打开「余额设置」→ 点「测试」），断言页脚文本不含尖括号、含 HTML 摘要与中文状态提示，并测量其实际渲染高度与溢出行为。
- 测试 48 → 49。
- **修复脱敏正则的两个边界缺陷**（在给 HTML 摘要写自测时暴露）：
  - **展示缺陷**：凭据 token 的字符类 `[^\s,;]+` 的补集**包含中文标点与数字**，于是摘要尾部紧跟凭据时会被整体吞掉——`Bearer sk-abcXYZ」（37 B）` 脱敏后残留 `Bearer [redacted] B）`，右括号与体积数字一并消失。现将 token 边界显式排除 CJK 标点（`\u3000-\u303f`）、全角字符（`\uff00-\uffef`）与引号括号，脱敏只切凭据本身、不动周边展示文本。
  - **安全缺陷**：标签正则只认 `api_key=` 这类下划线写法，漏掉 `API key: …`（**空格分隔**，上游报错文本里最常见的自然人写法）与 `apiKey=…`（**驼峰**，SDK 抛错常用）。更严重的是「无标签裸密钥」——`Invalid key: sk-live-xxxx` 这类没有任何 `key=` 前缀的回显原先完全没有兜底，会**原样泄露到界面**。现三种标签写法一并覆盖，并补一条 `sk-` / `pk-` / `rk-` 前缀的裸密钥兜底规则（放在标签规则之后，避免重复替换）。
  - 同时确认**不得过度脱敏**：`quota used: 37 %` 这类普通数字与百分号必须原样保留。
- 测试 49 → 50：新增「脱敏边界不得吞掉周边文本，且必须覆盖全部凭据写法」一条断言，含中文括号保留、体积标签完整、三种标签写法 + 裸密钥兜底共 6 项，以及防止过度脱敏的反向断言。已用变异测试确认两处缺陷复现时断言都会失败（分别报 `the closing CJK bracket must survive redaction` 与 `a bare sk- key must redact even with no label`）。
- **本地化 Host 层残留的 5 条英文报错**（端到端验证时发现）：`credential is missing in DSH credentials` → 「缺少可用的 API Key 或凭据引用，请在余额设置中填写凭据」、`provider returned invalid JSON` → 「供应商返回的不是合法 JSON…」、`balance response does not contain a numeric value` → 「余额响应中没有可用的数值（请核对余额 JSON 路径）」、`provider redirect is not allowed` → 「供应商返回了重定向…」、`provider response too large` → 「供应商响应体过大（超过 512 KB）…」、`provider request timed out` → 「供应商请求超时…」。这些文案会**原样出现在供应商卡片与弹窗页脚**。
- 测试 50 → 51：新增「Host 层用户可见错误文案必须为中文」枚举式断言——扫描宿主全部模块的 `new HttpError(<code>, "…")` 字面量，禁止「纯英文句子」形式复活。已用变异测试确认：把任一条改回英文，断言即失败并**点名具体文件与文案**。
- **「引入供应商」改为直接出卡片**：引入菜单项（从"模型"页引入 / 官方预设 / neco 模板）此前只把草稿装进表单（`setEditing`），用户还得再手工保存一步——用户反馈「点引入新供应商不应该直接增加一个卡片吗」。现点击菜单项 = 用自动填充的草稿（id / 名称 / 绑定路由 / 复用凭据 / 推断地址）**直接保存出卡片**，列表立即多一张；地址与 JSON 路径猜错时卡片会显示具体报错，用户再从卡片上的「余额设置」进入微调。仅两个场景保留表单：「+ 新建自定义余额供应商」（无信息可自动填充）与「直接保存失败」（草稿回落进表单供手动补全，输入不丢）。实现上把 `saveProvider` 的持久化核心抽成 `persistDraft(draft)`，表单保存与菜单引入共用同一通道（保序 upsert、绑定写回、状态刷新全套一致）。
- 新增 `scripts/verify-import-flow.mjs`（`pnpm dev:verify-import`）：点击引入菜单项后断言卡片数 +1、无弹窗、无「配置中」编辑器（`directCardAdded` / `newCardVisible`）。
- 测试 51 → 52：新增「引入供应商必须直接出卡片」断言——引入路径必须经 `importDirectly` → `persistDraft`，带 source 的引入不得进入表单编辑态；并锁定两个合法的表单回落场景。已用变异测试确认：在 `beginNeco` 里塞回 `setEditing`，断言即失败并报 `neco import must not enter the editing form`。
- **修复「在余额设置里点保存，对应供应商就跑到列表最下面」**：保存 provider 的 upsert 写成了「先滤掉旧的、再追加到末尾」，于是编辑任意一项都会把它挪到列表末位（卡片顺序直接来自 `config.providers`）。现改为**按 id 定位后原位替换**，只有新增才追加到末尾。注意这个缺陷在 **Host 与 Client 两处各有一份**：仅修 Host 时配置里存的顺序是对的，但前端那份本地副本仍会立刻重排，界面照样跳——两处必须用同一套保序语义。
- 同一缺陷在**健康监测源**上同样存在（Host 的 `/external-status-source` 与客户端 `saveExternal` 各一处），一并改为保序 upsert，匹配条件保持原语义（同 id，或同 `providerId`）。
- 新增 `scripts/verify-provider-order.mjs`（`pnpm dev:verify-order`）：记录**保存前后**的卡片顺序并断言被编辑项位置不变。脚本特意挑选**非末位**的卡片（挑最后一张则顺序错乱也看不出来），同时比对渲染顺序与配置中存储的顺序，避免「前端顺序对但存储顺序错」这类假绿。
- 测试 44 → 46：把原先只针对 providers 的文本匹配断言，升级为覆盖**全部四处 upsert**（客户端/Host × provider/监测源）的行为约束——禁止出现 `[...list.filter(...), item]` 形式的重排写法，并逐处校验「先 `findIndex` 定位、再 `map` 原位替换」。同时用变异测试确认：只改回其中任意一处，断言都会失败。
- **修复未配置余额的供应商在「余额设置」页点保存报 `invalid provider identity`**：该页过去直接预载 `blankForm`，而 `blankForm.id` 是空串，提交时被 Host 的 `validateProvider` 以 `isId` 规则拒绝。现在未纳入余额配置的供应商会拿到一份**完整可保存草稿**——`id` 取绑定路由或模型页 provider id、`name` 取模型页显示名、`endpointBase` 取模型页 `baseURL`、`credentialRef` 复用模型页凭据，用户只需补一个余额地址即可保存成功，无需重输 API Key。
- **修复「点取消没反应」**：把余额表单操作行提到弹窗页脚时，取消按钮只重置了表单却忘了关闭弹窗（健康页那侧是关的），两页行为不一致。现新增 `closeAdvanced()` 作为**唯一关闭入口**，背景点击、右上角 ×、余额页取消、健康页取消四条路径与两条保存成功路径全部收敛到它，同时清空两页草稿、测试结果与残留提示。
- 修复打开弹窗时的状态重置不对称：`openAdvanced` 只清了健康监测页的测试状态，导致上一次的 `测试失败：…` 红字会跟到下一次打开——用户刚保存成功、再进来却看到旧报错，很像「没保存上」。现两页测试状态对称重置。
- 保存失败同样显示在弹窗页脚：`saveProvider` 的 catch 原先只写卡片列表下方的提示位，弹窗打开时那一刻它在背后、用户根本看不见。现同时写入页脚提示区。
- 新增前置校验 `validateBalanceDraft()`：把「缺少供应商标识 / 显示名称 / 余额查询地址」等可判断问题在本地用中文说清并指明该填哪里，不再让用户直面英文报错。凭据缺失不在此拦截——Host 的 `/provider/test` 已返回中文「API Key 或凭据引用不能为空」，避免双重逻辑与误伤。
- Host 侧 `validateProvider` 的 `invalid provider identity` 文案本地化：按「显示名称非法」与「供应商标识非法」两种成因分别给出中文指引（该错误会原样回显给用户）。
- 新增 `scripts/verify-balance-flow.mjs` 与 `scripts/verify-balance-unconfigured.mjs`：端到端复现上述缺陷场景，覆盖草稿预载（含 `credentialRef` 复用信号）、取消关闭、重开无残留、保存成功关闭、以及 Host 裸接口报错文案。
- 测试 42 → 44：新增「未配置供应商必须拿到可保存草稿而非空白表单」与「所有关闭路径必须收敛到 `closeAdvanced`」两条回归断言；并用变异测试确认三条断言在缺陷复现时确实会失败（非空断言）。

## 0.3.6 - Unreleased

- 修复点击「高级设置」时的 `TypeError: Cannot read properties of undefined (reading 'llm')`：DSH 0.1.5-rc.2 已移除 `connection.api.<namespace>.<method>()`，Remote 命名空间改为独立 cordis 服务。
- 客户端改用 `ctx.get("remote.llm")` / `ctx.get("remote.settings")`，并在 `inject` 中声明 `remote`、`remote.llm`、`remote.settings`，保证命名空间挂载后才激活插件。
- 适配扁平化的 Remote 返回契约：成功读 `{ ok: true, value }`、失败读 `{ ok: false, error }`，不再读取旧版的 `{ result: { ok, value } }` 信封。
- 供应商目录改由 `llm.listProviders()` 与 `llm.listConfigurableProviders()` 在前端合并，等价于旧版 `llm.providers()` 的返回结构；未注册但已声明的路由以 `active: false` 保留，便于在高级设置中修复配置。
- 抽取统一的 Remote 失败信息提取与命名空间形状校验，避免再次出现解引用 `undefined` 导致的整页崩溃。

## 0.3.5 - Unreleased

- 关闭余额监测的供应商不再出现在状态栏供应商切换列表中，避免列表被无法提供余额的项占满。
- 状态栏默认展示与选择逻辑同步跳过已关闭监测的供应商，不再停留在只显示名称、既无余额也无法切换的项上。
- 修复 SSRF 绕过：内网地址判定改为数值区间比较，并先还原 IPv4-mapped（`::ffff:a.b.c.d`）与 IPv4-compatible 形式。此前 `::ffff:127.0.0.1`、`::`、`0:0:0:0:0:0:0:1` 等写法会被当作公网地址放行。
- 补充屏蔽 `100.64.0.0/10`（CGNAT）、`198.18.0.0/15`、`192.0.0.0/24`、`fec0::/10`、`ff00::/8` 及 NAT64 / 6to4 内嵌 IPv4 的地址段，大小写与展开写法不再影响判定。
- 无法解析的地址一律拒绝，不再默认放行。
- 新增 `lib/host/bounded-cache.js`：余额缓存与外部状态缓存改为有上限的 Map，按插入顺序淘汰，避免删除路径遗漏导致的条目泄漏。

## 0.3.4 - Unreleased

- 适配 DSH 0.1.5-rc.1：`dsh-settings` 移除了 `settingsNamespace()` 辅助函数，改为直接向 `settings.register()` 传入小写连字符命名空间字符串。
- 更新 `@deepseek-ai/dsh-settings` peer 依赖至 `^0.1.5-rc.2`。
- 修正设置页卡片槽位注册：`settings.plugin.item` 为 keyed 槽位，key 必须与 Host 端注册的 settings 命名空间一致，不再接受 `id`/`order`/`label`。

## 0.3.3 - Released

- 新增高级模型设置，可管理供应商模型列表、上下文窗口、文本/图片输入能力和推理等级。
- 新增外部模型健康监测，支持可视化 JSON 字段绑定、全模型预览、可用率、TTFT、响应耗时和历史状态展示。
- 状态栏新增健康监测入口，可直接查看模型状态、异常数量、自定义指标和最近状态记录。
- 自定义指标支持原文、数字、百分比和状态转换；数字字段可独立设置接口单位、显示单位与 0–2 位小数。
- 新增状态值映射和健康 JSON 预览缓存，重新打开编辑器时可恢复上次测试结果。
- 修复自定义字段空格、空白字段和数组索引路径导致的保存失败，并统一预览与正式详情的数字格式。
- 重写 GitHub 与 npm 使用文档，加入完整功能说明和 7 张真实脱敏界面截图。

## 0.3.2 - Released

- 新会话状态栏使用设置页指定的默认供应商，手动切换仍按会话独立记忆。
- 修复持续输出期间供应商切换和手动刷新失效，以及旧请求覆盖新选择的问题。
- 余额设置页支持测试未保存的供应商表单，测试不会写入配置、凭据或正式缓存。
- 建立主包版本、changelog、vX.Y.Z tag 与 GitHub Release 校验流程。

## 0.3.1 - Unreleased

- 将 DeepSeek 与 OpenCode Go 收敛为经过验证的统一官方余额/额度预设；不再把聊天或 token 统计接口误标为账户余额接口。
- 状态栏会按当前会话最近一次实际完成请求的 `provider/model` 自动匹配已绑定的余额供应商。
- 页面处于后台时暂停自动刷新；恢复可见时按每个供应商的 `queryIntervalMinutes` 判断是否需要查询。
- 同一供应商的多个会话复用 Host 端缓存；手动刷新仍可强制查询。
- 更新 README，补充支持范围、会话绑定、刷新策略与仓库截图。

## 0.3.0 - Unreleased

- 统一 DSH credentials 服务和跨平台安装流程。
- 增加单包 Bundle、Host、Client 发布形态。
- 增加旧版 macOS Keychain 迁移兼容。

## 0.2.0

- 支持 JSON 路径回退表达式、可选链和动态币种。

## 0.1.0

- 首次发布余额和额度查询插件。
