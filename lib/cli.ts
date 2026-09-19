/** Tiny flag parser. `--date 2026-09-18 --refresh --days 30`. */

export interface Flags {
  get(name: string): string | undefined;
  num(name: string, fallback: number): number;
  bool(name: string): boolean;
  list(name: string): string[] | undefined;
  positional: string[];
}

export function parseFlags(argv: string[] = process.argv.slice(2)): Flags {
  const values = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) {
      values.set(name!, inline);
    } else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) {
      values.set(name!, argv[++i]!);
    } else {
      values.set(name!, 'true');
    }
  }

  return {
    get: (name) => values.get(name),
    num: (name, fallback) => {
      const raw = values.get(name);
      const n = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(n) ? n : fallback;
    },
    bool: (name) => {
      const raw = values.get(name);
      return raw !== undefined && raw !== 'false' && raw !== '0';
    },
    list: (name) => values.get(name)?.split(',').map((s) => s.trim()).filter(Boolean),
    positional,
  };
}
