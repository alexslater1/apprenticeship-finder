import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useAddCompany } from '@/lib/companies';

const WORKFLOW_URL =
  'https://github.com/alexslater1/apprenticeship-finder/actions/workflows/scrape.yml';

/** Paste a careers or job URL; the next daily run works out its job platform and watches it. */
export function AddCompany() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useAddCompany();

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
      { url: parsed.toString(), name, note },
      {
        onSuccess: () => {
          toast.success('Added', {
            description: 'It will be checked in the next daily run.',
            action: {
              label: 'Run now',
              onClick: () => window.open(WORKFLOW_URL, '_blank', 'noopener'),
            },
          });
          setUrl('');
          setName('');
          setNote('');
          setOpen(false);
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus /> Add company
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <form onSubmit={submit} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>Add a company</SheetTitle>
            <SheetDescription>
              Paste its careers page or any job advert. The next daily run finds its job system and
              starts watching it.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ac-url">Careers or job link</Label>
              <Input
                id="ac-url"
                type="url"
                inputMode="url"
                required
                placeholder="https://careers.example.com/early-careers"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!!error}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-name">Company name (optional)</Label>
              <Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-note">Note (optional)</Label>
              <Textarea
                id="ac-note"
                rows={3}
                placeholder="e.g. their data apprenticeship opens in January"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="mt-auto">
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add company'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
