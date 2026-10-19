'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Alert, Button, DataTable, type DataColumn } from '@/components/ui';
import { ApiError, getBrowserApiClient, productsApi } from '@/lib/api';
import type { ImportReport } from '@/lib/api/schemas/products';
import { describeFailure } from '../business/business-errors';

/** Largest CSV the API accepts (2 MB). Checked here first so a huge file fails before it is uploaded. */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * A starter file people can fill in. One example row shows the shape: amounts in rupees, GST as a percentage.
 * The first line is the header the import reads (names are case-insensitive and may come in any order).
 */
const TEMPLATE_CSV = [
  'name,brand,category,variant,sku,barcode,hsn,gst_percent,mrp,price,cost',
  'Gold Standard 100% Whey,Optimum Nutrition,Protein & whey,2 kg / Chocolate,ON-GS-2KG-CHOC,748927052145,21069099,18,3499,2999,2400',
].join('\r\n');

type FailedRow = ImportReport['failedRows'][number];

/**
 * The CSV import screen (US-PROD-01). The flow is: choose a file, "Check the file" (saves nothing and lists every
 * problem row by row), fix the spreadsheet if needed, then "Import". The good rows are added; the bad rows are listed
 * with the exact problem so only those need fixing. Running the import again skips rows already added.
 */
export function ProductImportScreen() {
  const t = useTranslations('Products');
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: ({ chosen, dryRun }: { chosen: File; dryRun: boolean }) =>
      productsApi.importProducts(getBrowserApiClient(), chosen, dryRun),
    onSuccess: async (result) => {
      setFailure(null);
      setReport(result);
      if (!result.dryRun && result.createdCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ['products'] });
        await queryClient.invalidateQueries({ queryKey: ['business', 'onboarding'] });
      }
    },
    onError: (error) => {
      setReport(null);
      setFailure(
        error instanceof ApiError && error.code === 'PAYLOAD_TOO_LARGE'
          ? t('importPage.tooBig')
          : describeFailure(error, {
              title: t('errors.title'),
              network: t('errors.network'),
              forbidden: t('errors.forbidden'),
              generic: t('errors.generic'),
            }).body,
      );
    },
  });

  const onPick = (chosen: File | undefined) => {
    setReport(null);
    setFailure(null);
    if (!chosen) return;
    if (!/\.csv$/i.test(chosen.name)) return setFileProblem(t('importPage.notCsv'));
    if (chosen.size > MAX_CSV_BYTES) return setFileProblem(t('importPage.tooBig'));
    setFileProblem(null);
    setFile(chosen);
  };

  const downloadTemplate = () => {
    const address = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = address;
    link.download = 'dumbbill-products-template.csv';
    link.click();
    URL.revokeObjectURL(address);
  };

  const columns: DataColumn<FailedRow>[] = [
    {
      id: 'row',
      header: t('importPage.result.row', { number: '' }).trim(),
      value: (row) => row.rowNumber,
      mono: true,
      cell: (row) => t('importPage.result.row', { number: row.rowNumber }),
    },
    {
      id: 'problems',
      header: t('importPage.result.failedHeading'),
      value: (row) => row.errors.map((error) => error.message).join(' '),
      cell: (row) => (
        <ul className="py-1">
          {row.errors.map((error) => (
            <li key={`${error.field}-${error.message}`}>
              <span className="font-mono text-caption text-muted">{error.field}</span>{' '}
              {error.message}
            </li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <div className="flex max-w-prose flex-col gap-8">
      <section aria-labelledby="columns-heading" className="flex flex-col gap-2">
        <h2
          id="columns-heading"
          className="text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('importPage.columnsHeading')}
        </h2>
        <p className="text-small">{t('importPage.columnsBody')}</p>
        <p className="text-small text-muted">{t('importPage.columnsBodyCost')}</p>
        <div>
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            {t('importPage.template')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="file-heading" className="flex flex-col gap-4">
        <h2
          id="file-heading"
          className="text-small font-semibold tracking-wide text-muted uppercase"
        >
          {t('importPage.step1')}
        </h2>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="import-input"
          onChange={(event) => {
            onPick(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => input.current?.click()}>
            {t('importPage.choose')}
          </Button>
          {file && (
            <span className="text-small text-muted">
              {t('importPage.chosen', { name: file.name })}
            </span>
          )}
        </div>
        {fileProblem && (
          <Alert tone="danger" title={t('errors.title')}>
            {fileProblem}
          </Alert>
        )}
        {failure && (
          <Alert tone="danger" title={t('errors.title')}>
            {failure}
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={!file}
            loading={run.isPending && run.variables?.dryRun === true}
            onClick={() => file && run.mutate({ chosen: file, dryRun: true })}
          >
            {run.isPending && run.variables?.dryRun
              ? t('importPage.checking')
              : t('importPage.check')}
          </Button>
          <Button
            variant="primary"
            disabled={!file}
            loading={run.isPending && run.variables?.dryRun === false}
            onClick={() => file && run.mutate({ chosen: file, dryRun: false })}
          >
            {run.isPending && run.variables?.dryRun === false
              ? t('importPage.importing')
              : t('importPage.run')}
          </Button>
        </div>
      </section>

      {report && (
        <section
          aria-labelledby="result-heading"
          className="flex flex-col gap-4"
          data-testid="import-report"
        >
          <h2 id="result-heading" className="text-title font-semibold">
            {report.dryRun
              ? t('importPage.result.checkedTitle')
              : t('importPage.result.importedTitle')}
          </h2>
          {report.fileErrors.length > 0 ? (
            <Alert tone="danger" title={t('importPage.result.fileProblem')}>
              <ul>
                {report.fileErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <>
              <p role="status" className="text-body">
                {t('importPage.result.summary', {
                  created: report.createdCount,
                  failed: report.failedCount,
                  dryRun: String(report.dryRun),
                })}
              </p>
              {report.categoriesCreated.length > 0 && (
                <p className="text-small text-muted">
                  {t('importPage.result.categories', {
                    names: report.categoriesCreated.join(', '),
                  })}
                </p>
              )}
              {report.ignoredColumns.length > 0 && (
                <p className="text-small text-muted">
                  {t('importPage.result.ignored', { names: report.ignoredColumns.join(', ') })}
                </p>
              )}
              {report.failedRows.length > 0 && (
                <>
                  <DataTable
                    caption={t('importPage.result.failedHeading')}
                    columns={columns}
                    rows={report.failedRows}
                    getRowId={(row) => String(row.rowNumber)}
                    density="comfortable"
                  />
                  <p className="text-small text-muted">{t('importPage.result.fixHint')}</p>
                </>
              )}
            </>
          )}
          {!report.dryRun && report.createdCount > 0 && (
            <div>
              <Button asChild variant="primary">
                <Link href="/products">{t('importPage.back')}</Link>
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
