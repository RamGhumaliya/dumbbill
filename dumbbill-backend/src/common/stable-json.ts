/**
 * JSON text with object keys in a fixed (alphabetical) order and no undefined values, so the SAME data always gives the
 * SAME text. Used wherever a fingerprint of data is needed: the idempotency key's request hash, and the audit hash chain.
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([name, inner]) => `${JSON.stringify(name)}:${stableJson(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
