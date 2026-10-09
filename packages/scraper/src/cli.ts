import { parseArgs } from 'node:util';
import { migrate } from './migrate.ts';
import { runDigest, sendFailureEmail } from './notify/digest.ts';
import { runScrape } from './run.ts';

const USAGE = `usage: cli <command> [options]

commands:
  scrape [--source faa ...] [--dry-run] [--record]   run sources, write listings to Supabase
  digest [--dry-run]                                  send the daily email (dry run writes logs/digest.html)
  notify-failure                                      email both of you that the workflow failed
  migrate [--dry-run]                                 apply supabase/migrations/*.sql
`;

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      'dry-run': { type: 'boolean', default: false },
      record: { type: 'boolean', default: false },
      source: { type: 'string', multiple: true },
    },
    allowPositionals: true,
  });
  const dryRun = values['dry-run'];
  // Workflow inputs arrive as one comma-separated string.
  const sources = values.source
    ?.flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  switch (command) {
    case 'scrape': {
      const summary = await runScrape({
        sources: sources?.length ? sources : undefined,
        dryRun,
        record: values.record,
      });
      return summary.status === 'failed' ? 1 : 0;
    }
    case 'digest':
      await runDigest({ dryRun });
      return 0;
    case 'notify-failure':
      await sendFailureEmail();
      return 0;
    case 'migrate':
      await migrate({ dryRun });
      return 0;
    default:
      console.error(USAGE);
      return command ? 2 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  },
);
