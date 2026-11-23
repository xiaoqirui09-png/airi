<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
const KEY = 'settings.pages.modules.memory-long-term'

const entries = [
  { to: '/settings/modules/memory-long-term-settings', icon: 'i-solar:settings-bold-duotone', titleKey: 'settings.title', descriptionKey: 'settings.description' },
  { to: '/settings/modules/memory-long-term-audit', icon: 'i-solar:history-bold-duotone', titleKey: 'audit.entry.title', descriptionKey: 'audit.entry.description' },
  { to: '/settings/modules/memory-long-term-recipes', icon: 'i-solar:book-bookmark-bold-duotone', titleKey: 'recipes.entry.title', descriptionKey: 'recipes.entry.description' },
  { to: '/settings/modules/memory-long-term-memories', icon: 'i-solar:notebook-bookmark-bold-duotone', titleKey: 'memories.entry.title', descriptionKey: 'memories.entry.description' },
] as const
</script>

<template>
  <div :class="['flex flex-col', 'gap-4']">
    <RouterLink
      v-for="entry in entries"
      :key="entry.to"
      :to="entry.to"
      :class="['rounded-lg', 'bg-neutral-50 dark:bg-neutral-800', 'p-4', 'flex items-center', 'gap-3', 'transition-colors', 'hover:bg-neutral-100 dark:hover:bg-neutral-700']"
    >
      <div :class="[entry.icon, 'text-2xl', 'text-primary-500 dark:text-primary-400']" />
      <div :class="['flex-1', 'flex flex-col', 'gap-1']">
        <span :class="['text-lg font-medium']">{{ t(`${KEY}.${entry.titleKey}`) }}</span>
        <span :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">{{ t(`${KEY}.${entry.descriptionKey}`) }}</span>
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
