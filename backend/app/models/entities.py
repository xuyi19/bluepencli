from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class GradingTask(Base):
    """一次批改任务的汇总记录（单人 / 双人 / 圆桌）。

    注意：用户作答正文、笔记、错题本等**内容数据**仍保存在前端 IndexedDB，
    这是为了保住「单文件版发给别人就能用」的能力。后端只记录任务级指标，
    用于统计分析、成本核算与问题排查。
    """

    __tablename__ = "grading_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    mode: Mapped[str] = mapped_column(String(16), default="solo")          # solo | duo | roundtable
    teacher_ids: Mapped[str] = mapped_column(String(128), default="")       # 逗号分隔
    question_type: Mapped[str] = mapped_column(String(32), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    answer_chars: Mapped[int] = mapped_column(Integer, default=0)
    deep: Mapped[int] = mapped_column(Integer, default=0)                  # 是否深度模式
    final_score: Mapped[float] = mapped_column(Float, default=0.0)
    max_score: Mapped[float] = mapped_column(Float, default=0.0)
    score_rate: Mapped[float] = mapped_column(Float, default=0.0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    disputed: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="success")      # success | failed
    error: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True
    )


class LLMCallLog(Base):
    """单次 LLM 调用的明细，用于成本核算与问题定位。"""

    __tablename__ = "llm_call_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(32), index=True, default="")
    teacher_id: Mapped[str] = mapped_column(String(32), default="")
    stage: Mapped[str] = mapped_column(String(32), default="grade")        # grade | debate | consensus
    model: Mapped[str] = mapped_column(String(64), default="")
    prompt_chars: Mapped[int] = mapped_column(Integer, default=0)
    output_chars: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[int] = mapped_column(Integer, default=1)
    error: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True
    )
