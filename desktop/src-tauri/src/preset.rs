// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 预置配置：读 exe 同级的 `config.json`，做到「发给别人双击即用、一个字不用填」。
//
// 对应 Python 版 `backend/app/core/config.py::_apply_json_preset`，语义必须一致：
//   · 只接受**全大写键名 + 非空字符串值** —— 避免误把无关字段当成配置灌进来；
//   · 读不到 / 解析失败 / 不是对象 → **全部安静跳过**，绝不阻断启动
//     （配置坏了也要能开，最多是让用户自己去设置页填）。
//
// 打包分发时把 `config.example.json` 改名成 `config.json` 填上 Key 即可；
// `config.json` 本身不进仓库（.gitignore）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default)]
pub struct Preset {
    map: HashMap<String, String>,
    /// 找到过 config.json 的路径（用于启动日志里说清楚"配置是从哪读的"）
    pub source: Option<PathBuf>,
}

impl Preset {
    /// exe 同级目录。开发时是 `target/release/`，打包后是安装目录。
    pub fn exe_dir() -> PathBuf {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."))
    }

    /// 读配置。任何异常都只记一条日志，不向上抛。
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("config.json");
        if !path.is_file() {
            return Self::default();
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[preset] config.json 读不了，已忽略：{e}");
                return Self::default();
            }
        };
        let raw: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("[preset] config.json 不是合法 JSON，已忽略：{e}");
                return Self::default();
            }
        };
        let obj = match raw.as_object() {
            Some(o) => o,
            None => {
                log::warn!("[preset] config.json 顶层不是对象，已忽略");
                return Self::default();
            }
        };

        let mut map = HashMap::new();
        for (k, v) in obj {
            // 全大写 + 非空字符串：与 Python 版同一条判据
            let is_upper_key = !k.is_empty()
                && k.chars().any(|c| c.is_ascii_alphabetic())
                && k.chars().all(|c| !c.is_ascii_lowercase());
            if !is_upper_key {
                continue;
            }
            if let Some(s) = v.as_str() {
                let s = s.trim();
                if !s.is_empty() {
                    map.insert(k.clone(), s.to_string());
                }
            }
        }
        log::info!("[preset] 已加载 {} 项预置配置（{}）", map.len(), path.display());
        Self {
            map,
            source: Some(path),
        }
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.map.get(key).map(|s| s.as_str())
    }

    /// 直接构造（单测用；也给将来"命令行覆盖配置"留个口子）
    pub fn from_pairs(pairs: &[(&str, &str)]) -> Self {
        let mut map = HashMap::new();
        for (k, v) in pairs {
            map.insert((*k).to_string(), (*v).to_string());
        }
        Self { map, source: None }
    }

    /// 取值，空白视同没有
    pub fn str_or(&self, key: &str, fallback: &str) -> String {
        self.get(key)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(fallback)
            .to_string()
    }
}
