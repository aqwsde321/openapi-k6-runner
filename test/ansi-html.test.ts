import { describe, expect, it } from 'vitest';

import { createAnsiHtmlState, renderAnsiChunkToHtml } from '../src/cli/ansi-html.js';

describe('ANSI HTML renderer', () => {
  it('renders ANSI colors as escaped HTML spans', () => {
    const state = createAnsiHtmlState();

    expect(renderAnsiChunkToHtml('\u001b[32mPASS\u001b[0m <script>', state)).toBe(
      '<span class="ansi-green">PASS</span><span> &lt;script&gt;</span>',
    );
  });

  it('preserves ANSI state across chunks and resets it', () => {
    const state = createAnsiHtmlState();

    expect(renderAnsiChunkToHtml('\u001b[1;36mhttp://', state)).toBe(
      '<span class="ansi-cyan ansi-bold">http://</span>',
    );
    expect(renderAnsiChunkToHtml('example.test\u001b[0m plain', state)).toBe(
      '<span class="ansi-cyan ansi-bold">example.test</span><span> plain</span>',
    );
    expect(renderAnsiChunkToHtml(' next', state)).toBe('<span> next</span>');
  });

  it('buffers ANSI control sequences split across chunks', () => {
    const state = createAnsiHtmlState();

    expect(renderAnsiChunkToHtml('\u001b[', state)).toBe('');
    expect(renderAnsiChunkToHtml('32mPASS', state)).toBe('<span class="ansi-green">PASS</span>');
  });
});
