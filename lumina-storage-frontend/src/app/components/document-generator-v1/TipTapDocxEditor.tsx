// @ts-nocheck
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Heading1, Heading2, Undo2, Redo2 } from 'lucide-react';

// Preserve `style` and `class` attributes on block-level nodes (paragraph, heading,
// table cells, lists, etc.). Without this, TipTap strips all inline CSS from mammoth's
// HTML output on first load, breaking the document's visual appearance even for edits
// that don't touch formatting at all.
const PreserveBlockAttrs = Extension.create({
  name: 'preserveBlockAttrs',
  addGlobalAttributes() {
    return [{
      types: [
        'paragraph', 'heading',
        'bulletList', 'orderedList', 'listItem',
        'table', 'tableRow', 'tableCell', 'tableHeader',
        'blockquote',
      ],
      attributes: {
        style: {
          default: null,
          parseHTML: el => el.getAttribute('style') || null,
          renderHTML: attrs => attrs.style ? { style: attrs.style } : {},
        },
        class: {
          default: null,
          parseHTML: el => el.getAttribute('class') || null,
          renderHTML: attrs => attrs.class ? { class: attrs.class } : {},
        },
      },
    }];
  },
});

// Preserve <span style="..."> for character-level formatting (font-family, font-size,
// color, etc.) that mammoth encodes as inline spans. TipTap has no built-in mark for
// arbitrary span styles — without this, all character-level CSS is dropped.
const StyledSpan = Mark.create({
  name: 'styledSpan',
  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: el => el.getAttribute('style') || null,
        renderHTML: attrs => attrs.style ? { style: attrs.style } : {},
      },
      class: {
        default: null,
        parseHTML: el => el.getAttribute('class') || null,
        renderHTML: attrs => attrs.class ? { class: attrs.class } : {},
      },
    };
  },
  parseHTML() {
    // Only match spans that carry a style or class — leave plain <span> to other marks
    return [
      { tag: 'span[style]' },
      { tag: 'span[class]' },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});
import { ScrollArea } from '@/app/components/ui/scroll-area';

export function TipTapDocxEditor({
  initialHtml,
  onChange,
}: {
  initialHtml: string;
  onChange?: (html: string) => void;
}) {
  const { t } = useTranslation();
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      PreserveBlockAttrs,
      StyledSpan,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml || '<p></p>',
    editorProps: {
      attributes: { class: 'docx-html-preview focus:outline-none min-h-[560px]' },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if ((initialHtml || '<p></p>') !== current) {
      editor.commands.setContent(initialHtml || '<p></p>', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml, editor]);

  if (!editor) return null;

  const Btn = ({ active, onClick, disabled, children, title }: any) => (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`h-7 w-7 inline-flex items-center justify-center rounded text-xs transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border bg-card flex-shrink-0">
        <Btn title={t('generatorV1.tiptap.undoTitle')} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo2 className="w-3.5 h-3.5" />
        </Btn>
        <Btn title={t('generatorV1.tiptap.redoTitle')} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo2 className="w-3.5 h-3.5" />
        </Btn>
        <span className="w-px h-4 bg-border mx-1" />
        <Btn title={t('generatorV1.tiptap.boldTitle')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" />
        </Btn>
        <Btn title={t('generatorV1.tiptap.italicTitle')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="w-3.5 h-3.5" />
        </Btn>
        <Btn title={t('generatorV1.tiptap.underlineTitle')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="w-3.5 h-3.5" />
        </Btn>
        <span className="w-px h-4 bg-border mx-1" />
        <Btn title={t('generatorV1.tiptap.heading1Title')} active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="w-3.5 h-3.5" />
        </Btn>
        <Btn title={t('generatorV1.tiptap.heading2Title')} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="w-3.5 h-3.5" />
        </Btn>
        <span className="w-px h-4 bg-border mx-1" />
        <Btn title={t('generatorV1.tiptap.bulletListTitle')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="w-3.5 h-3.5" />
        </Btn>
        <Btn title={t('generatorV1.tiptap.orderedListTitle')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="w-3.5 h-3.5" />
        </Btn>
        <span className="ml-auto text-[10px] text-muted-foreground">{t('generatorV1.tiptap.editorHint')}</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className="bg-white border border-border rounded-lg shadow-sm ring-2 ring-primary/15 p-10 max-w-3xl mx-auto min-h-[600px]">
            <EditorContent editor={editor} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
