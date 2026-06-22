import { Link } from 'react-router-dom';
import { FileText, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

function LegalShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-ink-900">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
        <div className="mt-6 space-y-6 text-sm leading-relaxed text-muted">{children}</div>
        <Link to="/" className="btn-ghost mt-8 px-3 py-2 text-xs">
          Back to workspace
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold text-slate-100">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrivacyNotice() {
  return (
    <LegalShell eyebrow="Privacy" title="Privacy notice">
      <Section title="What we process">
        <p>
          Verify My Interview checks job posts, recruiter messages, links, screenshots, PDFs, emails, voice transcripts,
          and scam reports that you submit.
        </p>
      </Section>

      <Section title="What we store">
        <BulletList
          items={[
            'Anonymous checks are processed for the investigation response and are not saved as account history.',
            'Signed-in users can reopen redacted case snapshots from History.',
            'Original files are stored only when a signed-in user enables evidence retention.',
            'Public scam reports are de-identified before they enter the community intelligence corpus.',
          ]}
        />
      </Section>

      <Section title="What we remove">
        <p>
          South African ID numbers, bank account numbers, and payment-card numbers are redacted at the boundary. Scam
          indicators such as domains, emails, phone numbers, URLs, and payment handles are preserved because they are
          needed to detect fraud patterns.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <BulletList
          items={[
            'Consented evidence files and account case history are retained for up to 12 months unless you erase your account earlier.',
            'Content-free audit logs are kept for operational abuse monitoring and do not include evidence text.',
            'Delete account removes your account, cases, usage records, and stored evidence files.',
            'De-identified community reports may remain for fraud-prevention and public-safety purposes.',
          ]}
        />
      </Section>

      <div className="surface-2 flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <p>
          Do not submit unnecessary identity documents, banking details, passwords, one-time PINs, or private personal
          information. Submit only the evidence needed to check the opportunity.
        </p>
      </div>
    </LegalShell>
  );
}

export function TermsNotice() {
  return (
    <LegalShell eyebrow="Terms" title="Use terms">
      <Section title="Risk assessment, not a final finding">
        <p>
          Verify My Interview provides evidence-backed risk assessment for job and interview opportunities. A result is
          not a legal finding, a final accusation of fraud, or a guarantee that an opportunity is safe.
        </p>
      </Section>

      <Section title="How to use a result">
        <BulletList
          items={[
            'Confirm roles through the company’s official website or published switchboard before sharing sensitive information.',
            'Do not send money, banking details, passwords, or one-time PINs to recruiters.',
            'Keep copies of messages, links, payment requests, and contact details if you believe you were targeted.',
            'Report confirmed fraud to the appropriate platform, bank, employer, or law-enforcement channel.',
          ]}
        />
      </Section>

      <Section title="Service limits">
        <p>
          External services such as web search, OCR, speech transcription, company lookup, and Foundry agents may be
          unavailable or rate-limited. When that happens, the app degrades to the evidence it can safely verify.
        </p>
      </Section>

      <div className="surface-2 flex items-start gap-3 p-4">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <p>
          Use the product responsibly. Do not submit evidence to test how to bypass detection or to harass real
          companies, recruiters, or candidates.
        </p>
      </div>
    </LegalShell>
  );
}
