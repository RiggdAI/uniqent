import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

/**
 * Extensions of the markdown editor. Underline has no markdown form (html:false would drop it on
 * save), so it is not offered. Nothing is auto-linked: Tiptap 3's StarterKit ships Link, and
 * linkify/autolink would rewrite `AGENTS.md` or `ops@corp.com` into links in the saved markdown;
 * explicit `[text](url)` links still round-trip, and clicking one never opens a window.
 */
export const markdownExtensions = [
  StarterKit.configure({ underline: false, link: { autolink: false, openOnClick: false } }),
  Markdown.configure({ html: false, linkify: false }),
];
