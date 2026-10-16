import { getTranslations } from 'next-intl/server';
import { ApiError, createServerApiClient, systemApi } from '@/lib/api';
import { env } from '@/lib/env';

/**
 * Asks the API "are you ready?" (GET /readyz) and shows the answer.
 *
 * It exists to prove, on the first screen, that the whole chain works: this app, the typed API layer,
 * the CORS/CSP settings, and the backend with its database. A failure is shown in plain words together
 * with the reference (requestId) that finds the same call in the server logs.
 * It is a Server Component: the request is made on the server while the page is built.
 */
export async function ServerStatus() {
  const t = await getTranslations('Owner.status');
  const common = await getTranslations('Common');

  let tone: 'ok' | 'bad' = 'ok';
  let headline = '';
  let lines: string[] = [];
  let hint: string | undefined;

  try {
    const readiness = await systemApi.getReadiness(createServerApiClient());
    headline = t('ready');
    lines = [readiness.checks.database === 'up' ? t('databaseUp') : t('databaseDown')];
  } catch (error) {
    tone = 'bad';
    if (error instanceof ApiError && error.isNetwork) {
      headline = t('unreachable');
      hint = t('unreachableHint');
    } else {
      headline = t('problem');
    }
    if (error instanceof ApiError)
      lines = [error.code, common('reference', { code: error.requestId })];
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4" role="status">
      <p className="flex items-center gap-2 text-body font-medium">
        {/* The dot is decorative; the text beside it carries the meaning (never colour alone). */}
        <span
          aria-hidden
          className={`inline-block size-2.5 rounded-full ${tone === 'ok' ? 'bg-success' : 'bg-danger'}`}
        />
        {headline}
      </p>
      {lines.map((line) => (
        <p key={line} className="mt-1 font-mono text-caption text-muted">
          {line}
        </p>
      ))}
      {hint && <p className="mt-2 text-small text-muted">{hint}</p>}
      <p className="mt-3 text-caption text-muted">
        {t('api')}: <span className="font-mono">{env.NEXT_PUBLIC_API_BASE_URL}</span>
      </p>
    </div>
  );
}
