"""批改任务的落库与统计。

设计取舍：用户作答、笔记、错题本等内容数据留在前端 IndexedDB——
那是「单文件版双击即用」的前提。后端只记录任务级指标（评分、耗时、
token 消耗、是否触发分歧复核），用于成本核算、趋势统计与问题排查。
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import GradingTask, LLMCallLog
from app.models.schemas import GradingTaskIn, StatsOut

# DeepSeek 参考价（元 / 百万 token），仅用于粗略估算成本
PRICE_PROMPT_PER_M = 2.0
PRICE_COMPLETION_PER_M = 8.0


async def save_task(db: AsyncSession, payload: GradingTaskIn) -> GradingTask | None:
    if not settings.ENABLE_PERSISTENCE:
        return None

    existing = await db.execute(
        select(GradingTask).where(GradingTask.task_id == payload.task_id)
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        return row

    rate = (payload.final_score / payload.max_score) if payload.max_score else 0.0
    row = GradingTask(
        task_id=payload.task_id,
        mode=payload.mode,
        teacher_ids=",".join(payload.teacher_ids),
        question_type=payload.question_type,
        title=payload.title[:255],
        answer_chars=payload.answer_chars,
        deep=1 if payload.deep else 0,
        final_score=payload.final_score,
        max_score=payload.max_score,
        score_rate=round(rate, 4),
        elapsed_ms=payload.elapsed_ms,
        llm_calls=payload.llm_calls,
        prompt_tokens=payload.prompt_tokens,
        completion_tokens=payload.completion_tokens,
        disputed=1 if payload.disputed else 0,
        status=payload.status,
        error=payload.error[:500],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def list_tasks(db: AsyncSession, limit: int = 100, offset: int = 0) -> list[GradingTask]:
    result = await db.execute(
        select(GradingTask)
        .order_by(GradingTask.created_at.desc(), GradingTask.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def get_task(db: AsyncSession, task_id: str) -> GradingTask | None:
    result = await db.execute(
        select(GradingTask).where(GradingTask.task_id == task_id)
    )
    return result.scalar_one_or_none()


async def delete_task(db: AsyncSession, task_id: str) -> bool:
    row = await get_task(db, task_id)
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def log_llm_call(
    db: AsyncSession,
    *,
    task_id: str,
    teacher_id: str,
    stage: str,
    model: str,
    prompt_chars: int,
    output_chars: int,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    elapsed_ms: int = 0,
    ok: bool = True,
    error: str = "",
) -> None:
    if not settings.ENABLE_PERSISTENCE:
        return

    db.add(
        LLMCallLog(
            task_id=task_id,
            teacher_id=teacher_id,
            stage=stage,
            model=model,
            prompt_chars=prompt_chars,
            output_chars=output_chars,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            elapsed_ms=elapsed_ms,
            ok=1 if ok else 0,
            error=error[:500],
        )
    )
    await db.commit()


async def build_stats(db: AsyncSession) -> StatsOut:
    total_tasks = (await db.execute(select(func.count(GradingTask.id)))).scalar() or 0
    totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(GradingTask.llm_calls), 0),
                func.coalesce(func.sum(GradingTask.prompt_tokens), 0),
                func.coalesce(func.sum(GradingTask.completion_tokens), 0),
                func.coalesce(func.avg(GradingTask.score_rate), 0),
            )
        )
    ).one()

    llm_calls, ptokens, ctokens, avg_rate = totals

    by_mode_rows = (
        await db.execute(
            select(GradingTask.mode, func.count(GradingTask.id)).group_by(GradingTask.mode)
        )
    ).all()

    by_teacher: dict[str, int] = {}
    teacher_rows = (
        await db.execute(
            select(LLMCallLog.teacher_id, func.count(LLMCallLog.id))
            .where(LLMCallLog.teacher_id != "")
            .group_by(LLMCallLog.teacher_id)
        )
    ).all()
    for tid, cnt in teacher_rows:
        by_teacher[tid] = int(cnt)

    cost = (ptokens / 1_000_000) * PRICE_PROMPT_PER_M + (ctokens / 1_000_000) * PRICE_COMPLETION_PER_M

    return StatsOut(
        total_tasks=int(total_tasks),
        total_llm_calls=int(llm_calls),
        total_prompt_tokens=int(ptokens),
        total_completion_tokens=int(ctokens),
        estimated_cost_cny=round(cost, 4),
        avg_score_rate=round(float(avg_rate or 0) * 100, 1),
        by_mode={m: int(c) for m, c in by_mode_rows},
        by_teacher=by_teacher,
    )
