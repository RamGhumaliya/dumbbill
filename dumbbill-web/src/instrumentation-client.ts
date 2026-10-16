import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/observability/sentry-options';

/**
 * Runs in the browser before the app starts. Switches on Sentry for errors that happen on the user's
 * screen. It does nothing when no Sentry address is configured.
 */
const options = sentryOptions();
if (options) Sentry.init(options);

/** Lets Sentry note which page change an error happened after. No-op when Sentry is off. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
