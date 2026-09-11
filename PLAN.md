# 蓝笔申论 · 开发计划与现状

> 最后更新：2026-09-11

---

## 一、当前架构

```
bluepencil/
├── frontend/          Vue3 + Vite + Tailwind，双产物（网站版 / 单文件版）
├── backend/           FastAPI 网关 + 可选持久化（SQLite）+ 桌面版打包脚本
├── docs/              文档：上线分析、开发记录、文章库镜像
└── release/           分发包：单文件 HTML + 桌面版 zip（双击即用）
```

**核心设计：一套前端代码，三种运行通道。**

| 通道 | 触发条件 | 特点 |
|---|---|---|
| 服务端（网站版） | 探测到 `/api/v1/health` 可用 | 无 CORS、Key 可服务端配置、可记账 |
| 直连（单文件版） | 探测失败 | 无需服务器，用户自填 Key，受 CORS 限制 |
| 桌面版 | exe 内自带服务端 | **界面与 API 同进程**，无 CORS、可零配置、双击即用 |

桌面版是"发给别人"的主力形态：`release/蓝笔申论-桌面版.zip`（23MB），
对方解压双击 `蓝笔申论.exe` 即可，不装 Python / Node / 数据库。
在 exe 同级放 `config.json` 预置 Key 后，连配置都省了。

---

## 二、已完成

### 前端

- [x] 双产物构建：`npm run build` → 网站版，`npm run build:single` → 3.4MB 单文件
- [x] 五位真实名师 Agent（袁东 / 周泰然 / 白鹭 / Kiwi / 李崇立），讲义原文内置
- [x] 每人差异化评审侧重 + 权重（避免分数趋同导致圆桌失去意义）
- [x] 圆桌调度：并行阅卷 → 分歧检测 → **仅真分歧才辩论** → 加权合议
- [x] 支持 1~5 人任意组合，单人 / 双人 / 圆桌三种模式
- [x] 内置 31 篇官媒时评（9.5 万字）+ 真题题库
- [x] 文章导入导出：粘贴 / 上传文件 / 选整个文件夹 / JSON 文章包
- [x] 老师档案页：可读完整讲义原文 + 查看 AI 实际收到的系统提示
- [x] 双通道 API 层（`api/llm.js` + `api/backend.js`），运行期自动降级
- [x] 设置页通道状态可视化，支持自定义后端地址

### 后端

- [x] 分层结构对齐 resumatch-ai：`core / models / api/v1 / services / agents / utils`
- [x] LLM 网关：单次 / SSE 流式 / 批量并发（圆桌并行用）
- [x] 重试退避、超时控制、并发限流、JSON 三层兜底
- [x] SQLite 零配置持久化，`ENABLE_PERSISTENCE=False` 可一键关闭
- [x] 任务记账与成本统计（`/api/v1/stats`）
- [x] 模型连通性测试（`/api/v1/settings/test-llm`）
- [x] `GET /api/v1/settings/llm-default` —— 告知前端服务端是否已托管 Key（不回传 Key 本身）
- [x] 后端顺带托管前端静态文件，桌面版界面与 API 同进程、无跨域
- [x] pytest 冒烟测试（5 项全过）

### 桌面版分发

- [x] `backend/desktop.py` —— 选空闲端口、复用已运行实例、自动开浏览器
- [x] `backend/build_desktop.py` —— 一条命令出 `release/蓝笔申论-桌面版.zip`（23MB）
- [x] `backend/make_icon.py` —— SVG → 多尺寸 ICO，用系统 Chrome 无头渲染，零图形库依赖
- [x] frozen 感知的路径解析（打包后数据/配置落在 exe 同级，不再丢）
- [x] `config.json` 预置配置 → 使用者零配置直接用
- [x] 中文 exe 名、附带 `使用说明.txt`（UTF-8 BOM，记事本不乱码）
- [x] 实测：9 个路由无头渲染全通过、零配置路径验证通过

### 文档

- [x] `README.md` —— 项目主文档，对齐 resumatch-ai 的文档结构
- [x] `docs/上线部署分析.md` —— 四种上线形态、成本测算、部署清单、风险清单
- [x] `docs/articles/` —— 31 篇文章的 Markdown 镜像（按主题索引）
- [x] `docs/开发记录.md` —— 踩坑与验证记录

---

## 三、待办

### 阻塞项（必须有）

- [ ] **填入可用 API Key**，跑通一次真实批改。目前所有验证都在代码层与接口层，端到端批改链路一次都没实际跑过
- [ ] **实测成本**：三师圆桌 + 深度模式单次可能到 ¥0.12，五师 + 深度约 ¥0.22，需要实测校准

### 功能

- [ ] 老师档案页的 Markdown 渲染（现在是纯文本，标题表格都是原样字符）
- [ ] 批改结果导出（Word / PDF）
- [ ] OCR 识图（用户最初提过，已确认先不做）
- [ ] 手写板（已确认优先级最低）

### 上线（详见 `docs/上线部署分析.md`）

- [ ] 访问控制（共享访问码 / OAuth）
- [ ] 配额限流（**按批改次数限，不能按请求次数限**——一次圆桌 = 3~7 次 LLM 调用）
- [ ] 部署到服务器（Nginx 反代时记得 `proxy_buffering off`，否则流式会被攒起来）

---

## 四、数据流与文件归属（重要）

文章数据存在两份，**用途不同，不要混淆**：

| 位置 | 形态 | 谁在用 |
|---|---|---|
| `frontend/src/data/builtin-articles.json` | JSON | **程序**（打包进单文件版、运行时载入） |
| `docs/articles/*.md` | Markdown | **人**（查阅、校对、增补） |

同步方式：

```bash
cd frontend

# 从原始抓取数据 → 生成 JSON（源：Documents/晟安申论）
node scripts/import-articles.mjs

# JSON → 导出可读的 Markdown 镜像到 docs/
node scripts/export-articles-to-docs.mjs
```

老师讲义同理：`frontend/src/data/teachers/*.md` 是**唯一的源**（被前端 `?raw` 直接引用），
不能移动位置，`docs/` 下不再复制一份，避免出现两个版本。

---

## 五、已知的坑（都踩过了）

| 现象 | 原因 | 处理 |
|---|---|---|
| Vite 启动报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` | 本机安全删除策略拦截 vite 重建缓存（>50 文件） | `mv node_modules/.vite node_modules/.vite.old` 后重启 |
| **打包脚本跑到一半"正常结束"但什么都没生成** | 同上策略按**轮次累计**计数，会**终止 Python 进程**（`try/except` 救不回来，退出码仍是 0） | 构建放全新临时目录、输出目录用改名挪开、清理放脚本最后 |
| `pip install -U pip` 失败 | 同上，pip 自更新要删旧 dist-info | 跳过 pip 自更新，直接装 requirements |
| 移动大目录报 Permission denied | 文件被进程占用 | 先停 dev server，或改用 `robocopy /MOVE` |
| 同一文件并行多处编辑会丢改动 | 工具限制 | 同一文件的多处修改要串行 |
| 单文件版 favicon 404 | `file://` 下相对路径失效 | 已改为内联 data URI |
| 打包后启动即崩 `No module named 'aiosqlite'` | SQLAlchemy 用 `__import__("aiosqlite")` 字符串动态导入，PyInstaller 看不到 | `--hidden-import aiosqlite`（另有 `greenlet`、uvicorn 的 loop/protocol） |
| 打包后读不到 `.env`、数据库重启就没 | `__file__` 打包后指向临时解包目录 | 判断 `sys.frozen`，改用 `sys.executable` 定位 |

---

## 六、技术路线变更记录

| 阶段 | 决策 | 原因 |
|---|---|---|
| 起初 | Tauri 2 + Rust | 作品集含金量最高 |
| 后改 | 纯前端 + 单文件分发 | 避开 4~6GB MSVC 环境，且"发给别人就能用"更重要 |
| 再改 | 前后端分离 | 对齐 resumatch-ai 工程结构，后端解决 CORS 并承担网关职责 |
| **定稿** | **三种产物并存** | 网站版保住工程规范与上线能力；桌面版 zip 是"发给别人双击即用"的主力形态；单文件 HTML 保留作轻量备选 |
| **定稿** | **双通道并存** | 前后端结构保住工程规范与上线能力，单文件产物保住分发能力，两者不冲突 |

> Tauri 路线的完整难度分析已作废，不再保留。
