<template>
  <div :class="step === 'answer' ? 'w-full max-w-5xl' : 'w-full'">

    <!-- ==================== 页头 ==================== -->
    <div class="flex items-end justify-between gap-4 mb-8">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold text-c-ink">
          {{ step === 'answer' ? '练习批改' : step === 'grading' ? '批改中' : '批改结果' }}
        </h1>
        <p class="text-sm text-c-muted mt-1.5">
          {{ step === 'answer'
            ? '先把题答完，再交给老师批改'
            : step === 'grading'
              ? '老师正在各自独立阅卷，请稍候'
              : `${fmtDateTime(record?.createdAt)} · ${MODE_LABEL[report?.mode] || ''}` }}
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button v-if="step === 'result'" @click="backToAnswer"
          class="px-4 py-2 rounded-xl text-sm font-medium text-c-body neu-sm
            hover:text-c-bark transition-colors duration-200">
          修改作答
        </button>
        <button v-else-if="step === 'answer'" @click="resetAll"
          class="px-4 py-2 rounded-xl text-xs font-medium text-c-muted neu-sm
            hover:text-c-bark transition-colors duration-200">
          清空
        </button>
      </div>
    </div>

    <div v-if="!hasKey" class="rounded-2xl p-5 mb-8 neu-sm border-l-4 border-c-bark">
      <div class="text-sm text-c-body">
        还没配置 API Key，批改功能用不了。
        <RouterLink to="/settings" class="text-c-bark font-medium hover:underline">去设置 →</RouterLink>
      </div>
    </div>

    <!-- ==================== 第一步：答题 ==================== -->
    <template v-if="step === 'answer'">

      <!-- 今日一练：进页面就有题有材料，不用自己找。做成扁条，别把材料挤到折线以下 -->
      <section v-if="todayQ" class="rounded-2xl px-5 py-4 neu mb-5">
        <div class="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 mb-1.5">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
                style="background: #f2ebe2; color: #5c4033">今日一练</span>
              <span class="text-xs text-c-muted tnum">{{ todayLabel }}</span>
              <span class="text-xs px-1.5 py-0.5 rounded shrink-0"
                style="background: #e8ecdf; color: #3d5a7a">{{ todayQ.type }}</span>
              <span v-if="todayQ.kind" class="text-xs text-c-muted shrink-0">{{ todayQ.kind }}</span>
              <span class="text-xs text-c-muted truncate">{{ todayQ.exam }}</span>
              <span v-if="doneToday" class="text-xs shrink-0" style="color: #4f7d5e">✓ 今天已练过</span>
            </div>

            <h2 class="font-serif text-sm md:text-base text-c-ink leading-7">{{ todayQ.title }}</h2>

            <div class="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-c-muted mt-2">
              <span class="tnum">满分 {{ todayQ.maxScore }}</span>
              <span v-if="todayQ.wordLimit" class="tnum">≤ {{ todayQ.wordLimit }} 字</span>
              <span>{{ DIFFICULTY_LABEL[todayQ.difficulty] || '' }}</span>
              <span class="tnum">材料 {{ todayQ.materialChars || (todayQ.material || '').length }} 字</span>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button v-if="loadedId !== todayQ.id" @click="applyQuestion(todayQ)"
              class="px-4 py-2 rounded-xl text-xs font-medium text-c-cream
                bg-c-bark transition-colors duration-300">
              用今日一练作答
            </button>
            <span v-else
              class="px-4 py-2 rounded-xl text-xs font-medium neu-inset text-c-bark">
              已在作答这一题
            </span>
            <button @click="shuffle"
              class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-body
                hover:text-c-bark transition-colors duration-300">
              换一题
            </button>
          </div>
        </div>

        <!-- 材料速览：不点开只占一行，点开在卡片下方铺开，不挡下面的题目区 -->
        <!-- 真题的材料要等「用这道题」载入对应卷才有，这里先给个提示 -->
        <div v-if="todayQ.needLoad"
          class="mt-3 pt-3 border-t border-c-line text-xs text-c-muted leading-6">
          真题的整卷材料约 {{ todayQ.materialChars }} 字，点「用今日一练作答」后载入。
        </div>
        <details v-else class="mt-3 pt-3 border-t border-c-line group">
          <summary class="text-xs text-c-muted cursor-pointer hover:text-c-bark transition-colors list-none">
            <span class="transition-transform duration-300 group-open:rotate-90 inline-block mr-1">▸</span>
            先读材料（{{ materialBlocks(todayMaterialText).length }} 则）<span v-if="todayTrim" class="text-c-bark">· 本题用第 {{ todayTrim.used.join('、') }} 则</span>
          </summary>
          <div class="mt-3 max-h-72 overflow-y-auto space-y-3 pr-1">
            <div v-for="(b, i) in materialBlocks(todayMaterialText)" :key="i">
              <div v-if="b.label" class="text-xs font-medium text-c-bark mb-1">{{ b.label }}</div>
              <p class="text-xs text-c-body leading-7 whitespace-pre-wrap">{{ b.body }}</p>
            </div>
          </div>
        </details>
      </section>

      <!-- 阅卷老师：压成两行，把纵向空间让给题目与材料 -->
      <section class="rounded-2xl px-5 py-4 neu mb-5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
          <span class="text-sm font-medium text-c-body">谁来批改</span>
          <span class="text-xs text-c-muted">
            {{ MODE_LABEL[mode] }}<span v-if="selected.length" class="text-c-bark"> · {{ selected.length }} 位</span>
          </span>

          <div class="ml-auto flex flex-wrap items-center gap-1.5">
            <button v-for="p in PRESETS" :key="p.key" @click="selected = [...p.ids]"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200"
              :class="samePreset(p.ids)
                ? 'neu-inset text-c-bark font-medium'
                : 'text-c-muted hover:text-c-bark'"
              :title="p.hint">
              {{ p.label }}
            </button>
            <span class="w-px h-4 bg-c-line mx-1 hidden sm:block" />
            <button @click="deep = !deep"
              title="深度模式：注入老师方法论全文，判断更贴原始标准；代价是更慢更贵。日常练习建议关闭。"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200"
              :class="deep ? 'neu-inset text-c-bark font-medium' : 'text-c-muted hover:text-c-bark'">
              深度模式{{ deep ? ' · 开' : '' }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button v-for="t in TEACHER_LIST" :key="t.id" @click="toggle(t.id)"
            class="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-xs transition-all duration-200"
            :class="selected.includes(t.id) ? 'neu-inset' : 'neu-sm hover:opacity-90'"
            :title="`${t.name}｜${t.title}\n侧重：${t.focus}\n${t.desc}`">
            <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
              :style="selected.includes(t.id)
                ? { background: t.color, color: '#fffdfb' }
                : { background: t.color + '1f', color: t.color }">
              {{ t.avatar }}
            </span>
            <span :style="{ color: selected.includes(t.id) ? t.color : '#78716c' }"
              :class="selected.includes(t.id) ? 'font-medium' : ''">{{ t.name }}</span>
          </button>
        </div>
      </section>

      <!-- 给定资料 + 题目：并排，仿考场卷面 -->
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">

        <!-- 左：给定资料 -->
        <section class="lg:col-span-3 rounded-2xl p-5 neu flex flex-col">
          <div class="flex items-center justify-between gap-3 mb-3">
            <span class="text-sm font-medium text-c-body">
              给定资料
              <span v-if="form.material" class="text-xs text-c-muted font-normal tnum ml-1">
                {{ countChars(form.material) }} 字
              </span>
            </span>
            <div class="flex items-center gap-3 shrink-0">
              <button @click="togglePicker"
                class="text-xs text-c-muted hover:text-c-bark transition-colors">
                {{ showPicker ? '收起题库' : '从题库选题' }}
              </button>
              <button v-if="form.material && !showPicker" @click="materialEdit = !materialEdit"
                class="text-xs text-c-muted hover:text-c-bark transition-colors">
                {{ materialEdit ? '完成编辑' : '编辑' }}
              </button>
            </div>
          </div>

          <!-- 选题面板：空态与主动换题都走这里，左边不再是一片空白 -->
          <div v-if="showPicker" class="flex-1">
            <input v-model="pickKeyword" type="text" placeholder="搜索题目 / 来源 / 主题"
              class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none mb-3
                text-c-body placeholder:text-c-muted" />
            <div class="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
              <button v-for="q in pickList" :key="q.id" @click="applyQuestion(q)"
                class="w-full text-left rounded-xl p-3.5 neu-sm transition-all duration-200
                  hover:translate-y-px">
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="text-xs px-1.5 py-0.5 rounded shrink-0"
                    style="background: #e8ecdf; color: #3d5a7a">{{ q.type }}</span>
                  <span class="text-xs text-c-muted truncate">{{ q.exam }}</span>
                  <span v-if="q.id === loadedId" class="text-xs text-c-bark shrink-0 ml-auto">当前</span>
                </div>
                <div class="text-xs text-c-body leading-6">{{ q.title }}</div>
              </button>
              <div v-if="!pickList.length" class="text-xs text-c-muted py-6 text-center">
                没有匹配的题目
              </div>
            </div>
          </div>

          <!-- 有材料：阅读态（默认）/ 编辑态 -->
          <div v-else-if="form.material" class="flex-1 min-h-0">
            <div v-if="trimState.trimmed"
              class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-3 text-xs leading-5">
              <span class="font-medium text-c-bark">本题用给定资料{{ trimState.used.join('、') }}</span>
              <span class="text-c-muted tnum">
                整卷共 {{ trimState.dropped + trimState.used.length }} 则，已省去其余 {{ trimState.dropped }} 则（材料 {{ trimState.before }} → {{ trimState.after }} 字，省 {{ trimState.savedPct }}%）
              </span>
              <button @click="toggleTrim"
                class="underline underline-offset-2 text-c-muted hover:text-c-bark transition-colors">
                {{ trimState.active ? '查看整卷材料' : '只用本题材料' }}
              </button>
            </div>
            <textarea v-if="materialEdit" v-model="form.material" rows="14"
              placeholder="把材料原样粘进来（材料 1、材料 2……）"
              class="w-full h-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
                text-c-body placeholder:text-c-muted leading-7" />
            <div v-else class="max-h-[26rem] overflow-y-auto space-y-3.5 pr-1">
              <div v-for="(b, i) in materialBlocks(form.material)" :key="i">
                <div v-if="b.label" class="text-xs font-medium text-c-bark mb-1">{{ b.label }}</div>
                <p class="text-sm text-c-body leading-7 whitespace-pre-wrap">{{ b.body }}</p>
              </div>
            </div>
          </div>

          <!-- 空态：直接给选题入口，别留一片白 -->
          <div v-else class="flex-1 flex flex-col items-center justify-center py-10 text-center">
            <div class="text-sm text-c-body mb-1.5">还没有题目</div>
            <div class="text-xs text-c-muted leading-6 mb-4 max-w-xs">
              从题库挑一道开始，或直接粘贴你自己的材料
            </div>
            <div class="flex gap-2">
              <button @click="togglePicker"
                class="px-4 py-2 rounded-xl text-xs font-medium neu-inset text-c-bark">
                从题库选题
              </button>
              <button @click="startBlank"
                class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-body">
                空白作答
              </button>
            </div>
          </div>
        </section>

        <!-- 右：题目要求 -->
        <section class="lg:col-span-2 rounded-2xl p-5 neu">
          <div class="flex items-center justify-between mb-4">
            <span class="text-sm font-medium text-c-body">题目</span>
            <div class="flex items-center gap-1.5">
              <!-- 来源标签：导入的私有真题必须能一眼认出来（"这卷别外传"的前提是看得见） -->
              <span v-if="loadedMeta.kind" class="text-xs px-1.5 py-0.5 rounded font-medium"
                :style="kindBadgeStyle">{{ loadedMeta.kind }}</span>
              <span v-if="loadedMeta.type" class="text-xs px-1.5 py-0.5 rounded"
                style="background: #e8ecdf; color: #3d5a7a">{{ loadedMeta.type }}</span>
            </div>
          </div>

          <label class="block text-xs text-c-muted mb-1.5">题干</label>
          <textarea v-model="form.title" rows="3"
            placeholder="例：结合给定资料，围绕「养老刚需也是产业蓝海」自拟题目，写一篇文章"
            class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
              text-c-body placeholder:text-c-muted leading-6" />

          <label class="block text-xs text-c-muted mt-4 mb-1.5">作答要求</label>
          <textarea v-model="form.requirement" rows="4"
            placeholder="例：观点明确，结构完整，语言流畅，1000 字左右"
            class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
              text-c-body placeholder:text-c-muted leading-6" />

          <div class="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label class="block text-xs text-c-muted mb-1.5">满分</label>
              <input v-model.number="form.maxScore" type="number" min="1"
                class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none text-c-body tnum" />
            </div>
            <div>
              <label class="block text-xs text-c-muted mb-1.5">字数要求</label>
              <input v-model.number="form.wordLimit" type="number" placeholder="不限"
                class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none
                  text-c-body placeholder:text-c-muted tnum" />
            </div>
          </div>

          <div v-if="loadedMeta.topics?.length" class="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-c-line">
            <span v-for="t in loadedMeta.topics" :key="t"
              class="text-xs px-1.5 py-0.5 rounded" style="background: #f5f1ea; color: #78716c">
              {{ t }}
            </span>
          </div>
        </section>
      </div>

      <!-- 我的作答：方格纸，仿考场卷面 -->
      <section class="rounded-2xl p-5 neu mb-6">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-c-body">我的作答</span>
          <span v-if="overLimit" class="text-xs tnum text-[#b4552d]">
            超出 {{ countChars(form.answer) - form.wordLimit }} 字
          </span>
        </div>
        <div class="mx-auto w-full max-w-[760px]">
          <GridPaper v-model="form.answer" :word-limit="form.wordLimit || 0" />
        </div>
      </section>

      <!-- 提交：常驻底部，长作答不用滚回去找按钮 -->
      <div class="sticky bottom-4 z-10">
        <div class="rounded-2xl p-3 neu backdrop-blur">
          <div class="flex items-center gap-3">
            <button @click="start" :disabled="!canGrade"
              class="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300
                disabled:opacity-40 disabled:cursor-not-allowed neu-sm"
              :class="canGrade ? 'text-c-bark hover:translate-y-px' : 'text-c-muted'">
              答完了，开始批改（{{ selected.length }} 位老师）
            </button>
          </div>
          <div v-if="!canGrade" class="text-xs text-c-muted text-center mt-2">
            {{ !selected.length ? '先选至少一位阅卷老师' : !hasKey ? '先到设置页配置 API' : '作答至少 20 字才能提交' }}
          </div>
        </div>
      </div>
    </template>

    <!-- ==================== 第二步：批改中 ==================== -->
    <template v-else-if="step === 'grading'">
      <section class="rounded-2xl p-6 neu mb-6">
        <div class="flex items-center justify-between mb-5">
          <div class="flex items-center gap-2.5">
            <span class="w-2 h-2 rounded-full bg-c-bark animate-pulse" />
            <span class="text-sm font-medium text-c-body">{{ stageText }}</span>
          </div>
          <span class="text-xs text-c-muted tnum">{{ elapsed }}s</span>
        </div>

        <div class="space-y-3">
          <div v-for="t in runningTeachers" :key="t.id" class="rounded-xl p-3.5 neu-inset">
            <div class="flex items-center gap-2.5">
              <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                :style="{ background: t.state === 'waiting' ? '#e7e5e4' : t.color + '22', color: t.state === 'waiting' ? '#a8a29e' : t.color }">
                {{ t.avatar }}
              </span>
              <span class="text-xs font-medium text-c-body">{{ t.name }}</span>
              <span class="text-xs text-c-muted hidden sm:inline">{{ t.title }}</span>
              <span class="ml-auto text-xs"
                :class="t.state === 'done' ? 'text-[#4f7d5e]' : t.state === 'grading' ? t.color : 'text-c-muted'">
                {{ t.state === 'done' ? `${t.score} / ${t.max}` : t.state === 'grading' ? '批改中…' : '排队中' }}
              </span>
            </div>
            <div v-if="t.text" class="text-xs text-c-muted mt-2 line-clamp-2 leading-5">
              {{ t.text.slice(-120) }}
            </div>
          </div>
        </div>

        <div v-if="stage === 'debate' || stage === 'fusion'"
          class="rounded-xl p-4 mt-4 neu-inset border-l-2 border-c-bark">
          <div class="flex items-center gap-2 mb-2">
            <span class="w-1.5 h-1.5 rounded-full bg-c-bark animate-pulse" />
            <span class="text-xs font-medium text-c-bark">
              {{ stage === 'debate' ? '圆桌辩论：复核争议点' : '圆桌合议：融合观点结论' }}
            </span>
          </div>
          <pre v-if="stageText2" class="text-xs text-c-muted whitespace-pre-wrap leading-5 max-h-40 overflow-y-auto"
            style="font-family: inherit">{{ stageText2 }}</pre>
        </div>

        <div class="mt-5 text-center">
          <button @click="abort"
            class="px-5 py-2 rounded-xl text-xs font-medium neu-sm text-c-muted hover:text-[#b4552d] transition-colors">
            停止批改
          </button>
        </div>
      </section>
    </template>

    <!-- ==================== 第三步：结果 ==================== -->
    <template v-else-if="report">
      <div v-if="error" class="rounded-2xl p-4 mb-6 text-sm text-[#b4552d] leading-6 whitespace-pre-wrap"
        style="background: #f7e9e4">{{ error }}</div>

      <!-- 分数 -->
      <section class="rounded-2xl p-6 neu mb-6">
        <div class="flex items-center gap-6">
          <ScoreRing :score="report.final.finalScore" :max="report.final.maxScore || form.maxScore" />
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-c-ink">{{ report.final.level }}</div>
            <div class="text-xs text-c-muted mt-1.5 tnum">
              {{ report.final.finalScore }} / {{ report.final.maxScore || form.maxScore }} 分
              · 耗时 {{ (report.elapsed / 1000).toFixed(1) }}s
              · {{ countChars(form.answer) }} 字
            </div>
            <div class="text-xs text-c-muted mt-2.5 leading-5">{{ report.final.roundtableNote }}</div>
            <div v-if="archiveState" class="text-xs mt-2"
              :class="archiveState === 'docs' ? 'text-[#4f7d5e]' : 'text-c-muted'">
              {{ archiveState === 'docs'
                ? '本页已归档到 docs/practice/（含 md 与 json）'
                : '已存到本机浏览器（后端未连接，未写入 docs）' }}
            </div>
          </div>
        </div>
      </section>

      <!-- 评分可信度：这个分数有多少依据。
           紧贴分数是刻意的 —— 先把"能不能信"说清楚，考生才有心情看下面的改进建议 -->
      <CredibilityCard :credibility="report.credibility" />

      <!-- 复盘卡：考生看完分数最想知道"那我改哪儿"，所以放在分数下面第一个位置 -->
      <ReviewCard :record="report" />

      <!-- 客观校验（硬规则）：纯代码算出的板上钉钉的事实，与模型无关 -->
      <section v-if="report.hardRules" class="rounded-2xl p-5 neu mb-6">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-c-body">客观校验</span>
          <span class="text-xs text-c-muted tnum">
            程序计算 · 字数 {{ report.hardRules.stats.chars
            }}{{ report.hardRules.stats.wordLimit ? ` / ${report.hardRules.stats.wordLimit}` : '' }}
            · 段落 {{ report.hardRules.stats.paragraphs }}
          </span>
        </div>

        <div v-if="!meaningfulRules.length" class="text-xs text-c-muted leading-6">
          未发现客观问题：字数、标点、分段、重复与照抄检查均通过。
        </div>

        <div v-else class="space-y-2.5">
          <div v-for="f in meaningfulRules" :key="f.id" class="rounded-xl p-3 neu-inset">
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                :style="{ background: ruleLevelStyle(f.level).bg, color: ruleLevelStyle(f.level).fg }">
                {{ ruleLevelLabel(f.level) }}
              </span>
              <span class="text-xs text-c-muted">{{ f.category }}</span>
              <span class="text-sm text-c-ink font-medium">{{ f.title }}</span>
              <span v-if="f.deduction" class="text-xs ml-auto tnum shrink-0" style="color: #9c4a42">
                −{{ f.deduction }} 分
              </span>
            </div>
            <div class="text-xs text-c-body leading-6">{{ f.detail }}</div>
            <div v-if="f.evidence?.length" class="text-[11px] text-c-muted mt-1.5 leading-5">
              证据：{{ f.evidence.join('｜') }}
            </div>
            <div v-if="f.suggest" class="text-xs mt-1.5 leading-6" style="color: #4f7d5e">
              改法：{{ f.suggest }}
            </div>
          </div>
          <div v-if="report.hardRules.capped" class="text-[11px] text-c-muted pt-1 leading-5">
            合计客观扣分 {{ report.hardRules.rawDeduction }} 分，已封顶为 {{ report.hardRules.objectiveDeduction }} 分
            （满分 20%）。本项只作旁证，最终分数以合议为准。
          </div>
        </div>
      </section>

      <!-- 采分点对照：标准逐点 × 程序粗判 -->
      <section v-if="report.standard" class="rounded-2xl p-5 neu mb-6">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-c-body">采分点对照</span>
          <span class="text-xs text-c-muted tnum">
            覆盖率 {{ report.standard.coverage }}%（{{ report.standard.earned }} / {{ report.standard.total }} 分，程序粗判）
          </span>
        </div>
        <div class="h-1.5 rounded-full mb-4" style="background: #eae2d8">
          <div class="h-1.5 rounded-full" style="background: #8b9d77"
            :style="{ width: report.standard.coverage + '%' }"></div>
        </div>
        <div class="space-y-2.5">
          <div v-for="p in report.standard.rows" :key="p.id" class="flex gap-2.5 items-start">
            <span class="text-[11px] mt-0.5 px-1.5 py-0.5 rounded shrink-0" :style="pointStatusStyle(p.status)">
              {{ pointStatusLabel(p.status) }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-xs text-c-body leading-6">{{ p.label }}</div>
              <div v-if="p.matchedKeywords?.length" class="text-[11px] text-c-muted mt-0.5 leading-5">
                命中：{{ p.matchedKeywords.join('、') }}
              </div>
              <div v-if="p.status === 'miss' && p.evidence?.length" class="text-[11px] text-c-muted mt-0.5 leading-5">
                材料依据：{{ p.evidence.slice(0, 2).join('｜') }}
              </div>
            </div>
            <span class="text-xs tnum shrink-0 text-c-muted">{{ p.earned }} / {{ p.weight }}</span>
          </div>
        </div>
        <div class="text-[11px] text-c-muted mt-3 leading-5">
          说明：这是程序按关键词粗判的覆盖率，只作参照；正式得分以老师判断与合议结论为准。
        </div>
      </section>

      <!-- 老师色标批注：这一屏的主角 -->
      <section class="rounded-2xl p-6 neu mb-6">
        <div class="flex items-center justify-between mb-4">
          <span class="text-sm font-medium text-c-body">我的作答 · 老师批注</span>
          <span class="text-xs text-c-muted">不同老师用不同颜色</span>
        </div>
        <AnnotatedAnswer :answer="form.answer" :results="report.results" />
      </section>

      <!-- 各老师：一张卡一位，左侧色条 -->
      <section v-for="(r, i) in report.results" :key="r.teacherId"
        class="rounded-2xl p-5 neu mb-5" :style="{ borderLeft: `4px solid ${teacherColor(r.teacherId)}` }">
        <div class="flex items-center gap-3 mb-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0"
            :style="{ background: teacherColor(r.teacherId) + '22', color: teacherColor(r.teacherId) }">
            {{ teacherAvatar(r.teacherId) }}
          </span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-c-ink">{{ teacherName(r.teacherId) }}</div>
            <div class="text-xs text-c-muted">{{ teacherTitle(r.teacherId) }}</div>
          </div>
          <div class="ml-auto text-right shrink-0">
            <div class="text-lg font-semibold tnum" :style="{ color: teacherColor(r.teacherId) }">
              {{ r.error ? '—' : r.score }}
              <span class="text-xs text-c-muted font-normal">/ {{ r.maxScore }}</span>
            </div>
          </div>
        </div>

        <div v-if="r.error" class="text-xs text-[#b4552d]">
          {{ r.error }}，原始输出：<pre class="mt-2 whitespace-pre-wrap text-c-muted">{{ r.rawText }}</pre>
        </div>

        <template v-else>
          <!-- 一段修改建议 -->
          <div v-if="r.advice" class="rounded-xl p-4 mb-4"
            :style="{ background: teacherColor(r.teacherId) + '0f' }">
            <div class="text-xs font-medium mb-1.5" :style="{ color: teacherColor(r.teacherId) }">修改建议</div>
            <div class="text-sm text-c-body leading-7">{{ r.advice }}</div>
          </div>

          <!-- 逐句批注 -->
          <div v-if="r.annotations?.length" class="mb-4">
            <div class="text-xs text-c-muted mb-2">逐句批注（{{ r.annotations.length }}）</div>
            <div class="space-y-2">
              <div v-for="(a, j) in r.annotations" :key="j" class="rounded-xl p-3 neu-inset">
                <div class="flex items-start gap-2 flex-wrap">
                  <span class="text-xs px-1.5 py-0.5 rounded shrink-0"
                    :style="{ background: teacherColor(r.teacherId) + '1f', color: teacherColor(r.teacherId) }">
                    {{ a.type || '问题' }}
                  </span>
                  <span v-if="a.quote" class="text-xs text-c-muted italic">「{{ truncate(a.quote, 28) }}」</span>
                </div>
                <div v-if="a.comment" class="text-xs text-c-body mt-2 leading-6">{{ a.comment }}</div>
                <div v-if="a.fix" class="text-xs mt-1 leading-6" style="color: #4f7d5e">改：{{ a.fix }}</div>
              </div>
            </div>
          </div>

          <!-- 分项 -->
          <div v-if="r.dimensions?.length" class="mb-4">
            <div class="text-xs text-c-muted mb-2">分项得分</div>
            <div class="space-y-2.5">
              <div v-for="d in r.dimensions" :key="d.name" class="text-xs">
                <div class="flex justify-between mb-1">
                  <span class="text-c-body">{{ d.name }}</span>
                  <span class="text-c-muted tnum">{{ d.score }}/{{ d.max }}</span>
                </div>
                <div class="h-1 rounded-full neu-inset overflow-hidden">
                  <div class="h-full rounded-full transition-all duration-700"
                    :style="{ width: pct(d.score, d.max) + '%', background: teacherColor(r.teacherId) }" />
                </div>
                <div v-if="d.comment" class="text-c-muted mt-1 leading-5">{{ d.comment }}</div>
              </div>
            </div>
          </div>

          <!-- 扣分点 -->
          <details v-if="r.deductions?.length" class="mb-3">
            <summary class="text-xs text-c-muted cursor-pointer hover:text-c-bark">
              扣分点（{{ r.deductions.length }}）
            </summary>
            <div class="space-y-2 mt-2">
              <div v-for="(d, j) in r.deductions" :key="j" class="text-xs leading-6">
                <span class="text-c-body">{{ d.point }}</span>
                <span v-if="d.reason" class="text-c-muted"> —— {{ d.reason }}</span>
                <div v-if="d.fix" style="color: #4f7d5e">改：{{ d.fix }}</div>
              </div>
            </div>
          </details>

          <!-- 亮点 -->
          <div v-if="r.highlights?.length" class="mb-3">
            <div class="text-xs text-c-muted mb-1.5">亮点</div>
            <div v-for="(h, j) in r.highlights" :key="j" class="text-xs text-c-body leading-6">
              · <span class="text-c-ink">{{ h.point }}</span> — {{ h.why }}
            </div>
          </div>

          <!-- 升格方向 -->
          <div v-if="r.upgrade" class="text-xs leading-6" style="color: #9c4a42">
            升格方向：{{ r.upgrade }}
          </div>

          <!-- 改写示例 -->
          <details v-if="r.rewrites?.length" class="mt-3 pt-3 border-t border-c-line">
            <summary class="text-xs text-c-muted cursor-pointer hover:text-c-bark">
              改写示例（{{ r.rewrites.length }}）
            </summary>
            <div class="space-y-2.5 mt-2.5">
              <div v-for="(w, j) in r.rewrites" :key="j" class="text-xs leading-6">
                <div class="text-c-muted line-through">{{ w.original }}</div>
                <div style="color: #4f7d5e">{{ w.rewritten }}</div>
              </div>
            </div>
          </details>

          <!-- 总评 -->
          <div v-if="r.summary" class="text-xs text-c-body leading-6 mt-3 pt-3 border-t border-c-line">
            {{ r.summary }}
          </div>
        </template>
      </section>

      <!-- 采分点核对 -->
      <section v-if="keyPoints.length" class="rounded-2xl p-5 neu mb-6">
        <div class="text-xs text-c-muted mb-3">
          采分点核对
          <span class="text-c-muted">
            （命中 {{ kpSummary.hit }} / {{ kpSummary.total }} 项<span v-if="kpSummary.partial">
              ，部分命中 {{ kpSummary.partial }}</span>）
          </span>
          <span v-if="kpSummary.weightSum" class="text-c-muted">
            · 程序计 {{ kpSummary.earnedSum }} / {{ kpSummary.weightSum }} 分
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="(p, i) in keyPoints" :key="i"
            class="text-xs px-2 py-1 rounded-lg cursor-default"
            :title="(p.sources?.length ? `[${p.sources.join('、')}] ` : '') + (p.note || p.point)"
            :style="{
              background: p.status === 'hit' ? '#e8ecdf' : p.status === 'partial' ? '#f7eddc' : '#f7e9e4',
              color: p.status === 'hit' ? '#4f7d5e' : p.status === 'partial' ? '#9c6b2f' : '#b4552d',
            }">
            {{ p.status === 'hit' ? '✓' : p.status === 'partial' ? '~' : '✗' }}
            {{ truncate(p.point, 10) }}
          </span>
        </div>
        <div v-if="kpSummary.extra" class="text-[11px] text-c-muted mt-2.5 leading-5">
          另有 {{ kpSummary.extra }} 条标准之外的补充点（不计入上表分值）
        </div>
      </section>

      <!-- 圆桌分歧 -->
      <section v-if="report.debate?.disputes?.length" class="rounded-2xl p-5 neu mb-6">
        <div class="text-xs text-c-muted mb-3">圆桌分歧裁定</div>
        <div class="space-y-3">
          <div v-for="(d, i) in report.debate.disputes" :key="i" class="rounded-xl p-3.5 neu-inset">
            <div class="text-xs font-medium text-c-body">{{ d.topic }}</div>
            <div v-for="(p, j) in d.positions || []" :key="j" class="text-xs text-c-muted mt-1.5 leading-6">
              <span :style="{ color: teacherColor(p.teacher) }">{{ teacherName(p.teacher) }}</span>：{{ p.view }}
            </div>
            <div class="text-xs text-c-bark mt-2 leading-6">裁定：{{ d.ruling }}</div>
            <div v-if="d.reason" class="text-xs text-c-muted mt-1 leading-5">{{ d.reason }}</div>
          </div>
        </div>
      </section>

      <div v-if="report.dispute?.disputed && report.mode !== 'solo' && report.mode !== 'duo'"
        class="rounded-2xl p-4 mb-6 text-xs leading-6"
        style="background: #f7eddc; color: #9c6b2f">
        {{ report.teachers.length }} 位老师评分差异 {{ report.dispute.spreadPct }}%
        （最高 {{ report.dispute.maxRate }}% / 最低 {{ report.dispute.minRate }}%），已触发圆桌复核辩论
      </div>

      <!-- 综合结论 -->
      <section class="rounded-2xl p-5 neu mb-6">
        <div class="text-xs text-c-muted mb-3">综合结论</div>

        <div v-if="report.final.summary" class="text-sm text-c-body leading-7 whitespace-pre-wrap mb-5">
          {{ report.final.summary }}
        </div>

        <div v-if="report.final.criticalIssues?.length" class="mb-5">
          <div class="text-xs text-c-muted mb-2">优先解决</div>
          <div class="space-y-2">
            <div v-for="(d, i) in report.final.criticalIssues" :key="i" class="rounded-xl p-3.5 neu-inset">
              <div class="flex justify-between items-start gap-2">
                <span class="text-xs font-medium text-c-body">{{ d.issue }}</span>
                <span v-if="d.source" class="text-xs text-c-muted shrink-0">{{ d.source }}</span>
              </div>
              <div v-if="d.fix" class="text-xs mt-1.5 leading-6" style="color: #4f7d5e">改：{{ d.fix }}</div>
            </div>
          </div>
        </div>

        <details v-if="report.final.minorIssues?.length" class="mb-5">
          <summary class="text-xs text-c-muted cursor-pointer hover:text-c-bark">
            次要问题（{{ report.final.minorIssues.length }} 条）
          </summary>
          <div class="space-y-2 mt-2">
            <div v-for="(d, i) in report.final.minorIssues" :key="i" class="text-xs leading-6">
              <span class="text-c-body">{{ d.issue }}</span>
              <span v-if="d.fix" class="text-c-muted"> —— {{ d.fix }}</span>
            </div>
          </div>
        </details>

        <div v-if="report.final.suggestions?.length">
          <div class="text-xs text-c-muted mb-2.5">改进建议（按优先级）</div>
          <ul class="space-y-2">
            <li v-for="(s, i) in report.final.suggestions" :key="i" class="text-sm text-c-body flex gap-2 leading-6">
              <span class="text-c-bark shrink-0 tnum">{{ i + 1 }}.</span><span>{{ s }}</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- 追问 / 示范答案 -->
      <section class="rounded-2xl p-5 neu mb-6">
        <div class="flex gap-3">
          <button @click="askFollowup"
            class="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-body
              hover:text-c-bark transition-colors">
            追问老师
          </button>
          <button @click="genSample" :disabled="sampling"
            class="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-body
              hover:text-c-bark transition-colors disabled:opacity-40">
            {{ sampling ? '生成中…' : '看示范答案' }}
          </button>
        </div>

        <div v-if="followupText || sampleText" class="mt-5 space-y-5">
          <div v-if="followupText">
            <div class="text-xs text-c-muted mb-2">老师答疑</div>
            <div class="text-sm text-c-body leading-7 whitespace-pre-wrap">{{ followupText }}</div>
          </div>
          <div v-if="sampleText">
            <div class="text-xs text-c-muted mb-2">示范答案</div>
            <div class="text-sm text-c-body leading-7 whitespace-pre-wrap">{{ sampleText }}</div>
          </div>
        </div>
      </section>

      <div class="flex justify-center gap-3 pb-4">
        <RouterLink to="/records"
          class="px-5 py-2.5 rounded-xl text-xs font-medium neu text-c-bark">
          去复盘 →
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { toast } from '../utils/toast'
import ScoreRing from '../components/ScoreRing.vue'
import AnnotatedAnswer from '../components/AnnotatedAnswer.vue'
import ReviewCard from '../components/ReviewCard.vue'
import CredibilityCard from '../components/CredibilityCard.vue'
import GridPaper from '../components/GridPaper.vue'
import { chat } from '../api/llm'
import { buildFollowupMessages, buildSampleMessages } from '../prompts'
import { TEACHERS, TEACHER_LIST, MODE_LABEL, PRESETS, detectMode } from '../agents/teachers'
import { runGrading } from '../agents/orchestrator'
import { resolveStandard } from '../agents/grading/standardResolver'
import { mergeKeyPoints, summarizeKeyPoints } from '../utils/grading/keyPoints'
import { trimMaterial } from '../utils/grading/materialTrim'
import { buildRecord, archiveRecord, countChars, fmtDateTime, listAllRecords } from '../utils/record'
import { getAll, STORES } from '../store/db'
import { DIFFICULTY_LABEL } from '../data/builtin-questions'
import { BUILTIN_POOL, resolveQuestion } from '../data/questions'
import { pickDaily, pickRandom, practicedToday } from '../data/daily'
import { useReadiness } from '../utils/readiness'

const route = useRoute()

// 三步：答题 → 批改中 → 结果。同一路由内切换，
// 好处是刷新页面不会把作答丢掉（表单还在这一个组件里）。
const step = ref('answer')

const form = reactive({
  title: '',
  requirement: '',
  material: '',
  answer: '',
  maxScore: 40,
  wordLimit: null,
  // 题型随 form 一起走：批改记录要存它（「再练一题」按同题型找题）。
  // 不要在这里删掉改用 loadedMeta.type —— 记录是从 form 构建的，读不到 loadedMeta。
  questionType: '',
})

// 按题裁材料（v0.17.0 起**默认启用**，用户拍板）：
// 真题 material 存的是整卷，小题只问其中一两则 —— 展示与批改都用裁后材料，
// 材料区给一行说明 + 「查看整卷材料」开关。裁剪规矩见 utils/grading/materialTrim.js：
// 解析不出资料号不裁、大作文不裁、引用的号找不到不裁 —— 三种情况都整卷原样。
const trimState = reactive({
  trimmed: false,   // 这次题目有没有真的裁掉东西
  active: false,    // 当前展示/提交的是裁后材料吗
  used: [],         // 题干引用的资料号
  dropped: 0,       // 裁掉几则
  before: 0, after: 0, savedPct: 0,
  text: '',         // 裁后材料（切回来用）
  full: '',         // 整卷材料
})

/** 裁后 ⇄ 整卷 手动切换。切换会覆盖对材料的手工编辑——这是显式动作，不算误伤。 */
function toggleTrim() {
  if (!trimState.trimmed) return
  trimState.active = !trimState.active
  form.material = trimState.active ? trimState.text : trimState.full
}

/** 载入题目后按题裁材料；裁不动的（大作文/无分则/解析不出）整卷原样 */
function applyTrim(q) {
  const fullMat = q.material || ''
  const stem = [q.title, q.requirement].filter(Boolean).join(' ')
  const t = trimMaterial(fullMat, stem)
  trimState.full = fullMat
  trimState.text = t.text
  trimState.used = t.used || []
  trimState.dropped = t.dropped || 0
  trimState.before = t.before || fullMat.length
  trimState.after = t.after || fullMat.length
  trimState.savedPct = t.savedPct || 0
  trimState.trimmed = !!t.trimmed
  trimState.active = !!t.trimmed
  form.material = t.trimmed ? t.text : fullMat
}

function resetTrim() {
  Object.assign(trimState, {
    trimmed: false, active: false, used: [], dropped: 0,
    before: 0, after: 0, savedPct: 0, text: '', full: '',
  })
}

const selected = ref(['yuandong', 'zhoutairan', 'bailu'])
const deep = ref(false)
const stage = ref('')
const stageText2 = ref('')
const elapsed = ref(0)
const report = ref(null)
const record = ref(null)
const archiveState = ref('')
const error = ref('')
const followupText = ref('')
const sampleText = ref('')
const sampling = ref(false)
const teacherProgress = reactive({})

// —— 题库与每日一练 ——
// BUILTIN_POOL = 仿真题（资源在包内）+ 真题（只有摘要，材料与答案练习时才载入）
const builtin = BUILTIN_POOL
const mine = ref([])
const todayQ = ref(null)
const doneToday = ref(false)

// 今日一练卡片的材料速览：同样按题裁 —— 卡片展示的就是作答时真正要读的那几则。
const todayTrim = computed(() => {
  const q = todayQ.value
  if (!q || q.needLoad || !q.material) return null
  const t = trimMaterial(q.material, [q.title, q.requirement].filter(Boolean).join(' '))
  return t.trimmed ? t : null
})
const todayMaterialText = computed(() =>
  todayTrim.value ? todayTrim.value.text : todayQ.value?.material || ''
)

const loadedId = ref('')
const loadedMeta = reactive({ type: '', exam: '', difficulty: 0, kind: '', topics: [] })
const showPicker = ref(false)
const materialEdit = ref(false)
const pickKeyword = ref('')

let controller = null
let timer = null

const { ready: hasKey, probeReadiness } = useReadiness()

/** 来源标签配色，与题库页 kindStyle 保持一致：真题赭黄 / 私有用藕紫 / 仿真暖棕 / 自建灰 */
const kindBadgeStyle = computed(() => {
  const k = loadedMeta.kind
  if (k === '真题') return 'background:#f7eddc;color:#9c6b2f'
  if (k === '私有') return 'background:#efeaf4;color:#7a6a9b'
  if (k === '仿真') return 'background:#f2ebe2;color:#5c4033'
  return 'background:#f5f1ea;color:#78716c'
})

const pool = computed(() => [...mine.value, ...builtin])
const mode = computed(() => detectMode(selected.value))
const overLimit = computed(() => form.wordLimit && countChars(form.answer) > form.wordLimit)
const canGrade = computed(
  () => hasKey.value && selected.value.length > 0 && form.answer.trim().length > 20
)

const todayLabel = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
})

/** 选题面板：按关键词过滤，未加载的排前面 */
const pickList = computed(() => {
  const k = pickKeyword.value.trim().toLowerCase()
  const list = pool.value.filter((q) => {
    if (!k) return true
    return (
      (q.title || '').toLowerCase().includes(k) ||
      (q.exam || '').toLowerCase().includes(k) ||
      (q.type || '').toLowerCase().includes(k) ||
      (q.topics || []).some((t) => t.toLowerCase().includes(k))
    )
  })
  return [...list].sort((a, b) => (a.id === loadedId.value ? -1 : b.id === loadedId.value ? 1 : 0))
})

const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0)
const truncate = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : s)

/**
 * 把给定资料按「材料1 / 材料2」拆成块。
 * 真题材料就是这种分则结构，拆开渲染比一整块 textarea 好读得多。
 * 不在行首出现的「材料」二字（正文里提到）不会被误切——只认整行匹配。
 */
function materialBlocks(text) {
  const src = String(text || '')
  if (!src.trim()) return []
  const blocks = []
  let cur = null
  for (const line of src.split('\n')) {
    const m = line.match(/^材料\s*([0-9一二三四五六七八九十]+)\s*$/)
    if (m) {
      cur = { label: `材料${m[1]}`, body: [] }
      blocks.push(cur)
      continue
    }
    if (!cur) {
      cur = { label: '', body: [] }
      blocks.push(cur)
    }
    cur.body.push(line)
  }
  return blocks
    .map((b) => ({ label: b.label, body: b.body.join('\n').trim() }))
    .filter((b) => b.label || b.body)
}

const stageText = computed(() => {
  const map = {
    grading: '独立阅卷中',
    detect: '比对评分',
    debate: '圆桌辩论中',
    fusion: '合议汇总中',
  }
  return map[stage.value] || '批改中'
})

const runningTeachers = computed(() =>
  selected.value.map((id) => {
    const t = TEACHERS[id]
    const p = teacherProgress[id] || {}
    return {
      id,
      name: t.name,
      title: t.title,
      color: t.color,
      avatar: t.avatar,
      state: p.state || 'waiting',
      score: p.score,
      max: p.max,
      text: p.text,
    }
  })
)

const keyPoints = computed(() => {
  const final = report.value?.final?.keyPoints
  if (Array.isArray(final) && final.length) return final
  // 兜底：老记录（final.keyPoints 还没有这个字段时）走一遍归并。
  // ⚠️ 这里**不能**直接 flatMap —— 那正是本 bug 的第二现场：
  //    多老师时同一采分点会被拼 N 次，「命中 X / Y 项」跟着变成假数字。
  //    历史归档里的记录同样要按新口径显示，所以兜底也必须归并。
  return mergeKeyPoints(report.value?.results || [], resolveStandard(loadedId.value)?.standard || null)
})

/** 采分点统计：命中/部分/缺失、程序计分 —— 全部基于**归并后**的数据，可复算 */
const kpSummary = computed(() => summarizeKeyPoints(keyPoints.value))

function teacherName(id) {
  return TEACHERS[id]?.name || id
}
function teacherTitle(id) {
  return TEACHERS[id]?.title || ''
}
function teacherColor(id) {
  return TEACHERS[id]?.color || '#5c4033'
}
function teacherAvatar(id) {
  return TEACHERS[id]?.avatar || '?'
}

// ── 客观校验 / 采分点对照 的展示辅助 ──
// 只滤掉「字数刚好达标」这类纯报平安的条目，其余（含 0 分扣的提示）都展示，
// 因为"结尾缺标点""未首行缩进"这类小问题恰恰是提分最快的地方。
const meaningfulRules = computed(() =>
  (report.value?.hardRules?.findings || []).filter((f) => f.id !== 'word-fit')
)

function ruleLevelStyle(level) {
  if (level === 'fatal') return { bg: '#f7e9e4', fg: '#9c4a42' }
  if (level === 'major') return { bg: '#f7f0e2', fg: '#9c6b2f' }
  return { bg: '#eef1e8', fg: '#6b7a52' }
}
function ruleLevelLabel(level) {
  return { fatal: '严重', major: '需注意', minor: '提示' }[level] || '提示'
}

function pointStatusStyle(status) {
  if (status === 'hit') return { background: '#e6efe6', color: '#4f7d5e' }
  if (status === 'partial') return { background: '#f7f0e2', color: '#9c6b2f' }
  return { background: '#f7e9e4', color: '#9c4a42' }
}
function pointStatusLabel(status) {
  return { hit: '命中', partial: '部分', miss: '缺失' }[status] || '—'
}

function toggle(id) {
  const i = selected.value.indexOf(id)
  selected.value = i === -1 ? [...selected.value, id] : selected.value.filter((x) => x !== id)
}

function samePreset(ids) {
  return ids.length === selected.value.length && ids.every((i) => selected.value.includes(i))
}

/**
 * 把一道题带进表单。这是「题目和材料都没有」的解药——
 * 不论来自每日一练、选题面板还是题库页跳转，都走这一条路，
 * 保证 title / material / requirement / maxScore / wordLimit 五个字段一起到位。
 *
 * 必须 await：真题从池子里拿到的只是摘要（材料与答案是空的），
 * 真正的内容要 loadFullQuestion 去 await 对应卷的 chunk。
 */
async function applyQuestion(q, { resetAnswer = true } = {}) {
  if (!q) return
  const full = await resolveQuestion(q)
  if (!full) {
    toast.error('这道题的正文没能载入，换一道试试')
    return
  }
  q = full
  form.title = q.title || ''
  applyTrim(q)
  form.requirement = q.requirement || ''
  form.maxScore = Number(q.maxScore) || 40
  form.wordLimit = Number(q.wordLimit) || null
  form.questionType = q.type || ''
  if (resetAnswer) form.answer = ''

  loadedId.value = q.id || ''
  Object.assign(loadedMeta, {
    type: q.type || '',
    exam: q.exam || '',
    difficulty: q.difficulty || 0,
    kind: q.kind || (q.builtin ? '仿真' : '自建'),
    topics: q.topics || [],
  })

  showPicker.value = false
  materialEdit.value = false
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

/** 换一题：随机，但不与当前这题重复 */
async function shuffle() {
  const q = pickRandom(pool.value, loadedId.value)
  if (!q) return toast.warning('题库是空的，先录入题目')
  await applyQuestion(q)
  toast.success('已换一题')
}

function togglePicker() {
  showPicker.value = !showPicker.value
  if (showPicker.value) materialEdit.value = false
}

/** 空白作答：清掉题目，只留输入框，方便粘贴自己的材料 */
function startBlank() {
  form.title = ''
  form.material = ''
  resetTrim()
  form.requirement = ''
  form.maxScore = 40
  form.wordLimit = null
  form.questionType = ''
  form.answer = ''
  loadedId.value = ''
  Object.assign(loadedMeta, { type: '', exam: '', difficulty: 0, kind: '', topics: [] })
  showPicker.value = false
  materialEdit.value = true
}

function clearRun() {
  report.value = null
  error.value = ''
  followupText.value = ''
  sampleText.value = ''
  stageText2.value = ''
  archiveState.value = ''
  Object.keys(teacherProgress).forEach((k) => delete teacherProgress[k])
}

function resetAll() {
  clearRun()
  startBlank()
  form.answer = ''
}

function backToAnswer() {
  step.value = 'answer'
}

async function start() {
  if (!canGrade.value) {
    if (!selected.value.length) toast.warning('请至少选择一位阅卷老师')
    else if (!hasKey.value) toast.warning('请先到设置页配置 API Key')
    else toast.warning('请先填写作答内容（至少 20 字）')
    return
  }

  clearRun()
  step.value = 'grading'
  elapsed.value = 0
  timer = setInterval(() => {
    elapsed.value++
  }, 1000)
  controller = new AbortController()

  for (const id of selected.value) {
    teacherProgress[id] = { state: 'waiting', text: '' }
  }

  try {
    const result = await runGrading({
      // questionId 用于取该题的采分点标准；questionType 供硬规则判断"该不该分条"
      paper: { ...form, questionId: loadedId.value, questionType: loadedMeta.type },
      teacherIds: [...selected.value],
      deep: deep.value,
      signal: controller.signal,
      onProgress: (ev) => {
        if (ev.type === 'stage') {
          stage.value = ev.stage
          if (ev.stage !== 'debate' && ev.stage !== 'fusion') stageText2.value = ''
        } else if (ev.type === 'teacher:start') {
          teacherProgress[ev.teacherId] = { ...teacherProgress[ev.teacherId], state: 'grading', text: '' }
        } else if (ev.type === 'teacher:delta') {
          teacherProgress[ev.teacherId] = { ...teacherProgress[ev.teacherId], state: 'grading', text: ev.text }
        } else if (ev.type === 'teacher:done') {
          const p = ev.result
          teacherProgress[ev.teacherId] = {
            state: 'done',
            text: ev.raw,
            score: p?.score ?? '—',
            max: p?.maxScore ?? '—',
          }
        } else if (ev.type === 'stage:delta') {
          stageText2.value = ev.text
        }
      },
    })

    report.value = result
    step.value = 'result'

    // 归档：本地必写，后端能连上就同时落 docs/practice/
    const rec = buildRecord({ form, report: result, elapsedMs: result.elapsed })
    record.value = rec
    archiveState.value = (await archiveRecord(rec)) ? 'docs' : 'local'
    doneToday.value = true
  } catch (e) {
    if (e.name !== 'AbortError') {
      error.value = e.message
      step.value = 'result'
    } else {
      step.value = 'answer'
    }
  } finally {
    clearInterval(timer)
  }
}

function abort() {
  controller?.abort()
  clearInterval(timer)
}

function askFollowup() {
  const q = window.prompt('追问老师（例如：我的第二点为什么算偏题？该怎么改？）')
  if (!q?.trim()) return
  const grading = JSON.stringify({ final: report.value.final, teacherResults: report.value.results }, null, 2)
  followupText.value = ''
  chat({
    messages: buildFollowupMessages({ answer: form.answer, grading, question: q }),
    stream: true,
    onDelta: (_d, full) => {
      followupText.value = full
    },
  }).catch((e) => toast.error(e.message))
}

async function genSample() {
  sampling.value = true
  sampleText.value = ''
  try {
    await chat({
      messages: buildSampleMessages({ ...form }),
      stream: true,
      onDelta: (_d, full) => {
        sampleText.value = full
      },
    })
  } catch (e) {
    toast.error(e.message)
  } finally {
    sampling.value = false
  }
}

onMounted(async () => {
  // 服务端托管 Key 的情况（桌面版/部署版）也要算「已配置」
  probeReadiness()

  // 用户自建的题目也进池子，每日一练与选题面板一并覆盖。
  // kind **只在没有时**补「自建」：导入的题库包带 kind:'私有'，不能用默认值盖掉，
  // 否则练习页会把私有真题标成自建（真的踩过）。
  mine.value = (await getAll(STORES.questions)).map((q) => ({ kind: '自建', ...q }))

  todayQ.value = pickDaily(pool.value)
  const recs = await listAllRecords()
  doneToday.value = practicedToday(recs)

  // 从题库页跳过来：优先按 id 回池子里取完整题目，取不到再用 query 字段兜底
  let q = null
  if (route.query.questionId) {
    q = pool.value.find((x) => x.id === route.query.questionId) || null
  }
  if (!q && route.query.material) {
    q = {
      id: '',
      title: route.query.title || '',
      material: route.query.material || '',
      requirement: route.query.requirement || '',
      maxScore: Number(route.query.maxScore) || 40,
      wordLimit: Number(route.query.wordLimit) || null,
      type: route.query.type || '',
      exam: route.query.exam || '',
    }
  }
  // 都没有就默认用今日一练 —— 进页面就有题有材料，不再是空白表单
  applyQuestion(q || todayQ.value, { resetAnswer: false })
})

onUnmounted(() => {
  clearInterval(timer)
  controller?.abort()
})
</script>
