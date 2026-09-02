import { defineTool } from "@deepseek-ai/dsh-tools";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
//#region src/store.ts
/**
* dsh-wps — WPS cloud-doc credential store.
*
* Persists the WPS SkillHub access token to ~/.dsh/dsh-wps.json (mode 0600).
* Secrets never leave this module; the public view() masks everything. The
* config path can be overridden with DSH_WPS_CONFIG (used by tests).
*/
/** Default machine-wide config location (mode 0600). */
const DEFAULT_CONFIG_FILE = path.join(homedir(), ".dsh", "dsh-wps.json");
/** Test override for the config location. */
function configPath() {
	const override = process.env.DSH_WPS_CONFIG;
	return override !== void 0 && override !== "" ? override : DEFAULT_CONFIG_FILE;
}
/** The official WPS SkillHub MCP endpoint. */
const MCP_URL = "https://mcp-center.wps.cn/skill_hub/mcp";
/** WPS browser authorization guide URL (login + consent page). */
const AUTH_GUIDE_URL = "https://mcp-center.wps.cn/kdocs-auth/auth-guide";
/** WPS token exchange endpoint (plugin polls it with the auth_code). */
const EXCHANGE_URL = "https://api.wps.cn/office/v5/ai/skill_hub/wps_auth/exchange";
/** Mask a credential for display, keeping only the head and tail. */
function mask(value) {
	if (!value) return "";
	if (value.length <= 8) return value.slice(0, 2) + "****";
	return value.slice(0, 4) + "****" + value.slice(-4);
}
/** Empty credentials record. */
function empty() {
	return {
		token: null,
		tokenUpdatedAt: ""
	};
}
/** Parse an unknown JSON record into credentials (tolerates missing keys). */
function parse(raw) {
	const record = typeof raw === "object" && raw !== null ? raw : {};
	const str = (value) => typeof value === "string" ? value : "";
	return {
		token: str(record.token) !== "" ? str(record.token) : null,
		expiresIn: typeof record.expiresIn === "number" ? record.expiresIn : void 0,
		tokenUpdatedAt: str(record.tokenUpdatedAt)
	};
}
/**
* Small credential store backed by ~/.dsh/dsh-wps.json.
* Reads are lazy and cached; writes use mode 0600 so the WPS access token
* never leaks to other local users.
*/
var WpsStore = class {
	config = null;
	async load() {
		if (this.config !== null) return this.config;
		try {
			const raw = await readFile(configPath(), "utf8");
			this.config = parse(JSON.parse(raw));
		} catch {
			this.config = empty();
		}
		return this.config;
	}
	async save(next) {
		this.config = next;
		await mkdir(path.dirname(configPath()), { recursive: true });
		await writeFile(configPath(), JSON.stringify(next, null, 2), { mode: 384 });
	}
	/** Persist a fresh access token. */
	async setToken(token, expiresIn) {
		await this.save({
			token,
			expiresIn: typeof expiresIn === "number" ? expiresIn : void 0,
			tokenUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	}
	/** Clear only the access token. */
	async clearToken() {
		const cfg = await this.load();
		cfg.token = null;
		cfg.tokenUpdatedAt = "";
		await this.save(cfg);
	}
	/** Public, secret-free view. */
	async view() {
		const cfg = await this.load();
		return {
			configured: cfg.token !== null,
			authorized: cfg.token !== null && cfg.token.trim() !== "",
			tokenUpdatedAt: cfg.tokenUpdatedAt,
			mcpUrl: MCP_URL,
			authGuideUrl: AUTH_GUIDE_URL,
			configPath: configPath()
		};
	}
};
//#endregion
//#region src/auth.ts
/**
* dsh-wps — WPS SkillHub browser authorization.
*
* The official WPS cloud-doc MCP uses a custom, non-standard auth flow (no
* MCP OAuth discovery — the well-known endpoint 404s):
*
*   1. Generate a random `auth_code` and open the browser to
*      `https://mcp-center.wps.cn/kdocs-auth/auth-guide?auth_code=<uuid>`.
*   2. The user logs into WPS and consents; the server marks that auth_code
*      as authorized.
*   3. The plugin POLLS the exchange endpoint
*      `https://api.wps.cn/office/v5/ai/skill_hub/wps_auth/exchange` with the
*      same auth_code every second until the server returns an access token
*      (or times out). No loopback callback server is required.
*
* The returned token is then used as the `Authorization: Bearer <token>` on
* every MCP request to https://mcp-center.wps.cn/skill_hub/mcp.
*/
/** Maximum wait for the user to complete browser authorization (5 minutes). */
const AUTH_TIMEOUT_MS = 300 * 1e3;
/** How often to poll the exchange endpoint (1 second). */
const POLL_INTERVAL_MS = 1e3;
/** Client identity reported to WPS. */
const WPS_CLIENT_NAME = "dsh-wps";
/** Skill version reported to WPS. */
const WPS_SKILL_VERSION = "1.0.0";
/**
* Open the OS browser for a URL without an extra npm dependency.
*/
function openBrowser(url) {
	const platform = process.platform;
	let command;
	let args;
	switch (platform) {
		case "win32":
			command = "rundll32";
			args = ["url.dll,FileProtocolHandler", url];
			break;
		case "darwin":
			command = "open";
			args = [url];
			break;
		default:
			command = "xdg-open";
			args = [url];
			break;
	}
	execSync(`${command} ${args.map((a) => `"${a}"`).join(" ")}`, { stdio: "ignore" });
}
/**
* Poll the WPS exchange endpoint until the auth_code yields a token.
* @param authCode - the browser-flow auth_code.
* @param timeoutMs - overall deadline.
* @returns the token (and optional expiry seconds).
* @throws on timeout or a fatal exchange error (403 enterprise reject / 409 cancelled).
*/
async function pollToken(authCode, timeoutMs = AUTH_TIMEOUT_MS) {
	const deadline = Date.now() + timeoutMs;
	const body = JSON.stringify({ code: authCode });
	let pollCount = 0;
	while (Date.now() < deadline) {
		pollCount += 1;
		try {
			const response = await fetch(EXCHANGE_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": `${WPS_CLIENT_NAME}/${WPS_SKILL_VERSION}`
				},
				body,
				signal: AbortSignal.timeout(15e3)
			});
			if (!response.ok) {
				await sleep(POLL_INTERVAL_MS);
				continue;
			}
			const data = await response.json();
			const nested = typeof data.data === "object" && data.data !== null ? data.data : {};
			const code = data.code ?? nested.code;
			const token = data.token ?? nested.token;
			const expiresIn = data.expires_in ?? nested.expires_in;
			if (Number(code) === 200 && token) return {
				token,
				expiresIn: typeof expiresIn === "number" ? expiresIn : void 0
			};
			if (Number(code) === 403) throw new Error("企业账号授权被拒绝，请使用个人 WPS 账号重新授权");
			if (Number(code) === 409) throw new Error("本次授权已取消，请重新授权");
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("企业") || error instanceof Error && error.message.startsWith("本次")) throw error;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error("授权超时（5 分钟），请重新触发授权");
}
/**
* Trigger the browser authorization flow and return the access token,
* persisting it to the store.
*/
async function authorize(store) {
	const authCode = randomUUID();
	openBrowser(`${AUTH_GUIDE_URL}?auth_code=${authCode}`);
	const { token, expiresIn } = await pollToken(authCode);
	await store.setToken(token, expiresIn);
	return token;
}
/** Ensure a token exists: return the stored one or trigger authorization. */
async function ensureAuthenticated(store) {
	const cfg = await store.load();
	if (cfg.token && cfg.token.trim() !== "") return cfg.token;
	return authorize(store);
}
/** Small sleep helper. */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
//#endregion
//#region src/mcp.ts
/**
* dsh-wps — WPS SkillHub MCP connection (custom JSON-RPC-over-HTTP client).
*
* WPS's cloud-doc MCP has no standard OAuth discovery, so we talk to
* https://mcp-center.wps.cn/skill_hub/mcp directly over JSON-RPC 2.0, using
* the BrowserAuth access token as the Bearer credential on every request:
*
*   initialize (protocolVersion 2024-11-05) -> notifications/initialized
*       -> tools/list (paged) -> register mcp__wps__<rawName>
*       -> tools/call (per registered tool)
*
* The server's business results are wrapped in an MCP content envelope:
* { jsonrpc, id, result: { content: [{ type: 'text', text: '{"code":0,...}' }] } }
* — we surface the text blocks verbatim (the agent parses the nested JSON).
*/
/** DeepSeek function-name contract: at most 64 characters. */
const MAX_PUBLIC_NAME_LENGTH = 64;
/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;
/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12;
/** Default per-request timeout (ms). */
const REQUEST_TIMEOUT_MS = 6e4;
/** MCP protocol version we announce. */
const PROTOCOL_VERSION = "2024-11-05";
/**
* Derive the model-facing public name (mcp__wps__<rawName>).
*
* WPS's server tool names use dots as namespace separators (e.g.
* `sheet.get_range_data`). Dots are not valid in a DeepSeek function name, so
* they map deterministically to underscores; because every WPS tool is dotted,
* we do NOT append a hash for dot-only normalization — that would make every
* public name unreadable. We only fall back to the lossy hashed form when a
* name contains genuinely invalid characters beyond dots (spaces, slashes,
* colons, ...) or exceeds the 64-char ceiling.
*/
function publicToolName(rawName) {
	const joined = `mcp__wps__${rawName}`;
	const normalized = joined.replace(INVALID_NAME_CHARS, "_");
	if (!/[^A-Za-z0-9_.-]/.test(joined) && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
	const hash = createHash("sha256").update(`wps\0${rawName}`).digest("hex").slice(0, HASH_LENGTH);
	return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}
/** Extract readable text from an MCP content array. */
function extractText(mcpContent, toolName) {
	if (!Array.isArray(mcpContent)) return `(${toolName} returned non-content output)`;
	const parts = [];
	for (const value of mcpContent) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const block = value;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n") || `(${toolName} returned no text content)`;
}
/**
* Create the WPS MCP supervisor.
* @param ctx - cordis context carrying the tools registry and logger.
* @param store - credential store.
*/
function createSupervisor(ctx, store) {
	let conn = null;
	let disposers = /* @__PURE__ */ new Map();
	let disposed = false;
	/** Send one JSON-RPC request and return the result plus the echoed session id. */
	async function rpc(method, params, token, sessionId, isNotification) {
		const body = {
			jsonrpc: "2.0",
			method
		};
		if (!isNotification) body.id = 1;
		if (params !== void 0 && !isNotification) body.params = params;
		const headers = {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${token}`,
			"X-Skill-Version": WPS_SKILL_VERSION,
			"X-Request-Source": WPS_CLIENT_NAME,
			"User-Agent": `${WPS_CLIENT_NAME}/${WPS_SKILL_VERSION}`
		};
		if (sessionId) headers["Mcp-Session-Id"] = sessionId;
		const response = await fetch(MCP_URL, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		const nextSessionId = response.headers.get("mcp-session-id") ?? response.headers.get("Mcp-Session-Id");
		if (isNotification) return {
			result: void 0,
			sessionId: nextSessionId
		};
		const rawText = await response.text();
		let json;
		try {
			json = JSON.parse(rawText);
		} catch {
			throw new Error(`WPS MCP ${method} 失败 (HTTP ${response.status}): ${rawText.slice(0, 240)}`);
		}
		if (json.error) throw new Error(`WPS MCP ${method} 失败: ${json.error?.message ?? JSON.stringify(json.error)}`);
		return {
			result: json.result ?? json,
			sessionId: nextSessionId
		};
	}
	/** Open a fresh session (initialize + initialized notification). */
	async function openSession(token) {
		let sessionId = null;
		sessionId = (await rpc("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: {
				name: WPS_CLIENT_NAME,
				version: WPS_SKILL_VERSION
			}
		}, token, null, false)).sessionId;
		sessionId = (await rpc("notifications/initialized", void 0, token, sessionId, true)).sessionId ?? sessionId;
		return {
			token,
			sessionId
		};
	}
	/** List all tools from the server (paged). */
	async function listTools(token, sessionId) {
		const tools = [];
		let cursor = null;
		do {
			const result = (await rpc("tools/list", cursor === null ? {} : { cursor }, token, sessionId, false)).result;
			for (const tool of result?.tools ?? []) tools.push({
				name: String(tool.name ?? ""),
				description: typeof tool.description === "string" ? tool.description : "",
				inputSchema: tool.inputSchema ?? {}
			});
			cursor = result?.nextCursor ?? null;
		} while (typeof cursor === "string" && cursor !== "");
		return tools;
	}
	/** Register mcp__wps__* tools from a tool list, replacing prior registrations. */
	async function syncTools(activeConn) {
		const tools = await listTools(activeConn.token, activeConn.sessionId);
		for (const dispose of disposers.values()) dispose();
		disposers = /* @__PURE__ */ new Map();
		for (const tool of tools) disposers.set(publicToolName(tool.name), ctx.tools.register({
			name: publicToolName(tool.name),
			description: tool.description ?? "",
			parameters: tool.inputSchema ?? {},
			output: {
				schema: {
					type: "object",
					properties: { content: {
						type: "array",
						items: {}
					} },
					required: ["content"],
					additionalProperties: false
				},
				render(_args, value) {
					return [{
						type: "text",
						text: extractText(typeof value === "object" && value !== null ? value.content : void 0, tool.name)
					}];
				}
			},
			execute: async (args) => {
				const cleanArgs = typeof args === "object" && args !== null ? args : {};
				return { content: (await rpc("tools/call", {
					name: tool.name,
					arguments: cleanArgs
				}, activeConn.token, activeConn.sessionId, false)).result?.content ?? [] };
			}
		}));
	}
	/** The public supervisor. */
	return {
		isConnected() {
			return conn !== null;
		},
		toolCount() {
			return disposers.size;
		},
		async listTools() {
			await this.ensureConnected();
			return (await listTools(conn.token, conn.sessionId)).map((t) => t.name);
		},
		async ensureConnected() {
			if (disposed) throw new Error("dsh-wps 已卸载");
			if (conn !== null) return;
			conn = await openSession(await ensureAuthenticated(store));
			await syncTools(conn);
		},
		async callTool(rawName, args) {
			await this.ensureConnected();
			return { content: (await rpc("tools/call", {
				name: rawName,
				arguments: args
			}, conn.token, conn.sessionId, false)).result?.content ?? [] };
		},
		async dispose() {
			disposed = true;
			conn = null;
			for (const dispose of disposers.values()) dispose();
			disposers = /* @__PURE__ */ new Map();
		}
	};
}
//#endregion
//#region src/routes.ts
/** Route paths. */
const WPS_API = {
	status: "/api/dsh-wps/status",
	oauthStart: "/api/dsh-wps/oauth/start",
	test: "/api/dsh-wps/test",
	clear: "/api/dsh-wps/clear"
};
/** Guard against two concurrent background authorizations. */
let authPromise = null;
/** Strict loopback fence. */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}
/**
* Build every /api/dsh-wps route (exact paths).
* @param deps - store and MCP supervisor.
* @returns the route list.
*/
function makeRoutes(deps) {
	const { store, supervisor } = deps;
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};
	const statusView = async () => {
		return {
			...await store.view(),
			connected: supervisor.isConnected(),
			toolCount: supervisor.toolCount()
		};
	};
	return [
		{
			kind: "exact",
			path: WPS_API.status,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				writeJson(res, 200, await statusView());
			}
		},
		{
			kind: "exact",
			path: WPS_API.oauthStart,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				if ((await store.view()).authorized) {
					writeJson(res, 200, {
						ok: true,
						message: "已授权。",
						view: await statusView()
					});
					return;
				}
				if (authPromise !== null) {
					writeJson(res, 200, {
						ok: true,
						message: "授权已在后台进行中，请在浏览器完成登录。",
						started: true,
						view: await statusView()
					});
					return;
				}
				authPromise = (async () => {
					await authorize(store);
					await supervisor.ensureConnected();
				})().catch((error) => {
					console.error("[dsh-wps] authorization failed:", error instanceof Error ? error.message : error);
				}).finally(() => {
					authPromise = null;
				});
				writeJson(res, 200, {
					ok: true,
					message: "已在浏览器打开 WPS 登录页，请登录并授权。",
					started: true,
					view: await statusView()
				});
			}
		},
		{
			kind: "exact",
			path: WPS_API.test,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				if (!(await store.view()).authorized) {
					writeJson(res, 200, {
						ok: false,
						error: "尚未授权：请先点击「开始授权」。",
						view: await statusView()
					});
					return;
				}
				try {
					await supervisor.ensureConnected();
					const tools = await supervisor.listTools();
					writeJson(res, 200, {
						ok: true,
						message: `连接成功，发现 ${tools.length} 个 WPS SkillHub MCP 工具。`,
						tools,
						view: await statusView()
					});
				} catch (error) {
					writeJson(res, 200, {
						ok: false,
						error: String(error instanceof Error ? error.message : error),
						view: await statusView()
					});
				}
			}
		},
		{
			kind: "exact",
			path: WPS_API.clear,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				await supervisor.dispose();
				await store.clearToken();
				writeJson(res, 200, {
					ok: true,
					message: "已清除 WPS 授权并断开连接。",
					view: await statusView()
				});
			}
		}
	];
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "wps";
/** Services required before the surfaces can mount. */
const inject = [
	"tools",
	"systemPrompt",
	"webServer"
];
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 165;
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const WPS_GUIDANCE = "本机已安装 dsh-wps 插件（WPS / 金山文档云文档）：通过浏览器授权后，金山文档官方 SkillHub MCP 的工具以 mcp__wps__* 形式可用，覆盖云盘管理（列目录/搜索/读取/创建/上传/下载云文档、文件详情与分享）与文档内容操作（文字/表格/演示/PDF 的读写与导出，如 wps.read_text、sheet.get_range_data、wpp.read_slide 等）。授权流程：wps_oauth_start 触发浏览器授权（打开 WPS 登录页并登录，自动轮询取 token）→ 成功后可调用 mcp__wps__*。wps_status 查看连接状态（不回显令牌），wps_test 测试连接并列出工具。令牌存 ~/.dsh/dsh-wps.json（权限 0600）。用户提到「WPS / 金山文档 / 云文档 / 查云文档」时即指本插件，请据此协作。";
/** Build every agent-facing wps_* tool. */
function buildTools(ctx) {
	return [
		wpsStatusTool(ctx),
		wpsOauthStartTool(ctx),
		wpsTestTool(ctx),
		wpsClearTool(ctx)
	];
}
/** One text content block. */
function text(value) {
	return [{
		type: "text",
		text: value
	}];
}
/** Status tool: auth state, connection state, tool count. */
function wpsStatusTool(ctx) {
	return defineTool({
		name: "wps_status",
		description: "查看 dsh-wps 插件状态：是否已授权、令牌最近更新时间、MCP 是否已连接、已注册的 WPS 工具数量。不会泄露任何密钥。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					authorized: { type: "boolean" },
					connected: { type: "boolean" },
					toolCount: { type: "number" },
					tokenUpdatedAt: { type: "string" },
					mcpUrl: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			const view = await ctx.store.view();
			return {
				ok: true,
				message: "dsh-wps：" + [
					view.authorized ? "已授权（令牌更新于 " + view.tokenUpdatedAt + "）" : "未授权",
					"MCP " + (ctx.supervisor.isConnected() ? "已连接" : "未连接"),
					"已注册工具 " + ctx.supervisor.toolCount() + " 个",
					"端点 " + view.mcpUrl,
					"配置路径 " + view.configPath
				].join("；") + "。" + (view.authorized ? "可直接使用 mcp__wps__* 工具；若未连接可先调 wps_test 建立连接。" : "请用 wps_oauth_start 开始授权。"),
				authorized: view.authorized,
				connected: ctx.supervisor.isConnected(),
				toolCount: ctx.supervisor.toolCount(),
				tokenUpdatedAt: view.tokenUpdatedAt,
				mcpUrl: view.mcpUrl,
				configPath: view.configPath
			};
		}
	});
}
/** OAuth start tool: trigger the browser auth; on success, connect + register tools. */
function wpsOauthStartTool(ctx) {
	return defineTool({
		name: "wps_oauth_start",
		description: "开始 WPS / 金山文档授权流程：打开 WPS 登录页（auth-guide），用户登录并授权后自动轮询拿到 token，随后建立 MCP 连接并把 mcp__wps__* 工具注册进来。授权成功后可关闭浏览器页面。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			try {
				await ctx.supervisor.ensureConnected();
				return {
					ok: true,
					message: "WPS 授权成功，已连接并注册 " + ctx.supervisor.toolCount() + " 个 mcp__wps__* 工具。用「WPS / 金山文档 / 云文档」开头描述需求即可调用。"
				};
			} catch (error) {
				return {
					ok: false,
					message: "WPS 授权失败：" + String(error instanceof Error ? error.message : error)
				};
			}
		}
	});
}
/** Test tool: connect and report the number of discovered tools. */
function wpsTestTool(ctx) {
	return defineTool({
		name: "wps_test",
		description: "测试 dsh-wps 连接：确认授权有效并列出 WPS SkillHub MCP 当前提供的工具数量（若未授权会触发浏览器授权）。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					toolCount: { type: "number" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			try {
				await ctx.supervisor.ensureConnected();
				const count = ctx.supervisor.toolCount();
				return {
					ok: true,
					message: "WPS 连接成功，已加载 " + count + " 个 mcp__wps__* 工具。",
					toolCount: count
				};
			} catch (error) {
				return {
					ok: false,
					message: "WPS 连接失败：" + String(error instanceof Error ? error.message : error)
				};
			}
		}
	});
}
/** Clear tool: drop the stored token and disconnect. */
function wpsClearTool(ctx) {
	return defineTool({
		name: "wps_clear",
		description: "清除 dsh-wps 已保存的 WPS access token 并断开 MCP 连接（不触发授权）。需要重新授权时，清除后再调 wps_oauth_start。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			await ctx.supervisor.dispose();
			await ctx.store.clearToken();
			return {
				ok: true,
				message: "已清除 WPS 授权并断开连接。请用 wps_oauth_start 重新授权。"
			};
		}
	});
}
/**
* Mount the WPS helper tools, routes, and announcement.
* @param ctx - host plugin context carrying tools/systemPrompt.
* @param config - plugin config from the composition row.
*/
function apply(ctx, config) {
	const announceToAgent = config?.announceToAgent !== false;
	const enabled = config?.enabled !== false;
	const store = new WpsStore();
	const supervisor = createSupervisor(ctx, store);
	const context = {
		store,
		supervisor
	};
	let disposeTools;
	let disposeRoutes;
	let disposeSection;
	const sync = () => {
		if (disposeTools !== void 0) {
			disposeTools();
			disposeTools = void 0;
		}
		if (disposeRoutes !== void 0) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		if (!enabled) return;
		disposeTools = ctx.effect(() => {
			const disposers = buildTools(context).map((tool) => ctx.tools.register(tool));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-wps: tools");
		disposeRoutes = ctx.effect(() => {
			const disposers = makeRoutes(context).map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-wps: routes");
		if (announceToAgent) disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-wps",
			order: SECTION_ORDER,
			text: WPS_GUIDANCE
		});
	};
	sync();
	(async () => {
		if (!enabled) return;
		if ((await store.view()).authorized && !supervisor.isConnected()) supervisor.ensureConnected().catch((error) => {
			ctx.logger.error(`dsh-wps: auto-connect failed: ${String(error)}`);
		});
	})();
	ctx.effect(() => {
		return () => {
			supervisor.dispose();
		};
	}, "dsh-wps: connection");
}
//#endregion
export { AUTH_GUIDE_URL, EXCHANGE_URL, MCP_URL, WPS_API, WPS_GUIDANCE, WpsStore, apply, authorize, configPath, createSupervisor, defineTool, ensureAuthenticated, inject, makeRoutes, mask, name, openBrowser, pollToken, publicToolName };
