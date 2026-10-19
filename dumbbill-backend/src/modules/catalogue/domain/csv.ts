/**
 * A small, strict CSV reader (RFC 4180), written here so the import has no hidden dependency to audit.
 *
 * Handles: quoted fields (so a comma or a line break can sit inside a value), "" for a quote inside quotes, both
 * Windows (CRLF) and Unix (LF) line ends, and the byte-order mark Excel puts at the start of a UTF-8 file.
 * A blank line is skipped. An unclosed quote is an error rather than silently swallowing the rest of the file.
 */

/** Thrown for a file that is not valid CSV (an unclosed quote). */
export class CsvFormatError extends Error {}

/** Split CSV text into rows of cells. Every cell is trimmed of surrounding spaces. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellWasQuoted = false;

  const endCell = (): void => {
    row.push(cellWasQuoted ? cell : cell.trim());
    cell = '';
    cellWasQuoted = false;
  };
  const endRow = (): void => {
    endCell();
    // A completely blank line is not a row.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.trim() === '') {
      inQuotes = true;
      cellWasQuoted = true;
      cell = '';
    } else if (char === ',') {
      endCell();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      endRow();
    } else {
      cell += char;
    }
  }
  if (inQuotes) throw new CsvFormatError('A quoted value is never closed.');
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
