import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

test('lesson Markdown renderer emits formatted text and KaTeX math', () => {
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] },
      '**重点** 和 $x^2$'
    )
  );

  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /class="katex/);
});
