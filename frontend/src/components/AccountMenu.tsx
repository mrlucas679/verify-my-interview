import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
  Trash2,
  UserCircle,
} from 'lucide-react';
import { deleteAccount, getProfile, setEvidenceConsent, type AccountProfile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCase } from '../store/caseStore';

function displayName(profile: AccountProfile | null, fallback: string | undefined): string {
  return profile?.user.name || profile?.user.email || fallback || 'Account';
}

function displayEmail(profile: AccountProfile | null, fallback: string | undefined): string {
  return profile?.user.email || fallback || '';
}

export function AccountMenu() {
  const auth = useAuth();
  const { clearHistory, newCase } = useCase();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'profile' | 'consent' | 'erase' | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointer);
    return () => document.removeEventListener('pointerdown', handlePointer);
  }, []);

  useEffect(() => {
    if (!open || !auth.authenticated) return;
    const controller = new AbortController();
    setBusy('profile');
    setProfileError(null);
    getProfile({ signal: controller.signal })
      .then((next) => setProfile(next))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProfileError(error instanceof Error ? error.message : 'Account unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(null);
      });
    return () => controller.abort();
  }, [auth.authenticated, open]);

  if (!auth.enabled) return null;

  async function toggleConsent() {
    if (!profile || busy) return;
    const next = !profile.user.consent.store_evidence;
    setBusy('consent');
    setProfileError(null);
    try {
      const result = await setEvidenceConsent(next);
      setProfile({ ...profile, user: { ...profile.user, consent: result.consent } });
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not update privacy setting.');
    } finally {
      setBusy(null);
    }
  }

  async function eraseAccount() {
    if (!confirmErase) {
      setConfirmErase(true);
      return;
    }
    setBusy('erase');
    setProfileError(null);
    try {
      await deleteAccount();
      clearHistory();
      newCase();
      auth.signOut();
      setOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not erase this account.');
    } finally {
      setBusy(null);
    }
  }

  if (!auth.authenticated) {
    return (
      <button
        type="button"
        onClick={() => void auth.signIn()}
        disabled={auth.loading}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-muted transition hover:bg-ink-850 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 sm:text-sm"
      >
        {auth.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
        <span>Sign in</span>
      </button>
    );
  }

  const email = displayEmail(profile, auth.account?.email);
  const name = displayName(profile, auth.account?.name || auth.account?.email);
  const consent = profile?.user.consent.store_evidence ?? false;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-muted transition hover:bg-ink-850 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:text-sm"
      >
        <UserCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="hidden sm:inline">{name}</span>
        <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-ink-850 p-3 text-sm shadow-card">
          <div className="min-w-0 border-b border-line/70 pb-3">
            <p className="truncate font-medium text-slate-100">{name}</p>
            {email && <p className="mt-0.5 truncate text-xs text-faint">{email}</p>}
            {profile && (
              <p className="mt-2 font-mono text-[11px] text-faint">
                {profile.usage.count} checks in {profile.usage.period}
              </p>
            )}
          </div>

          <div className="space-y-2 border-b border-line/70 py-3">
            <button
              type="button"
              onClick={() => void toggleConsent()}
              disabled={!profile || busy === 'consent'}
              aria-pressed={consent}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
            >
              <span>
                <span className="block text-slate-200">Store evidence</span>
                <span className="block text-xs text-faint">Private files, 12-month retention</span>
              </span>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${consent ? 'border-accent bg-accent text-white' : 'border-line text-transparent'}`}>
                {busy === 'consent' ? <Loader2 className="h-3 w-3 animate-spin text-white" /> : <Check className="h-3 w-3" />}
              </span>
            </button>

            {auth.isAdmin && (
              <Link
                to="/admin/reports"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-slate-200 transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ShieldCheck className="h-4 w-4 text-accent" strokeWidth={1.75} />
                Review reports
              </Link>
            )}
          </div>

          {(profileError || auth.error) && (
            <p className="mt-3 rounded-lg border border-risk-needs/40 bg-risk-needs/10 p-2 text-xs text-risk-needs" role="alert">
              {profileError || auth.error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                auth.signOut();
                setProfile(null);
                setOpen(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
              Sign out
            </button>
            <button
              type="button"
              onClick={() => void eraseAccount()}
              disabled={busy === 'erase'}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-risk-needs transition hover:bg-risk-needs/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-risk-needs/40 disabled:opacity-60"
            >
              {busy === 'erase' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {confirmErase ? 'Confirm erase' : 'Erase account'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
