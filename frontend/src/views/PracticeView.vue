<template>
  <div :class="step === 'answer' ? 'max-w-3xl' : 'w-full'">

    <!-- ==================== 页头 ==================== -->
    <div class="flex items-end justify-between gap-4 mb-8">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">
          {{ step === 'answer' ? '练习批改' : step === 'grading' ? '批改中' : '批改结果' }}
        </h1>
        <p class="text-sm text-gray-500 mt-1.5">
          {{ step === 'answer'
            ? '先把题答完，再交给老师批改'
            : step === 'grading'
              ? '老师正在各自独立阅卷，请稍候'
              : `${fmtDateTime(record?.createdAt)} · ${MODE_LABEL[report?.mode] || ''}` }}
        </p>
      </div>
      <button v-if="step === 'result'" @click="backToAnswer"
        class="shrink-0 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 neu-sm
          hover:text-[#6d5dfc] transition-colors duration-200">
        修改作答
      </button>
      <button v-else-if="step === 'answer'" @click="resetAll"
        class="shrink-0 px-4 py-2 rounded-xl text-xs font-medium text-gray-500 neu-sm
          hover:text-[#6d5dfc] transition-colors duration-200">
        清空
      </button>
    </div>

    <div v-if="!hasKey" class="rounded-2xl p-5 mb-8 neu-sm border-l-4 border-[#6d5dfc]">
      <div class="text-sm text-gray-700">
        还没配置 API Key，批改功能用不了。
        <RouterLink to="/settings" class="text-[#6d5dfc] font-medium hover:underline">去设置 →</RouterLink>
      </div>
    </div>

    <!-- ==================== 第一步：答题 ==================== -->
    <template v-if="step === 'answer'">

      <!-- 阅卷老师：紧凑一行，不再铺五张大卡 -->
      <section class="rounded-2xl p-5 neu mb-6">
        <div class="flex items-center justify-between gap-3 mb-3.5">
          <span class="text-sm font-medium text-gray-700">谁来批改</span>
          <span class="text-xs text-gray-500">
            {{ MODE_LABEL[mode] }}
            <span v-if="selected.length" class="text-[#6d5dfc]">· {{ selected.length }} 位</span>
          </span>
        </div>

        <div class="flex flex-wrap gap-2">
          <button v-for="t in TEACHER_LIST" :key="t.id" @click="toggle(t.id)"
            class="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-xs transition-all duration-200"
            :class="selected.includes(t.id) ? 'neu-inset' : 'neu-sm hover:opacity-90'"
            :title="`${t.name}｜${t.title}\n侧重：${t.focus}\n${t.desc}`">
            <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
              :style="selected.includes(t.id)
                ? { background: t.color, color: '#fff' }
                : { background: t.color + '1f', color: t.color }">
              {{ t.avatar }}
            </span>
            <span :style="{ color: selected.includes(t.id) ? t.color : '#6b7280' }"
              :class="selected.includes(t.id) ? 'font-medium' : ''">{{ t.name }}</span>
          </button>
        </div>

        <div class="pt-3.5 mt-4 border-t border-gray-200">
          <div class="flex flex-wrap gap-1.5">
            <button v-for="p in PRESETS" :key="p.key" @click="selected = [...p.ids]"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200"
              :class="samePreset(p.ids)
                ? 'neu-inset text-[#6d5dfc] font-medium'
                : 'text-gray-500 hover:text-[#6d5dfc]'"
              :title="p.hint">
              {{ p.label }}
            </button>
          </div>
        </div>

        <div class="pt-3 mt-3 border-t border-gray-200 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-xs text-gray-700">深度模式</div>
            <div class="text-xs text-gray-400 mt-0.5 leading-5">
              注入老师方法论全文，判断更贴原始标准；代价是更慢更贵。日常练习建议关闭。
            </div>
          </div>
          <button @click="deep = !deep"
            class="shrink-0 px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
            :class="deep ? 'neu-inset text-[#6d5dfc] font-medium' : 'neu-sm text-gray-600'">
            {{ deep ? '已开启' : '未开启' }}
          </button>
        </div>
      </section>

      <!-- 题目 + 给定资料：并排，仿考场卷面 -->
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">

        <!-- 左：给定资料（答题时占主位） -->
        <section class="lg:col-span-3 rounded-2xl p-5 neu flex flex-col min-h-[16rem]">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-gray-700">给定资料</span>
            <button @click="showMaterial = !showMaterial"
              class="text-xs text-gray-500 hover:text-[#6d5dfc] transition-colors">
              {{ showMaterial ? '收起' : '展开' }}
            </button>
          </div>
          <textarea v-if="showMaterial" v-model="form.material" rows="16"
            placeholder="把材料原样粘进来（材料 1、材料 2……）"
            class="w-full flex-1 px-3.5 py-2.5 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none resize-none
              text-gray-700 placeholder:text-gray-400 leading-7" />
          <div v-else class="text-xs text-gray-400 py-1">
            {{ form.material ? `已填写 ${countChars(form.material)} 字（点击展开查看/编辑）` : '未填写（点击展开填写）' }}
          </div>
        </section>

        <!-- 右：题目要求 -->
        <section class="lg:col-span-2 rounded-2xl p-5 neu">
          <div class="text-sm font-medium text-gray-700 mb-4">题目</div>

          <label class="block text-xs text-gray-500 mb-1.5">题干</label>
          <input v-model="form.title" type="text"
            placeholder="例：结合给定资料，围绕「养老刚需也是产业蓝海」自拟题目，写一篇文章"
            class="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none
              text-gray-700 placeholder:text-gray-400" />

          <label class="block text-xs text-gray-500 mt-4 mb-1.5">作答要求</label>
          <textarea v-model="form.requirement" rows="4"
            placeholder="例：观点明确，结构完整，语言流畅，1000 字左右"
            class="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none resize-none
              text-gray-700 placeholder:text-gray-400 leading-6" />

          <div class="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label class="block text-xs text-gray-500 mb-1.5">满分</label>
              <input v-model.number="form.maxScore" type="number" min="1"
                class="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none text-gray-700 tnum" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1.5">字数要求</label>
              <input v-model.number="form.wordLimit" type="number" placeholder="不限"
                class="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none
                  text-gray-700 placeholder:text-gray-400 tnum" />
            </div>
          </div>
        </section>
      </div>

      <!-- 我的作答：方格纸，仿考场卷面 -->
      <section class="rounded-2xl p-5 neu mb-6">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-gray-700">我的作答</span>
          <span v-if="overLimit" class="text-xs tnum text-[#a32d2d]">
            超出 {{ countChars(form.answer) - form.wordLimit }} 字
          </span>
        </div>
        <GridPaper v-model="form.answer" :word-limit="form.wordLimit || 0" />
      </section>

      <!-- 提交：常驻底部，长作答不用滚回去找按钮 -->
      <div class="sticky bottom-4 z-10">
        <div class="rounded-2xl p-3 neu backdrop-blur">
          <div class="flex items-center gap-3">
            <button @click="start" :disabled="!canGrade"
              class="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300
                disabled:opacity-40 disabled:cursor-not-allowed neu-sm"
              :class="canGrade ? 'text-[#6d5dfc] hover:shadow-[inset_3px_3px_6px_#b8bcc2,inset_-3px_-3px_6px_#ffffff]' : 'text-gray-400'">
              答完了，开始批改（{{ selected.length }} 位老师）
            </button>
          </div>
          <div v-if="!canGrade" class="text-xs text-gray-400 text-center mt-2">
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
            <span class="w-2 h-2 rounded-full bg-[#6d5dfc] animate-pulse" />
            <span class="text-sm font-medium text-gray-700">{{ stageText }}</span>
          </div>
          <span class="text-xs text-gray-400 tnum">{{ elapsed }}s</span>
        </div>

        <div class="space-y-3">
          <div v-for="t in runningTeachers" :key="t.id" class="rounded-xl p-3.5 neu-inset">
            <div class="flex items-center gap-2.5">
              <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                :style="{ background: t.state === 'waiting' ? '#d0d4da' : t.color + '22', color: t.state === 'waiting' ? '#9ca3af' : t.color }">
                {{ t.avatar }}
              </span>
              <span class="text-xs font-medium text-gray-700">{{ t.name }}</span>
              <span class="text-xs text-gray-400 hidden sm:inline">{{ t.title }}</span>
              <span class="ml-auto text-xs"
                :class="t.state === 'done' ? 'text-[#0f6e56]' : t.state === 'grading' ? t.color : 'text-gray-400'">
                {{ t.state === 'done' ? `${t.score} / ${t.max}` : t.state === 'grading' ? '批改中…' : '排队中' }}
              </span>
            </div>
            <div v-if="t.text" class="text-xs text-gray-400 mt-2 line-clamp-2 leading-5">
              {{ t.text.slice(-120) }}
            </div>
          </div>
        </div>

        <div v-if="stage === 'debate' || stage === 'fusion'"
          class="rounded-xl p-4 mt-4 neu-inset border-l-2 border-[#6d5dfc]">
          <div class="flex items-center gap-2 mb-2">
            <span class="w-1.5 h-1.5 rounded-full bg-[#6d5dfc] animate-pulse" />
            <span class="text-xs font-medium text-[#6d5dfc]">
              {{ stage === 'debate' ? '圆桌辩论：复核争议点' : '圆桌合议：融合观点结论' }}
            </span>
          </div>
          <pre v-if="stageText2" class="text-xs text-gray-500 whitespace-pre-wrap leading-5 max-h-40 overflow-y-auto"
            style="font-family: inherit">{{ stageText2 }}</pre>
        </div>

        <div class="mt-5 text-center">
          <button @click="abort"
            class="px-5 py-2 rounded-xl text-xs font-medium neu-sm text-gray-500 hover:text-[#a32d2d] transition-colors">
            停止批改
          </button>
        </div>
      </section>
    </template>

    <!-- ==================== 第三步：结果 ==================== -->
    <template v-else-if="report">
      <div v-if="error" class="rounded-2xl p-4 mb-6 text-sm text-[#a32d2d] leading-6 whitespace-pre-wrap"
        style="background: #fcebeb">{{ error }}</div>

      <!-- 分数 -->
      <section class="rounded-2xl p-6 neu mb-6">
        <div class="flex items-center gap-6">
          <ScoreRing :score="report.final.finalScore" :max="report.final.maxScore || form.maxScore" />
          <div class="min-w-0 flex-1">
            <div class="text-base font-medium text-gray-800">{{ report.final.level }}</div>
            <div class="text-xs text-gray-500 mt-1.5 tnum">
              {{ report.final.finalScore }} / {{ report.final.maxScore || form.maxScore }} 分
              · 耗时 {{ (report.elapsed / 1000).toFixed(1) }}s
              · {{ countChars(form.answer) }} 字
            </div>
            <div class="text-xs text-gray-400 mt-2.5 leading-5">{{ report.final.roundtableNote }}</div>
            <div v-if="archiveState" class="text-xs mt-2"
              :class="archiveState === 'docs' ? 'text-[#0f6e56]' : 'text-gray-400'">
              {{ archiveState === 'docs'
                ? '本页已归档到 docs/practice/（含 md 与 json）'
                : '已存到本机浏览器（后端未连接，未写入 docs）' }}
            </div>
          </div>
        </div>
      </section>

      <!-- 老师色标批注：这一屏的主角 -->
      <section class="rounded-2xl p-6 neu mb-6">
        <div class="flex items-center justify-between mb-4">
          <span class="text-sm font-medium text-gray-700">我的作答 · 老师批注</span>
          <span class="text-xs text-gray-400">不同老师用不同颜色</span>
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
            <div class="text-sm font-medium text-gray-800">{{ teacherName(r.teacherId) }}</div>
            <div class="text-xs text-gray-400">{{ teacherTitle(r.teacherId) }}</div>
          </div>
          <div class="ml-auto text-right shrink-0">
            <div class="text-lg font-semibold tnum" :style="{ color: teacherColor(r.teacherId) }">
              {{ r.error ? '—' : r.score }}
              <span class="text-xs text-gray-400 font-normal">/ {{ r.maxScore }}</span>
            </div>
          </div>
        </div>

        <div v-if="r.error" class="text-xs text-[#a32d2d]">
          {{ r.error }}，原始输出：<pre class="mt-2 whitespace-pre-wrap text-gray-500">{{ r.rawText }}</pre>
        </div>

        <template v-else>
          <!-- 一段修改建议 -->
          <div v-if="r.advice" class="rounded-xl p-4 mb-4"
            :style="{ background: teacherColor(r.teacherId) + '0f' }">
            <div class="text-xs font-medium mb-1.5" :style="{ color: teacherColor(r.teacherId) }">修改建议</div>
            <div class="text-sm text-gray-700 leading-7">{{ r.advice }}</div>
          </div>

          <!-- 逐句批注 -->
          <div v-if="r.annotations?.length" class="mb-4">
            <div class="text-xs text-gray-500 mb-2">逐句批注（{{ r.annotations.length }}）</div>
            <div class="space-y-2">
              <div v-for="(a, j) in r.annotations" :key="j" class="rounded-xl p-3 neu-inset">
                <div class="flex items-start gap-2 flex-wrap">
                  <span class="text-xs px-1.5 py-0.5 rounded shrink-0"
                    :style="{ background: teacherColor(r.teacherId) + '1f', color: teacherColor(r.teacherId) }">
                    {{ a.type || '问题' }}
                  </span>
                  <span v-if="a.quote" class="text-xs text-gray-500 italic">「{{ truncate(a.quote, 28) }}」</span>
                </div>
                <div v-if="a.comment" class="text-xs text-gray-700 mt-2 leading-6">{{ a.comment }}</div>
                <div v-if="a.fix" class="text-xs mt-1 leading-6" style="color: #0f6e56">改：{{ a.fix }}</div>
              </div>
            </div>
          </div>

          <!-- 分项 -->
          <div v-if="r.dimensions?.length" class="mb-4">
            <div class="text-xs text-gray-500 mb-2">分项得分</div>
            <div class="space-y-2.5">
              <div v-for="d in r.dimensions" :key="d.name" class="text-xs">
                <div class="flex justify-between mb-1">
                  <span class="text-gray-700">{{ d.name }}</span>
                  <span class="text-gray-500 tnum">{{ d.score }}/{{ d.max }}</span>
                </div>
                <div class="h-1 rounded-full neu-inset overflow-hidden">
                  <div class="h-full rounded-full transition-all duration-700"
                    :style="{ width: pct(d.score, d.max) + '%', background: teacherColor(r.teacherId) }" />
                </div>
                <div v-if="d.comment" class="text-gray-500 mt-1 leading-5">{{ d.comment }}</div>
              </div>
            </div>
          </div>

          <!-- 扣分点 -->
          <details v-if="r.deductions?.length" class="mb-3">
            <summary class="text-xs text-gray-500 cursor-pointer hover:text-[#6d5dfc]">
              扣分点（{{ r.deductions.length }}）
            </summary>
            <div class="space-y-2 mt-2">
              <div v-for="(d, j) in r.deductions" :key="j" class="text-xs leading-6">
                <span class="text-gray-700">{{ d.point }}</span>
                <span v-if="d.reason" class="text-gray-500"> —— {{ d.reason }}</span>
                <div v-if="d.fix" style="color: #0f6e56">改：{{ d.fix }}</div>
              </div>
            </div>
          </details>

          <!-- 亮点 -->
          <div v-if="r.highlights?.length" class="mb-3">
            <div class="text-xs text-gray-500 mb-1.5">亮点</div>
            <div v-for="(h, j) in r.highlights" :key="j" class="text-xs text-gray-600 leading-6">
              · <span class="text-gray-800">{{ h.point }}</span> — {{ h.why }}
            </div>
          </div>

          <!-- 升格方向 -->
          <div v-if="r.upgrade" class="text-xs leading-6" style="color: #993556">
            升格方向：{{ r.upgrade }}
          </div>

          <!-- 改写示例 -->
          <details v-if="r.rewrites?.length" class="mt-3 pt-3 border-t border-gray-200">
            <summary class="text-xs text-gray-500 cursor-pointer hover:text-[#6d5dfc]">
              改写示例（{{ r.rewrites.length }}）
            </summary>
            <div class="space-y-2.5 mt-2.5">
              <div v-for="(w, j) in r.rewrites" :key="j" class="text-xs leading-6">
                <div class="text-gray-400 line-through">{{ w.original }}</div>
                <div style="color: #0f6e56">{{ w.rewritten }}</div>
              </div>
            </div>
          </details>

          <!-- 总评 -->
          <div v-if="r.summary" class="text-xs text-gray-600 leading-6 mt-3 pt-3 border-t border-gray-200">
            {{ r.summary }}
          </div>
        </template>
      </section>

      <!-- 采分点核对 -->
      <section v-if="keyPoints.length" class="rounded-2xl p-5 neu mb-6">
        <div class="text-xs text-gray-500 mb-3">
          采分点核对
          <span class="text-gray-400">
            （命中 {{ keyPoints.filter(p => p.status === 'hit').length }} / {{ keyPoints.length }} 项）
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="(p, i) in keyPoints" :key="i"
            class="text-xs px-2 py-1 rounded-lg cursor-default"
            :title="p.note || p.point"
            :style="{
              background: p.status === 'hit' ? '#e1f5ee' : p.status === 'partial' ? '#faeeda' : '#fcebeb',
              color: p.status === 'hit' ? '#0f6e56' : p.status === 'partial' ? '#854f0b' : '#a32d2d',
            }">
            {{ p.status === 'hit' ? '✓' : p.status === 'partial' ? '~' : '✗' }}
            {{ truncate(p.point, 10) }}
          </span>
        </div>
      </section>

      <!-- 圆桌分歧 -->
      <section v-if="report.debate?.disputes?.length" class="rounded-2xl p-5 neu mb-6">
        <div class="text-xs text-gray-500 mb-3">圆桌分歧裁定</div>
        <div class="space-y-3">
          <div v-for="(d, i) in report.debate.disputes" :key="i" class="rounded-xl p-3.5 neu-inset">
            <div class="text-xs font-medium text-gray-700">{{ d.topic }}</div>
            <div v-for="(p, j) in d.positions || []" :key="j" class="text-xs text-gray-500 mt-1.5 leading-6">
              <span :style="{ color: teacherColor(p.teacher) }">{{ teacherName(p.teacher) }}</span>：{{ p.view }}
            </div>
            <div class="text-xs text-[#6d5dfc] mt-2 leading-6">裁定：{{ d.ruling }}</div>
            <div v-if="d.reason" class="text-xs text-gray-400 mt-1 leading-5">{{ d.reason }}</div>
          </div>
        </div>
      </section>

      <div v-if="report.dispute?.disputed && report.mode !== 'solo' && report.mode !== 'duo'"
        class="rounded-2xl p-4 mb-6 text-xs leading-6"
        style="background: #faeeda; color: #854f0b">
        {{ report.teachers.length }} 位老师评分差异 {{ report.dispute.spreadPct }}%
        （最高 {{ report.dispute.maxRate }}% / 最低 {{ report.dispute.minRate }}%），已触发圆桌复核辩论
      </div>

      <!-- 综合结论 -->
      <section class="rounded-2xl p-5 neu mb-6">
        <div class="text-xs text-gray-500 mb-3">综合结论</div>

        <div v-if="report.final.summary" class="text-sm text-gray-700 leading-7 whitespace-pre-wrap mb-5">
          {{ report.final.summary }}
        </div>

        <div v-if="report.final.criticalIssues?.length" class="mb-5">
          <div class="text-xs text-gray-500 mb-2">优先解决</div>
          <div class="space-y-2">
            <div v-for="(d, i) in report.final.criticalIssues" :key="i" class="rounded-xl p-3.5 neu-inset">
              <div class="flex justify-between items-start gap-2">
                <span class="text-xs font-medium text-gray-700">{{ d.issue }}</span>
                <span v-if="d.source" class="text-xs text-gray-400 shrink-0">{{ d.source }}</span>
              </div>
              <div v-if="d.fix" class="text-xs mt-1.5 leading-6" style="color: #0f6e56">改：{{ d.fix }}</div>
            </div>
          </div>
        </div>

        <details v-if="report.final.minorIssues?.length" class="mb-5">
          <summary class="text-xs text-gray-500 cursor-pointer hover:text-[#6d5dfc]">
            次要问题（{{ report.final.minorIssues.length }} 条）
          </summary>
          <div class="space-y-2 mt-2">
            <div v-for="(d, i) in report.final.minorIssues" :key="i" class="text-xs leading-6">
              <span class="text-gray-700">{{ d.issue }}</span>
              <span v-if="d.fix" class="text-gray-500"> —— {{ d.fix }}</span>
            </div>
          </div>
        </details>

        <div v-if="report.final.suggestions?.length">
          <div class="text-xs text-gray-500 mb-2.5">改进建议（按优先级）</div>
          <ul class="space-y-2">
            <li v-for="(s, i) in report.final.suggestions" :key="i" class="text-sm text-gray-700 flex gap-2 leading-6">
              <span class="text-[#6d5dfc] shrink-0 tnum">{{ i + 1 }}.</span><span>{{ s }}</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- 追问 / 示范答案 -->
      <section class="rounded-2xl p-5 neu mb-6">
        <div class="flex gap-3">
          <button @click="askFollowup"
            class="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-gray-600
              hover:text-[#6d5dfc] transition-colors">
            追问老师
          </button>
          <button @click="genSample" :disabled="sampling"
            class="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-gray-600
              hover:text-[#6d5dfc] transition-colors disabled:opacity-40">
            {{ sampling ? '生成中…' : '看示范答案' }}
          </button>
        </div>

        <div v-if="followupText || sampleText" class="mt-5 space-y-5">
          <div v-if="followupText">
            <div class="text-xs text-gray-500 mb-2">老师答疑</div>
            <div class="text-sm text-gray-700 leading-7 whitespace-pre-wrap">{{ followupText }}</div>
          </div>
          <div v-if="sampleText">
            <div class="text-xs text-gray-500 mb-2">示范答案</div>
            <div class="text-sm text-gray-700 leading-7 whitespace-pre-wrap">{{ sampleText }}</div>
          </div>
        </div>
      </section>

      <div class="flex justify-center gap-3 pb-4">
        <RouterLink to="/records"
          class="px-5 py-2.5 rounded-xl text-xs font-medium neu text-[#6d5dfc]">
          去复盘 →
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onUnmounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Message } from '@arco-design/web-vue'
import ScoreRing from '../components/ScoreRing.vue'
import AnnotatedAnswer from '../components/AnnotatedAnswer.vue'
import GridPaper from '../components/GridPaper.vue'
import { chat, hasApiKey } from '../api/llm'
import { buildFollowupMessages, buildSampleMessages } from '../prompts'
import { TEACHERS, TEACHER_LIST, MODE_LABEL, PRESETS, detectMode } from '../agents/teachers'
import { runGrading } from '../agents/orchestrator'
import { buildRecord, archiveRecord, countChars, fmtDateTime } from '../utils/record'

const route = useRoute()

// 三步：答题 → 批改中 → 结果。同一路由内切换，
// 好处是刷新页面不会把作答丢掉（表单还在这一个组件里）。
const step = ref('answer')

const form = reactive({
  title: route.query.title || '',
  requirement: '',
  material: route.query.material || '',
  answer: '',
  maxScore: 40,
  wordLimit: null,
})

const showMaterial = ref(false)
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

let controller = null
let timer = null

const hasKey = computed(() => hasApiKey())
const mode = computed(() => detectMode(selected.value))
const overLimit = computed(() => form.wordLimit && countChars(form.answer) > form.wordLimit)
const canGrade = computed(
  () => hasKey.value && selected.value.length > 0 && form.answer.trim().length > 20
)
const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0)
const truncate = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : s)

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
  return (report.value?.results || []).flatMap((r) => r.keyPoints || [])
})

function teacherName(id) {
  return TEACHERS[id]?.name || id
}
function teacherTitle(id) {
  return TEACHERS[id]?.title || ''
}
function teacherColor(id) {
  return TEACHERS[id]?.color || '#6d5dfc'
}
function teacherAvatar(id) {
  return TEACHERS[id]?.avatar || '?'
}

function toggle(id) {
  const i = selected.value.indexOf(id)
  selected.value = i === -1 ? [...selected.value, id] : selected.value.filter((x) => x !== id)
}

function samePreset(ids) {
  return ids.length === selected.value.length && ids.every((i) => selected.value.includes(i))
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
  form.title = ''
  form.requirement = ''
  form.material = ''
  form.answer = ''
}

function backToAnswer() {
  step.value = 'answer'
}

async function start() {
  if (!canGrade.value) {
    if (!selected.value.length) Message.warning('请至少选择一位阅卷老师')
    else if (!hasKey.value) Message.warning('请先到设置页配置 API Key')
    else Message.warning('请先填写作答内容（至少 20 字）')
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
      paper: { ...form },
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
  }).catch((e) => Message.error(e.message))
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
    Message.error(e.message)
  } finally {
    sampling.value = false
  }
}

onUnmounted(() => {
  clearInterval(timer)
  controller?.abort()
})
</script>
