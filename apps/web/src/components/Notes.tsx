import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useAddNote, useDeleteNote, useNotes, type NoteTarget } from '@/lib/queries';

export function Notes({ target }: { target: NoteTarget }) {
  const { session } = useAuth();
  const { data: notes, isLoading } = useNotes(target);
  const add = useAddNote(target);
  const del = useDeleteNote(target);
  const [body, setBody] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    add.mutate(text, { onSuccess: () => setBody('') });
  }

  return (
    <section aria-labelledby="notes-heading" className="grid gap-3">
      <h3 id="notes-heading" className="font-semibold">
        Notes
      </h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : notes?.length ? (
        <ul className="grid gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-muted/60 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.author_name ?? 'Someone'}</span>
                <span>{formatDateTime(n.created_at)}</span>
                {n.author_id === session?.user.id && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto"
                    aria-label="Delete note"
                    onClick={() => del.mutate(n.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      )}
      <form onSubmit={onSubmit} className="grid gap-2">
        <label htmlFor="note-body" className="sr-only">
          Add a note
        </label>
        <Textarea
          id="note-body"
          placeholder="Add a note (deadlines, contacts, what to mention…). Tag #wrong if it's misclassified."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!body.trim() || add.isPending}
          className="justify-self-end"
        >
          {add.isPending ? 'Saving…' : 'Add note'}
        </Button>
      </form>
    </section>
  );
}
