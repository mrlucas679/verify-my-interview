// Client-side evidence preview scanning. The REAL parsing/redaction happens
// server-side; these bounded regexes exist only so the composer can visibly
// "understand" pasted text (chip by chip) and pre-fill a community report. All
// loops are length-capped (never scan more than the server accepts).

const SCAN_CAP = 20_000;
const CHIP_CAP = 4; // per kind

export interface DetectedEntity {
  kind: 'email' | 'link' | 'phone' | 'amount';
  value: string;
}

function dedupeCap(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values.slice(0, 40)) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
      if (out.length >= CHIP_CAP) break;
    }
  }
  return out;
}

export function detectEntities(raw: string): DetectedEntity[] {
  const text = raw.slice(0, SCAN_CAP);
  if (!text.trim()) return [];
  const emails = dedupeCap(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []);
  const links = dedupeCap(
    (text.match(/\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+/gi) ?? []).map((u) =>
      u.replace(/[.,;]$/, '')
    )
  );
  const phones = dedupeCap(
    (text.match(/\+?\d[\d\s().-]{7,16}\d/g) ?? []).filter((p) => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 15;
    })
  );
  const amounts = dedupeCap(text.match(/\b(?:R|ZAR|\$|USD)\s?\d[\d,\s.]{0,11}\d?\b/g) ?? []);

  const chips: DetectedEntity[] = [
    ...emails.map((value): DetectedEntity => ({ kind: 'email', value })),
    ...links.map((value): DetectedEntity => ({ kind: 'link', value })),
    ...phones.map((value): DetectedEntity => ({ kind: 'phone', value })),
    ...amounts.map((value): DetectedEntity => ({ kind: 'amount', value })),
  ];
  return chips.slice(0, 10);
}

/** Pre-fill scam IOCs for a community report payload (server re-validates + redacts). */
export function extractReportIOCs(raw: string): { emails: string[]; domains: string[]; phones: string[] } {
  const text = raw.slice(0, SCAN_CAP);
  const lower = (xs: string[]) => Array.from(new Set(xs.map((x) => x.toLowerCase())));
  const emails = lower(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []);
  const hosts: string[] = [];
  for (const u of text.match(/\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+/gi) ?? []) {
    try {
      hosts.push(new URL(u.startsWith('http') ? u : `https://${u}`).hostname);
    } catch {
      /* skip malformed url */
    }
  }
  const domains = lower([...emails.map((e) => e.split('@')[1] ?? ''), ...hosts].filter(Boolean));
  const phones = Array.from(
    new Set(
      (text.match(/\+?\d[\d\s().-]{7,16}\d/g) ?? [])
        .map((p) => p.trim())
        .filter((p) => {
          const d = p.replace(/\D/g, '');
          return d.length >= 9 && d.length <= 15;
        })
        .filter((p) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(p.replace(/\s/g, '')))
    )
  );
  return { emails: emails.slice(0, 20), domains: domains.slice(0, 20), phones: phones.slice(0, 20) };
}

/** Heuristic: does the text read like the scam ALREADY happened to the writer?
 *  Used only to surface a non-blocking "report this" suggestion — never to route. */
export function looksLikeVictimReport(raw: string): boolean {
  const t = raw.toLowerCase();
  if (t.length < 12) return false;
  return /\b(i (already )?(paid|sent|transferred|deposited)|lost (my )?money|got scammed|was scammed|they took|sent my (id|bank|card)|after i paid)\b/.test(
    t
  );
}
