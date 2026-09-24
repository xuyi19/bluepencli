<template>
  <div class="w-full max-w-3xl">

    <section class="mb-8">
      <div class="flex items-center gap-2 mb-2">
        <span class="px-2.5 py-1 rounded-full text-xs font-medium" style="background: #f2ebe2; color: #5c4033">使用文档</span>
        <span class="text-xs text-c-muted">五分钟上手</span>
      </div>
      <h1 class="font-serif text-2xl font-semibold text-c-ink">怎么用蓝笔申论</h1>
      <p class="text-sm text-c-muted mt-2 leading-6">
        写一篇作答，交给五位申论老师独立批改：分歧复核、圆桌合议，
        每个分数都给得出依据。这份文档讲清楚从配置到复盘的完整流程。
      </p>
    </section>

    <!-- ① 三步开始 -->
    <section class="rounded-2xl p-6 neu mb-6">
      <h2 class="font-serif text-lg text-c-ink mb-4">三步开始</h2>
      <ol class="space-y-4">
        <li class="flex gap-3.5">
          <span class="shrink-0 w-7 h-7 rounded-full neu-inset flex items-center justify-center text-xs font-medium text-c-bark tnum">1</span>
          <div>
            <div class="text-sm font-medium text-c-body">配置你的大模型 API</div>
            <p class="text-xs text-c-muted leading-6 mt-1">
              到 <RouterLink to="/settings" class="text-c-bark hover:underline">设置页</RouterLink>
              填 API 地址、Key 和模型名，点「测试连接」确认能通。
              配置只存在本机浏览器，不会上传。部署版 / 桌面版可能已由作者托管 Key，看到「服务端已配置」就不用填。
            </p>
          </div>
        </li>
        <li class="flex gap-3.5">
          <span class="shrink-0 w-7 h-7 rounded-full neu-inset flex items-center justify-center text-xs font-medium text-c-bark tnum">2</span>
          <div>
            <div class="text-sm font-medium text-c-body">选一道题，写完作答</div>
            <p class="text-xs text-c-muted leading-6 mt-1">
              进 <RouterLink to="/practice" class="text-c-bark hover:underline">练习批改</RouterLink>
              默认载入今日一练；也可以去
              <RouterLink to="/questions" class="text-c-bark hover:underline">题库</RouterLink>
              挑题，或直接把材料粘进来练自己的题。作答写在方格纸上，每行 25 字，和真实答题纸一样。
            </p>
          </div>
        </li>
        <li class="flex gap-3.5">
          <span class="shrink-0 w-7 h-7 rounded-full neu-inset flex items-center justify-center text-xs font-medium text-c-bark tnum">3</span>
          <div>
            <div class="text-sm font-medium text-c-body">点「开始批改」，选老师</div>
            <p class="text-xs text-c-muted leading-6 mt-1">
              批改时才选人：弹窗里挑 1～5 位老师（默认三师圆桌：袁东 / 周泰然 / 白鹭），
              也可以用预设组合。「深度模式」会注入老师方法论全文，判断更贴原始标准，代价是更慢更贵——日常练习建议关闭。
            </p>
          </div>
        </li>
      </ol>
    </section>

    <!-- ② 三种练习形态 -->
    <section class="rounded-2xl p-6 neu mb-6">
      <h2 class="font-serif text-lg text-c-ink mb-4">三种练习形态</h2>
      <div class="space-y-3">
        <div class="flex gap-3">
          <span class="shrink-0 w-1 rounded-full bg-c-bark/60" />
          <div>
            <div class="text-sm font-medium text-c-body">练习批改 <span class="text-xs text-c-muted font-normal">— 日常消化</span></div>
            <p class="text-xs text-c-muted leading-6 mt-0.5">
              材料自动按题裁剪（只给本题用到的资料），批改快、成本低；随时批随时看答案。
            </p>
          </div>
        </div>
        <div class="flex gap-3">
          <span class="shrink-0 w-1 rounded-full bg-c-bark/60" />
          <div>
            <div class="text-sm font-medium text-c-body">真题模式 <span class="text-xs text-c-muted font-normal">— 练找资料</span></div>
            <p class="text-xs text-c-muted leading-6 mt-0.5">
              按原卷给全部材料，练「在整卷里定位本题资料」的真实功夫；材料更全，批改成本也更高。
            </p>
          </div>
        </div>
        <div class="flex gap-3">
          <span class="shrink-0 w-1 rounded-full bg-c-bark/60" />
          <div>
            <div class="text-sm font-medium text-c-body">考场模式 <span class="text-xs text-c-muted font-normal">— 练节奏</span></div>
            <p class="text-xs text-c-muted leading-6 mt-0.5">
              落笔即计时，时间到自动交卷；作答用时记进报告。交卷后直接批改，不会中途弹窗打断。
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ③ 读懂批改结果 -->
    <section class="rounded-2xl p-6 neu mb-6">
      <h2 class="font-serif text-lg text-c-ink mb-4">读懂批改结果</h2>
      <div class="space-y-4 text-xs text-c-muted leading-6">
        <p>
          <span class="text-sm font-medium text-c-body">每位老师独立评分。</span>
          五位老师各有一套方法论，分数会真的分歧。超过阈值的分歧会触发复核辩论，
          最后加权合议出综合分——这个合议过程是公开的，你能看到每位老师各自的分数与理由。
        </p>
        <p>
          <span class="text-sm font-medium text-c-body">看分数先看可信度卡。</span>
          分数旁边有一张可信度卡，用六个信号说明这个分有多少依据：老师一致性、与程序粗判的吻合度、
          标准来源、阅卷完成度、客观校验、分歧复核。没有依据的项会明说「不适用」，不装样子。
        </p>
        <p>
          <span class="text-sm font-medium text-c-body">逐句批注落在原文上。</span>
          每位老师用自己的颜色在作答原文上标出问题，悬停看全部意见；
          每位老师另给一条「如果只改一处先改哪里」。
        </p>
        <p>
          <span class="text-sm font-medium text-c-body">复盘卡告诉你下次先改什么。</span>
          按「几位老师都提到」排序——共识是硬伤，单提是侧重。有的真题还配采分点对照与客观校验
          （字数 / 格式 / 结构 / 重复照抄），客观扣分封顶 20%，只作旁证、不改写 AI 分数。
        </p>
      </div>
    </section>

    <!-- ④ 荧光标注 -->
    <section class="rounded-2xl p-6 neu mb-6">
      <h2 class="font-serif text-lg text-c-ink mb-4">荧光标注</h2>
      <p class="text-xs text-c-muted leading-6">
        材料和作答都支持划荧光：选中文字后选颜色即可（8 种颜色）。用它在材料里圈关键词、
        在自己的作答里标「我写到了哪句材料」，批改不受影响。标记存在本机、按题记忆，
        下次打开同一道题还在；材料对应的文字被改掉后，失效的标记会明确提示而不是悄悄消失。
      </p>
    </section>

    <!-- ⑤ 数据与隐私 -->
    <section class="rounded-2xl p-6 neu mb-6">
      <h2 class="font-serif text-lg text-c-ink mb-4">数据在哪</h2>
      <div class="space-y-2 text-xs text-c-muted leading-6">
        <p>· 作答与批改记录存在本机（浏览器 IndexedDB），网站版同时归档到本机 docs/practice/ 目录，随时回看。</p>
        <p>· 只有批改那一刻会联网调用你配置的大模型 API；其余一切（题库、标准、记录）都在本地。</p>
        <p>· 荧光标记、API 配置都只存在本机浏览器，换浏览器 / 换设备不共享。</p>
      </div>
    </section>

    <!-- ⑥ 常见问题 -->
    <section class="rounded-2xl p-6 neu-sm mb-4">
      <h2 class="font-serif text-lg text-c-ink mb-4">常见问题</h2>
      <div class="space-y-4">
        <div>
          <div class="text-sm font-medium text-c-body">批改要多久？</div>
          <p class="text-xs text-c-muted leading-6 mt-1">
            三位老师并行阅卷，有分歧还会加一轮辩论，通常一到两分钟；深度模式更慢。
            批改页能实时看到每位老师的进度。
          </p>
        </div>
        <div>
          <div class="text-sm font-medium text-c-body">一次批改花多少钱？</div>
          <p class="text-xs text-c-muted leading-6 mt-1">
            取决于你的模型定价。材料是 token 大头——练习批改会自动裁剪材料，能省一半以上；
            每次批改的调用都在记录里可查。控制成本最有效的方式：练习批改 + 关深度模式 + 选 1～3 位老师。
          </p>
        </div>
        <div>
          <div class="text-sm font-medium text-c-body">「测试连接」401 / 404 是什么意思？</div>
          <p class="text-xs text-c-muted leading-6 mt-1">
            401 通常是 Key 不对，404 通常是 API 地址不对（注意版本段，比如要以 /v1 结尾）。
            地址写对但模型名写错，一般是 400 或「model not found」。
          </p>
        </div>
        <div>
          <div class="text-sm font-medium text-c-body">没有标准答案的题能批吗？</div>
          <p class="text-xs text-c-muted leading-6 mt-1">
            能。有采分点标准的题走标准（更准），没有的走裸判；但裸判时可信度天花板会降低，
            卡上会写明「无标准」，分数当参考而不是当真。
          </p>
        </div>
      </div>
    </section>

    <section class="rounded-2xl p-5 neu-sm">
      <p class="text-xs text-c-muted leading-6">
        更多背景（为什么这么设计、评分内核怎么工作）见
        <a href="https://github.com/xuyi19/bluepencli#readme" target="_blank" rel="noopener"
          class="text-c-bark hover:underline">GitHub README</a>；
        每个版本的改动见 <RouterLink to="/changelog" class="text-c-bark hover:underline">更新日志</RouterLink>。
      </p>
    </section>
  </div>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>
