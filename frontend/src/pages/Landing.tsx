import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Search, ScanSearch, FileText, Network, ShieldCheck } from 'lucide-react';

const STEPS = [
  {
    icon: Search,
    title: 'Investigate',
    body: 'An agent extracts every entity and runs real checks — company registry, domain age, DNS, links, payment methods.',
  },
  {
    icon: ScanSearch,
    title: 'Verify',
    body: 'A critic agent reviews each finding against the evidence and drops anything the tools do not actually prove.',
  },
  {
    icon: FileText,
    title: 'Report',
    body: 'You get a clear verdict with confidence, the reasoning trail, and concrete next steps — proof, not guesses.',
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
            <span className="eyebrow">AI fraud detective</span>
            <h1 className="mx-auto mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
              Know if a job offer is real.
              <span className="block text-muted">Before you reply, before you pay.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted">
              Verify My Interview runs a full investigation on suspicious recruiter emails, messages
              and links — then checks them against a network of reported scams.
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
        <div className="grid gap-4 md:grid-cols-3">
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
              Reported scams are matched semantically against new cases — catching reworded emails,
              shared payment details, renamed companies and repeat locations, even when the wording
              changes.
            </p>
            <Link to="/new" className="btn-ghost mt-6">
              Check an offer <ArrowRight className="h-4 w-4" />
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
