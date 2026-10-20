'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui';
import { ApiError, getBrowserApiClient, productsApi } from '@/lib/api';
import type { Product } from '@/lib/api/schemas/products';

/** How a product is written in the suggestion list. The barcode makes every label unique and lets a scan match exactly. */
export function productLabel(
  product: Pick<Product, 'name' | 'brand' | 'variant' | 'barcode'>,
): string {
  const detail = [product.brand, product.variant].filter(Boolean).join(' · ');
  return `${product.name}${detail ? ` · ${detail}` : ''}${product.barcode ? ` (${product.barcode})` : ''}`;
}

/**
 * What to ask the server when the box holds `text`. Once a suggestion is chosen the box holds its whole label
 * ("Gold Standard 100% Whey · Optimum Nutrition · 2 kg (748927052145)"), which no product contains as a phrase, so the
 * search uses the barcode in the brackets, or else the name before the first " · ". Plain typing is searched as typed.
 */
export function searchTermFor(text: string): string {
  const trimmed = text.trim();
  const barcode = /\(([A-Za-z0-9._-]{3,32})\)$/.exec(trimmed)?.[1];
  if (barcode) return barcode;
  return trimmed.split(' · ')[0] ?? trimmed;
}

/**
 * A box for choosing a product by typing a name OR scanning a barcode (journey J2).
 *
 * It uses the browser's own suggestion list (`<datalist>`), which is keyboard-operable and announced by screen readers
 * without any custom widget: the person types, matching products appear, they pick one. A barcode scanner types the
 * digits and presses Enter; Enter looks the exact barcode up and picks that product. Only ACTIVE products are offered.
 *
 * The parent owns the choice: `onPick` is called with the chosen product, or `null` when the text no longer matches one.
 * This component never decides what the product costs; it only finds it.
 *
 * @param ariaLabel the accessible name of the box (the parent's column or row label).
 */
export function ProductPicker({
  ariaLabel,
  placeholder,
  initialText = '',
  invalid = false,
  onPick,
  className,
}: {
  ariaLabel: string;
  placeholder?: string;
  initialText?: string;
  invalid?: boolean;
  onPick: (product: Product | null) => void;
  className?: string;
}) {
  const listId = useId();
  const [text, setText] = useState(initialText);
  const [debounced, setDebounced] = useState(initialText);

  // Wait for a pause in typing before searching, so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(searchTermFor(text)), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  const suggestions = useQuery({
    queryKey: ['products', 'picker', debounced],
    queryFn: () =>
      productsApi.listProducts(getBrowserApiClient(), {
        q: debounced,
        status: 'active',
        limit: 10,
      }),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  });
  const items = useMemo(() => suggestions.data?.items ?? [], [suggestions.data]);

  // The parent's callback changes on every render; keep the latest one without making the effect below re-run.
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });
  // Which product is currently chosen, so the same one is not announced twice.
  const pickedId = useRef<string | null>(null);

  const matchFor = (value: string): Product | undefined =>
    items.find((product) => productLabel(product) === value || product.barcode === value);

  const choose = (value: string) => {
    setText(value);
    const match = matchFor(value);
    pickedId.current = match?.id ?? null;
    onPick(match ?? null);
  };

  // The suggestions can arrive AFTER the text was typed or pasted (a full name pasted at once, a slow connection). When
  // they do, a text that now matches a product picks it, so the choice never depends on timing.
  useEffect(() => {
    const match = items.find((product) => productLabel(product) === text);
    if (match && pickedId.current !== match.id) {
      pickedId.current = match.id;
      onPickRef.current(match);
    }
  }, [items, text]);

  return (
    <>
      <Input
        value={text}
        list={listId}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        onChange={(event) => choose(event.target.value)}
        onKeyDown={async (event) => {
          if (event.key !== 'Enter') return;
          // A scanner ends with Enter: keep it from submitting the form, and look the barcode up exactly.
          event.preventDefault();
          const typed = text.trim();
          if (!typed || items.some((product) => productLabel(product) === typed)) return;
          try {
            const product = await productsApi.getProductByBarcode(getBrowserApiClient(), typed);
            setText(productLabel(product));
            pickedId.current = product.id;
            onPick(product);
          } catch (error) {
            // Not a barcode we know: leave the text so the person can keep typing a name.
            if (!(error instanceof ApiError)) throw error;
          }
        }}
      />
      <datalist id={listId}>
        {items.map((product) => (
          <option key={product.id} value={productLabel(product)} />
        ))}
      </datalist>
    </>
  );
}
