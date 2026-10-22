import { useEffect, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Underline, List, ListOrdered, Heading2, Link2, Undo2, Redo2, Unlink } from 'lucide-react';
import { cn } from '@/lib/format';
import { Button } from '@/components/ui/Button';

export function EmailEditor({ value, onChange, variables, disabled }: { value: string; onChange: (html: string) => void; variables: string[]; disabled: boolean }) {
  const [showLink, setShowLink] = useState(false);
  const [url, setUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false,
      link: { openOnClick: false, autolink: false, defaultProtocol: 'https' } })],
    content: value, editable: !disabled,
    editorProps: { attributes: { class: 'email-editor-content', role: 'textbox', 'aria-label': 'Isi template email', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  const state = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive('bold'), italic: editor?.isActive('italic'), underline: editor?.isActive('underline'), heading: editor?.isActive('heading', { level: 2 }), bullet: editor?.isActive('bulletList'), ordered: editor?.isActive('orderedList'), link: editor?.isActive('link'), undo: editor?.can().undo(), redo: editor?.can().redo() }) });
  useEffect(() => { if (editor && editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false }); }, [editor, value]);
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  if (!editor) return <p>Memuat editor...</p>;
  const actions = [
    { label: 'Tebal', icon: Bold, active: state?.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Miring', icon: Italic, active: state?.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Garis bawah', icon: Underline, active: state?.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Judul', icon: Heading2, active: state?.heading, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Daftar poin', icon: List, active: state?.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Daftar nomor', icon: ListOrdered, active: state?.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'Tautan', icon: Link2, active: state?.link, run: () => { setUrl(editor.getAttributes('link').href || 'https://'); setShowLink(!showLink); setLinkError(''); } },
    { label: 'Hapus tautan', icon: Unlink, active: false, run: () => editor.chain().focus().unsetLink().run(), unavailable: !state?.link },
    { label: 'Urungkan', icon: Undo2, active: false, run: () => editor.chain().focus().undo().run(), unavailable: !state?.undo },
    { label: 'Ulangi', icon: Redo2, active: false, run: () => editor.chain().focus().redo().run(), unavailable: !state?.redo },
  ];
  function applyLink() {
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/i.test(url)) { setLinkError('Isi URL http/https atau mailto yang valid.'); return; }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); setShowLink(false);
  }
  return <div className="space-y-3">
    <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-700">
      <div role="toolbar" aria-label="Format email" className="flex flex-wrap gap-1 border-b border-ink-200 bg-ink-50 p-2 dark:border-ink-700 dark:bg-ink-900">
        {actions.map(({ label, icon: Icon, active, run, unavailable }) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={!!active} disabled={disabled || unavailable} onClick={run} className={cn('grid h-10 w-10 place-items-center rounded-lg disabled:opacity-30', active ? 'bg-brand-100 text-brand-700' : 'hover:bg-ink-200 dark:hover:bg-ink-700')}><Icon size={17} /></button>)}
      </div>
      {showLink && <div className="space-y-2 border-b border-ink-200 p-3"><label htmlFor="email-link-url" className="text-sm">URL tautan</label><div className="flex flex-wrap gap-2"><input id="email-link-url" className="input min-w-0 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} disabled={disabled} /><Button type="button" disabled={disabled} onClick={applyLink}>Terapkan tautan</Button></div>{linkError && <p role="alert" className="text-sm text-rose-600">{linkError}</p>}</div>}
      <EditorContent editor={editor} />
    </div>
    <div><p className="mb-2 text-xs text-ink-500">Klik variabel untuk menyisipkan ke posisi kursor.</p><div className="flex flex-wrap gap-2">{variables.map((name) => <button key={name} type="button" disabled={disabled} onClick={() => editor.chain().focus().insertContent({ type: 'text', text: `{${name}}` }).run()} className="rounded-md bg-ink-100 px-2 py-1.5 font-mono text-xs hover:bg-brand-100 dark:bg-ink-800">{`{${name}}`}</button>)}</div></div>
  </div>;
}
