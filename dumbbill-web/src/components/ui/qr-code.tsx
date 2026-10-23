import { create } from 'qrcode';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';

/**
 * A QR code drawn as an inline SVG, made entirely in the browser.
 *
 * Why in the browser: the thing it carries (an authenticator-app setup link) contains a secret, so it must never be
 * sent to a third-party "QR image" service. The text is encoded here and never leaves the page.
 *
 * Colours: scanners need DARK squares on a LIGHT ground, whatever the page theme is, so this uses the two fixed
 * `qr-ink` / `qr-paper` tokens (identical in both themes) instead of the theme's text and surface colours. The light
 * border (the "quiet zone") is four squares wide, as the QR standard asks, and is part of the drawing.
 *
 * Accessibility: the picture is decoration for the scanner; `label` names it for screen readers, and the caller must
 * always offer the same information as typed text (the setup key) next to it.
 */
export interface QrCodeProps {
  /** The text to encode, for example an `otpauth://` link. */
  value: string;
  /** What a screen reader says for the picture. */
  label: string;
  className?: string;
}

/** Width of the light border around the squares, in squares (the QR standard asks for at least four). */
const QUIET_ZONE = 4;

export function QrCode({ value, label, className }: QrCodeProps) {
  const { size, path } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: 'M' });
    // One path for all dark squares keeps the drawing small: "M x y h1 v1 h-1 z" per square.
    let d = '';
    for (let row = 0; row < modules.size; row += 1) {
      for (let col = 0; col < modules.size; col += 1) {
        if (modules.get(row, col)) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { size: modules.size + QUIET_ZONE * 2, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('block aspect-square w-48 max-w-full', className)}
    >
      <rect width={size} height={size} className="fill-qr-paper" />
      <path d={path} className="fill-qr-ink" />
    </svg>
  );
}
