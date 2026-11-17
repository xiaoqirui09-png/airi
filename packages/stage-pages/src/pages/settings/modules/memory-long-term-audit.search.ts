import type { SettingsSearchModule } from '@proj-airi/stage-ui/libs/settings-search'

import { settingsSearchItemKey } from '@proj-airi/stage-shared/settings-search'

/** The memory activity page, where automatic changes can be reviewed and undone. */
export default {
  routes: [{
    path: '/settings/modules/memory-long-term-audit',
    items: ({ t }) => [{
      title: t('settings.pages.modules.memory-long-term.audit.title'),
      key: settingsSearchItemKey('memory-audit', 'page'),
      section: t('settings.pages.modules.memory-long-term.title'),
    }],
  }],
} satisfies SettingsSearchModule
