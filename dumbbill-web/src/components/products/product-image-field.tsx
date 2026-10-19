'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, useToast } from '@/components/ui';
import { ApiError, getBrowserApiClient, productsApi } from '@/lib/api';
import { describeFailure } from '../business/business-errors';

/** Largest picture the API accepts (2 MB). Checked here first so a big photo fails before it is uploaded. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Shows a product's picture and lets someone with permission replace or remove it.
 *
 * The picture needs the sign-in token to download, so a plain `<img src>` link cannot fetch it: the screen downloads it
 * with the API client and shows it from memory (a `data:` address). The server re-encodes every upload as a clean WebP,
 * so what is shown is never the raw upload. The checks here (type, size) only save a round trip.
 */
export function ProductImageField({
  productId,
  hasImage,
  canEdit,
}: {
  productId: string;
  hasImage: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations('Products');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const picture = useQuery({
    queryKey: ['products', 'image', productId],
    queryFn: () => productsApi.getProductImage(getBrowserApiClient(), productId, 'full'),
    enabled: hasImage,
  });

  const [loaded, setLoaded] = useState<{ blob: Blob; address: string } | null>(null);
  useEffect(() => {
    const blob = picture.data;
    if (!hasImage || !blob) return;
    const reader = new FileReader();
    reader.onload = () => setLoaded({ blob, address: String(reader.result) });
    reader.readAsDataURL(blob);
    return () => reader.abort();
  }, [hasImage, picture.data]);
  // Ignore an address that belongs to an older picture or to a picture that was removed.
  const address = hasImage && loaded && loaded.blob === picture.data ? loaded.address : null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      productsApi.uploadProductImage(getBrowserApiClient(), productId, file),
    onSuccess: async () => {
      setProblem(null);
      await refresh();
      toast({ title: t('toast.imageSaved'), tone: 'success' });
    },
    onError: (error) => setProblem(uploadProblem(error, t)),
  });

  const remove = useMutation({
    mutationFn: () => productsApi.removeProductImage(getBrowserApiClient(), productId),
    onSuccess: async () => {
      setProblem(null);
      await refresh();
      toast({ title: t('toast.imageRemoved'), tone: 'success' });
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
    if (!ACCEPTED_TYPES.includes(file.type)) return setProblem(t('image.wrongType'));
    if (file.size > MAX_IMAGE_BYTES) return setProblem(t('image.tooBig'));
    setProblem(null);
    upload.mutate(file);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="flex size-32 items-center justify-center overflow-hidden rounded-card border border-line bg-surface">
          {address ? (
            // A user-supplied picture held in memory, so the Next image optimiser does not apply.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={address}
              alt={t('image.alt')}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="px-2 text-center text-caption text-muted">{t('image.none')}</span>
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
              data-testid="product-image-input"
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
                ? t('image.uploading')
                : hasImage
                  ? t('image.replace')
                  : t('image.choose')}
            </Button>
            {hasImage && (
              <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
                {t('image.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="text-caption text-muted">{t('image.hint')}</p>
      {problem && (
        <Alert tone="danger" title={t('errors.title')}>
          {problem}
        </Alert>
      )}
    </div>
  );
}

/** Words for a refused upload, chosen from the error code. */
function uploadProblem(error: unknown, t: ReturnType<typeof useTranslations<'Products'>>): string {
  if (error instanceof ApiError) {
    if (error.isNetwork) return t('errors.network');
    if (error.code === 'FILE_TOO_LARGE' || error.code === 'PAYLOAD_TOO_LARGE')
      return t('image.tooBig');
    if (error.code === 'FILE_TYPE_NOT_ALLOWED') return t('image.wrongType');
    if (error.code === 'FILE_CONTENT_MISMATCH' || error.code === 'FILE_EMPTY')
      return t('image.notReal');
    if (error.code === 'FORBIDDEN') return t('errors.forbidden');
  }
  return t('errors.generic');
}
