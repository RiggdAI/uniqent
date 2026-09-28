import { useEffect } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Code, Quote } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '../../lib/utils';

// Tiptap 3 types extension storage through this interface; tiptap-markdown exports the shape
// but does not register it.
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

/**
 * A WYSIWYG editor whose source of truth is MARKDOWN. It renders rich text for editing but
 * loads/saves plain markdown (via tiptap-markdown, html:false) so persona.md / README.md travel
 * into the bundle as clean markdown — no HTML ever leaks into a target framework's files.
 */
function ToolBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // preventDefault keeps the editor selection when clicking a toolbar button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

export function RichEditor({
  value,
  onChange,
  testid,
}: {
  value: string;
  onChange: (markdown: string) => void;
  testid?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    // Underline has no markdown form (html:false would drop it on save), so it is not offered.
    extensions: [
      StarterKit.configure({ underline: false }),
      Markdown.configure({ html: false, linkify: true }),
    ],
    content: value,
    onUpdate: ({ editor }: { editor: Editor }) => onChange(editor.storage.markdown.getMarkdown()),
    editorProps: {
      attributes: {
        'data-testid': testid ?? '',
        class:
          'uq-rich-content uq-scroll min-h-[160px] max-h-[460px] overflow-auto px-3 py-2 text-sm leading-relaxed focus:outline-hidden',
      },
    },
  });

  // Sync when the markdown changes externally (preload from state, switching panels). Skip while
  // the editor is focused so normalization round-trips never yank the caret mid-typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (value !== editor.storage.markdown.getMarkdown())
      editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;
  return (
    <div className="rounded-md border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * Formatting buttons. Tiptap 3 no longer re-renders on every transaction, so the toolbar
 * subscribes to exactly the marks/nodes it shows — buttons follow the caret. Mounted only once
 * the editor exists (useEditor with immediatelyRender:false starts as null).
 */
function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
    }),
  });
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
      <ToolBtn
        icon={Bold}
        label="Bold"
        active={active.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolBtn
        icon={Italic}
        label="Italic"
        active={active.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolBtn
        icon={Heading1}
        label="Heading 1"
        active={active.h1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolBtn
        icon={Heading2}
        label="Heading 2"
        active={active.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolBtn
        icon={List}
        label="Bullet list"
        active={active.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolBtn
        icon={ListOrdered}
        label="Numbered list"
        active={active.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolBtn
        icon={Quote}
        label="Quote"
        active={active.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolBtn
        icon={Code}
        label="Code block"
        active={active.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
    </div>
  );
}
