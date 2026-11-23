import type { SettingsSearchModule } from '@proj-airi/stage-ui/libs/settings-search'

import { settingsSearchItemKey } from '@proj-airi/stage-shared/settings-search'

/** The long-term memory settings page. */
export default {
  routes: [{
    path: '/settings/modules/memory-long-term-settings',
    items: ({ t }) => [{
      title: t('settings.pages.modules.memory-long-term.settings.title'),
      key: settingsSearchItemKey('memory-long-term-settings', 'page'),
      section: t('settings.pages.modules.memory-long-term.title'),
    }],
  }],
} satisfies SettingsSearchModule
