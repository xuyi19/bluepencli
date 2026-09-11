"""练习记录归档接口测试。

重点不是 CRUD 本身，而是三件容易出错的事：
1. 落盘产物的**形态**（md + json 同名、md 真的可读）
2. 列表接口**不回传正文**（否则记录一多，列表接口就变成几十万字的响应）
3. 记录目录被隔离到临时目录（由 conftest 保证），测试不污染用户 docs/
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _payload(rid="rec-00000001", title="“养老刚需”也是产业蓝海"):
    return {
        "id": rid,
        "created_at": "2026-09-11 21:50:00",
        "title": title,
        "requirement": "自拟题目，写一篇议论文，1000 字左右",
        "material": "截至2025年末，全国60周岁及以上老年人口32338万人……",
        "answer": "“老吾老，以及人之老。”庞大的银发群体，既是民生保障的重点……",
        "max_score": 40,
        "word_limit": 1200,
        "word_count": 1050,
        "mode": "trio",
        "teacher_ids": ["yuandong", "zhoutairan", "bailu"],
        "teachers": [
            {"id": "yuandong", "name": "袁东", "title": "按词给分 · 采分词裁判", "color": "#185fa5"},
            {"id": "zhoutairan", "name": "周泰然", "title": "材料逻辑 · 要点处理裁判", "color": "#0f6e56"},
            {"id": "bailu", "name": "白鹭", "title": "应题意识 · 形式回应裁判", "color": "#993556"},
        ],
        "final_score": 32.5,
        "level": "二类上",
        "roundtable_note": "三位老师对结构判断一致",
        "summary": "立意准确，结构完整，但分论点展开偏薄。",
        "suggestions": ["分论点补材料例证", "压缩开头"],
        "critical_issues": [{"issue": "分论点二空泛", "fix": "补一个具体数据", "source": "Kiwi"}],
        "minor_issues": [],
        "highlights": [{"point": "标题扣题", "why": "直接呼应材料关键词"}],
        "key_points": [{"point": "供给规模不足", "status": "hit", "note": "写到了"}],
        "teacher_results": [
            {
                "teacherId": "yuandong",
                "score": 30,
                "maxScore": 40,
                "advice": "优先把材料里的数字用上，采分词就稳了。",
                "annotations": [
                    {
                        "quote": "庞大的银发群体",
                        "type": "采分词缺失",
                        "comment": "材料原词是「老年人口占比 23%」，这里该直接引用数据",
                        "fix": "改写为「我国老年人口占比已达 23.0%」",
                    }
                ],
                "dimensions": [{"name": "采分词覆盖", "score": 10, "max": 15, "comment": "漏了 2 个关键数据"}],
                "deductions": [{"point": "漏采分点", "reason": "材料数据未用", "fix": "补数据"}],
                "summary": "内容方向对，但采分词漏得多。",
            }
        ],
        "elapsed_ms": 42000,
    }


async def test_save_creates_md_and_json(client, _isolate_records_dir):
    res = await client.post("/api/v1/records", json=_payload())
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "rec-00000001"

    files = sorted(p.name for p in _isolate_records_dir.iterdir())
    assert any(f.endswith(".md") for f in files)
    assert any(f.endswith(".json") for f in files)
    # 同 basename
    stems = {f.rsplit(".", 1)[0] for f in files}
    assert len(stems) == 1
    # 文件名带日期与标题（方便在 docs 里一眼认出）
    stem = stems.pop()
    assert stem.startswith("2026-09-11")
    assert "养老刚需" in stem


async def test_markdown_is_human_readable(client, _isolate_records_dir):
    await client.post("/api/v1/records", json=_payload())
    md = next(_isolate_records_dir.glob("*.md")).read_text(encoding="utf-8")

    for expect in ["# ", "## 三、我的作答", "## 四、老师批注", "袁东", "逐句批注", "修改建议", "庞大的银发群体"]:
        assert expect in md, f"markdown 缺少：{expect}"


async def test_list_returns_summary_without_full_answer(client):
    await client.post("/api/v1/records", json=_payload())
    res = await client.get("/api/v1/records")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1

    item = items[0]
    assert item["title"]
    assert item["final_score"] == 32.5
    assert item["teacher_ids"] == ["yuandong", "zhoutairan", "bailu"]
    # 列表不能带正文，否则响应会随记录数线性膨胀
    assert "answer" not in item
    assert "material" not in item


async def test_get_returns_full_record(client):
    await client.post("/api/v1/records", json=_payload())
    res = await client.get("/api/v1/records/rec-00000001")
    assert res.status_code == 200
    data = res.json()
    assert data["answer"].startswith("“老吾老")
    assert data["teacher_results"][0]["annotations"][0]["quote"] == "庞大的银发群体"


async def test_get_missing_returns_404(client):
    res = await client.get("/api/v1/records/not-exist")
    assert res.status_code == 404


async def test_save_is_idempotent_by_id(client, _isolate_records_dir):
    """同 id 重复保存应覆盖，而不是留下两份文件。"""
    await client.post("/api/v1/records", json=_payload())
    changed = _payload(title="改过的标题")
    await client.post("/api/v1/records", json=changed)

    files = list(_isolate_records_dir.glob("*.json"))
    assert len(files) == 1
    assert "改过的标题" in files[0].name


async def test_delete_removes_both_files(client, _isolate_records_dir):
    await client.post("/api/v1/records", json=_payload())
    res = await client.delete("/api/v1/records/rec-00000001")
    assert res.status_code == 200
    assert list(_isolate_records_dir.iterdir()) == []


async def test_markdown_endpoint(client):
    await client.post("/api/v1/records", json=_payload())
    res = await client.get("/api/v1/records/rec-00000001/markdown")
    assert res.status_code == 200
    assert res.json()["markdown"].startswith("# ")


async def test_markdown_section_numbers_have_no_gap(client, _isolate_records_dir):
    """没填「给定资料」时，章节号不应从「一」跳到「三」。

    之前章节号是硬编码的，资料一空就出现 一、三、四 这种缺号，
    看起来像文档丢了内容。
    """
    payload = _payload(rid="rec-nomat")
    payload["material"] = ""
    await client.post("/api/v1/records", json=payload)
    md_files = list(_isolate_records_dir.glob("*.md"))
    assert len(md_files) == 1
    md = md_files[0].read_text(encoding="utf-8")

    assert "## 一、题目" in md
    assert "## 二、我的作答" in md
    assert "## 三、老师批注" in md
    assert "给定资料" not in md
