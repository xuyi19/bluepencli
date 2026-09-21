# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.api.v1 import grading, health, llm
from app.api.v1 import records as records_api
from app.api.v1 import settings as settings_api
from app.api.v1 import stats
from app.core.config import DATA_DIR, RECORDS_DIR, WEB_DIR
from app.core.config import settings as app_settings
from app.core.db import Base, engine
from app.models import entities  # noqa: F401  确保建表时能发现所有模型
from app.services.llm_service import close_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    if app_settings.ENABLE_PERSISTENCE:
        # 首次运行（或换了目录）时 data/ 可能不存在，SQLite 不会自动建目录
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("启动中，创建数据库表...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    else:
        logger.info("持久化已关闭（ENABLE_PERSISTENCE=False），后端仅作 LLM 网关")
    if app_settings.ENABLE_RECORD_ARCHIVE:
        # 提前建好目录，用户打开 docs/ 一眼能看到练习记录往哪落
        RECORDS_DIR.mkdir(parents=True, exist_ok=True)
        logger.info(f"练习记录归档目录：{RECORDS_DIR}")
    logger.info(f"{app_settings.APP_NAME} v{app_settings.APP_VERSION} 启动完成")
    yield
    await close_client()
    await engine.dispose()
    logger.info("已关闭")


app = FastAPI(
    title=app_settings.APP_NAME,
    version=app_settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS：本地自用默认全放；部署到公网时把 CORS_ORIGINS 收成具体域名
_origins = [o.strip() for o in (app_settings.CORS_ORIGINS or "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_credentials=False,  # 与 allow_origins=["*"] 共存时必须为 False
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 路由
app.include_router(health.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(grading.router, prefix="/api/v1")
app.include_router(records_api.router, prefix="/api/v1")
app.include_router(stats.router, prefix="/api/v1")
app.include_router(settings_api.router, prefix="/api/v1")


class WebStaticFiles(StaticFiles):
    """托管前端构建产物，顺带把缓存策略写对。

    为什么要管缓存：桌面版每次升级都跑在**同一个地址**（127.0.0.1:8765）。
    入口 HTML 若被浏览器缓存住，双击新版 exe 打开的仍是**旧界面** ——
    用户看到的现象是「你这个包是旧版的」，而实际上新文件已经就位了。
    真踩过，所以在服务端直接定死，不指望浏览器自己判断。
    """

    async def get_response(self, *args, **kwargs):
        resp = await super().get_response(*args, **kwargs)
        ctype = resp.headers.get("content-type", "")
        if "text/html" in ctype:
            # 入口文件每次回源校验。靠 ETag/304 拿消息，不额外费流量。
            resp.headers["Cache-Control"] = "no-cache, must-revalidate"
        else:
            # 其余资源文件名都带内容哈希，内容一变名字就变，可放心长缓存
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


if WEB_DIR is not None:
    # 桌面版：同一个进程既提供 API 也提供界面，无跨域、无需另开前端服务。
    # 前端用 hash 路由，所有页面都在 `/` 下，因此纯静态托管即可，不需要 SPA 回退。
    app.mount("/", WebStaticFiles(directory=str(WEB_DIR), html=True), name="web")
    logger.info(f"已挂载前端界面：{WEB_DIR}")
else:
    # 未构建前端时（例如只跑后端做开发），根路径给出提示而不是 404
    @app.get("/")
    async def root():
        return {
            "message": f"{app_settings.APP_NAME} API",
            "docs": "/docs",
            "health": "/api/v1/health",
            "hint": "未检测到前端构建产物，请先在 frontend/ 执行 npm run build",
        }
