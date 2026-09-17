<template>
  <div class="w-full max-w-3xl">

    <div class="mb-10">
      <h1 class="font-serif text-2xl font-semibold text-c-ink">更新日志</h1>
      <p class="text-sm text-c-muted mt-2 leading-6">
        {{ APP_NAME }} 的版本历史与每轮改动
      </p>
      <p class="text-xs text-c-muted mt-1.5">
        内容直接取自仓库根的 CHANGELOG.md，改文档即改此页
      </p>
    </div>

    <!-- 时间轴：一条竖线 + 每版一个节点 -->
    <div class="relative pl-7 md:pl-9">
      <div class="absolute left-[5px] top-2 bottom-3 w-px bg-c-line" />

      <section v-for="log in CHANGELOG" :key="log.version" class="relative mb-10 last:mb-0">
        <div class="absolute -left-7 md:-left-9 top-2 w-3 h-3 rounded-full bg-c-bark
          ring-4 ring-c-barkSoft" />

        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="font-serif text-lg font-semibold text-c-ink tnum">{{ log.version }}</h2>
          <span class="text-xs text-c-muted tnum">{{ log.date }}</span>
        </div>

        <div v-if="log.title" class="text-sm text-c-body mt-1.5">{{ log.title }}</div>

        <div class="mt-4 rounded-2xl neu overflow-hidden">
          <!-- 条目分两类：顶层条目（带「新增/修复…」标签）与子条目（缩进的补充说明）。
               子条目只有一道短横，不再重复标签 —— 一行里出现两个同样的「新增」很吵。 -->
          <div v-for="(item, i) in log.items" :key="i"
            class="flex items-start gap-3 px-4 md:px-5"
            :class="item.depth ? 'py-1.5 pl-9 md:pl-11' : (i ? 'py-3 border-t border-c-line' : 'py-3')">

            <span v-if="!item.depth" class="shrink-0 mt-px px-2 py-0.5 rounded-md text-xs font-medium"
              :style="{ background: tagStyle(item.type).bg, color: tagStyle(item.type).fg }">
              {{ item.type }}
            </span>
            <span v-else class="shrink-0 mt-3 w-2.5 h-px bg-c-line" />

            <div class="min-w-0">
              <!-- 逐片段渲染，不用 v-html：文档是自己写的，但把 Markdown 当 HTML 解析
                   这件事本身就不该开这个口子 -->
              <div class="text-sm text-c-body leading-6">
                <template v-for="(p, j) in item.parts" :key="j">
                  <code v-if="p.t === 'code'"
                    class="px-1 py-px rounded text-[0.92em] text-c-bark bg-c-barkSoft">{{ p.v }}</code>
                  <strong v-else-if="p.t === 'bold'" class="font-medium text-c-ink">{{ p.v }}</strong>
                  <em v-else-if="p.t === 'em'" class="italic">{{ p.v }}</em>
                  <template v-else>{{ p.v }}</template>
                </template>
              </div>
              <!-- 文档里用 > 写的附注（如「哪些旧包含私有卷」），单独一行小字 -->
              <div v-if="item.note" class="text-xs text-c-muted leading-5 mt-1">{{ item.note }}</div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 仓库入口：日志看完顺手也给个入口 -->
    <div class="mt-12 pt-8 border-t border-c-line flex flex-wrap items-center gap-3">
      <RouterLink to="/"
        class="px-4 py-2.5 rounded-full text-sm text-c-body neu-sm hover:text-c-bark">
        返回首页
      </RouterLink>
      <a :href="REPO.github" target="_blank" rel="noopener"
        class="px-4 py-2.5 rounded-full text-sm text-c-body neu-sm hover:text-c-bark">
        GitHub 仓库
      </a>
      <a :href="REPO.gitee" target="_blank" rel="noopener"
        class="px-4 py-2.5 rounded-full text-sm text-c-body neu-sm hover:text-c-bark">
        Gitee 仓库
      </a>
    </div>
  </div>
</template>

<script setup>
import { RouterLink } from 'vue-router'
import { APP_NAME, REPO } from '../data/site'
import { CHANGELOG, tagStyle } from '../data/changelog'
</script>
