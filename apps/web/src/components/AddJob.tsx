import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { formatDate } from '@/lib/format';
import { useAddJob, useManualJobs, useRemoveJob, type ManualJob } from '@/lib/manualJobs';
import { useOpenListing } from '@/lib/useOpenListing';

const WORKFLOW_URL =
  'https://github.com/alexslater1/apprenticeship-finder/actions/workflows/scrape.yml';

function JobStatus({ job, onOpen }: { job: ManualJob; onOpen: (id: string) => void }) {
  if (job.listing_id)
    return (
      <span>
        <button
          type="button"
          onClick={() => onOpen(job.listing_id!)}
          className="text-primary underline-offset-2 hover:underline"
        >
          Open listing
        </button>
        {job.error && ' · couldn’t read the page, so fill in its details with Edit details'}
      </span>
    );
  if (!job.checked_at) return <span>Added {formatDate(job.created_at)}, read in the next run</span>;
  return <span>Couldn’t read the page: {job.error ?? 'no listing came of it'}</span>;
}

/** Paste a job advert's link; the next daily run reads it into a listing that's always shown. */
export function AddJob() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [employer, setEmployer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: jobs } = useManualJobs();
  const add = useAddJob();
  const remove = useRemoveJob();
  const openListing = useOpenListing();

  function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      setError('Paste the full address, starting with https://');
      return;
    }
    add.mutate(
      { url: parsed.toString(), title, employer },
      {
        onSuccess: () => {
          toast.success('Added', {
            description:
              'It becomes a listing in the next daily run. To read it now, run the workflow with “manual” as the source.',
            action: {
              label: 'Run now',
              onClick: () => window.open(WORKFLOW_URL, '_blank', 'noopener'),
            },
          });
          setUrl('');
          setTitle('');
          setEmployer('');
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus /> Add a job
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <form onSubmit={submit} className="grid gap-4">
          <SheetHeader>
            <SheetTitle>Add a job</SheetTitle>
            <SheetDescription>
              Paste the job advert’s link. The next daily run reads it into a listing, which stays
              on your list whatever Settings say. If the page can’t be read, the listing is made
              from what you type here.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="aj-url">Job link</Label>
              <Input
                id="aj-url"
                type="url"
                inputMode="url"
                required
                placeholder="https://careers.example.com/jobs/data-apprentice"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!!error}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="aj-title">Job title (optional)</Label>
              <Input id="aj-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="aj-employer">Company (optional)</Label>
              <Input
                id="aj-employer"
                value={employer}
                onChange={(e) => setEmployer(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={add.isPending} className="w-fit">
              {add.isPending ? 'Adding…' : 'Add job'}
            </Button>
          </div>
        </form>

        {!!jobs?.length && (
          <section className="grid gap-2 border-t p-4">
            <h3 className="font-semibold">Jobs you’ve added</h3>
            <ul className="grid gap-3">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <a
                      href={j.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium hover:underline"
                    >
                      {j.title || j.url}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {j.employer_name && `${j.employer_name} · `}
                      <JobStatus
                        job={j}
                        onOpen={(id) => {
                          setOpen(false);
                          openListing(id);
                        }}
                      />
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Take off the list"
                    title="Take off the list (its listing closes in the next run)"
                    onClick={() => remove.mutate(j.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}
