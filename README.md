> **English** | [**中文**](README.zh.md)

# dsh-wps

WPS / 金山文档 (WPS Cloud Docs) integration for DeepSeek Harness (DSH).

Talk to your **WPS cloud drive** in the DSH conversation: list / search / read / create /
upload-download cloud documents, and read / write their text / spreadsheet /
presentation / PDF content. It connects to the **official Kingsoft SkillHub MCP**
(`https://mcp-center.wps.cn/skill_hub/mcp`) and registers its tools as `mcp__wps__*`.

- Custom browser authorization (auth-guide + exchange-poll token), no standard OAuth.
- Access token stored at `~/.dsh/dsh-wps.json` (mode 0600).
- **558 tools** discovered dynamically from the official SkillHub (drive / wps / sheet /
  wpp / dbsheet / pdf / form / aippt).
- Auto-registers `mcp__wps__<name>` tools + 4 helper tools (`wps_status` /
  `wps_oauth_start` / `wps_test` / `wps_clear`) + a web settings panel "WPS".

## Install (from npm)

```bash
dsh plugin --profile web add dsh-wps
# or from Git:
# dsh plugin --profile web add github.com/zhengjy01/dsh-wps
```

Restart, then trigger authorization (browser opens the WPS login page, use a
**personal** WPS account — enterprise accounts are rejected). After that you can just
say things like "列一下我的 WPS 云文档根目录".

## Usage (examples)

| You say | Tool |
| --- | --- |
| "看看我最近的 WPS 文件" | `mcp__wps__list_latest_items` |
| "列我的云文档根目录" | `mcp__wps__list_my_files` |
| "搜含『周报』的文件" | `mcp__wps__search_files` |
| "读这个文档/表/演示" | `read_file` / `sheet.get_range_data` / `read_slide` |
| "新建一个 docx，内容是……" | `create_file_with_content` |
| "把这个演示导出 PDF" | `wpp.export.export.pdf` |

Full tool list = whatever `wps_test` reports (558 tools).

## Auth (implementation note)

`mcp-center.wps.cn/.well-known/oauth-authorization-server` returns 404, so WPS uses a
**custom** flow, not MCP OAuth discovery: generate `auth_code` → open
`https://mcp-center.wps.cn/kdocs-auth/auth-guide?auth_code=<uuid>` → user logs in →
poll `POST https://api.wps.cn/office/v5/ai/skill_hub/wps_auth/exchange` (body `{code}`)
every second until `{code:200, token}`. 403 = enterprise account rejected, 409 = cancelled.
The token is then the Bearer credential on every JSON-RPC call to the SkillHub MCP.

## Directory

```
dsh-wps/
├── src/
│   ├── index.ts     # cordis plugin entry (apply + helper tools + announcement)
│   ├── store.ts     # token store (~/.dsh/dsh-wps.json, 0600)
│   ├── auth.ts      # browser authorization (auth-guide + exchange poll)
│   ├── mcp.ts       # JSON-RPC-over-HTTP MCP client + dynamic mcp__wps__* registration
│   ├── routes.ts    # /api/dsh-wps/* (settings panel)
│   └── client/      # web settings panel "WPS"
├── cordis.patch.yml # bundle patch (insert wps row)
├── tsdown.config.ts # host + client bundle build
└── package.json     # dsh.bundle.patch declaration
```

## License

MIT
