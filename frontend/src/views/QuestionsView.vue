<template>
  <div class="w-full">

    <!-- 拖拽提示层：整页接收，落点在哪都能接住，所以提示也铺满整页 -->
    <div v-if="dragging"
      class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      style="background: rgba(120, 96, 64, 0.14)">
      <div class="neu rounded-2xl px-8 py-6 text-center">
        <div class="text-base font-medium text-c-ink">松手即可导入题库包</div>
        <div class="text-xs text-c-muted mt-2">
          支持 .bpq（加密包会再问一次口令）
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-c-ink">题库</h1>
        <p class="text-sm text-c-muted mt-1.5">
          国考真题 {{ countBySource('真题') }} 道（{{ REAL_EXAMS.length }} 套）· 仿真 {{ SIM_QUESTIONS.length }} 道 · 自建 {{ ownCount }} 道
          <span class="text-c-muted">· 题型覆盖 {{ coveredTypes }} / 5</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="keyword" type="text" placeholder="搜索题目 / 来源 / 主题"
          class="px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none w-52
            text-c-body placeholder:text-c-muted" />
        <button @click="packInput?.click()" :disabled="importing"
          class="px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark disabled:opacity-40">
          {{ importing ? '导入中…' : '导入题库包' }}
        </button>
        <button @click="toggleLib" id="btn-my-lib"
          class="px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark">
          {{ showLib ? '收起' : '我的题库' }}
          <span v-if="imports.length" class="tnum opacity-60 ml-0.5">{{ imports.length }}</span>
        </button>
        <button @click="showImport = !showImport"
          class="px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark">
          {{ showImport ? '收起录入' : '+ 录入题目' }}
        </button>
        <!-- 一次只能选一个包：分开的包分别导入，避免一次误吞几个来源不明的文件 -->
        <input ref="packInput" type="file" accept=".bpq,application/json,.json"
          class="hidden" @change="onPackFile" />
      </div>
    </div>

    <!-- 导入过程逐条回显：把「格式 → 验签 → 水印 → 解密 → 入库」摆出来。
         加密包的价值（谁签发的、水印是谁）本来只在文档里，现在用户在导入这一刻就能看见。 -->
    <div v-if="importSteps.length" class="rounded-2xl p-5 neu mb-6">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-medium text-c-body">导入题库包</span>
        <button v-if="!importing" @click="importSteps = []"
          class="text-xs text-c-muted hover:text-c-bark">关闭</button>
      </div>
      <div class="space-y-1.5">
        <div v-for="(s, i) in importSteps" :key="i" class="flex items-start gap-2 text-xs leading-6">
          <span class="shrink-0 w-3.5 text-center" :style="{ color: stepColor(s.state) }">{{ stepIcon(s.state) }}</span>
          <span class="min-w-0">
            <span :style="s.state === 'fail' ? { color: '#b4552d' } : {}" :class="s.state === 'fail' ? '' : 'text-c-body'">{{ s.label }}</span>
            <span v-if="s.detail" class="text-c-muted"> · {{ s.detail }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 诚实说明：真题（公开 / 私有）与仿真分别标明，不混为一谈 -->
    <div class="rounded-2xl px-5 py-4 mb-6 text-xs leading-6"
      style="background: #f7eddc; color: #9c6b2f">
      <strong>真题（{{ REAL_EXAMS.length }} 套）</strong>为 2010–{{ PUBLIC_MAX_YEAR }} 年国考申论卷，
      材料与参考答案由 PDF 自动提取后过质量闸门（分题/字段/分值合计/字数/答案齐全），
      标注「真题」；<strong>仿真</strong>为按真题风格自编的材料，用于快速专项练。
      真题的「给定资料」是整卷共用的，练一题即载入该卷全部材料。
      <template v-if="privateExamCount">
        <br />另有 <strong>{{ privateExamCount }} 套私有真题</strong>（{{ PUBLIC_MAX_YEAR + 1 }} 年起国考卷及省考卷）已通过题库包导入，
        标为「私有」——这些卷不随软件分发，请勿对外转发。
      </template>
      <template v-else>
        <br />{{ PUBLIC_MAX_YEAR + 1 }} 年起的国考卷与省考卷为<strong>私有题库</strong>，不在软件本体里 ——
        向作者索取题库包后，把 <code>.bpq</code> 文件<strong>拖进本页任意位置</strong>，
        或用右上角「导入题库包」选文件，加入即可。
        <button @click="showGetPack = !showGetPack"
          class="ml-1 underline decoration-dotted hover:text-c-bark">
          {{ showGetPack ? '收起' : '怎么获取？' }}
        </button>
      </template>
    </div>

    <!-- 获取私有题库：作者联系方式 + 说明。默认收起，不打扰正常刷题 -->
    <div v-if="showGetPack && !privateExamCount"
      class="rounded-2xl p-5 neu-sm mb-6 text-xs leading-6 text-c-body">
      <div class="font-medium mb-2">获取私有题库包（{{ PUBLIC_MAX_YEAR + 1 }} 年起国考真题）</div>
      <p class="text-c-muted">
        这些卷是人工校准过的私有资产，不随开源版分发。联系作者获取 <code>.bpq</code> 题库包，
        把 <code>.bpq</code> 文件拖进本页任意位置（或用「导入题库包」选文件）即可入库 ——
        材料与参考答案都在包里，导入完就能直接练。加密包会再问一次口令。
      </p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
        <span>作者 <span class="text-c-ink font-medium">{{ AUTHOR.name }}</span></span>
        <a :href="`mailto:${AUTHOR.email}`" class="hover:text-c-bark">{{ AUTHOR.email }}</a>
        <a :href="AUTHOR.gitee" target="_blank" rel="noopener" class="hover:text-c-bark">Gitee</a>
        <a :href="AUTHOR.github" target="_blank" rel="noopener" class="hover:text-c-bark">GitHub</a>
        <button @click="onCopyStamp" class="hover:text-c-bark">复制联系方式</button>
      </div>

      <!-- 二维码放这儿比一行邮箱好使：目标用户就在手机上，扫一下比复制邮箱再写邮件快得多。
           groupStub（群码过期）会自动降级成"加我拉你进群"，不需要额外处理。 -->
      <div class="mt-4 pt-4 border-t border-c-line">
        <WeChatPanel compact
          desc="扫码加我微信（备注「蓝笔申论」），我把题库包直接发给你；用起来遇到问题也随时问我。" />
      </div>
    </div>

    <!-- 筛选 -->
    <div class="rounded-2xl p-5 neu mb-6">
      <div class="text-xs text-c-muted mb-2.5">按来源</div>
      <div class="flex flex-wrap gap-1.5 mb-4">
        <button @click="sourceFilter = ''"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="!sourceFilter ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          全部
          <span class="tnum opacity-60">{{ pool.length }}</span>
        </button>
        <button v-for="s in SOURCES" :key="s.key" @click="sourceFilter = s.key" :title="s.hint"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="sourceFilter === s.key ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          {{ s.key }}
          <span class="tnum opacity-60">{{ countBySource(s.key) }}</span>
        </button>
      </div>
      <template v-if="systems.length > 1">
        <div class="text-xs text-c-muted mb-2.5">按体系</div>
        <div class="flex flex-wrap gap-1.5 mb-4">
          <button @click="systemFilter = ''"
            class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
            :class="!systemFilter ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
            全部
            <span class="tnum opacity-60">{{ filteredSource.length }}</span>
          </button>
          <button v-for="sys in systems" :key="sys" @click="systemFilter = sys"
            class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
            :class="systemFilter === sys ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
            {{ sys }}
            <span class="tnum opacity-60">{{ countBySystem(sys) }}</span>
          </button>
        </div>
      </template>
      <div class="text-xs text-c-muted mb-2.5">按题型</div>
      <div class="flex flex-wrap gap-1.5">
        <button @click="typeFilter = ''"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="!typeFilter ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          全部
          <span class="tnum opacity-60">{{ filteredSource.length }}</span>
        </button>
        <button v-for="t in QUESTION_TYPES" :key="t" @click="typeFilter = t"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="typeFilter === t ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          {{ t }}
          <span class="tnum opacity-60">{{ countByType(t) }}</span>
        </button>
      </div>
    </div>

    <!-- 录入面板 -->
    <!-- 我的题库：按**导入批次**分组，看清来源、能整批删。
         此前导入完只有一句 toast，用户既不知道导过什么、也删不掉 —— 这是最大的体验缺口。 -->
    <div v-if="showLib" class="rounded-2xl p-5 neu mb-6">
      <div class="text-sm font-medium text-c-body mb-1">我的题库</div>
      <div class="text-xs text-c-muted mb-4 leading-5">
        这里记的是<strong>导入过的题库包</strong>（作者定向分发的私有卷）。
        「删除整批」＝把这一包带进来的题全部清掉，<strong>不影响</strong>内置真题与你自己录入的题目。
      </div>
      <div v-if="!imports.length" class="text-xs text-c-muted leading-6">
        还没有导入过题库包。拿到 <code>.bpq</code> 文件后拖进本页任意位置即可。
      </div>
      <div v-else class="space-y-2.5">
        <div v-for="it in imports" :key="it.id" class="rounded-xl px-4 py-3" style="background: #f1ece4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs text-c-body">
                <strong>{{ it.exams }} 套 / {{ it.questions }} 题</strong>
                <span v-if="it.yearRange" class="text-c-muted"> · {{ it.yearRange }}</span>
                <span v-if="it.tier" class="text-c-muted"> · {{ it.tier }}</span>
              </div>
              <div class="text-[11px] text-c-muted mt-1 leading-5">
                导入于 {{ fmtTime(it.createdAt) }}<template v-if="it.fileName"> · {{ it.fileName }}</template>
              </div>
              <div class="text-[11px] text-c-muted leading-5">
                水印：{{ it.fingerprint }}<template v-if="it.issuer"> · 签发：{{ it.issuer }}</template>
                <template v-if="it.issuedAt"> · {{ it.issuedAt }}</template>
              </div>
              <div v-if="it.examTitles && it.examTitles.length" class="text-[11px] text-c-muted leading-5">
                卷：{{ it.examTitles.join('、') }}
              </div>
            </div>
            <button @click="askRemoveImport(it)" :disabled="importing"
              class="shrink-0 px-3 py-1.5 rounded-lg text-[11px] neu-sm disabled:opacity-40"
              style="color: #b4552d">
              删除整批
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showImport" class="rounded-2xl p-5 neu mb-6">
      <div class="text-sm font-medium text-c-body mb-1">录入题目</div>
      <div class="text-xs text-c-muted mb-4 leading-5">
        材料与作答要求一起填，练习页才能一键带入完整题目
      </div>
      <div class="space-y-3">
        <textarea v-model="draft.title" rows="2" placeholder="题干"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select v-model="draft.type"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none text-c-body">
            <option value="">题型</option>
            <option v-for="t in QUESTION_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model="draft.exam" type="text" placeholder="来源"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none
              text-c-body placeholder:text-c-muted" />
          <input v-model.number="draft.maxScore" type="number" placeholder="满分"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none
              text-c-body placeholder:text-c-muted tnum" />
          <input v-model.number="draft.wordLimit" type="number" placeholder="字数"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none
              text-c-body placeholder:text-c-muted tnum" />
        </div>
        <textarea v-model="draft.requirement" rows="2" placeholder="作答要求"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <textarea v-model="draft.material" rows="8" placeholder="给定资料（建议按「材料1 / 材料2」分行写）"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <textarea v-model="draft.reference" rows="4" placeholder="参考答案 / 范文（选填）"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <div class="flex gap-2">
          <button @click="saveQuestion" :disabled="!draft.title.trim()"
            class="px-4 py-2 rounded-xl text-xs font-medium neu text-c-bark disabled:opacity-40">
            保存
          </button>
          <button @click="showImport = false"
            class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-muted">取消</button>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="filtered.length" class="space-y-3">
      <div v-for="q in filtered" :key="q.id" class="rounded-2xl p-5 neu-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="q.id === dailyId" class="text-xs px-2 py-0.5 rounded-full shrink-0 font-medium"
                style="background: #f2ebe2; color: #5c4033">今日一练</span>
              <span class="text-xs px-1.5 py-0.5 rounded shrink-0 font-medium"
                :style="kindStyle(q)">{{ kindOf(q) }}</span>
              <span v-if="q.year" class="text-xs text-c-muted shrink-0 tnum">{{ q.year }}</span>
              <span v-if="q.type" class="text-xs px-1.5 py-0.5 rounded shrink-0"
                style="background: #e8ecdf; color: #3d5a7a">{{ q.type }}</span>
            </div>
            <div class="text-sm font-medium text-c-ink mt-2 leading-6">{{ q.title }}</div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-xs text-c-muted">
              <span v-if="q.exam">{{ q.exam }}</span>
              <span v-if="q.maxScore" class="tnum">{{ q.maxScore }} 分</span>
              <span v-if="q.wordLimit" class="tnum">≤{{ q.wordLimit }} 字</span>
              <span v-if="q.difficulty">{{ DIFFICULTY_LABEL[q.difficulty] }}</span>
              <span v-if="q.materialChars || q.material" class="tnum">
                材料 {{ q.materialChars || q.material.length }} 字
              </span>
              <span v-if="q.needLoad" class="text-c-muted">（材料进入练习后载入）</span>
              <span v-for="t in q.topics || []" :key="t"
                class="px-1.5 py-0.5 rounded" style="background: #f5f1ea; color: #78716c">
                {{ t }}
              </span>
            </div>
            <div v-if="q.requirement" class="text-xs text-c-muted mt-2.5 leading-5">
              要求：{{ q.requirement }}
            </div>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            <button @click="practiceWith(q)"
              class="px-3.5 py-2 rounded-lg text-xs font-medium neu-inset text-c-bark whitespace-nowrap">
              做这道题
            </button>
            <button v-if="!q.builtin" @click="del(q.id)"
              class="w-8 h-8 rounded-lg flex items-center justify-center text-c-muted
                hover:text-c-clay hover:bg-c-paper/50 transition-colors">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 材料预览：折叠，点开看「这道题要读的那几则」（按题裁剪，与练习页同口径） -->
        <details v-if="q.needLoad || q.material" class="mt-3 pt-3 border-t border-c-line"
          @toggle="onToggleMat($event, q)">
          <summary class="text-xs text-c-muted cursor-pointer hover:text-c-bark list-none">
            ▸ 材料预览<span v-if="q.materialUsed?.length" class="text-c-bark">· 本题用给定资料{{ q.materialUsed.join('、') }}</span><span v-else-if="q.materialView" class="text-c-muted">· 整卷</span>
          </summary>
          <div v-if="!q.materialView" class="mt-2.5 text-xs text-c-muted">载入中…</div>
          <div v-else class="mt-2.5 text-xs text-c-body leading-7 whitespace-pre-wrap
            max-h-72 overflow-y-auto pr-1">{{ q.materialView }}</div>
        </details>

        <!-- 参考答案：折叠，做完再看。真题按需载入 -->
        <details v-if="q.needLoad || q.reference" class="mt-3 pt-3 border-t border-c-line"
          @toggle="onToggleRef($event, q)">
          <summary class="text-xs text-c-muted cursor-pointer hover:text-c-bark list-none">
            ▸ 参考答案
          </summary>
          <div v-if="!q.reference" class="mt-2.5 text-xs text-c-muted">载入中…</div>
          <div v-else class="mt-2.5 text-xs text-c-body leading-7 whitespace-pre-wrap
            max-h-72 overflow-y-auto pr-1">{{ q.reference }}</div>
        </details>
      </div>
    </div>

    <div v-else class="rounded-2xl p-12 neu text-center text-c-muted">
      <div class="text-sm">{{ keyword || typeFilter ? '没有匹配的题目' : '题库还是空的' }}</div>
      <div class="text-xs text-c-muted mt-2 leading-5">
        可以录入自己的题目，或清空筛选看看内置题库
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from '../utils/toast'
import { getAll, put, remove, uid, STORES } from '../store/db'
import { QUESTION_TYPES, DIFFICULTY_LABEL } from '../data/builtin-questions'
import {
  BUILTIN_POOL, REAL_EXAMS, SIM_QUESTIONS, PUBLIC_MAX_YEAR, PRIVATE_EXAM_COUNT,
  loadFullQuestion,
} from '../data/questions'
import { pickDaily } from '../data/daily'
import { trimMaterial } from '../utils/grading/materialTrim'
import { AUTHOR } from '../data/author'
import { readPackFile, importPack, openSealedPack, listImports, removeImport } from '../bpq/importer'
import { useFileDrop } from '../utils/fileDrop'
import { copyAuthorLine } from '../utils/watermark'
import WeChatPanel from '../components/WeChatPanel.vue'

const router = useRouter()

const builtin = ref(BUILTIN_POOL)
const mine = ref([])          // 用户侧全部（自建 + 题库包导入的）——pool 要用它
/** 「自建」只数用户自己录入的：导入的私有真题不算自建（此前被算进去了） */
const ownCount = computed(() => mine.value.filter((q) => q._source !== 'bpq').length)
const keyword = ref('')
const typeFilter = ref('')
const systemFilter = ref('')   // 体系筛选（国考 / 省考-河北…），动态枚举
// 来源筛选：真题 / 私有 / 仿真 / 自建。真题一进来，光靠题型分不出该练哪个，
// 而这个项目最有价值的部分正是这些真题，必须在第一屏能筛出来。
const sourceFilter = ref('')
const showImport = ref(false)
const showGetPack = ref(false)
const packInput = ref(null)

// 拖拽导入：把 .bpq 拖进窗口任意位置即可，跟点「导入题库包」选文件走同一段逻辑。
// 只认题库包扩展名——拖别的东西进来不吭声，免得用户以为随便丢个文件就能入库。
const { dragging } = useFileDrop({
  onFile: handlePack,
  accept: ['.bpq', '.json'],
})
const importing = ref(false)

/** 私有卷套数：分发版恒为 0，据此决定"已导入"还是"引导获取" */
const privateExamCount = ref(PRIVATE_EXAM_COUNT)

// ── 我的题库：导入批次 ────────────────────────────────────────
// 此前导入完只弹一句 toast：用户既不知道导过什么、也删不掉 —— 这是最大的体验缺口。
// 这里把批次列出来（来源 / 时间 / 水印 / 卷清单），并能整批删除。
const showLib = ref(false)
const imports = ref([])
const importSteps = ref([])

const stepIcon = (s) => (s === 'ok' ? '✓' : s === 'fail' ? '✗' : s === 'doing' ? '…' : '·')
const stepColor = (s) => (s === 'ok' ? '#4f7d5e' : s === 'fail' ? '#b4552d' : '#9c6b2f')
function fmtTime(t) {
  const d = new Date(t || 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 推一条回显；返回下标，稍后就地改成 ok / fail */
function pushStep(label, state = 'doing', detail = '') {
  importSteps.value.push({ label, state, detail })
  return importSteps.value.length - 1
}
function setStep(i, state, detail = '') {
  const s = importSteps.value[i]
  if (!s) return
  s.state = state
  if (detail) s.detail = detail
}

async function loadImports() {
  try {
    imports.value = await listImports()
  } catch {
    imports.value = []   // 读不到不该让整页崩（老库还没有 imports 表也不会走到这，upgrade 已建）
  }
}

function toggleLib() {
  showLib.value = !showLib.value
  if (showLib.value) loadImports()
}

async function askRemoveImport(it) {
  const ok = await toast.confirm(
    `删除这一批？\n\n${it.exams} 套 / ${it.questions} 题（水印 ${it.fingerprint}）将被清掉。\n` +
      '不影响内置真题与你自己录入的题目；想再练需要重新导入题库包。',
    { title: '删除导入批次', okText: '删除整批' },
  )
  if (!ok) return
  try {
    const n = await removeImport(it.id)
    await Promise.all([load(), loadImports()])
    toast.success(`已删除 ${n} 道题（这一批）`)   // 如实报数，不写"已删除"这种不报数的空话
  } catch (err) {
    toast.error(err?.message || '删除失败')
  }
}

const draft = reactive({
  title: '', type: '', exam: '', requirement: '',
  material: '', reference: '', maxScore: 25, wordLimit: null,
})

const pool = computed(() => [...mine.value, ...builtin.value])

/** 今日一练是哪道：与练习页共用同一套确定性选题，两处必然一致 */
const dailyId = computed(() => pickDaily(pool.value)?.id || '')

/** 来源归属：真题 / 仿真 / 自建。自建题存在库里时只带 kind:'自建' */
function kindOf(q) {
  if (q.kind) return q.kind
  return q.builtin ? '仿真' : '自建'
}

/** 真题用赭黄、私有用藕紫、仿真用暖棕、自建用中灰 —— 与老师色标同一套色系，不新造颜色 */
function kindStyle(q) {
  const k = kindOf(q)
  if (k === '真题') return 'background:#f7eddc;color:#9c6b2f'
  if (k === '私有') return 'background:#efeaf4;color:#7a6a9b'
  if (k === '仿真') return 'background:#f2ebe2;color:#5c4033'
  return 'background:#f5f1ea;color:#78716c'
}

/**
 * 题库页展开「参考答案」时才去载真题正文。
 * 真题材料整卷共用、动辄七八千字，列表页一次性全载会白读 1MB。
 */
async function onToggleRef(e, q) {
  if (!e.target.open || !q.needLoad || q.reference) return
  const full = await loadFullQuestion(q.id)
  if (!full) return
  q.reference = full.reference          // q 是 ref 数组里的响应式对象，直接改即生效
  q.material = full.material
  q.materialChars = full.material.length
  q.needLoad = false
  applyMatView(q)
}

/**
 * 材料预览（v0.17.0）：与练习页同一套裁剪口径 —— 展示的是「这道题要读的那几则」，
 * 不是整卷。评分细则 / 采分点在这里永远不出现（标准分层：写出采分点＝泄题）。
 */
function applyMatView(q) {
  if (!q.material) return
  const stem = [q.title, q.requirement].filter(Boolean).join(' ')
  const t = trimMaterial(q.material, stem)
  q.materialView = t.trimmed ? t.text : q.material
  q.materialUsed = t.trimmed ? t.used : []
}

async function onToggleMat(e, q) {
  if (!e.target.open) return
  if (q.needLoad && !q.material) {
    const full = await loadFullQuestion(q.id)
    if (!full) return
    q.reference = full.reference
    q.material = full.material
    q.materialChars = full.material.length
    q.needLoad = false
  }
  if (q.material && q.materialView === undefined) applyMatView(q)
}

const SOURCES = [
  { key: '真题', hint: `2010–${PUBLIC_MAX_YEAR} 国考，随软件内置，含整卷材料与参考答案` },  // 省考卷(≥2022)走私有通道，见「私有」
  { key: '私有', hint: `${PUBLIC_MAX_YEAR + 1} 年起的国考卷与省考卷，题库包导入，请勿转发` },
  { key: '仿真', hint: '按真题风格自编，适合快速专项练' },
  { key: '自建', hint: '你自己录入的题目' },
]

function countBySource(s) {
  return pool.value.filter((q) => kindOf(q) === s).length
}

/** 只按「来源」过滤后的池子：体系那一排的计数跟着它走 */
const filteredSource = computed(() =>
  sourceFilter.value ? pool.value.filter((q) => kindOf(q) === sourceFilter.value) : pool.value
)

/** 体系动态枚举（国考 / 省考-河北…）——有第二种体系才显示这排筛选 */
const systems = computed(() =>
  [...new Set(filteredSource.value.map((q) => q.system).filter(Boolean))].sort()
)

const filteredSystem = computed(() =>
  systemFilter.value
    ? filteredSource.value.filter((q) => (q.system || '国考') === systemFilter.value)
    : filteredSource.value
)

function countBySystem(sys) {
  return filteredSource.value.filter((q) => (q.system || '国考') === sys).length
}

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return filteredSystem.value.filter((q) => {
    if (systemFilter.value && (q.system || '国考') !== systemFilter.value) return false
    if (typeFilter.value && q.type !== typeFilter.value) return false
    if (!k) return true
    return (
      (q.title || '').toLowerCase().includes(k) ||
      (q.exam || '').toLowerCase().includes(k) ||
      (q.topics || []).some((t) => t.toLowerCase().includes(k))
    )
  })
})

const coveredTypes = computed(
  () => QUESTION_TYPES.filter((t) => pool.value.some((q) => q.type === t)).length
)

function countByType(t) {
  return filteredSystem.value.filter((q) => q.type === t).length
}

async function load() {
  const all = await getAll(STORES.questions)
  // mine = 用户侧全部（自建 + 导入）：pool 由它构成，导入的题必须能在题库里看到、能练。
  // ⚠️ 别在这里按来源过滤掉导入题 —— 那样题库列表里就看不到私有卷了（试过，是回归）。
  mine.value = all
  // 私有卷数 = 内置常量与库内导入的**并集**，按卷 id 去重（重复导入同一卷不该算两次）。
  // 用并集而不是"加"：删除整批后能正确回落，不会越删越大。
  const byExam = new Set(all.filter((q) => q._source === 'bpq').map((q) => q._examId).filter(Boolean))
  privateExamCount.value = Math.max(PRIVATE_EXAM_COUNT, byExam.size)
}

/**
 * 导入 .bpq 私有题库包。
 * 校验不过就整包拒绝 —— 半截导入会让题库里混进读不通的题，比不导入更糟。
 *
 * 加密包（v2）比明文包多一步「问口令」：口令是作者另外给的（不跟着包走），
 * 所以这里最多问 3 次，够用又不至于让人一直撞。
 */
async function onPackFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''            // 清掉 value，同一个文件才能再次选择（重导/换包）
  if (!file) return
  await handlePack(file)
}

/**
 * 导入一个 .bpq 包。文件选择与拖拽两个入口都走这里 —— 两条路各写一遍，
 * 迟早有一条忘了处理加密包的口令。
 */
async function handlePack(file) {
  if (importing.value) return    // 拖拽可能连发，导入中再丢进来直接忽略
  importing.value = true
  importSteps.value = []         // 每次导入都从干净的回显开始
  try {
    const iRead = pushStep('读取文件', 'doing', file.name)
    let r = await readPackFile(file)
    setStep(iRead, 'ok', `${(file.size / 1024).toFixed(0)} KB`)

    // ① 格式：明文包在这一步就能全判完；加密包只标出类型，验签解密在下面两步
    if (!r.sealed) {
      const iFmt = pushStep('格式与校验和', 'doing')
      setStep(iFmt, r.ok ? 'ok' : 'fail', r.ok ? `${r.pack?.exams?.length || 0} 套` : r.errors[0] || '')
    } else {
      pushStep('格式', 'ok', '加密包 v2 —— 先验签、再解密')
    }

    // ② 加密包：验签 → 解密，逐条回显（阶段回调从 openSealedPack 里透出来）
    let iSig = -1
    let iDec = -1
    for (let attempt = 0; r.sealed && !r.pack && attempt < 3; attempt++) {
      const pwd = await toast.askPassword(
        '这份题库包是加密的，需要作者给你的口令才能打开。\n'
        + '（口令与包是分开给的——如果作者把两者发在同一条消息里，提醒他一下）',
        { placeholder: '口令', okText: '打开' },
      )
      if (!pwd) {
        pushStep('已取消', 'fail', '没有输入口令')
        return
      }
      if (iSig < 0) iSig = pushStep('签名校验', 'doing', '用内置公钥验证签发者…')
      if (iDec < 0) iDec = pushStep('解密', 'doing', '按口令解密…')
      r = await openSealedPack(r.text, pwd, {
        onStage: (ev) => {
          if (ev.stage === 'signature') {
            setStep(iSig, ev.ok ? 'ok' : 'fail', ev.ok ? (ev.keyId ? `keyId ${ev.keyId}` : '签名有效') : '签名不通过')
          }
          if (ev.stage === 'decrypt') {
            setStep(iDec, ev.ok ? 'ok' : 'fail', ev.ok ? '' : '口令不对或文件被改动')
          }
        },
      })
      if (r.ok) break
      const msg = r.errors.join('')
      // 口令错可以重试；签名不过、格式不对这类问题再输一百遍也没用，直接说清
      if (!msg.includes('口令')) {
        toast.error(r.errors[0] || '打不开这个题库包')
        return
      }
      toast.warning(attempt < 2 ? '口令不对，再试一次' : '口令仍不对，稍后再试或联系作者')
    }

    if (!r.ok) {
      pushStep('校验未通过', 'fail', r.errors[0] || '')
      toast.error(r.errors[0] || '题库包不可用')
      return
    }

    // ③ 水印：加密包的价值本来只写在文档里，这里让用户在导入这一刻就看见
    pushStep('水印', r.pack?.userFingerprint ? 'ok' : 'doing', r.pack?.userFingerprint || '未署名')

    for (const w of r.warnings) {
      pushStep('提示', 'doing', w)
      toast.warning(w)
    }

    // ④ 入库（流式报题数）
    const iSave = pushStep('写入题库', 'doing')
    const res = await importPack(r.pack, {
      fileName: file.name,
      onProgress: (n) => setStep(iSave, 'doing', `已写入 ${n} 道`),
    })
    setStep(iSave, 'ok', `${res.exams} 套 / ${res.questions} 题`)

    await Promise.all([load(), loadImports()])
    pushStep('完成', 'ok', `可在「我的题库」里查看来源或整批删除`)
    toast.success(`已导入 ${res.exams} 套 / ${res.questions} 道题（水印：${res.fingerprint}）`)
  } catch (err) {
    pushStep('导入失败', 'fail', err?.message || '请确认文件是 .bpq 题库包')
    toast.error(err?.message || '导入失败，请确认文件是 .bpq 题库包')
  } finally {
    importing.value = false
  }
}

async function onCopyStamp() {
  const ok = await copyAuthorLine()
  if (ok) toast.success('已复制作者联系方式')
  else toast.warning('浏览器不允许自动复制，请手动记录')
}

async function saveQuestion() {
  const now = Date.now()
  await put(STORES.questions, {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    type: draft.type,
    exam: draft.exam.trim(),
    requirement: draft.requirement,
    material: draft.material,
    reference: draft.reference,
    maxScore: draft.maxScore,
    wordLimit: draft.wordLimit,
    topics: [],
  })
  Object.assign(draft, {
    title: '', type: '', exam: '', requirement: '',
    material: '', reference: '', maxScore: 25, wordLimit: null,
  })
  showImport.value = false
  await load()
  toast.success('已保存')
}

async function del(id) {
  await remove(STORES.questions, id)
  await load()
}

/**
 * 带进练习页。
 * 只传 questionId —— 练习页会回题库池里按 id 取完整题目（字段最全，也不怕 URL 过长）。
 * 早期版本只传 title + material，作答要求、满分、字数全丢，用户还得手填一遍；
 * 后来改成把五个字段都塞进 query，虽然不丢了但 URL 会变成几千字符。
 * id 是唯一稳定标识，传它就够了。
 */
function practiceWith(q) {
  router.push({ path: '/practice', query: { questionId: q.id } })
}

onMounted(async () => {
  await load()
  await loadImports()   // 「我的题库」的批次列表（按钮上要显示数量）
})
</script>
