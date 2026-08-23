# Changelog

## 0.3.2 - Unreleased

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
