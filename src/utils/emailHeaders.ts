// Raw email (RFC-822) header analysis.
//
// When a user pastes a full email including headers, the headers carry signals
// the body never shows: a Reply-To pointing somewhere else, SPF/DKIM/DMARC
// failures, a free-mail sender behind a corporate display name, and the
// originating IP. Hand-rolled (no deps): we only need a handful of fields and
// the input is untrusted, so a small strict parser beats a full MIME library.

export interface EmailHeaderAnalysis {
  /** True when the input looks like a raw email with a header block. */
  isRawEmail: boolean;
  fromAddress?: string;
  fromDisplayName?: string;
  fromDomain?: string;
  replyToAddress?: string;
  replyToDomain?: string;
  /** From and Reply-To resolve to different domains. */
  replyToMismatch: boolean;
  /** First public IPv4 found walking the Received: chain bottom-up. */
  senderIp?: string;
  /** Results parsed from Authentication-Results, when present. */
  spf?: 'pass' | 'fail' | 'softfail' | 'none' | 'neutral';
  dkim?: 'pass' | 'fail' | 'none';
  dmarc?: 'pass' | 'fail' | 'none';
  /** From is a free-mail provider (gmail/outlook/...) — suspicious for corporate recruiting. */
  freeMailFrom: boolean;
  subject?: string;
}

const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'ymail.com',
  'aol.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'zoho.com',
]);

const HEADER_NAMES = /^(from|to|reply-to|subject|date|received|return-path|message-id|authentication-results|received-spf|dkim-signature|mime-version|content-type|cc|bcc|x-[a-z0-9-]+):/i;

/** Quick check: does this text begin with an email header block? */
export function looksLikeRawEmail(text: string): boolean {
  if (!text) return false;
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 40);
  let headerLines = 0;
  for (const line of head) {
    if (line.trim() === '') break; // header block ends at first blank line
    if (HEADER_NAMES.test(line.trim()) || /^[ \t]/.test(line)) headerLines++;
  }
  // Require From: plus at least two other header-ish lines to avoid false hits
  return headerLines >= 3 && /^from:/im.test(head.join('\n'));
}

/** Unfold the header block (continuation lines start with whitespace) into name->values. */
function parseHeaderBlock(text: string): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  const lines = text.split(/\r?\n/);
  let currentName = '';
  let currentValue = '';

  const commit = () => {
    if (!currentName) return;
    const key = currentName.toLowerCase();
    const list = headers.get(key) ?? [];
    list.push(currentValue.trim());
    headers.set(key, list);
  };

  for (const line of lines) {
    if (line.trim() === '') break; // end of header block
    if (/^[ \t]/.test(line) && currentName) {
      currentValue += ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([A-Za-z0-9-]+):\s?(.*)$/);
    if (!m) break; // malformed line — stop, body probably started
    commit();
    currentName = m[1];
    currentValue = m[2];
  }
  commit();
  return headers;
}

/** Pull "Display Name <addr@domain>" apart; tolerates bare addresses. */
function parseAddress(value?: string): { address?: string; displayName?: string } {
  if (!value) return {};
  const angled = value.match(/^\s*"?([^"<]*)"?\s*<([^>\s]+@[^>\s]+)>/);
  if (angled) {
    return { displayName: angled[1].trim() || undefined, address: angled[2].toLowerCase() };
  }
  const bare = value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return bare ? { address: bare[0].toLowerCase() } : {};
}

function domainOf(address?: string): string | undefined {
  const m = address?.match(/@([^\s>]+)/);
  return m ? m[1].toLowerCase() : undefined;
}

function isPrivateIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^127\./.test(ip) ||
    /^169\.254\./.test(ip)
  );
}

/** Walk Received: headers bottom-up (origin first) for the first public IPv4. */
function extractSenderIp(received: string[]): string | undefined {
  for (let i = received.length - 1; i >= 0; i--) {
    const ips = received[i].match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g) || [];
    const pub = ips.find((ip) => !isPrivateIp(ip));
    if (pub) return pub;
  }
  return undefined;
}

function authResult(
  auth: string,
  mechanism: 'spf' | 'dkim' | 'dmarc'
): EmailHeaderAnalysis['spf'] {
  const m = auth.match(new RegExp(`${mechanism}\\s*=\\s*(pass|fail|softfail|none|neutral)`, 'i'));
  return m ? (m[1].toLowerCase() as EmailHeaderAnalysis['spf']) : undefined;
}

export function analyzeEmailHeaders(text: string): EmailHeaderAnalysis {
  const none: EmailHeaderAnalysis = { isRawEmail: false, replyToMismatch: false, freeMailFrom: false };
  if (!looksLikeRawEmail(text)) return none;

  const headers = parseHeaderBlock(text);
  const from = parseAddress(headers.get('from')?.[0]);
  const replyTo = parseAddress(headers.get('reply-to')?.[0]);
  const fromDomain = domainOf(from.address);
  const replyToDomain = domainOf(replyTo.address);

  const auth = (headers.get('authentication-results') ?? []).join(' ');
  const receivedSpf = headers.get('received-spf')?.[0] ?? '';

  const spf =
    authResult(auth, 'spf') ??
    (receivedSpf.match(/^(pass|fail|softfail|none|neutral)/i)?.[1].toLowerCase() as
      | EmailHeaderAnalysis['spf']
      | undefined);

  return {
    isRawEmail: true,
    fromAddress: from.address,
    fromDisplayName: from.displayName,
    fromDomain,
    replyToAddress: replyTo.address,
    replyToDomain,
    replyToMismatch: Boolean(fromDomain && replyToDomain && fromDomain !== replyToDomain),
    senderIp: extractSenderIp(headers.get('received') ?? []),
    spf,
    dkim: authResult(auth, 'dkim') as EmailHeaderAnalysis['dkim'],
    dmarc: authResult(auth, 'dmarc') as EmailHeaderAnalysis['dmarc'],
    freeMailFrom: Boolean(fromDomain && FREE_MAIL.has(fromDomain)),
    subject: headers.get('subject')?.[0],
  };
}
