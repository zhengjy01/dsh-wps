[**English**](README.md) | **中文**

# dsh-wps

> DeepSeek Harness（DSH）WPS / 金山文档云文档能力集成插件。
> 装上后，你可以在 DSH 对话里用自然语言操作 **WPS 云文档**：列目录、搜索、读取、创建、上传/下载云文档，以及文字/表格/演示/PDF 的内容读写。

## 它做什么

- 连接**金山文档官方 SkillHub MCP**（`https://mcp-center.wps.cn/skill_hub/mcp`）。
- 通过**自定义浏览器授权**（auth-guide + exchange 轮询拿 token，非标准 OAuth）登录你的 WPS 个人账号。
- 授权后把官方 MCP 的工具**动态注册**为 `mcp__wps__<名称>`（云盘 / wps / sheet / wpp / dbsheet / pdf / form / aippt 等）。
- 提供 4 个帮助工具 `wps_status` / `wps_oauth_start` / `wps_test` / `wps_clear`，并带 Web 设置面板「WPS」。

## 安装（npm）

```bash
dsh plugin --profile web add dsh-wps
# 或从 Git：
# dsh plugin --profile web add github.com/zhengjy01/dsh-wps
```

重启后触发授权：浏览器会打开 WPS 登录页，用**个人 WPS 账号**登录授权（企业账号会被拒绝）。之后即可直接说「列一下我的 WPS 云文档根目录」。

## 使用（示例）

| 你说的话 | 调用 |
| --- | --- |
| 「看看我最近的 WPS 文件」 | `mcp__wps__list_latest_items` |
| 「列我的云文档根目录」 | `mcp__wps__list_my_files` |
| 「搜含『周报』的文件」 | `mcp__wps__search_files` |
| 「读这个文档/表/演示」 | `read_file` / `sheet.get_range_data` / `read_slide` |
| 「新建一个 docx，内容是……」 | `create_file_with_content` |
| 「把这个演示导出 PDF」 | `wpp.export.export.pdf` |

全部工具名以 `wps_test` 实际列出为准（共 558 个）。

## 授权（实现要点）

`mcp-center.wps.cn/.well-known/oauth-authorization-server` 返回 404，说明 WPS 不用标准 MCP OAuth 发现，而是**自定义**流程：生成 `auth_code` → 打开 `https://mcp-center.wps.cn/kdocs-auth/auth-guide?auth_code=<uuid>` → 用户登录 → 每秒轮询 `POST https://api.wps.cn/office/v5/ai/skill_hub/wps_auth/exchange`（body `{code}`）直到 `{code:200, token}`。403=企业账号被拒（用个人号）、409=已取消。token 作为每次 JSON-RPC 调用到 SkillHub MCP 的 Bearer 凭据。

## 目录结构

```
dsh-wps/
├── src/
│   ├── index.ts     # cordis 插件入口（apply + 帮助工具 + 公告）
│   ├── store.ts     # token 存储（~/.dsh/dsh-wps.json，0600）
│   ├── auth.ts      # 浏览器授权（auth-guide + exchange 轮询）
│   ├── mcp.ts       # JSON-RPC-over-HTTP MCP 客户端 + 动态注册 mcp__wps__*
│   ├── routes.ts    # /api/dsh-wps/*（设置面板）
│   └── client/      # Web 设置面板「WPS」
├── cordis.patch.yml # bundle patch（insert wps 行）
├── tsdown.config.ts # host + client bundle 构建
└── package.json     # dsh.bundle.patch 声明
```

## License

MIT
