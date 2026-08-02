import type { TurboConfig } from './config';
import { matchTurboLog } from './marker';

export type BulkMode = 'comment' | 'uncomment' | 'delete';

export interface LineEdit {
  /** Zero-based line to change. */
  line: number;
  /** Replacement text, or `undefined` to remove the line entirely. */
  text?: string;
}

/**
 * Plans the edits a bulk command should make, touching only turbo logs.
 *
 * Returns per-line edits rather than a rewritten document: replacing the whole
 * document collapses undo to one step and resets cursor, selection and folding,
 * which is what the previous implementation did.
 *
 * Lines that need no change produce no edit, so commenting an already-commented
 * log is a no-op rather than a second `//`.
 */
export function planBulkEdits(
  lines: readonly string[],
  config: TurboConfig,
  mode: BulkMode,
): LineEdit[] {
  const edits: LineEdit[] = [];

  for (const [line, text] of lines.entries()) {
    const parts = matchTurboLog(text, config);
    if (!parts) {
      continue;
    }

    const isCommented = parts.comment.length > 0;

    if (mode === 'delete') {
      edits.push({ line });
      continue;
    }
    if (mode === 'comment' && !isCommented) {
      edits.push({ line, text: `${parts.indent}// ${parts.statement}` });
      continue;
    }
    if (mode === 'uncomment' && isCommented) {
      edits.push({ line, text: `${parts.indent}${parts.statement}` });
    }
  }

  return edits;
}
