import sanitize from 'sanitize-html';
import { z } from 'zod';
import type { Block } from './types.js';
export const blockSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(['heading', 'text', 'button', 'image', 'divider', 'spacer']),
  content: z.string().max(10000),
  url: z.string().max(2000).optional(),
});
export const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => !/[\r\n]/.test(s)),
  blocks: z.array(blockSchema).min(1).max(50),
});
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function safeUrl(s: string) {
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
}
export function cleanHtml(html: string) {
  return sanitize(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'b',
      'i',
      'u',
      'h1',
      'h2',
      'h3',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'hr',
      'table',
      'tbody',
      'tr',
      'td',
      'div',
      'span',
      'img',
    ],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'width'], '*': ['style'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i],
        'text-align': [/^(left|center|right)$/],
        padding: [/^[0-9 px]+$/],
        'font-size': [/^[0-9]+px$/],
        'font-family': [/^[a-zA-Z ,'-]+$/],
        'border-radius': [/^[0-9]+px$/],
      },
    },
  });
}
export function variables(subject: string, blocks: Block[]) {
  return [
    ...new Set(
      (subject + ' ' + blocks.map((b) => b.content + ' ' + (b.url || '')).join(' '))
        .match(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)
        ?.map((v) => v.replace(/[{}\s]/g, '')) || [],
    ),
  ].sort();
}
export function renderTemplate(subject: string, blocks: Block[], values: Record<string, string>) {
  const names = variables(subject, blocks);
  for (const n of names)
    if (!Object.hasOwn(values, n) || !values[n].trim()) throw new Error(`Missing variable: ${n}`);
  const fill = (s: string) =>
    s.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_, n) => values[n]);
  const title = fill(subject);
  if (/[\r\n]/.test(title) || title.length > 200) throw new Error('Invalid rendered subject');
  const html = blocks
    .map((b) => {
      const c = escapeHtml(fill(b.content));
      const url = escapeHtml(safeUrl(fill(b.url || '')));
      switch (b.kind) {
        case 'heading':
          return `<h1 style="font-size:28px;color:#15171b">${c}</h1>`;
        case 'text':
          return `<p>${c.replace(/\n/g, '<br>')}</p>`;
        case 'button':
          if (!url) throw new Error('Button needs an HTTP(S) URL');
          return `<p><a href="${url}" style="background-color:#e07a3f;color:#15171b;padding:14px 24px;border-radius:8px">${c}</a></p>`;
        case 'image':
          if (!url) throw new Error('Image needs an HTTP(S) URL');
          return `<img src="${url}" alt="${c}" width="560">`;
        case 'divider':
          return '<hr>';
        case 'spacer':
          return '<p><br></p>';
      }
    })
    .join('');
  return {
    subject: title,
    html: `<div style="font-family:Arial, sans-serif;padding:24px">${html}</div>`,
    text: blocks
      .filter((b) => !['divider', 'spacer'].includes(b.kind))
      .map((b) => fill(b.content) + (b.url ? '\n' + fill(b.url) : ''))
      .join('\n\n'),
  };
}
export function previewDocument(html: string) {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:15px/1.6 system-ui;padding:20px;color:#24262b;background:#fff;overflow-wrap:anywhere}img{max-width:100%}a{color:#ad511f}</style></head><body>${cleanHtml(html)}</body></html>`;
}
