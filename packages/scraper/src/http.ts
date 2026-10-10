import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import robotsParser from 'robots-parser';
import { REPO_ROOT } from './env.ts';

export const USER_AGENT =
  'apprenticeship-finder/0.1 (+https://github.com/alexslater1/apprenticeship-finder; personal non-commercial)';

/** Strip credentials from URLs before they reach logs, run stats or data/last-run.json. */
export function redactUrl(url: string): string {
  return url.replace(
    /([?&](?:app_key|app_id|api_key|apikey|key|token|access_token)=)[^&#\s]+/gi,
    '$1…',
  );
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} for ${redactUrl(url)}: ${body.slice(0, 200)}`);
  }
}

/** A bot wall / challenge page. The pipeline records "blocked", never "0 jobs". */
export class BlockedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Blocked at ${redactUrl(url)}: ${reason}`);
  }
}

const BOT_WALL = [
  /Quick check needed/i,
  /Just a moment\.\.\./i,
  /cf-chl-|challenge-platform/i,
  /altcha/i,
  /Access Denied.*Reference #/is,
  /Request unsuccessful\. Incapsula/i,
];

export function detectBotWall(body: string, headers: Headers): string | null {
  if (headers.get('cf-mitigated') === 'challenge') return 'cf-mitigated: challenge';
  // Only sniff smallish HTML bodies; real job pages can mention these words.
  if (body.length > 200_000) return null;
  for (const re of BOT_WALL) if (re.test(body)) return `matched ${re.source}`;
  return null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  /** Respect robots.txt for this request (default true for HTML scraping, false for APIs). */
  robots?: boolean;
  timeoutMs?: number;
  retries?: number;
  /** 'manual' hands back 3xx responses (read the `location` header) instead of following them. */
  redirect?: 'follow' | 'manual';
  /** Keep the body as bytes (PDFs); `body` is then only filled for text replies. */
  binary?: boolean;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Headers;
  bytes?: Buffer;
}

const DEFAULT_GAP_MS = 1500;
const HOST_GAPS: Array<[RegExp, number]> = [
  [/\.tal\.net$/, 10_000],
  [/\.csod\.com$/, 10_000],
  [/^api\.apprenticeships\.education\.gov\.uk$/, 2_000],
  [/^api\.postcodes\.io$/, 200],
  [/^api\.adzuna\.com$/, 3_000], // 25 hits/minute limit
];

function gapFor(host: string): number {
  for (const [re, ms] of HOST_GAPS) if (re.test(host)) return ms;
  return DEFAULT_GAP_MS;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polite fetch: honest UA, timeout, retries on 5xx/network only, one request at a time per host
 * with a minimum gap, optional robots.txt check, bot-wall detection, and fixture recording.
 */
export class Http {
  private hostChains = new Map<string, Promise<unknown>>();
  private lastAt = new Map<string, number>();
  private robotsCache = new Map<string, Promise<ReturnType<typeof robotsParser> | null>>();
  requests = 0;

  constructor(private readonly opts: { record?: boolean } = {}) {}

  async json<T>(url: string, o: RequestOptions = {}): Promise<T> {
    const res = await this.request(url, {
      ...o,
      headers: { Accept: 'application/json', ...o.headers },
    });
    return JSON.parse(res.body) as T;
  }

  async text(url: string, o: RequestOptions = {}): Promise<string> {
    return (await this.request(url, o)).body;
  }

  /** Download a file as bytes. A text/HTML reply (bot wall, error page) is still sniffed. */
  async bytes(url: string, o: RequestOptions = {}): Promise<Buffer> {
    return (await this.request(url, { ...o, binary: true })).bytes ?? Buffer.alloc(0);
  }

  async request(url: string, o: RequestOptions = {}): Promise<HttpResponse> {
    const host = new URL(url).hostname;
    if (o.robots && !(await this.allowedByRobots(url))) {
      throw new BlockedError(url, 'disallowed by robots.txt');
    }
    // Serialise per host.
    const prev = this.hostChains.get(host) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.doRequest(url, host, o));
    this.hostChains.set(host, run);
    return run;
  }

  private async doRequest(url: string, host: string, o: RequestOptions): Promise<HttpResponse> {
    const retries = o.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const wait = (this.lastAt.get(host) ?? 0) + gapFor(host) - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastAt.set(host, Date.now());
      this.requests++;
      try {
        const res = await fetch(url, {
          method: o.method ?? 'GET',
          headers: { 'User-Agent': USER_AGENT, ...o.headers },
          body: o.body,
          signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
          redirect: o.redirect ?? 'follow',
        });
        const bytes = o.binary ? Buffer.from(await res.arrayBuffer()) : undefined;
        const textual = /text|html|json|xml/i.test(res.headers.get('content-type') ?? '');
        const body = bytes ? (textual ? bytes.toString('utf8') : '') : await res.text();
        if (res.status >= 500 && attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        const wall = detectBotWall(body, res.headers);
        if (
          wall &&
          (res.status === 403 || res.status === 429 || res.status === 503 || body.length < 50_000)
        ) {
          throw new BlockedError(url, wall);
        }
        if (res.status === 403 || res.status === 429) throw new HttpError(res.status, url, body);
        const redirected = o.redirect === 'manual' && res.status >= 300 && res.status < 400;
        if (!res.ok && !redirected) throw new HttpError(res.status, url, body);
        if (this.opts.record) this.record(url, bytes ?? body);
        return { status: res.status, body, headers: res.headers, bytes };
      } catch (err) {
        const retryable =
          !(err instanceof HttpError) && !(err instanceof BlockedError) && attempt < retries;
        if (!retryable) throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  private allowedByRobots(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    let p = this.robotsCache.get(origin);
    if (!p) {
      p = fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      })
        .then(async (r) => (r.ok ? robotsParser(`${origin}/robots.txt`, await r.text()) : null))
        .catch(() => null);
      this.robotsCache.set(origin, p);
    }
    return p.then((robots) => (robots ? robots.isAllowed(url, USER_AGENT) !== false : true));
  }

  private record(url: string, body: string | Buffer) {
    const dir = `${REPO_ROOT}packages/scraper/test/fixtures/recorded/`;
    mkdirSync(dir, { recursive: true });
    const name = `${new URL(url).hostname}-${createHash('sha1').update(url).digest('hex').slice(0, 10)}.raw`;
    writeFileSync(dir + name, body);
  }
}
