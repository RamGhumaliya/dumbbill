import type messages from '../../messages/en.json';

/**
 * Makes translation keys type-checked: `t('Owner.title')` compiles only if that key exists in
 * messages/en.json, so a typo is caught by the compiler instead of showing a raw key to a user.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: 'en';
    Messages: typeof messages;
  }
}
