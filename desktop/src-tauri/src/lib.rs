// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 桌面版入口：开窗口、起本地 LLM 网关、把网关地址告诉前端。
//
// 三个模块各管一段：
//   · preset.rs —— 读 exe 同级的 config.json（零配置）
//   · llm.rs    —— LLM 转发（含 build_url / build_payload，与前端和 Python 三份必须一致）
//   · server.rs —— 本地 axum 服务（health + /llm/chat[/stream]）
//
// 前端那边**不需要改请求逻辑**：`api/backend.js` 本来就会探测 `/api/v1/health`，
// 通就用后端通道。这里只要把服务地址注入进去即可（见 frontend/src/main.js）。

mod llm;
mod preset;
mod server;

use std::net::TcpListener as StdTcpListener;
use std::sync::{Arc, Mutex};

use tauri::{Manager, State};

/// 本地服务的实际端口。用一个共享槽存着，command 里读。
struct ApiPort(Arc<Mutex<Option<u16>>>);

/// 告诉前端本地服务在哪。
///
/// 前端在挂载 Vue 之前调一次，拿到后走 `setRuntimeBase()` 注入。
/// 返回 None 只在极端情况下发生（setup 里绑定失败），前端会退回原有探测逻辑。
#[tauri::command]
fn api_base(state: State<'_, ApiPort>) -> Option<String> {
    state
        .0
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .map(|port| format!("http://127.0.0.1:{port}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 日志**不只在 debug 下开**（骨架默认是那样）。
            // 理由很具体：release 版带 `windows_subsystem = "windows"`，没有控制台，
            // 出问题时用户看到的只是"双击没反应"。只要日志落到文件，
            // 至少还有地方能查——第一版就是靠进程表才判断出"它是崩了，不是没启动"。
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // ── 预置配置：exe 同级的 config.json ──
            let exe_dir = preset::Preset::exe_dir();
            let pre = preset::Preset::load(&exe_dir);
            log::info!("[蓝笔] 程序目录：{}", exe_dir.display());

            // ── 起本地服务 ──
            // ⚠️ 用 **std 的 TcpListener 同步绑定**，而不是直接 await tokio 的：
            //    同步绑定的好处是 setup 返回前端口就已经确定了。窗口一打开前端就会
            //    invoke `api_base`，若走异步绑定，那一瞬间会拿到 None，
            //    前端只能退回"浏览器直连"——而在 Tauri 里直连会被 CORS 拦死。
            let std_listener = StdTcpListener::bind("127.0.0.1:0")?;
            let port = std_listener.local_addr()?.port();
            std_listener.set_nonblocking(true)?;
            log::info!("[蓝笔] 本地服务：http://127.0.0.1:{port}");

            app.manage(ApiPort(Arc::new(Mutex::new(Some(port)))));

            tauri::async_runtime::spawn(async move {
                // ⚠️ `from_std` **必须在 tokio runtime 里**调用：它内部要取当前 runtime 的
                //    handle，在同步上下文里会直接 panic。第一版就栽在这 ——
                //    表现是"双击 exe 没反应、进程秒退"，而 release 版没有控制台，
                //    连一行错误都看不到，只能靠进程表判断它是崩了还是没启动。
                let listener = match tokio::net::TcpListener::from_std(std_listener) {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!("[蓝笔] 本地服务绑定失败：{e}");
                        return;
                    }
                };
                if let Err(e) = axum::serve(listener, server::router(pre)).await {
                    // 服务挂了不该静默：批改会全线失败，日志里必须留下原因
                    log::error!("[蓝笔] 本地服务异常退出：{e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api_base])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
