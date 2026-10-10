import { ROLE_LABELS } from '@af/shared';
import {
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { BookOpen, Columns3, Eye, EyeOff, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Derived } from '@/lib/derive';
import { formatDate, formatSalary, locationLabel, milesLabel, studyWith } from '@/lib/format';
import { useSetHidden } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  ClosingBadge,
  GradeFitBadge,
  LevelBadge,
  MatchChip,
  NewDot,
  PreRegisterBadge,
} from './badges';
import { useOpenListing } from '@/lib/useOpenListing';
import { StatusSelect } from './StatusSelect';

const features = tableFeatures({ columnVisibilityFeature });
const helper = createColumnHelper<typeof features, Derived>();

function HideButton({ d }: { d: Derived }) {
  const setHidden = useSetHidden();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={d.row.hidden ? `Unhide ${d.row.title}` : `Hide ${d.row.title}`}
      onClick={(e) => {
        e.stopPropagation();
        setHidden(d.row.id, !d.row.hidden, { undo: true });
      }}
    >
      {d.row.hidden ? <Eye /> : <EyeOff />}
    </Button>
  );
}

const columns = helper.columns([
  helper.accessor((d) => d.score, {
    id: 'match',
    header: 'Match',
    enableHiding: false,
    cell: (c) => <MatchChip score={c.getValue()} />,
  }),
  helper.accessor((d) => d.row.title, {
    id: 'title',
    header: 'Apprenticeship',
    enableHiding: false,
    cell: (c) => {
      const d = c.row.original;
      return (
        <div className="max-w-[24rem] min-w-[14rem]">
          <div className="font-medium">{d.row.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {d.row.employer_name}
            {studyWith(d.row) && (
              <span className="inline-flex items-center gap-1">
                {d.row.university ? (
                  <GraduationCap className="size-3.5" aria-label="University" />
                ) : (
                  <BookOpen className="size-3.5" aria-label="Training provider" />
                )}
                {studyWith(d.row)!.name}
                {studyWith(d.row)!.rank && ` (${studyWith(d.row)!.rank})`}
              </span>
            )}
            {d.row.pre_register && <PreRegisterBadge />}
            {d.isNew && <NewDot />}
          </div>
        </div>
      );
    },
  }),
  helper.accessor((d) => locationLabel(d.row), {
    id: 'location',
    header: 'Location',
    cell: (c) => {
      const miles = milesLabel(c.row.original.distance);
      return (
        <span className="whitespace-nowrap">
          {c.getValue()}
          {miles && <span className="block text-xs text-muted-foreground">{miles}</span>}
        </span>
      );
    },
  }),
  helper.accessor((d) => d.row.level, {
    id: 'level',
    header: 'Level',
    cell: (c) => <LevelBadge level={c.getValue()} isDegree={c.row.original.row.is_degree} />,
  }),
  helper.accessor((d) => ROLE_LABELS[d.row.role_type], { id: 'role', header: 'Role' }),
  helper.accessor((d) => formatSalary(d.row), {
    id: 'salary',
    header: 'Salary',
    cell: (c) => <span className="whitespace-nowrap">{c.getValue() ?? '—'}</span>,
  }),
  helper.accessor((d) => d.row.closing_date, {
    id: 'closing',
    header: 'Closes',
    cell: (c) => (
      <span className="whitespace-nowrap">
        {formatDate(c.getValue())}
        <ClosingBadge days={c.row.original.daysToClose} className="block" />
      </span>
    ),
  }),
  helper.accessor((d) => d.row.posted_date ?? d.row.first_seen_at, {
    id: 'posted',
    header: 'Posted',
    cell: (c) => <span className="whitespace-nowrap">{formatDate(c.getValue())}</span>,
  }),
  helper.accessor((d) => d.row.entry?.summary ?? null, {
    id: 'grades',
    header: 'Grades needed',
    cell: (c) =>
      c.getValue() ? (
        <div className="grid max-w-[12rem] min-w-[8rem] justify-items-start gap-1">
          {c.getValue()}
          <GradeFitBadge fit={c.row.original.fit} />
        </div>
      ) : (
        <span className="text-muted-foreground" title="The advert doesn’t say">
          —
        </span>
      ),
  }),
  helper.display({
    id: 'status',
    header: 'Status',
    enableHiding: false,
    cell: (c) => <StatusSelect row={c.row.original.row} compact />,
  }),
  helper.display({
    id: 'actions',
    header: () => <span className="sr-only">Hide</span>,
    enableHiding: false,
    cell: (c) => <HideButton d={c.row.original} />,
  }),
]);

const COLUMN_LABELS: Record<string, string> = {
  location: 'Location',
  level: 'Level',
  role: 'Role',
  salary: 'Salary',
  closing: 'Closes',
  posted: 'Posted',
  grades: 'Grades needed',
};

export function ListingTable({ data }: { data: Derived[] }) {
  const open = useOpenListing();
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (d) => d.row.id,
    initialState: { columnVisibility: { posted: false, role: false } },
  });

  return (
    <div className="rounded-xl border">
      <div className="flex justify-end border-b px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Columns3 /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {table
              .getAllLeafColumns()
              .filter((col) => col.getCanHide())
              .map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {COLUMN_LABELS[col.id] ?? col.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className="px-3 py-2 font-medium whitespace-nowrap"
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => open(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) open(row.id);
                }}
                className={cn(
                  'cursor-pointer border-t align-top outline-none hover:bg-accent/40 focus-visible:bg-accent/60',
                  !row.original.row.is_active && 'opacity-60',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2.5">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
