<script setup lang="ts">
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const memory = useMemoryStore()
const { auditLogs } = storeToRefs(memory)

const KEY = 'settings.pages.modules.memory-long-term.audit'

function formatDate(at: number) {
  return new Date(at).toLocaleString()
}

function undo(id: string) {
  void memory.undoAudit(id)
}
</script>

<template>
  <div :class="['flex flex-col', 'gap-4']">
    <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      {{ t(`${KEY}.description`) }}
    </p>

    <ul v-if="auditLogs.length" :class="['flex flex-col', 'gap-2']">
      <li
        v-for="log in auditLogs"
        :key="log.id"
        :class="['flex items-start', 'gap-3', 'rounded-lg', 'bg-neutral-50 dark:bg-neutral-800/60', 'px-3 py-2.5']"
      >
        <div :class="['min-w-0 flex-1', 'flex flex-col', 'gap-0.5']">
          <div :class="['flex flex-wrap items-center', 'gap-2']">
            <span :class="['text-sm font-medium']">{{ t(`${KEY}.action.${log.action}`) }}</span>
            <span :class="['text-xs', 'text-neutral-400 dark:text-neutral-500']">{{ t(`${KEY}.at`, { date: formatDate(log.at) }) }}</span>
          </div>
          <p :class="['text-sm', 'break-words']">
            {{ log.reason }}
          </p>
          <code v-if="log.after?.description" :class="['text-xs', 'text-neutral-500 dark:text-neutral-400', 'break-all']">{{ log.after.description }}</code>
        </div>
        <Button size="sm" :label="t(`${KEY}.undo`)" @click="undo(log.id)" />
      </li>
    </ul>
    <p v-else :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
      {{ t(`${KEY}.empty`) }}
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.audit.title
  subtitleKey: settings.pages.modules.memory-long-term.title
  stageTransition:
    name: slide
</route>
