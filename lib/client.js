window.__ModuleLoader__.load({
	id: "dsh-wps",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/** Error carrying the route's JSON error message. */
		var WpsApiError = class extends Error {
			constructor(message) {
				super(message);
				this.name = "WpsApiError";
			}
		};
		/** Parse a JSON response or throw a WpsApiError. */
		async function readJson(response) {
			let body;
			try {
				body = await response.json();
			} catch {
				throw new WpsApiError(`HTTP ${response.status}: invalid JSON response`);
			}
			if (!response.ok) throw new WpsApiError(typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
			return body;
		}
		/** Plain fetch helper with an error wrapper. */
		async function request(path, init) {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new WpsApiError("网络请求失败: " + String(error instanceof Error ? error.message : error));
			}
			return readJson(response);
		}
		/** The WPS panel API. */
		var WpsApi = class {
			async status() {
				return request("/api/dsh-wps/status");
			}
			async oauthStart() {
				return request("/api/dsh-wps/oauth/start", { method: "POST" });
			}
			async test() {
				return request("/api/dsh-wps/test", { method: "POST" });
			}
			async clear() {
				return request("/api/dsh-wps/clear", { method: "POST" });
			}
		};
		//#endregion
		//#region src/client/WpsPanel.tsx
		/**
		* WPS / 金山文档 settings panel — rendered inside the web settings page
		* (settings.section entry). Drives the browser authorization (host-side
		* auth-guide + exchange poll, no popup URL to paste — the host opens the
		* browser), shows connection state and registered tool count, and offers
		* one-click test / clear. Plain React, inline styles.
		*/
		/** Module-level API client (stateless; the component closes over it). */
		const api = new WpsApi();
		/** One shared style sheet (kept tiny and theme-agnostic). */
		const s = {
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				maxWidth: "620px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid rgba(128,128,128,0.3)",
				fontSize: "13px",
				color: "inherit"
			},
			title: {
				fontWeight: 600,
				fontSize: "13px",
				margin: 0
			},
			status: {
				fontSize: "12px",
				opacity: .85
			},
			statusWarn: {
				fontSize: "12px",
				opacity: .9,
				color: "#c9763a"
			},
			row: {
				display: "flex",
				gap: "6px",
				alignItems: "center",
				flexWrap: "wrap"
			},
			flex: { flex: 1 },
			button: {
				padding: "4px 10px",
				borderRadius: "6px",
				cursor: "pointer",
				border: "1px solid rgba(128,128,128,0.4)",
				background: "rgba(128,128,128,0.14)",
				color: "inherit",
				fontSize: "12px",
				whiteSpace: "nowrap"
			},
			msg: {
				fontSize: "12px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-all",
				opacity: .9
			},
			hint: {
				fontSize: "11px",
				opacity: .75,
				lineHeight: 1.6
			}
		};
		/** Status line for the current view. */
		function statusText(view) {
			if (view === null) return "加载中…";
			if (!view.authorized) return "未授权 — 点击「开始授权」，浏览器会打开 WPS 登录页，登录并授权后工具即可用。";
			const connected = view.connected ? "已连接" : "未连接";
			return `已授权 · 令牌更新于 ${view.tokenUpdatedAt} · MCP ${connected} · 工具 ${view.toolCount} 个`;
		}
		/** The settings panel component. */
		function WpsSettingsPanel() {
			const [view, setView] = (0, react.useState)(null);
			const [tools, setTools] = (0, react.useState)([]);
			const [busy, setBusy] = (0, react.useState)(false);
			const [waiting, setWaiting] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)("");
			const refreshStatus = (0, react.useCallback)(async () => {
				try {
					setView(await api.status());
				} catch (error) {
					setMsg("读取状态失败: " + String(error instanceof Error ? error.message : error));
				}
			}, []);
			(0, react.useEffect)(() => {
				refreshStatus();
			}, [refreshStatus]);
			(0, react.useEffect)(() => {
				const onFocus = () => {
					refreshStatus();
				};
				window.addEventListener("focus", onFocus);
				return () => window.removeEventListener("focus", onFocus);
			}, [refreshStatus]);
			(0, react.useEffect)(() => {
				if (!waiting) return;
				const timer = setInterval(async () => {
					try {
						const next = await api.status();
						setView(next);
						if (next.authorized) {
							const result = await api.test();
							setView(result.view);
							if (result.ok && result.tools !== void 0) setTools(result.tools);
							setMsg(result.ok ? result.message ?? "授权成功。" : "[failed] " + (result.error ?? ""));
							setWaiting(false);
						}
					} catch {}
				}, 2500);
				return () => clearInterval(timer);
			}, [waiting]);
			/** Run one async panel action with busy/message bookkeeping. */
			const run = async (action) => {
				setBusy(true);
				setMsg("");
				try {
					const result = await action();
					if (result !== void 0) setMsg(result.message);
				} catch (error) {
					setMsg("操作失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			const authorize = () => {
				run(async () => {
					const result = await api.oauthStart();
					setView(result.view);
					if (result.ok) {
						setWaiting(true);
						return { message: result.started ? "已打开 WPS 登录页，请在浏览器完成登录授权…" : result.message };
					}
					return { message: "[failed] " + (result.error ?? "开始授权失败") };
				});
			};
			const test = () => {
				run(async () => {
					const result = await api.test();
					setView(result.view);
					if (result.ok && result.tools !== void 0) setTools(result.tools);
					return { message: result.ok ? result.message ?? "连接成功。" : "[failed] " + (result.error ?? "") };
				});
			};
			const clear = () => {
				run(async () => {
					if (!window.confirm("确定清除 WPS 授权吗？之后需要重新授权。")) return { message: "已取消。" };
					const result = await api.clear();
					setView(result.view);
					setTools([]);
					setWaiting(false);
					return { message: result.message };
				});
			};
			const authorized = Boolean(view && view.authorized);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: s.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: s.title,
						children: "WPS / 金山文档"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: authorized ? s.status : s.statusWarn,
						children: statusText(view)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.hint,
						children: [
							"通过金山文档官方 SkillHub MCP（",
							view?.mcpUrl ?? "https://mcp-center.wps.cn/skill_hub/mcp",
							"）连接，授权后云文档工具以 mcp__wps__* 形式在会话中可用（云盘列表/搜索/读取/创建/上传下载 + 文字/表格/演示/PDF 内容读写）。 令牌存 ",
							view?.configPath ?? "~/.dsh/dsh-wps.json",
							"（权限 0600）。请使用个人 WPS 账号授权。"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: authorize,
								disabled: busy || authorized,
								children: "开始授权"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: test,
								disabled: busy || !authorized,
								children: "测试连接"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								onClick: clear,
								disabled: busy || !authorized,
								children: "清除授权"
							})
						]
					}),
					tools.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.hint,
						children: [
							"已发现的 MCP 工具（",
							tools.length,
							"）：",
							tools.slice(0, 12).join("、"),
							tools.length > 12 ? "…" : ""
						]
					}),
					msg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: s.msg,
						children: msg
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services. */
		const inject = ["slots"];
		/**
		* Register the WPS settings page.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "wps",
					order: 330,
					label: () => "WPS"
				}, WpsSettingsPanel));
			} catch (error) {
				console.warn("[dsh-wps] settings panel registration failed:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map