import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  FileSearch,
  ScanSearch,
  Network,
  ShieldCheck,
  Search,
  FileText,
  MessageSquare,
} from 'lucide-react';

const STEPS = [
  {
    icon: FileSearch,
    title: 'Collect evidence',
    body: 'Paste an email with headers, upload a screenshot or offer letter, or drop a link. Every entity is extracted — sender, Reply-To, domains, phones, payment requests.',
  },
  {
    icon: ScanSearch,
    title: 'Six agents investigate',
    body: 'Specialist agents verify the company registry, domain age and DNS, search the public web, and a critic strikes any claim the tools cannot prove.',
  },
  {
    icon: Network,
    title: 'Match the network',
    body: 'Identifiers are checked against a graph of prior reports. Scammers rename brands — but reuse domains, phone numbers and wallets. That is how rings surface.',
  },
  {
    icon: MessageSquare,
    title: 'Ask the detective',
    body: 'Interrogate the verdict, inspect the proof behind each finding, dig deeper with more checks, or have it draft a safe reply to the recruiter.',
  },
];

export function Landing() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-grid">
        <div className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center sm:pt-28">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="eyebrow">Fraud intelligence platform</span>
            <h1 className="mx-auto mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
              Know if a job offer is real.
              <span className="block text-muted">Before you reply, before you pay.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted">
              Modern job scams use real company names and professional emails. The fraud hides in
              the relationships between evidence — so we investigate the recruiter, domain, phone
              and payment trail, and prove every finding.
            </p>
            <div className="mt-9 flex items-center justify-center gap-3">
              <Link to="/new" className="btn-primary">
                Start a verification <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/how-it-works" className="btn-ghost">
                How it works
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="surface p-6"
              >
                <div className="mb-4 flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="font-mono text-xs text-faint">0{i + 1}</span>
                </div>
                <h3 className="text-base font-semibold text-slate-100">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Network teaser */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="surface grid items-center gap-8 p-8 md:grid-cols-2 md:p-10">
          <div>
            <span className="eyebrow">Scam-intelligence network</span>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-white">
              Every report makes the next person safer.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Reports that share hard infrastructure — domains, phone numbers, payment handles —
              are linked into an entity graph and promoted to corroborated. New cases are matched
              semantically and structurally, even when every word has changed.
            </p>
            <Link to="/network" className="btn-ghost mt-6">
              Explore the network <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Network, label: 'Semantic matching' },
              { icon: ShieldCheck, label: 'Evidence-backed' },
              { icon: Search, label: 'Deep OSINT research' },
              { icon: FileText, label: 'Cited guidance' },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.label} className="surface-2 flex items-center gap-2.5 p-3.5">
                  <Icon className="h-4 w-4 text-accent" />
                  <span className="text-xs text-slate-300">{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
