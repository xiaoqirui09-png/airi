<script setup lang="ts">
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useMemoryEmbeddingStore } from '@proj-airi/stage-ui/stores/memory-embedding'
import { useMemoryExtractStore } from '@proj-airi/stage-ui/stores/memory-extract'
import { useMemoryProactiveStore } from '@proj-airi/stage-ui/stores/memory-proactive'
import { FieldCheckbox, FieldRange, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
const { enabled, recallEnabled, recallTopN, recallBudgetChars, decayHalfLifeDays } = storeToRefs(useMemoryStore())
const { autoExtractEnabled, autoExtractMode } = storeToRefs(useMemoryExtractStore())
const embeddingStore = useMemoryEmbeddingStore()
const { enabled: semanticEnabled, recallWeight, vectorCount, ready: semanticReady, failure: semanticFailure } = storeToRefs(embeddingStore)
const proactiveStore = useMemoryProactiveStore()
const {
  enabled: proactiveEnabled,
  probability: proactiveProbability,
  minInterval: proactiveMinInterval,
  maxChars: proactiveMaxChars,
  relevanceThreshold: proactiveThreshold,
} = storeToRefs(proactiveStore)

const KEY = 'settings.pages.modules.memory-long-term'

onMounted(() => {
  void embeddingStore.loadCount()
})

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
    <div v-if="enabled" :class="['flex flex-col', 'gap-4', 'rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <FieldCheckbox v-model="semanticEnabled" :label="t(`${KEY}.semantic`)" :description="t(`${KEY}.semantic-description`)" />
      <template v-if="semanticEnabled">
        <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
          {{ semanticReady ? t(`${KEY}.semantic-ready`) : (semanticFailure ? t(`${KEY}.semantic-error`, { error: semanticFailure }) : t(`${KEY}.semantic-loading`)) }}
        </p>
        <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
          {{ t(`${KEY}.semantic-vectors`, { count: vectorCount }) }}
        </p>
        <FieldRange v-model="recallWeight" as="div" :min="0" :max="1" :step="0.05" :default-value="0.55" :label="t(`${KEY}.semantic-weight`)" :description="t(`${KEY}.semantic-weight-description`)" />
        <div :class="['flex', 'gap-2', 'flex-wrap']">
          <button type="button" :class="['rounded-lg', 'bg-neutral-50 dark:bg-neutral-800', 'px-3', 'py-2', 'text-sm', 'hover:bg-neutral-100 dark:hover:bg-neutral-700']" @click="embeddingStore.backfill()">
            {{ t(`${KEY}.semantic-backfill`) }}
          </button>
          <button type="button" :class="['rounded-lg', 'bg-neutral-50 dark:bg-neutral-800', 'px-3', 'py-2', 'text-sm', 'hover:bg-neutral-100 dark:hover:bg-neutral-700']" @click="embeddingStore.clearVectors()">
            {{ t(`${KEY}.semantic-clear`) }}
          </button>
        </div>
      </template>
    </div>
    <div v-if="enabled" :class="['flex flex-col', 'gap-4', 'rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <FieldCheckbox v-model="proactiveEnabled" :label="t(`${KEY}.proactive`)" :description="t(`${KEY}.proactive-description`)" />
      <template v-if="proactiveEnabled">
        <FieldRange v-model="proactiveProbability" as="div" :min="0" :max="1" :step="0.05" :default-value="0.15" :label="t(`${KEY}.proactive-probability`)" :description="t(`${KEY}.proactive-probability-description`)" />
        <FieldRange v-model="proactiveMinInterval" as="div" :min="1" :max="40" :step="1" :default-value="8" :label="t(`${KEY}.proactive-interval`)" :description="t(`${KEY}.proactive-interval-description`)" />
        <FieldRange v-model="proactiveMaxChars" as="div" :min="40" :max="400" :step="10" :default-value="120" :label="t(`${KEY}.proactive-max-chars`)" :description="t(`${KEY}.proactive-max-chars-description`)" />
        <FieldRange v-model="proactiveThreshold" as="div" :min="0" :max="1" :step="0.05" :default-value="0.35" :label="t(`${KEY}.proactive-threshold`)" :description="t(`${KEY}.proactive-threshold-description`)" />
        <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
          {{ semanticEnabled ? t(`${KEY}.proactive-hint-related`) : t(`${KEY}.proactive-hint-simple`) }}
        </p>
      </template>
    </div>
    <div v-if="enabled" :class="['flex flex-col', 'gap-4', 'rounded-xl', 'bg-neutral-100 dark:bg-neutral-900', 'p-4']">
      <p :class="['text-sm font-medium']">
        {{ t(`${KEY}.decay`) }}
      </p>
      <p :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
        {{ t(`${KEY}.decay-description`) }}
      </p>
      <FieldRange v-model="decayHalfLifeDays" as="div" :min="7" :max="365" :step="1" :default-value="90" :label="t(`${KEY}.decay_half_life`)" :description="t(`${KEY}.decay_half_life-description`)" />
    </div>
    <RouterLink
      to="/settings/modules/memory-long-term-audit"
      :class="['rounded-lg', 'bg-neutral-50 dark:bg-neutral-800', 'p-4', 'flex items-center', 'gap-3', 'transition-colors', 'hover:bg-neutral-100 dark:hover:bg-neutral-700']"
    >
      <div :class="['i-solar:history-bold-duotone', 'text-2xl', 'text-primary-500 dark:text-primary-400']" />
      <div :class="['flex-1', 'flex flex-col', 'gap-1']">
        <span :class="['text-lg font-medium']">{{ t('settings.pages.modules.memory-long-term.audit.entry.title') }}</span>
        <span :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">{{ t('settings.pages.modules.memory-long-term.audit.entry.description') }}</span>
      </div>
      <div :class="['i-solar:alt-arrow-right-linear', 'text-neutral-400']" />
    </RouterLink>
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
