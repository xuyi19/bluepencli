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
//   · 全程**无控制台窗口**：主程序以 windows 子系统编译，子进程一律 CREATE_NO_WINDOW。
//     否则每跑一次工具就闪一个黑窗，工具链一跑十几步就满屏黑框。

// 发布版按 GUI 子系统编译：不弹控制台窗口。
// （debug 版保留控制台，方便看 panic 与 println；发布版排查走 admin-run.log）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

/// 子进程静默标志：不给子进程分配控制台窗口。
/// 主程序已经是 GUI 子系统（无控制台），此时 Windows 默认会给每个子进程**新建**一个
/// 控制台 —— 表现就是每跑一步工具闪一个黑窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 统一的"静默启动"入口：所有 spawn 都必须过这里，漏一个就闪一次黑窗。
#[cfg(windows)]
fn quiet(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW)
}
#[cfg(not(windows))]
fn quiet(cmd: &mut Command) -> &mut Command {
    cmd
}

/// 按 `where <name>` 找可执行文件，返回第一个真实存在的绝对路径。
///
/// 为什么要绝对路径：PATH 里若只有 `.cmd`/`.bat` 桩（nvm、scoop 常见），
/// `Command::new("node")` 在 Windows 上会直接找不到可执行文件。
fn which(name: &str) -> Option<String> {
    let mut c = Command::new("cmd");
    c.args(["/C", "where", name]);
    let out = quiet(&mut c).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && l.to_lowercase().ends_with(".exe"))
        .find(|l| Path::new(l).exists())
        .map(String::from)
}

fn find_node() -> Result<String, String> {
    if let Some(p) = which("node") {
        return Ok(p);
    }
    for c in [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        r"E:\develop\node-js\node.exe",
    ] {
        if Path::new(c).exists() {
            return Ok(c.into());
        }
    }
    Err("找不到 node.exe。本工具依赖仓库工具链，请先安装 Node.js 或把它加入 PATH。".into())
}

/// 找 python：**仓库内 venv 优先**。
///
/// PDF 提取/编入那几条管线要 pdfplumber 等依赖，只有仓库 venv 里装了；
/// PATH 上的 python 可能是完全无关的解释器（实测 `where python` 第一条就是别的工具带的），
/// 随手取了它 → 脚本报 ModuleNotFoundError，看起来像"脚本坏了"。
fn find_python(root: &Path) -> Result<String, String> {
    let local = [
        root.join("backend/.venv/Scripts/python.exe"),
        root.join(".venv/Scripts/python.exe"),
    ];
    for c in &local {
        if c.exists() {
            return Ok(c.display().to_string());
        }
    }
    if let Some(p) = which("python") {
        return Ok(p);
    }
    for c in [
        r"E:\develop\Anaconda\python.exe",
        r"C:\Python313\python.exe",
        r"C:\Python312\python.exe",
    ] {
        if Path::new(c).exists() {
            return Ok(c.into());
        }
    }
    Err(format!(
        "找不到 python.exe。管线依赖仓库自带的 {}（里面装了 pdfplumber 等），请先建好 venv。",
        root.join("backend/.venv").display()
    ))
}

/// 把 UI 传来的 program 解析成真正能 CreateProcess 的路径。
///
/// ⚠️ 关键坑：Windows 上 `Command::new("backend/.venv/Scripts/python.exe")` 里的
/// **相对路径是按父进程的当前目录解析的，不是 current_dir()**。哪怕设了 current_dir，
/// 也会立刻 os error 3（系统找不到指定的路径）—— 而错误信息只会说"启动失败"，
/// 极容易误判成"venv 没装"。所以相对路径一律先按 root 拼成绝对路径。
fn resolve_program(program: &str, root: &Path) -> Result<String, String> {
    match program {
        "node" => find_node(),
        "python" => find_python(root),
        other => {
            let p = Path::new(other);
            if p.is_absolute() {
                return Ok(other.to_string());
            }
            let joined = root.join(other);
            if joined.exists() {
                return Ok(joined.display().to_string());
            }
            // 裸命令名（如 git）交给系统按 PATH 搜索；其余情况给明确报错
            if !other.contains('/') && !other.contains('\\') {
                return Ok(other.to_string());
            }
            Err(format!(
                "找不到 {}（已按仓库根找过 {}）",
                other,
                joined.display()
            ))
        }
    }
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
    // "node"/"python" 等语义名与相对路径都在这里解析成绝对路径
    let prog = resolve_program(&program, &root_dir).map_err(|e| {
        running.store(false, Ordering::SeqCst);
        e
    })?;

    let mut cmd = Command::new(&prog);
    cmd.args(&args)
        .current_dir(&root_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    quiet(&mut cmd); // 无控制台窗口（漏了这行子进程会闪黑窗）
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
        // 报出**实际用的那个程序路径**：写死"启动 node 失败"曾在跑 python 时误导排查
        format!("启动失败：{}（{}）", prog, e)
    })?;
    let mut out = child.stdout.take().expect("stdout");
    let mut err = child.stderr.take().expect("stderr");

    let app_out = app.clone();
    let app_err = app.clone();
    let app_end = app.clone();
    let flag = Arc::clone(&*running);
    thread::spawn(move || {
        // 每行同时**追加到日志文件**（exe 同级 admin-run.log）：
        // 事件通道万一不通（权限/前端问题），输出仍然落在磁盘上，可自查。
        //
        // ⚠️ 这个闭包必须**零捕获**：它要被两个读取线程各自 move 一份，
        // 捕获了外部变量（如提前算好的 log_path）就只剩一份、编译直接报
        // E0373（闭包生命周期）。所以日志路径在闭包内部现算 —— current_exe() 足够便宜。
        let emit = |app: &tauri::AppHandle, stream: &str, text: String| {
            if let Some(lp) = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("admin-run.log")))
            {
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(lp) {
                    use std::io::Write;
                    let _ = writeln!(f, "[{}] {}", stream, text);
                }
            }
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
