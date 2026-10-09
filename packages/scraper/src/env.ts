import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Local runs read the repo-root .env; CI passes real env vars and has no file.
const envFile = `${REPO_ROOT}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(10),
  SUPABASE_DB_PASSWORD: optional,
  SUPABASE_DB_URL: optional,
  FAA_API_KEY: optional,
  SMTP_HOST: optional,
  SMTP_PORT: optional,
  SMTP_USER: optional,
  SMTP_PASS: optional,
  DIGEST_TO: optional,
  ADZUNA_APP_ID: optional,
  ADZUNA_APP_KEY: optional,
  REED_API_KEY: optional,
  SERPAPI_KEY: optional,
  TAVILY_API_KEY: optional,
  DASHBOARD_URL: z.string().default('https://alexslater1.github.io/apprenticeship-finder/'),
  GITHUB_EVENT_NAME: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Missing or invalid environment variables: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}
