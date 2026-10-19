'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, useToast } from '@/components/ui';
import { ApiError, businessApi, getBrowserApiClient } from '@/lib/api';
import { describeFailure } from './business-errors';

/** Largest logo the API accepts (2 MB). Checked here first so a big photo fails before it is uploaded. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Shows the business logo and lets someone with permission replace or remove it.
 *
 * The logo needs the sign-in token to download, so a plain `<img src>` link cannot fetch it. The screen downloads it
 * with the API client and shows it from memory (as a `data:` address). The server checks the file's real contents; the checks here (type, size) only save a round trip.
 */
export function LogoField({ hasLogo, canEdit }: { hasLogo: boolean; canEdit: boolean }) {
  const t = useTranslations('Business');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const logo = useQuery({
    queryKey: ['business', 'logo'],
    queryFn: () => businessApi.getBusinessLogo(getBrowserApiClient()),
    enabled: hasLogo,
  });

  // The downloaded image becomes a `data:` address (allowed by our content-security policy) the <img> can show.
  // It is set from the reader's callback, which is where React expects outside events to arrive.
  const [loaded, setLoaded] = useState<{ blob: Blob; address: string } | null>(null);
  useEffect(() => {
    const blob = logo.data;
    if (!hasLogo || !blob) return;
    const reader = new FileReader();
    reader.onload = () => setLoaded({ blob, address: String(reader.result) });
    reader.readAsDataURL(blob);
    return () => reader.abort();
  }, [hasLogo, logo.data]);
  // Ignore an address that belongs to an older logo or to a logo that was removed.
  const address = hasLogo && loaded && loaded.blob === logo.data ? loaded.address : null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['business'] });
  };

  const upload = useMutation({
    mutationFn: (file: File) => businessApi.uploadBusinessLogo(getBrowserApiClient(), file),
    onSuccess: async () => {
      setProblem(null);
      await refresh();
      toast({ title: t('logo.uploaded'), tone: 'success' });
    },
    onError: (error) => setProblem(uploadProblem(error, t)),
  });

  const remove = useMutation({
    mutationFn: () => businessApi.removeBusinessLogo(getBrowserApiClient()),
    onSuccess: async () => {
      setProblem(null);
      await refresh();
      toast({ title: t('logo.removed'), tone: 'success' });
    },
    onError: (error) =>
      setProblem(
        describeFailure(error, {
          title: t('errors.title'),
          network: t('errors.network'),
          forbidden: t('errors.forbidden'),
          generic: t('errors.generic'),
        }).body,
      ),
  });

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) return setProblem(t('logo.wrongType'));
    if (file.size > MAX_LOGO_BYTES) return setProblem(t('logo.tooBig'));
    setProblem(null);
    upload.mutate(file);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-card border border-line bg-surface">
          {address ? (
            // The logo is a user-supplied image from memory, so the Next image optimiser does not apply.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={address}
              alt={t('logo.alt')}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="px-2 text-center text-caption text-muted">{t('logo.none')}</span>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-testid="logo-input"
              onChange={(event) => {
                onPick(event.target.files?.[0]);
                // Allow choosing the same file again after an error.
                event.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              loading={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {upload.isPending
                ? t('logo.uploading')
                : hasLogo
                  ? t('logo.replace')
                  : t('logo.choose')}
            </Button>
            {hasLogo && (
              <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
                {t('logo.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="text-caption text-muted">{t('logo.hint')}</p>
      {problem && (
        <Alert tone="danger" title={t('errors.title')}>
          {problem}
        </Alert>
      )}
    </div>
  );
}

/** Words for a refused upload, chosen from the error code. */
function uploadProblem(error: unknown, t: ReturnType<typeof useTranslations<'Business'>>): string {
  if (error instanceof ApiError) {
    if (error.isNetwork) return t('errors.network');
    if (error.code === 'FILE_TOO_LARGE' || error.code === 'PAYLOAD_TOO_LARGE')
      return t('logo.tooBig');
    if (error.code === 'FILE_TYPE_NOT_ALLOWED') return t('logo.wrongType');
    if (error.code === 'FILE_CONTENT_MISMATCH' || error.code === 'FILE_EMPTY')
      return t('logo.notReal');
    if (error.code === 'FORBIDDEN') return t('errors.forbidden');
  }
  return t('errors.generic');
}
