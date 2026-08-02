import type { TurboConfig } from './config';
import { linesInsideStrings, matchTurboLog } from './marker';

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
  // A `'''` block can hold something shaped exactly like a log; editing it would
  // rewrite the contents of a string rather than code.
  const inString = linesInsideStrings(lines);

  for (const [line, text] of lines.entries()) {
    if (inString[line]) {
      continue;
    }
    const parts = matchTurboLog(text, config);
    if (!parts) {
      continue;
    }

    const isCommented = parts.comment.length > 0;

    // Deleting takes the whole line, trailing comment included: the comment
    // annotates the log, so it has nothing left to say once the log is gone.
    if (mode === 'delete') {
      edits.push({ line });
      continue;
    }
    if (mode === 'comment' && !isCommented) {
      edits.push({
        line,
        text: `${parts.indent}// ${parts.statement}${parts.trailing}`,
      });
      continue;
    }
    if (mode === 'uncomment' && isCommented) {
      edits.push({
        line,
        text: `${parts.indent}${parts.statement}${parts.trailing}`,
      });
    }
  }

  return edits;
}
