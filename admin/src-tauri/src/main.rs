// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库管理员端（GUI 壳）
//
// 设计原则：
//   · 管理功能与分发的桌面版**物理隔离** —— 这个 exe 永不进 release/、
//     永不打进用户拿到的安装包，它只服务作者本人打包/验包。
//   · 不重新实现任何题库逻辑：全部 spawn `node .tools/admin-bank.mjs`，
//     GUI 只负责收参数、回显输出。
//   · 口令经环境变量 BPQ_PASSPHRASE 传给子进程，不出现在命令行参数里
//     （进程列表里看不见）；UI 侧永不回显、不写日志。
//   · 仓库根自动向上探测（找 .tools/admin-bank.mjs），找不到允许手动指定，
//     存在 exe 同级 admin-config.json。
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use serde::Serialize;
use tauri::Emitter;

#[derive(Serialize, Clone)]
struct LogLine {
    stream: String, // "out" | "err" | "sys"
    text: String,
}

/// 找 node：先 PATH，再几个常见安装位置（作者机器实测过的）。
fn find_node() -> Result<String, String> {
    let probe = |program: &str| -> bool {
        Command::new(program)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .status()
            .is_ok()
    };
    if probe("node") {
        return Ok("node".into());
    }
    let candidates = [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        r"E:\develop\node-js\node.exe",
    ];
    for c in candidates {
        if Path::new(c).exists() {
            return Ok(c.into());
        }
    }
    Err("找不到 node.exe。本工具依赖仓库工具链，请先安装 Node.js 或把它加入 PATH。".into())
}

/// 探测仓库根：含 `.tools/admin-bank.mjs` 的目录。
/// 顺序：显式给出 > 环境变量 BLUEPENCIL_ROOT > exe 同级 admin-config.json > 向上找 6 层。
fn detect_root(explicit: Option<&str>) -> Result<PathBuf, String> {
    const MARKER: &str = ".tools/admin-bank.mjs";
    let has_marker = |dir: &Path| dir.join(MARKER).exists();

    if let Some(e) = explicit {
        let p = PathBuf::from(e.trim());
        if has_marker(&p) {
            return Ok(p);
        }
        return Err(format!("{} 里没有 {}", p.display(), MARKER));
    }
    if let Ok(env) = std::env::var("BLUEPENCIL_ROOT") {
        let p = PathBuf::from(env);
        if has_marker(&p) {
            return Ok(p);
        }
    }
    // exe 同级 / 上级 + admin-config.json
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|d| d.to_path_buf());
        if let Some(cfg) = exe
            .parent()
            .map(|d| d.join("admin-config.json"))
            .filter(|c| c.exists())
        {
            if let Ok(s) = std::fs::read_to_string(cfg) {
                if let Some(v) = serde_json::from_str::<serde_json::Value>(&s)
                    .ok()
                    .and_then(|v| v.get("root").and_then(|r| r.as_str()).map(String::from))
                {
                    let p = PathBuf::from(v);
                    if has_marker(&p) {
                        return Ok(p);
                    }
                }
            }
        }
        for _ in 0..6 {
            match dir {
                Some(d) if has_marker(&d) => return Ok(d),
                Some(d) => dir = d.parent().map(|p| p.to_path_buf()),
                None => break,
            }
        }
    }
    Err("没找到仓库根（需要 .tools/admin-bank.mjs）。把本 exe 放进仓库目录树内，或在下方手动指定。".into())
}

#[tauri::command]
fn find_root(explicit: Option<String>) -> Result<String, String> {
    detect_root(explicit.as_deref()).map(|p| p.display().to_string())
}

#[tauri::command]
fn save_root(root: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let cfg = exe
        .parent()
        .ok_or("无法定位 exe 目录")?
        .join("admin-config.json");
    let json = serde_json::json!({ "root": root.trim() });
    std::fs::write(&cfg, json.to_string()).map_err(|e| format!("写配置失败（{}）：{}", cfg.display(), e))
}

/// 通用工具执行器：把仓库里的 node / python 脚本当成一条命令跑起来。
///
/// 为什么泛化而不是每加一个工具就加一个 command：管理员端要整合的是**一整套**
/// 工具链（PDF 提取 / 编入前端 / 打包验包 / 汇编 / 标准校准 / 回归测试……），
/// 每加一个就在 Rust 侧加一个函数是纯重复劳动。这里只保留"执行器"职责：
/// 定程序、传参、注入环境变量（**口令只走 env，不进 argv**）、逐行回显。
///
/// 注意：这里**不做**命令白名单校验——管理端是作者自用的本机工具，
/// 而且它需要能跑将来新加的任何脚本；安全边界在于它与分发版物理隔离。
#[tauri::command]
fn run_tool(
    app: tauri::AppHandle,
    running: tauri::State<'_, Arc<AtomicBool>>,
    root: String,
    program: String,
    args: Vec<String>,
    envs: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    if running.swap(true, Ordering::SeqCst) {
        return Err("已有任务在跑，等它结束再点。".into());
    }
    let root_dir = detect_root(Some(&root))?;
    // program 传 "node" 时走 PATH 探测（顺带找常见安装位置）
    let prog = if program == "node" {
        find_node()?
    } else {
        program
    };

    let mut cmd = Command::new(&prog);
    cmd.args(&args)
        .current_dir(&root_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    // 口令/密钥一律走环境变量，不进 argv（进程列表里看不见）
    if let Some(map) = envs {
        for (k, v) in map {
            if !k.is_empty() {
                cmd.env(k, v);
            }
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        running.store(false, Ordering::SeqCst);
        format!("启动 node 失败：{}", e)
    })?;
    let mut out = child.stdout.take().expect("stdout");
    let mut err = child.stderr.take().expect("stderr");

    let app_out = app.clone();
    let app_err = app.clone();
    let app_end = app.clone();
    let flag = Arc::clone(&*running);
    thread::spawn(move || {
        let emit = |app: &tauri::AppHandle, stream: &str, text: String| {
            let _ = app.emit("admin-log", LogLine { stream: stream.into(), text });
        };
        let t1 = {
            let app = app_out;
            thread::spawn(move || {
                for line in BufReader::new(&mut out).lines() {
                    match line {
                        Ok(l) => emit(&app, "out", l),
                        Err(_) => break,
                    }
                }
            })
        };
        let t2 = {
            let app = app_err;
            thread::spawn(move || {
                for line in BufReader::new(&mut err).lines() {
                    match line {
                        Ok(l) => emit(&app, "err", l),
                        Err(_) => break,
                    }
                }
            })
        };
        let _ = t1.join();
        let _ = t2.join();
        let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        let _ = app_end.emit("admin-exit", code);
        flag.store(false, Ordering::SeqCst);
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![find_root, save_root, run_tool])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
