import { getRequestConfig } from 'next-intl/server';

/**
 * Tells next-intl which language and which translation file to use for each request.
 *
 * Only English exists today, but the app is built so more languages can be added later without touching
 * any screen: add `messages/hi.json`, return the user's choice here, and every text follows.
 * Rule for developers: NO user-visible text is written inside components. It lives in messages/en.json.
 */
export default getRequestConfig(async () => {
  const locale = 'en';
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
