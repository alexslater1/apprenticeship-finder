import { parseSalary, type ListingEdits, type ListingRow } from '@af/shared';
import { Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatSalary } from '@/lib/format';
import { useEditListing } from '@/lib/queries';

type Row = Pick<
  ListingRow,
  'id' | 'salary_min' | 'salary_max' | 'salary_text' | 'closing_date' | 'start_date'
>;

const initial = (r: Row) => ({
  salary: r.salary_text ?? formatSalary(r) ?? '',
  closing: r.closing_date ?? '',
  start: r.start_date ?? '',
});

/** Fill in or correct what the advert says when the scrape missed it. Scrapes keep these. */
export function EditDetails({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => initial(r));
  const edit = useEditListing();

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const was = initial(r);
    const edits: ListingEdits = {};
    if (form.salary.trim() !== was.salary) {
      const text = form.salary.trim();
      const { min, max } = parseSalary(text);
      Object.assign(edits, { salary_text: text || null, salary_min: min, salary_max: max });
    }
    if (form.closing !== was.closing) edits.closing_date = form.closing || null;
    if (form.start !== was.start) edits.start_date = form.start || null;
    if (Object.keys(edits).length) edit.mutate({ id: r.id, edits });
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setForm(initial(r));
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground">
          <Pencil /> Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit details</DialogTitle>
            <DialogDescription>
              For when the advert gives these but they didn’t come through. The daily scrape keeps
              what you enter here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-salary">Salary</Label>
            <Input
              id="ed-salary"
              placeholder="e.g. £24,500 a year"
              value={form.salary}
              onChange={(e) => setForm({ ...form, salary: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ed-closing">Closes</Label>
              <Input
                id="ed-closing"
                type="date"
                value={form.closing}
                onChange={(e) => setForm({ ...form, closing: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ed-start">Starts</Label>
              <Input
                id="ed-start"
                type="date"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
