<template>
  <div :class="step === 'answer' ? 'w-full max-w-5xl' : 'w-full'">

    <!-- ==================== 页头 ==================== -->
    <!-- 答题态用更紧的下边距：整页要在一屏里放下（材料独滚），省出来的都是作答空间 -->
    <div class="flex items-end justify-between gap-4"
      :class="step === 'answer' ? 'mb-4' : 'mb-8'">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold text-c-ink">
          {{ step === 'answer' ? modeTitle : step === 'grading' ? '批改中' : '批改结果' }}
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

      <!-- 答题壳：宽屏下一屏放下（材料独滚、题目与作答固定），不再整页滚动。
           高度 = 视口 - 顶栏 padding - 页头；内部 grid flex-1 吃掉剩余空间。 -->
      <div class="lg:flex lg:flex-col lg:h-[calc(100vh-172px)] lg:min-h-[600px]">

      <!-- 模式说明不再单独占一条卡：模式名在页头标题里已经有了，这里的字全是重复 -->

      <!-- 考场倒计时条：落笔（首次输入）即开始 -->
      <div v-if="isExamMode"
        class="rounded-2xl px-5 py-3 mb-4 neu shrink-0 flex items-center justify-between"
        :style="examUrgent ? 'background:#fdecea' : ''">
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium" :style="examUrgent ? 'color:#b91c1c' : 'color:#1f2430'">
            {{ examRunning ? '剩余时间' : '待开始' }}
          </span>
          <span class="tnum text-2xl font-semibold" :style="examUrgent ? 'color:#b91c1c' : 'color:#1f2430'">
            {{ examClock }}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-xs text-c-muted">
            {{ examRunning
              ? (examUrgent ? '最后 5 分钟，抓紧组织答案' : '作答中——交卷前可以继续修改')
              : '开始输入后自动计时' }}
          </div>
          <label class="text-xs text-c-muted flex items-center gap-1.5">
            时长
            <select v-model.number="examMinutes" @change="resetExamTimer" :disabled="examRunning"
              class="px-2 py-1 rounded-lg text-xs neu-inset outline-none text-c-body disabled:opacity-50">
              <option v-for="m in [15, 20, 30, 40, 60, 90, 120]" :key="m" :value="m">{{ m }} 分钟</option>
            </select>
          </label>
        </div>
      </div>

      <!-- 给定资料 + 题目：并排，仿考场卷面 -->
      <!-- 上排 flex-1：材料在面板内滚、题目作答位置固定不动（答题只滚材料，不滚页面）；
           高度吃掉视口剩余空间——空地铺满，而不是留一截白 -->
      <!-- ⚠️ lg:grid-rows-[minmax(0,1fr)] 不是装饰：grid 行轨道默认 auto，会被长材料
           撑高（容器设了 height 也拦不住，轨道溢出容器），材料直接画出面板、
           叠到下方作答区上，sticky 提交条悬在材料中间 —— 内滚链条在这一环断掉。 -->
      <div class="grid grid-cols-1 lg:grid-cols-7 lg:grid-rows-[minmax(0,1fr)] gap-4 lg:gap-x-6 lg:mb-4 mb-4 lg:flex-1 lg:min-h-[380px]">

        <!-- 左：给定资料（材料才是大头，占 5/7） -->
        <section class="lg:col-span-5 rounded-2xl p-5 neu flex flex-col lg:min-h-0">
          <div class="flex items-center justify-between gap-3 mb-3">
            <span class="text-sm font-medium text-c-body">
              给定资料
              <span v-if="form.material" class="text-xs text-c-muted font-normal tnum ml-1">
                {{ countChars(form.material) }} 字
              </span>
            </span>
            <div class="flex items-center gap-3 shrink-0">
              <button @click="openPicker"
                class="text-xs text-c-muted hover:text-c-bark transition-colors">
                换一题
              </button>
              <button v-if="form.material" @click="materialEdit = !materialEdit"
                class="text-xs text-c-muted hover:text-c-bark transition-colors">
                {{ materialEdit ? '完成编辑' : '编辑' }}
              </button>
            </div>
          </div>

          <!-- 有材料：阅读态（默认）/ 编辑态。
               ⚠️ 这层必须是 flex flex-col：里面的滚动容器靠 flex-1 min-h-0 拿高度，
               父级不是 flex 的话 flex-1 无效 → 容器高度=内容高度，长材料直接
               溢出面板、叠到下方作答区上（宽屏 lg 下 max-h 兜底也被关掉，必现）。 -->
          <div v-if="form.material" class="flex-1 min-h-0 flex flex-col">
            <!-- 说明条要跟**当前用的是哪一份**走：
                 说"已省去 N 则"却在显示整卷，会让人看不懂到底用了什么（真踩过）。 -->
            <div v-if="trimState.trimmed"
              class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-3 text-xs leading-5">
              <template v-if="trimState.active">
                <span class="font-medium text-c-bark">本题用给定资料{{ trimState.used.join('、') }}</span>
                <span class="text-c-muted tnum">
                  整卷共 {{ trimState.dropped + trimState.used.length }} 则，已省去其余 {{ trimState.dropped }} 则（材料 {{ trimState.before }} → {{ trimState.after }} 字，省 {{ trimState.savedPct }}%）
                </span>
                <button @click="toggleTrim"
                  class="underline underline-offset-2 text-c-muted hover:text-c-bark transition-colors">
                  查看整卷材料
                </button>
              </template>
              <template v-else>
                <span class="font-medium text-c-bark">当前用的是整卷材料</span>
                <span class="text-c-muted tnum">
                  本题只问资料{{ trimState.used.join('、') }}；切成本题材料可省 {{ trimState.savedPct }}%（{{ trimState.before }} → {{ trimState.after }} 字）
                </span>
                <button @click="toggleTrim"
                  class="underline underline-offset-2 text-c-muted hover:text-c-bark transition-colors">
                  只用本题材料
                </button>
              </template>
            </div>
            <textarea v-if="materialEdit" v-model="form.material" rows="14"
              placeholder="把材料原样粘进来（材料 1、材料 2……）"
              class="w-full h-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
                text-c-body placeholder:text-c-muted leading-7" />
            <div v-else class="flex-1 min-h-0 overflow-y-auto pr-1 max-h-[32rem] lg:max-h-none">
              <Highlightable :blocks="materialBlocks(form.material)" :marks="marks.material"
                @change="(l) => onMarksChange('material', l)" class="space-y-3.5" />
            </div>
          </div>

          <!-- 空态：直接给选题入口，别留一片白 -->
          <div v-else class="flex-1 flex flex-col items-center justify-center py-10 text-center">
            <div class="text-sm text-c-body mb-1.5">还没有题目</div>
            <div class="text-xs text-c-muted leading-6 mb-4 max-w-xs">
              从题库挑一道开始，或直接粘贴你自己的材料
            </div>
            <div class="flex gap-2">
              <button @click="openPicker"
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

        <!-- 右：题目要求（压缩占地；定高下内容多就面板内滚） -->
        <section class="lg:col-span-2 rounded-2xl p-4 neu lg:overflow-y-auto lg:min-h-0">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-c-body">题目</span>
            <div class="flex items-center gap-1.5">
              <!-- 来源标签：导入的私有真题必须能一眼认出来（"这卷别外传"的前提是看得见） -->
              <span v-if="loadedMeta.kind" class="text-xs px-1.5 py-0.5 rounded font-medium"
                :style="kindBadgeStyle">{{ loadedMeta.kind }}</span>
              <span v-if="loadedMeta.type" class="text-xs px-1.5 py-0.5 rounded"
                style="background: #e8ecdf; color: #3d5a7a">{{ loadedMeta.type }}</span>
            </div>
          </div>

          <label class="block text-[11px] text-c-muted mb-1">题干</label>
          <textarea v-model="form.title" rows="2"
            placeholder="例：结合给定资料，围绕「养老刚需也是产业蓝海」自拟题目，写一篇文章"
            class="w-full px-3 py-2 rounded-xl text-xs neu-inset outline-none resize-none
              text-c-body placeholder:text-c-muted leading-6" />

          <label class="block text-[11px] text-c-muted mt-3 mb-1">作答要求</label>
          <textarea v-model="form.requirement" rows="3"
            placeholder="例：观点明确，结构完整，语言流畅，1000 字左右"
            class="w-full px-3 py-2 rounded-xl text-xs neu-inset outline-none resize-none
              text-c-body placeholder:text-c-muted leading-6" />

          <div class="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label class="block text-[11px] text-c-muted mb-1">满分</label>
              <input v-model.number="form.maxScore" type="number" min="1"
                class="w-full px-3 py-2 rounded-xl text-xs neu-inset outline-none text-c-body tnum" />
            </div>
            <div>
              <label class="block text-[11px] text-c-muted mb-1">字数要求</label>
              <input v-model.number="form.wordLimit" type="number" placeholder="不限"
                class="w-full px-3 py-2 rounded-xl text-xs neu-inset outline-none
                  text-c-body placeholder:text-c-muted tnum" />
            </div>
          </div>

          <!-- 提纲：默认收起不占地方；按题目存本机，批改不看它 -->
          <details class="mt-3 group">
            <summary class="flex items-center cursor-pointer list-none select-none
              text-xs text-c-muted hover:text-c-bark transition-colors">
              <span class="transition-transform duration-200 group-open:rotate-90 inline-block mr-1">▸</span>
              <span class="font-medium">提纲</span>
              <span class="text-c-muted/70 ml-2">先列提纲再动笔</span>
              <span v-if="outline.trim()" class="tnum ml-auto">{{ outline.length }} 字</span>
              <span v-else class="ml-auto">展开</span>
            </summary>
            <textarea v-model="outline" rows="4"
              placeholder="立论一句 → 分论点（附材料依据）→ 结尾收束。提纲只存在本机，批改不看它。"
              class="w-full mt-2 px-3 py-2 rounded-xl text-xs neu-inset outline-none resize-none
                text-c-body placeholder:text-c-muted leading-6" />
          </details>

          <div v-if="loadedMeta.topics?.length" class="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-c-line">
            <span v-for="t in loadedMeta.topics" :key="t"
              class="text-xs px-1.5 py-0.5 rounded" style="background: #f5f1ea; color: #78716c">
              {{ t }}
            </span>
          </div>
        </section>
      </div>

      <!-- 我的作答：方格纸，仿考场卷面；标注态可划荧光（编辑/标注两态切换，输入体验不动）。
           lg 下定高、内部滚动 —— 页面本身不动，答题全程只有材料面板在滚 -->
      <section class="rounded-2xl p-5 neu mb-4 shrink-0 lg:h-[268px] lg:flex lg:flex-col">
        <div class="flex items-center justify-between mb-3 shrink-0">
          <span class="text-sm font-medium text-c-body">我的作答</span>
          <div class="flex items-center gap-3">
            <span v-if="markCount" class="text-xs text-c-muted tnum">已标 {{ markCount }} 处</span>
            <span v-if="overLimit" class="text-xs tnum text-[#b4552d]">
              超出 {{ countChars(form.answer) - form.wordLimit }} 字
            </span>
          </div>
        </div>
        <div class="mx-auto w-full max-w-[760px] lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          <div v-if="!answerMarkMode" class="mb-1.5 flex justify-end">
            <button @click="answerMarkMode = form.answer.trim() ? true : answerMarkMode"
              :disabled="!form.answer.trim()" :title="form.answer.trim() ? '用荧光笔圈出关键词、关键句（不影响作答）' : '先写点内容再标注'"
              class="text-xs text-c-muted hover:text-c-bark underline underline-offset-2 transition-colors disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
              🖍️ 荧光标注
            </button>
          </div>
          <GridPaper v-if="!answerMarkMode" v-model="form.answer" :word-limit="form.wordLimit || 0" />
          <div v-else>
            <div class="mb-1.5 flex items-center justify-between text-xs text-c-muted">
              <span>选中文字后选颜色划荧光；标记存在本机，下次打开还在，批改不受影响</span>
              <button @click="answerMarkMode = false"
                class="underline underline-offset-2 text-c-muted hover:text-c-bark transition-colors shrink-0 ml-3">
                返回编辑
              </button>
            </div>
            <Highlightable :blocks="[{ body: form.answer }]" :marks="marks.answer"
              @change="(l) => onMarksChange('answer', l)"
              class="rounded-xl neu-inset px-3.5 py-2.5 max-h-[32rem] overflow-y-auto" />
          </div>
        </div>
      </section>

      <!-- 提交：常驻底部，长作答不用滚回去找按钮 -->
      <div class="sticky bottom-0 z-10 shrink-0 pb-1">
        <div class="rounded-2xl p-3 neu backdrop-blur">
          <div class="flex items-center gap-3">
            <!-- 考场模式：交卷两段确认（防误触）；超时自动交卷不走这里 -->
            <button v-if="isExamMode && confirmSubmit" @click="startExam"
              class="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300
                text-white" style="background:#b91c1c">
              确认交卷？计时将停止，交给 {{ selected.length }} 位老师批改
            </button>
            <button v-else-if="isExamMode" @click="startExam" :disabled="!canGrade"
              class="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300
                disabled:opacity-40 disabled:cursor-not-allowed neu-sm"
              :class="canGrade ? 'text-c-bark hover:translate-y-px' : 'text-c-muted'">
              交卷（{{ examClock }}）
            </button>
            <button v-else @click="start" :disabled="!canGrade"
              class="flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300
                disabled:opacity-40 disabled:cursor-not-allowed neu-sm"
              :class="canGrade ? 'text-c-bark hover:translate-y-px' : 'text-c-muted'">
              答完了，开始批改{{ selected.length ? `（${selected.length} 位老师）` : '' }}
            </button>
          </div>
          <div v-if="!canGrade" class="text-xs text-c-muted text-center mt-2">
            {{ !hasKey ? '先到设置页配置 API' : '作答至少 20 字才能提交' }}
          </div>
        </div>
      </div>

      </div><!-- /答题壳（lg 一屏固定） -->

      <!-- 选题弹窗：进入/切换模式即弹出，按题型分类选题。
           分类从题池现算（题型是自由文本，别写死枚举——自建题什么类型都可能有）；
           「今日一练」置顶第一个，跟原来的日常节奏接上。 -->
      <div v-if="showPickerModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30"
        @click.self="closePicker">
        <div class="w-full max-w-2xl rounded-2xl p-5 bg-c-paper shadow-[0_18px_50px_rgba(92,64,51,0.25)]
          flex flex-col max-h-[82vh]">
          <div class="flex items-center justify-between mb-3 shrink-0">
            <div class="min-w-0">
              <span class="text-sm font-medium text-c-body">选一道题开始作答</span>
              <!-- 模式说明跟着弹窗走：顶部卡删了，但三种形态的差异说明得有人讲 -->
              <span class="text-xs text-c-muted ml-2">
                {{ isExamMode
                  ? '落笔即计时，时间到自动交卷 —— 按真实考场练节奏'
                  : isRealMode
                    ? '按原卷给全材料，练「在整卷里找资料」—— 材料更全，批改成本也更高'
                    : '随时批改、随时看参考答案，适合日常消化' }}
              </span>
            </div>
            <button @click="closePicker" class="text-c-muted hover:text-c-bark text-xs leading-none shrink-0 ml-3">✕</button>
          </div>

          <!-- 分类条：全部 / 今日一练 / 动态题型 -->
          <div class="flex flex-wrap items-center gap-1.5 mb-3 shrink-0">
            <button @click="pickCat = '全部'"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200"
              :class="pickCat === '全部' ? 'bg-c-bark text-c-cream font-medium' : 'text-c-muted hover:text-c-bark neu-sm'">
              全部
            </button>
            <button @click="pickCat = '今日一练'" :disabled="!todayQ"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200 disabled:opacity-40"
              :class="pickCat === '今日一练' ? 'bg-c-bark text-c-cream font-medium' : 'text-c-muted hover:text-c-bark neu-sm'">
              今日一练
            </button>
            <span class="w-px h-4 bg-c-line mx-0.5" />
            <button v-for="c in pickCats" :key="c" @click="pickCat = c"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200"
              :class="pickCat === c ? 'bg-c-bark text-c-cream font-medium' : 'text-c-muted hover:text-c-bark neu-sm'">
              {{ c }}
            </button>
          </div>

          <input v-model="pickKeyword" type="text" placeholder="搜索题目 / 来源 / 主题"
            class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none mb-3 shrink-0
              text-c-body placeholder:text-c-muted" />

          <div class="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            <button v-for="q in pickList" :key="q.id" @click="applyQuestion(q)"
              class="w-full text-left rounded-xl p-3.5 neu-sm transition-all duration-200
                hover:translate-y-px">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="text-xs px-1.5 py-0.5 rounded shrink-0"
                  style="background: #e8ecdf; color: #3d5a7a">{{ q.type || '未分类' }}</span>
                <span class="text-xs text-c-muted truncate">{{ q.exam }}</span>
                <span v-if="q.kind" class="text-xs text-c-muted shrink-0">{{ q.kind }}</span>
                <span v-if="q.id === loadedId" class="text-xs text-c-bark shrink-0 ml-auto">当前</span>
              </div>
              <div class="text-xs text-c-body leading-6">{{ q.title }}</div>
            </button>
            <div v-if="!pickList.length" class="text-xs text-c-muted py-8 text-center">
              {{ pickCat === '今日一练' ? '今日一练还没就绪，稍等片刻' : '这个分类下没有匹配的题目' }}
            </div>
          </div>

          <div class="flex items-center justify-between mt-3 pt-3 border-t border-c-line shrink-0">
            <span class="text-xs text-c-muted">题库共 {{ pool.length }} 题 · 也可以先空白作答粘贴自己的材料</span>
            <div class="flex items-center gap-2 shrink-0">
              <!-- 考场入口从顶部卡挪到这里：想练节奏的人随时能跳过去 -->
              <RouterLink v-if="!isExamMode" to="/exam"
                class="text-xs px-3 py-1.5 rounded-lg neu-sm text-c-body transition-all duration-200 hover:translate-y-px">
                去考场模式练节奏 →
              </RouterLink>
              <button @click="startBlank(); closePicker()"
                class="px-3 py-1.5 rounded-lg text-xs neu-sm text-c-body hover:text-c-bark transition-colors">
                空白作答
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 选老师弹窗：批改时才选人，页面顶部不再给一张常驻卡——进页面直接是材料+作答的大工作区 -->
      <div v-if="showTeacherPicker" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30"
        @click.self="showTeacherPicker = false">
        <div class="w-full max-w-md rounded-2xl p-5 bg-c-paper shadow-[0_18px_50px_rgba(92,64,51,0.25)]">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-c-body">谁来批改这份作答</span>
            <button @click="showTeacherPicker = false" class="text-c-muted hover:text-c-bark text-xs leading-none">✕</button>
          </div>

          <div class="space-y-1.5 mb-3">
            <button v-for="t in TEACHER_LIST" :key="t.id" @click="toggle(t.id)"
              class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-200"
              :class="selected.includes(t.id) ? 'neu-inset' : 'hover:bg-c-barkSoft/50'"
              :title="`${t.name}｜${t.title}\n侧重：${t.focus}\n${t.desc}`">
              <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                :style="selected.includes(t.id)
                  ? { background: t.color, color: '#fffdfb' }
                  : { background: t.color + '1f', color: t.color }">{{ t.avatar }}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-medium leading-4"
                  :style="{ color: selected.includes(t.id) ? t.color : '#44403c' }">{{ t.name }}</span>
                <span class="block text-[11px] text-c-muted truncate leading-4">{{ t.focus }}</span>
              </span>
              <span v-if="selected.includes(t.id)" class="text-xs shrink-0 font-medium" :style="{ color: t.color }">✓</span>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 mb-4">
            <button v-for="p in PRESETS" :key="p.key" @click="selected = [...p.ids]"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200"
              :class="samePreset(p.ids) ? 'neu-inset text-c-bark font-medium' : 'text-c-muted hover:text-c-bark'"
              :title="p.hint">{{ p.label }}</button>
            <span class="w-px h-4 bg-c-line mx-1" />
            <button @click="deep = !deep"
              title="深度模式：注入老师方法论全文，判断更贴原始标准；代价是更慢更贵"
              class="px-2.5 py-1 rounded-lg text-xs transition-all duration-200"
              :class="deep ? 'neu-inset text-c-bark font-medium' : 'text-c-muted hover:text-c-bark'">
              深度模式{{ deep ? ' · 开' : '' }}
            </button>
          </div>

          <!-- 不 disabled：禁用了就点不出提示，用户只看到"点了没反应"。
               选不满也让点，点了明确告诉他为什么走不了。 -->
          <button @click="selected.length ? startGrade() : toast.warning('请至少选择一位阅卷老师')"
            class="w-full px-4 py-2.5 rounded-xl text-sm font-medium neu-sm text-c-bark
              hover:translate-y-px transition-all duration-300">
            开始批改{{ selected.length ? `（${selected.length} 位老师${deep ? ' · 深度' : ''}）` : '' }}
          </button>
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
              · 耗时 {{ (report.elapsed / 1000).toFixed(1) }}s<template v-if="answerSeconds > 0"> · 考试作答 {{ Math.round(answerSeconds / 60) }} 分钟</template>
              · {{ countChars(form.answer) }} 字
            </div>
            <div class="text-xs text-c-muted mt-2.5 leading-5">{{ report.final.roundtableNote }}</div>
            <!-- 批改依据（结果冻结）：这份分是用哪版标准、哪版提示词、哪个模型算的。
                 写出来是有意的——只给分数不给来路，用户没法判断该不该信。 -->
            <div v-if="provenanceText" class="text-xs text-c-muted mt-1.5 leading-5">
              批改依据：{{ provenanceText }}
            </div>
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
        <div v-if="report.standard.forbiddenCount" class="text-[11px] mb-3 leading-5" style="color: #b4552d">
          ⛔ 有 {{ report.standard.forbiddenCount }} 处答到了反向要点 —— 这不是"少写"，是方向理解错了，
          比漏点更该先纠正。
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
              <!-- 反向要点：答反了比漏写更需要注意，必须单独说清 -->
              <div v-if="p.forbidden" class="text-[11px] mt-0.5 leading-5" style="color: #b4552d">
                ⛔ 写到了反向要点「{{ (p.matchedForbidden || []).join('、') }}」——方向理解错了，本点不给分
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
        <AnnotatedAnswer :answer="form.answer" :results="report.results" :highlights="marks.answer" />
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
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { toast } from '../utils/toast'
import ScoreRing from '../components/ScoreRing.vue'
import AnnotatedAnswer from '../components/AnnotatedAnswer.vue'
import Highlightable from '../components/Highlightable.vue'
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
import { BUILTIN_POOL, resolveQuestion } from '../data/questions'
import { pickDaily, practicedToday } from '../data/daily'
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
  // 真题模式默认**不裁**：它的定位就是"按原卷给全材料"（要自己在整卷里找资料）。
  // 仍保留切换按钮 —— 用户想省成本时可以自己改成按题材料。
  trimState.active = isRealMode.value ? false : !!t.trimmed
  form.material = trimState.active ? t.text : fullMat
}

function resetTrim() {
  Object.assign(trimState, {
    trimmed: false, active: false, used: [], dropped: 0,
    before: 0, after: 0, savedPct: 0, text: '', full: '',
  })
}

/** 默认老师组合：袁东 / 周泰然 / 白鹭（三师圆桌） */
const DEFAULT_TEACHERS = ['yuandong', 'zhoutairan', 'bailu']
const selected = ref([...DEFAULT_TEACHERS])
const deep = ref(false)
// 选老师挪到批改时：点「开始批改」弹窗选人，不再占页面顶部一张卡——
// 进页面直接是材料 + 作答的大工作区。超时自动交卷不走弹窗（不能拦自动流程）。
const showTeacherPicker = ref(false)
const stage = ref('')
const stageText2 = ref('')
const elapsed = ref(0)
const report = ref(null)
const record = ref(null)
const archiveState = ref('')
const error = ref('')

/**
 * 结果页「批改依据」一行 —— 把冻结在结果里的 provenance 拼成人话。
 * 目的很直接：只给一个分数、不说它怎么来的，用户没法判断该不该信这个分。
 */
const provenanceText = computed(() => {
  const p = report.value?.provenance
  if (!p) return ''
  const srcLabel =
    { manual: '人工校准标准', llm: '模型预解析标准', none: '无标准（裸判）' }[p.standardSource] ||
    p.standardSource ||
    '无标准'
  const bits = [srcLabel]
  if (p.standardVersion) bits.push(`v${p.standardVersion}`)
  if (p.standardPoints) bits.push(`${p.standardPoints} 个采分点`)
  if (p.promptVersion) bits.push(`提示词 ${p.promptVersion}`)
  if (p.model) bits.push(`模型 ${p.model}`)
  if (p.deep) bits.push('深度模式')
  return bits.join(' · ')
})
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

// 今日一练在选题弹窗里作为第一个分类出现；材料按需载入，不再单独维护速览裁剪。

const loadedId = ref('')
const loadedMeta = reactive({ type: '', exam: '', difficulty: 0, kind: '', topics: [] })
const showPickerModal = ref(false)
const pickCat = ref('全部')
const materialEdit = ref(false)

// ── 荧光标注（材料 + 作答）───────────────────────────────────
// 存在 localStorage、按**题目**维度（不是按记录）：同一道题反复练，上次划的重点还在 ——
// 划标记是"读题时的动作"，不该跟着某一次提交走。
// ⚠️ 不写进批改记录，所以不涉及任何后端字段（也就不会踩 pydantic 静默丢字段的坑）。
const marks = reactive({ material: [], answer: [] })
const answerMarkMode = ref(false)   // 作答区：编辑态（textarea）/ 标注态（只读可划）

function marksKey(qid) {
  return `bp-marks:${qid || 'blank'}`
}
function loadMarks(qid) {
  try {
    const raw = JSON.parse(localStorage.getItem(marksKey(qid)) || '{}')
    marks.material = Array.isArray(raw.material) ? raw.material : []
    marks.answer = Array.isArray(raw.answer) ? raw.answer : []
  } catch {
    marks.material = []
    marks.answer = []
  }
}
function saveMarks(qid) {
  try {
    localStorage.setItem(marksKey(qid), JSON.stringify({ material: marks.material, answer: marks.answer }))
  } catch {
    /* 存不下就算了：标记是辅助功能，不该因为它让做题流程报错 */
  }
}
function onMarksChange(which, list) {
  marks[which] = list
  saveMarks(loadedId.value)
}
/** 划了多少处（供工具条显示；0 时不显示那一行，别占地方） */
const markCount = computed(() => (marks.material?.length || 0) + (marks.answer?.length || 0))
const pickKeyword = ref('')

// ── 提纲（先列提纲再动笔）──
// 与荧光标记同理：按题目存本机（bp-outline:<qid>），是"读题时的动作"，
// 不写进批改记录、不涉及后端字段。批改不看提纲——它是给考生自己理思路用的。
const outline = ref('')
function outlineKey(qid) {
  return `bp-outline:${qid || 'blank'}`
}
function loadOutline(qid) {
  try {
    outline.value = localStorage.getItem(outlineKey(qid)) || ''
  } catch {
    outline.value = ''
  }
}
watch(outline, () => {
  try {
    localStorage.setItem(outlineKey(loadedId.value), outline.value)
  } catch {
    /* 存不下就算了：提纲是辅助功能，不该因为它让做题流程报错 */
  }
})

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
// ⚠️ 这里**不能**再要求 selected.length > 0：老师只在「开始批改」的弹窗里选，
// 若按钮因"没选老师"而禁用，用户就再也点不开那个弹窗 —— 选人的入口被自己锁死。
// 老师的校验下沉到弹窗的确认按钮（选不满就点不动、点了也有明确提示）。
const canGrade = computed(() => hasKey.value && form.answer.trim().length > 20)

// ── 考场模式：倒计时 + 交卷确认 + 超时自动交卷 ──
// 设计取舍：落笔（首次输入）才计时，贴真实考场的「发卷后开始」；
// 训练模式一条代码路径都不动，两个模式互不干扰。
//
// 2026-09-24 起模式由**路由**决定，不再靠页内 chip 切换：
//   /practice → 练习批改（训练）    /exam → 考场模式（独立入口）
// 一个组件两种形态 —— 改一处逻辑两页同时生效，也不会出现"两份实现漂移"。
const isExamMode = computed(() => route.name === 'exam')
// 真题模式：按**原卷**给全材料，练"在整卷里找资料"——与训练模式的"按题裁剪"形成互补。
// 三种形态共用这一份作答与批改逻辑（路由名决定形态，不搞三份实现）。
const isRealMode = computed(() => route.name === 'real')
const modeTitle = computed(() =>
  isExamMode.value ? '考场模式' : isRealMode.value ? '真题模式' : '练习批改'
)
// 换页时重置计时与交卷确认：从考场页离开再回来，不该带着上一轮的倒计时
watch(
  () => route.name,
  () => {
    resetExamTimer()
    confirmSubmit.value = false
  }
)

const examMinutes = ref(30)
const examRemain = ref(30 * 60)
const examRunning = ref(false)
const confirmSubmit = ref(false)
let examTimer = null
let examDeadline = 0
const answerSeconds = ref(0)   // 考场模式作答用时（交卷时定格），结果页与记录展示

const examClock = computed(() => {
  const s = examRemain.value
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})
const examUrgent = computed(() => isExamMode.value && examRunning.value && examRemain.value <= 300)

/** 按题型给默认时长：大作文 60、贯彻执行 40、其余 30 */
function defaultMinutes() {
  if (form.questionType === '大作文') return 60
  if (form.questionType === '贯彻执行') return 40
  return 30
}

function resetExamTimer() {
  stopExamTimer()
  examMinutes.value = defaultMinutes()
  examRemain.value = examMinutes.value * 60
  examRunning.value = false
  confirmSubmit.value = false
}

function startExamTimer() {
  if (!isExamMode.value || examRunning.value) return
  examRunning.value = true
  examDeadline = Date.now() + examRemain.value * 1000
  examTimer = setInterval(() => {
    examRemain.value = Math.max(0, Math.round((examDeadline - Date.now()) / 1000))
    if (examRemain.value <= 0) {
      stopExamTimer()
      toast.warning('考试时间到，自动交卷')
      startGrade()   // 超时自动交卷（不经过二次确认，也不弹选老师——不能拦自动流程）
    }
  }, 500)
}

function stopExamTimer() {
  if (examTimer) {
    clearInterval(examTimer)
    examTimer = null
  }
}

/** 考场交卷（两段确认的第二段） */
async function startExam() {
  if (!confirmSubmit.value) {
    confirmSubmit.value = true
    return
  }
  confirmSubmit.value = false
  // 考场交卷**不弹选老师**：倒计时还在走/刚停，中途弹窗选人既打断节奏也不合考场语义。
  // 用开考前就定好的老师组合直接批改（超时自动交卷同此路径）。
  await startGrade()
}

// 落笔即计时：训练模式无感，考场模式首次输入触发
watch(
  () => form.answer,
  (v, ov) => {
    if (isExamMode.value && !examRunning.value && v && v.length > 0 && !ov) startExamTimer()
  }
)

// —— 选题弹窗：进入/切换模式即弹出 ——
function openPicker() {
  materialEdit.value = false
  showPickerModal.value = true
}
function closePicker() {
  showPickerModal.value = false
}

/** 分类条：题型从题池现算（题型是自由文本，自建题什么类型都可能有，别写死枚举） */
const pickCats = computed(() => {
  const seen = []
  for (const q of pool.value) {
    if (q.type && !seen.includes(q.type)) seen.push(q.type)
  }
  return seen
})

/** 选题列表：分类 + 关键词双重过滤，未加载的排前面 */
const pickList = computed(() => {
  const k = pickKeyword.value.trim().toLowerCase()
  let list = pool.value
  if (pickCat.value === '今日一练') {
    list = todayQ.value ? [todayQ.value] : []
  } else if (pickCat.value !== '全部') {
    list = list.filter((q) => q.type === pickCat.value)
  }
  if (k) {
    list = list.filter((q) =>
      (q.title || '').toLowerCase().includes(k) ||
      (q.exam || '').toLowerCase().includes(k) ||
      (q.type || '').toLowerCase().includes(k) ||
      (q.topics || []).some((t) => t.toLowerCase().includes(k)))
  }
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

  showPickerModal.value = false
  materialEdit.value = false
  answerMarkMode.value = false   // 换题回到编辑态
  loadMarks(loadedId.value)      // 这道题上次划的重点还在
  loadOutline(loadedId.value)    // 这道题上次的提纲还在
  resetExamTimer()   // 换题 = 换卷，考场计时重置
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

/** 空白作答：清掉题目，只留输入框，方便粘贴自己的材料 */
function startBlank() {
  resetExamTimer()
  form.title = ''
  form.material = ''
  resetTrim()
  form.requirement = ''
  form.maxScore = 40
  form.wordLimit = null
  form.questionType = ''
  form.answer = ''
  loadedId.value = ''
  marks.material = []            // 空白题没有可标注的对象
  marks.answer = []
  answerMarkMode.value = false
  loadOutline('')                // 空白题的提纲单独一格（bp-outline:blank）
  Object.assign(loadedMeta, { type: '', exam: '', difficulty: 0, kind: '', topics: [] })
  showPickerModal.value = false
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

/** 点「开始批改」：只做校验 + 弹选老师弹窗。真正的批改在弹窗确认后由 startGrade 发起 */
function start() {
  if (!hasKey.value) {
    toast.warning('请先到设置页配置 API Key')
    return
  }
  if (form.answer.trim().length <= 20) {
    toast.warning('请先填写作答内容（至少 20 字）')
    return
  }
  showTeacherPicker.value = true
}

async function startGrade() {
  showTeacherPicker.value = false

  // 兜底：任何发起批改的路径（弹窗确认 / 考场交卷 / 超时自动交卷）都不允许 0 位老师。
  // 真发生了要**让用户知道**是谁改的，不能静默换人 —— 静默换人等于结果页撒谎。
  if (!selected.value.length) {
    selected.value = [...DEFAULT_TEACHERS]
    toast.warning('未选择老师，已按默认三位（袁东 / 周泰然 / 白鹭）批改')
  }

  stopExamTimer()
  answerSeconds.value = isExamMode.value
    ? Math.max(0, examMinutes.value * 60 - examRemain.value)
    : 0
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
  // 都没有就默认用今日一练 —— 进页面就有题有材料，不再是空白表单。
  // ⚠️ 必须 await：applyQuestion 收尾会把弹窗状态复位，不 await 的话
  // 它会在 openPicker 之后才跑完，把刚弹出来的选题弹窗又关掉（竞态，真踩过）。
  await applyQuestion(q || todayQ.value, { resetAnswer: false })

  // 选模式 → 弹分类选题：这是进来的第一件事。带着 query（题库页跳转）来的不算，
  // 那条路径用户已经选好题了。
  if (!route.query.questionId && !route.query.material) openPicker()
})

// 三个模式入口复用同一组件实例（onMounted 不会重跑）：切换模式同样弹选题，
// 让"选模式"这个动作总有"选题"接着。批改中/看结果时不打断。
watch(() => route.path, (p, op) => {
  if (p !== op && step.value === 'answer') openPicker()
})

onUnmounted(() => {
  clearInterval(timer)
  stopExamTimer()
  controller?.abort()
})
</script>
