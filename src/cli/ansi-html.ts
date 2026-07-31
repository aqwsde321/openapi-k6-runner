export type AnsiHtmlColor = 'grey' | 'cyan' | 'green' | 'yellow' | 'red';

export interface AnsiHtmlState {
  fg?: AnsiHtmlColor;
  bold: boolean;
  dim: boolean;
  pendingEscape: string;
}

export interface AnsiTextSegment {
  text: string;
  color?: AnsiHtmlColor;
  bold: boolean;
  dim: boolean;
}

export function createAnsiHtmlState(): AnsiHtmlState {
  return {
    bold: false,
    dim: false,
    pendingEscape: '',
  };
}

export function renderAnsiChunkToHtml(value: string, state: AnsiHtmlState = createAnsiHtmlState()): string {
  return parseAnsiChunk(value, state).map(wrapAnsiText).join('');
}

export function parseAnsiChunk(
  value: string,
  state: AnsiHtmlState = createAnsiHtmlState(),
): AnsiTextSegment[] {
  const text = `${state.pendingEscape}${value}`.replace(/\r/g, '');
  state.pendingEscape = '';

  const completeLength = takeCompleteAnsiTextLength(text);
  const completeText = text.slice(0, completeLength);
  state.pendingEscape = text.slice(completeLength);

  const pattern = /\u001b\[([0-9;]*)m/g;
  const segments: AnsiTextSegment[] = [];
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(completeText)) !== null) {
    pushAnsiText(segments, completeText.slice(index, match.index), state);
    applyAnsiCodes(match[1] ?? '', state);
    index = pattern.lastIndex;
  }

  pushAnsiText(segments, completeText.slice(index), state);
  return segments;
}

function takeCompleteAnsiTextLength(value: string): number {
  const escapeIndex = value.lastIndexOf('\u001b');

  if (escapeIndex < 0) {
    return value.length;
  }

  const tail = value.slice(escapeIndex);

  if (tail === '\u001b' || /^\u001b\[[0-9;]*$/.test(tail)) {
    return escapeIndex;
  }

  return value.length;
}

function wrapAnsiText(segment: AnsiTextSegment): string {
  const classes = [];

  if (segment.color !== undefined) {
    classes.push(`ansi-${segment.color}`);
  }

  if (segment.bold) {
    classes.push('ansi-bold');
  }

  if (segment.dim) {
    classes.push('ansi-dim');
  }

  const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
  return `<span${classAttr}>${escapeHtml(segment.text)}</span>`;
}

function pushAnsiText(
  segments: AnsiTextSegment[],
  text: string,
  state: AnsiHtmlState,
): void {
  if (text === '') return;
  segments.push({
    text,
    ...(state.fg === undefined ? {} : { color: state.fg }),
    bold: state.bold,
    dim: state.dim,
  });
}

function applyAnsiCodes(value: string, state: AnsiHtmlState): void {
  const codes = value === '' ? [0] : value.split(';').map((item) => Number(item || '0'));

  for (const code of codes) {
    if (code === 0) {
      state.fg = undefined;
      state.bold = false;
      state.dim = false;
      state.pendingEscape = '';
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 32) {
      state.fg = 'green';
    } else if (code === 33) {
      state.fg = 'yellow';
    } else if (code === 36) {
      state.fg = 'cyan';
    } else if (code === 39) {
      state.fg = undefined;
    } else if (code === 90) {
      state.fg = 'grey';
    } else if (code === 91) {
      state.fg = 'red';
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
