<script setup lang="ts">
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useMemoryExtractStore } from '@proj-airi/stage-ui/stores/memory-extract'
import { FieldCheckbox, FieldRange, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
const { enabled, recallEnabled, recallTopN, recallBudgetChars } = storeToRefs(useMemoryStore())
const { autoExtractEnabled, autoExtractMode } = storeToRefs(useMemoryExtractStore())

const KEY = 'settings.pages.modules.memory-long-term'

const modeOptions = computed(() => [
  { label: t(`${KEY}.mode.confirm`), value: 'confirm' as const, icon: 'i-solar:shield-check-linear' },
  { label: t(`${KEY}.mode.auto`), value: 'auto' as const, icon: 'i-solar:bolt-linear' },
])
</script>

<template>
  <div :class="['flex flex-col', 'gap-4']">
    <div :class="['rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <FieldCheckbox v-model="enabled" :label="t(`${KEY}.enable`)" :description="t(`${KEY}.enable-description`)" />
    </div>
    <div v-if="enabled" :class="['flex flex-col', 'gap-4', 'rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <FieldCheckbox v-model="autoExtractEnabled" :label="t(`${KEY}.auto_extract`)" :description="t(`${KEY}.auto_extract-description`)" />
      <template v-if="autoExtractEnabled">
        <div :class="['flex flex-col', 'gap-2']">
          <span :class="['text-sm font-medium']">{{ t(`${KEY}.auto_extract_mode`) }}</span>
          <SelectTab v-model="autoExtractMode" :options="modeOptions" size="sm" />
          <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
            {{ t(`${KEY}.auto_extract_mode-description`) }}
          </p>
        </div>
      </template>
    </div>
    <div v-if="enabled" :class="['flex flex-col', 'gap-4', 'rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <FieldCheckbox v-model="recallEnabled" :label="t(`${KEY}.recall`)" :description="t(`${KEY}.recall-description`)" />
      <template v-if="recallEnabled">
        <FieldRange v-model="recallTopN" as="div" :min="1" :max="20" :step="1" :default-value="8" :label="t(`${KEY}.recall_top_n`)" :description="t(`${KEY}.recall_top_n-description`)" />
        <FieldRange v-model="recallBudgetChars" as="div" :min="200" :max="4000" :step="100" :default-value="800" :label="t(`${KEY}.recall_budget`)" :description="t(`${KEY}.recall_budget-description`)" />
      </template>
    </div>
    <RouterLink
      to="/settings/modules/memory-long-term-recipes"
      :class="['rounded-lg', 'bg-neutral-50 dark:bg-neutral-800', 'p-4', 'flex items-center', 'gap-3', 'transition-colors', 'hover:bg-neutral-100 dark:hover:bg-neutral-700']"
    >
      <div :class="['i-solar:book-bookmark-bold-duotone', 'text-2xl', 'text-primary-500 dark:text-primary-400']" />
      <div :class="['flex-1', 'flex flex-col', 'gap-1']">
        <span :class="['text-lg font-medium']">{{ t('settings.pages.modules.memory-long-term.recipes.entry.title') }}</span>
        <span :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.modules.memory-long-term.recipes.entry.description') }}</span>
      </div>
      <div :class="['i-solar:alt-arrow-right-linear', 'text-neutral-400']" />
    </RouterLink>
    <RouterLink
      to="/settings/modules/memory-long-term-memories"
      :class="['rounded-lg', 'bg-neutral-50 dark:bg-neutral-800', 'p-4', 'flex items-center', 'gap-3', 'transition-colors', 'hover:bg-neutral-100 dark:hover:bg-neutral-700']"
    >
      <div :class="['i-solar:notebook-bookmark-bold-duotone', 'text-2xl', 'text-primary-500 dark:text-primary-400']" />
      <div :class="['flex-1', 'flex flex-col', 'gap-1']">
        <span :class="['text-lg font-medium']">{{ t('settings.pages.modules.memory-long-term.memories.entry.title') }}</span>
        <span :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.modules.memory-long-term.memories.entry.description') }}</span>
      </div>
      <div :class="['i-solar:alt-arrow-right-linear', 'text-neutral-400']" />
    </RouterLink>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
