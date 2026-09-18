# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
import json
import os
import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_base_dir() -> Path:
    """确定"可写数据目录"的位置。

    - 开发运行（python run.py）：`backend/`
    - 打包成 exe 后：exe 所在目录

    打包后 `__file__` 指向 PyInstaller 的临时解包目录，不能再用它推算，
    否则 `.env` / `config.json` / `data/` 会落在临时目录里，重启即丢。
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent.parent


def _resolve_web_dir() -> Path | None:
    """前端构建产物（frontend/dist）的位置；不存在则返回 None。

    - 打包后：随 exe 一起打进 `web/`（PyInstaller one-folder 的 `_internal/web`）
    - 开发时：`frontend/dist`
    """
    if getattr(sys, "frozen", False):
        candidate = Path(getattr(sys, "_MEIPASS", BASE_DIR)) / "web"
    else:
        candidate = BASE_DIR.parent / "frontend" / "dist"
    return candidate if candidate.is_dir() else None


def _apply_json_preset() -> None:
    """读取同级目录的 `config.json`，作为预置配置（发给别人时做到零配置）。

    只填充**环境变量尚未设置**的项，因此显式设环境变量的优先级更高。
    仅接受全大写键名 + 非空字符串值，避免误把无关字段灌进环境。
    """
    path = BASE_DIR / "config.json"
    if not path.is_file():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001  配置读不了不该阻断启动
        return
    if not isinstance(data, dict):
        return
    for key, value in data.items():
        if key.isupper() and isinstance(value, str) and value:
            os.environ.setdefault(key, value)


def _resolve_docs_dir() -> Path:
    """练习记录归档目录（markdown + json）。

    - 开发运行：项目根的 `docs/`（和文章库、开发记录放一起，方便直接翻）
    - 打包成 exe：exe 同级的 `docs/`（别人的数据落在自己的目录里）
    """
    if getattr(sys, "frozen", False):
        return BASE_DIR / "docs"
    return BASE_DIR.parent / "docs"


BASE_DIR = _resolve_base_dir()
DATA_DIR = BASE_DIR / "data"
ENV_FILE = BASE_DIR / ".env"
WEB_DIR = _resolve_web_dir()
DOCS_DIR = _resolve_docs_dir()
# 练习批改记录的归档位置：docs/practice/<日期>-<标题>-<id>.{md,json}
RECORDS_DIR = DOCS_DIR / "practice"

_apply_json_preset()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    APP_NAME: str = "蓝笔申论 BluePencil"
    APP_VERSION: str = "0.13.7"
    DEBUG: bool = True

    # SQLite：默认落在可写数据目录下的 data/bluepencil.db，零外部服务依赖
    # 如需换成 MySQL，改成 mysql+asyncmy://user:pass@127.0.0.1:3306/bluepencil 即可
    DB_URL: str = f"sqlite+aiosqlite:///{(DATA_DIR / 'bluepencil.db').as_posix()}"

    # 是否启用持久化（任务记录 / 调用日志）
    # False = 后端退回为纯 LLM 网关：不建表、不落盘、不留任何数据
    ENABLE_PERSISTENCE: bool = True

    # 是否把练习批改结果归档成 markdown（docs/practice/），供后期复盘
    ENABLE_RECORD_ARCHIVE: bool = True

    # 桌面版模式：`desktop.py` 启动时置为 True（环境变量 DESKTOP_MODE=1）。
    # 打开后启用「浏览器页面全关了就结束进程」——这**只对本地单机形态成立**：
    # 网站版绝不能开，否则某个访客关掉标签页就会把公网服务杀掉。
    DESKTOP_MODE: bool = False

    # 服务端兜底 LLM 配置：前端未传时使用；留空则要求前端自带配置
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = "https://api.deepseek.com"
    LLM_MODEL: str = "deepseek-chat"

    # 网关行为
    LLM_TIMEOUT: float = 180.0
    LLM_MAX_RETRIES: int = 2
    LLM_MAX_CONCURRENCY: int = 6

    # CORS 允许来源，逗号分隔；* 表示全部放行（本地自用默认全放）
    CORS_ORIGINS: str = "*"


settings = Settings()
