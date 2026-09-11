"""测试环境准备。

两处必须的处理：

1. **数据库隔离**：把 DB_URL 指向临时库，避免测试写进 backend/data/bluepencil.db。
   注意 engine 是模块级创建的，所以环境变量必须在 import app.* 之前设置。
2. **显式建表**：httpx 的 ASGITransport 不会触发 FastAPI 的 lifespan 事件，
   表不会像 uvicorn 启动时那样自动创建。少了这一步，测试会依赖"磁盘上刚好有个旧库"。
"""

import os
import shutil
import tempfile
from pathlib import Path

_TEST_DB = Path(tempfile.gettempdir()) / "bluepencil_test.db"
os.environ["DB_URL"] = f"sqlite+aiosqlite:///{_TEST_DB.as_posix()}"

import pytest  # noqa: E402

from app.core import config  # noqa: E402
from app.core.db import Base, engine  # noqa: E402
from app.models import entities  # noqa: E402,F401  导入以注册模型到 Base.metadata


@pytest.fixture(autouse=True)
async def _prepare_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.fixture(autouse=True)
def _isolate_records_dir():
    """把记录归档目录指向临时目录。

    否则跑一次测试就会往真实的 `docs/practice/` 里塞测试数据 ——
    那是用户自己的复盘资料，绝不能被测试污染。
    """
    tmp = Path(tempfile.mkdtemp(prefix="bp_records_"))
    original = config.RECORDS_DIR
    config.RECORDS_DIR = tmp
    yield tmp
    config.RECORDS_DIR = original
    shutil.rmtree(tmp, ignore_errors=True)
