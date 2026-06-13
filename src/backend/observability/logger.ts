type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[configuredLevel()];
}

function write(level: LogLevel, message: string): void {
  if (!shouldLog(level)) return;
  if (level === 'error') console.error(message);
  else if (level === 'warn') console.warn(message);
  else console.log(message);
}

export const logger = {
  debug: (message: string) => write('debug', message),
  info: (message: string) => write('info', message),
  warn: (message: string) => write('warn', message),
  error: (message: string) => write('error', message),
};
