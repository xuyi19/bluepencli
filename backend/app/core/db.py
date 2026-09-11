from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import AsyncAdaptedQueuePool

from app.core.config import BASE_DIR, settings

# SQLite 需要目录先存在，否则首次连接会直接失败
(BASE_DIR / "data").mkdir(parents=True, exist_ok=True)

# 创建异步引擎
engine = create_async_engine(
    settings.DB_URL,
    echo=False,         # 需要排查 SQL 时改成 True（会刷屏，别长期开着）
    future=True,
    poolclass=AsyncAdaptedQueuePool,
    pool_size=5,        # SQLite 写操作串行，池子不需要大
    max_overflow=10,
    pool_recycle=1800,
    pool_pre_ping=True,
)

# 异步 session 工厂
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# 所有 ORM 模型的基类
class Base(DeclarativeBase):
    pass


# FastAPI 依赖注入用的 session 提供器
async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
