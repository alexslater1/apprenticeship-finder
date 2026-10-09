import { appendFileSync, mkdirSync } from 'node:fs';
import { REPO_ROOT } from './env.ts';

const LOG_DIR = `${REPO_ROOT}logs/`;
let logFile: string | undefined;

export function startLogFile(name: string): void {
  mkdirSync(LOG_DIR, { recursive: true });
  logFile = `${LOG_DIR}${name}`;
}

function write(level: string, scope: string, msg: string): void {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${msg}`;
  (level === 'ERROR' || level === 'WARN' ? console.error : console.log)(line);
  if (logFile) appendFileSync(logFile, line + '\n');
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  child(scope: string): Logger;
}

export function logger(scope = 'main'): Logger {
  return {
    info: (m) => write('INFO', scope, m),
    warn: (m) => write('WARN', scope, m),
    error: (m) => write('ERROR', scope, m),
    child: (s) => logger(`${scope}:${s}`),
  };
}
