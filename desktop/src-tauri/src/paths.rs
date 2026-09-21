// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
//! 桌面版的路径规则。
//!
//! ── 一条原则 ──
//! **数据落在用户自己的目录里**，不写在程序内部、也不写到系统盘深处：
//! 记录归档（`docs/practice/`）和数据库（`data/bluepencil.db`）都放在
//! **exe 同级目录**，用户复制一份 exe 就等于带着自己的数据走。
//! 这与旧的 Python 桌面版行为一致（那边同样取 `sys.executable` 所在目录）。
//!
//! ── 但 exe 可能放在不可写的地方 ──
//! 有人会把 exe 丢进 `C:\Program Files\` 或只读目录，那时写盘会失败。
//! 所以启动时**真写一个探针文件**试一次（Windows 上光看属性位不可靠），
//! 不行就退回 `%LOCALAPPDATA%\com.xuyi.bluepencil\`。
//! 判断只做一次（`OnceLock`），之后全进程复用同一个根目录 ——
//! 不能"这个函数成功、那个函数失败"，否则记录会散落在两处。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static BASE: OnceLock<PathBuf> = OnceLock::new();

/// 数据根目录（exe 同级；不可写时退回应用数据目录）。全进程只解析一次。
pub fn base_dir() -> &'static Path {
    BASE.get_or_init(|| {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."));

        if is_writable(&exe_dir) {
            return exe_dir;
        }

        // exe 放只读位置（Program Files 之类）时的兜底。
        // 这里**不能静默失败** —— 记录归档是用户能看见的产物，写不进去要说清楚，
        // 所以下面打一条日志，而不是假装成功。
        let fallback = appdata_dir();
        if let Err(e) = std::fs::create_dir_all(&fallback) {
            log::error!("[蓝笔] 数据目录不可写，退回目录也建不出来：{e}");
        }
        log::warn!(
            "[蓝笔] exe 所在目录不可写，数据改存到 {}",
            fallback.display()
        );
        fallback
    })
}

/// 用一个真写探针判断可写性。
///
/// ⚠️ 不用 `metadata().permissions().readonly()`：那是属性位，
/// Windows 上目录带只读属性也是能写的，反过来 ACL 拒绝时属性位又看不出来。
/// 「真写一次」是唯一可信的判据。
fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".bp-write-probe");
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn appdata_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("com.xuyi.bluepencil")
}

/// SQLite 库所在目录
pub fn data_dir() -> PathBuf {
    base_dir().join("data")
}

pub fn db_path() -> PathBuf {
    data_dir().join("bluepencil.db")
}

/// 练习记录归档目录（`docs/practice/`）
pub fn records_dir() -> PathBuf {
    base_dir().join("docs").join("practice")
}

/// 确保目录存在，返回可用的路径
pub fn ensure_dir(p: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(p)
}
