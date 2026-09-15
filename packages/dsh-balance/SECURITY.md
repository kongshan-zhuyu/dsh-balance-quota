# Security Policy

请通过 GitHub Security Advisories 私下报告漏洞，不要在公开 issue 中粘贴 API Key 或完整的敏感响应。

插件只允许公网 HTTP/HTTPS，拒绝私网/回环地址、内部域名、重定向、危险请求头和超大响应；请求时会重新解析 DNS 并固定到已校验的公网地址。API Key 由 DSH `credentials` 服务管理，不进入余额 JSON 配置或浏览器响应。旧版 macOS Keychain 仅作为一次性迁移来源。

## 明文 HTTP

出站允许明文 HTTP，用于覆盖「网关部署在无域名裸 IP 上、无法签发证书」的场景。SSRF 防线不因此放宽：

- 协议白名单仍仅 `http:` / `https:`，传输通道由**校验后的 endpoint** 决定，不受重定向等远端输入影响；
- 端口取 endpoint 声明的值（缺省按协议回落 80/443）；
- 公网地址校验、DNS 解析后固定 IP、禁止重定向、拒绝内嵌凭据（`http://user:pw@host`）全部保留；
- 如部署环境要求强制 TLS，设置环境变量 `DSH_BALANCE_ALLOW_HTTP=0`。

明文 HTTP 意味着链路可被中间人读取与篡改，请自行评估网络环境；余额接口的凭据会以 `Authorization` 头明文传输。

## 内网地址判定

出站地址在放行前会逐条判定，判定基于**数值区间**而非字符串前缀，并先还原等价写法：

- IPv4-mapped（`::ffff:a.b.c.d`）与 IPv4-compatible（`::a.b.c.d`）先还原为 IPv4 再判定；
- NAT64（`64:ff9b::/96`）与 6to4（`2002::/16`）内嵌的 IPv4 同样还原后判定；
- 大小写与展开写法（`FC00::1`、`0:0:0:0:0:0:0:1`）不影响结果；
- 无法解析为合法 IP 的输入一律拒绝，不默认放行。

屏蔽范围包括回环、私网、链路本地（含云元数据 `169.254.169.254`）、CGNAT `100.64.0.0/10`、唯一本地 `fc00::/7`、组播、保留段与各类测试网段。详见 `lib/host/net.js` 中的 `privateIp`。
