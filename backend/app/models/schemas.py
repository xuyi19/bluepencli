from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HealthOut(BaseModel):
    status: str
    app: str
    version: str
    db: str


# ---------------- LLM 网关 ----------------

class LLMConfig(BaseModel):
    """前端传来的模型配置；缺省项回退到服务端 .env。"""

    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    temperature: float = 0.3
    json_mode: bool = False
    llm_config: LLMConfig | None = None
    # 记账用（可选）
    task_id: str = ""
    teacher_id: str = ""
    stage: str = "grade"


class ChatResponse(BaseModel):
    content: str
    model: str = ""
    elapsed_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    finish_reason: str = ""


class BatchChatRequest(BaseModel):
    requests: list[ChatRequest]
    concurrency: int | None = None


class BatchChatResponse(BaseModel):
    results: list[ChatResponse]
    errors: list[str] = []
    elapsed_ms: int = 0


# ---------------- 批改任务 ----------------

class GradingTaskIn(BaseModel):
    task_id: str
    mode: str = "solo"
    teacher_ids: list[str] = []
    question_type: str = ""
    title: str = ""
    answer_chars: int = 0
    deep: bool = False
    final_score: float = 0
    max_score: float = 0
    elapsed_ms: int = 0
    llm_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    disputed: bool = False
    status: str = "success"
    error: str = ""


class GradingTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: str
    mode: str
    teacher_ids: str
    question_type: str
    title: str
    answer_chars: int
    deep: int
    final_score: float
    max_score: float
    score_rate: float
    elapsed_ms: int
    llm_calls: int
    prompt_tokens: int
    completion_tokens: int
    disputed: int
    status: str
    error: str
    created_at: datetime


# ---------------- 统计 ----------------

class StatsOut(BaseModel):
    total_tasks: int = 0
    total_llm_calls: int = 0
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    estimated_cost_cny: float = 0.0
    avg_score_rate: float = 0.0
    by_mode: dict[str, int] = Field(default_factory=dict)
    by_teacher: dict[str, int] = Field(default_factory=dict)


# ---------------- 设置 ----------------

class TestLLMRequest(BaseModel):
    api_key: str = ""
    base_url: str = ""
    model: str = ""


class TestLLMResponse(BaseModel):
    success: bool
    model: str = ""
    response: str = ""
    elapsed_ms: int = 0
    error: str = ""


# ---------------- 练习记录归档（docs/practice/）----------------
#
# 结构故意用宽松类型（list[dict] / dict）：批改结果由 LLM 产出，
# 字段形态会随 prompt 迭代变化，这里不该成为它的瓶颈。
# 真正需要保证的只是「前端写什么，复盘时原样读回来」。

class RecordTeacher(BaseModel):
    """阅卷老师元信息，让 markdown 记录自带署名与配色。"""

    id: str
    name: str = ""
    title: str = ""
    color: str = ""
    avatar: str = ""
    focus: str = ""
    school: str = ""


class PracticeRecordIn(BaseModel):
    """一次完整练习的快照（前端批改完成后提交）。"""

    id: str
    created_at: str = ""
    title: str = ""
    requirement: str = ""
    material: str = ""
    answer: str = ""
    max_score: float = 40
    word_limit: int | None = None
    word_count: int = 0
    mode: str = "solo"
    teacher_ids: list[str] = []
    teachers: list[RecordTeacher] = []
    final_score: float = 0
    level: str = ""
    roundtable_note: str = ""
    summary: str = ""
    suggestions: list[str] = []
    critical_issues: list[dict] = []
    minor_issues: list[dict] = []
    highlights: list[dict] = []
    key_points: list[dict] = []
    debate: dict | None = None
    teacher_results: list[dict] = []
    elapsed_ms: int = 0


class PracticeRecordSummary(BaseModel):
    """列表项摘要（不含正文，避免列表接口返回几十万字）。"""

    id: str
    created_at: str = ""
    title: str = ""
    mode: str = "solo"
    teacher_ids: list[str] = []
    final_score: float = 0
    max_score: float = 40
    level: str = ""
    word_count: int = 0
    preview: str = ""
    has_markdown: bool = True
