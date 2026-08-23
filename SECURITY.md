# Security Policy

## Reporting a vulnerability

请不要在公开 issue 中披露凭据泄露、绕过公网地址校验或其他安全问题。请通过 GitHub Security Advisories 私下报告，或联系仓库维护者并附上：

- 复现步骤和完整错误信息（请先移除 API Key）。
- DSH Balance、DSH 和 Node.js 版本。
- 操作系统和安装方式。

## 安全边界

- 余额接口和用户配置的外部状态 API 仅允许公网 HTTPS，拒绝回环、私网、链路本地和内部域名。
- 保存和查询时都会解析 DNS，实际连接固定到已校验的公网地址，并保留 Host/TLS SNI，降低 DNS 重绑定风险。
- 禁止重定向，响应体限制为 512 KiB，请求头拒绝注入字符。
- API Key 通过 DSH `credentials` 服务保存和解析，不写入余额 JSON 配置，也不通过配置接口返回。
- 复用模型页凭据时，插件不会覆盖或删除该共享凭据。
- 外部状态源只支持 Host 端 GET + JSON，不发送模型凭据、Prompt 或模型请求；外部状态仅代表第三方监控结果。
- 旧版本 macOS Keychain 只作为一次性读取迁移来源，新版本不再向 Keychain 写入凭据。

## 支持版本

安全修复优先发布到最新版本。升级前请备份 `~/.dsh/balance/config.json`，但不要把凭据文件或包含密钥的日志提交到仓库。
