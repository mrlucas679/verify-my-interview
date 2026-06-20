import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { setAuthTokenProvider } from './api';

const TOKEN_KEY = 'vmi.auth.token.v1';
const PKCE_KEY = 'vmi.auth.pkce.v1';
const CALLBACK_MAX_AGE_MS = 10 * 60 * 1000;
const EXPIRY_SKEW_MS = 60 * 1000;

interface AuthConfig {
  clientId: string;
  authority: string;
  scope: string;
  redirectUri: string;
}

interface PendingPkce {
  state: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

interface StoredToken {
  accessToken: string;
  expiresAt: number;
  claims: AuthClaims | null;
}

interface AuthClaims {
  sub?: string;
  oid?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  roles?: string[];
  exp?: number;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  id_token?: string;
}

export interface AuthAccount {
  id: string;
  email?: string;
  name?: string;
}

interface AuthContextValue {
  enabled: boolean;
  loading: boolean;
  authenticated: boolean;
  account: AuthAccount | null;
  roles: string[];
  isAdmin: boolean;
  error: string | null;
  tokenExpiresAt: number | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAuthority(value: string): string {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/oauth2\/v2\.0$/i, '')
    .replace(/\/v2\.0$/i, '');
}

function readConfig(): AuthConfig | null {
  const clientId = clean(import.meta.env.VITE_AUTH_CLIENT_ID);
  const authority = clean(import.meta.env.VITE_AUTH_AUTHORITY);
  const scope = clean(import.meta.env.VITE_AUTH_SCOPE);
  if (!clientId || !authority || !scope) return null;
  const redirectUri = clean(import.meta.env.VITE_AUTH_REDIRECT_URI) || `${window.location.origin}/auth/callback`;
  return { clientId, authority: normalizeAuthority(authority), scope, redirectUri };
}

function authEndpoint(config: AuthConfig, name: 'authorize' | 'token'): string {
  return `${config.authority}/oauth2/v2.0/${name}`;
}

function storageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Session storage can be blocked; auth will fail visibly instead. */
  }
}

function storageRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignored */
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function parseClaims(token: string): AuthClaims | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const raw = JSON.parse(decodeBase64Url(parts[1])) as unknown;
    if (!isRecord(raw)) return null;
    const roles = Array.isArray(raw.roles) ? raw.roles.filter((role): role is string => typeof role === 'string') : [];
    return {
      sub: clean(raw.sub) || undefined,
      oid: clean(raw.oid) || undefined,
      email: clean(raw.email) || undefined,
      preferred_username: clean(raw.preferred_username) || undefined,
      name: clean(raw.name) || undefined,
      roles,
      exp: typeof raw.exp === 'number' && Number.isFinite(raw.exp) ? raw.exp : undefined,
    };
  } catch {
    return null;
  }
}

function readStoredToken(): StoredToken | null {
  const raw = storageGet(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const accessToken = clean(parsed.accessToken);
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0;
    if (!accessToken || expiresAt <= Date.now() + EXPIRY_SKEW_MS) {
      storageRemove(TOKEN_KEY);
      return null;
    }
    return {
      accessToken,
      expiresAt,
      claims: parseClaims(accessToken),
    };
  } catch {
    storageRemove(TOKEN_KEY);
    return null;
  }
}

function writeStoredToken(token: StoredToken | null): void {
  if (!token) {
    storageRemove(TOKEN_KEY);
    return;
  }
  storageSet(TOKEN_KEY, JSON.stringify({ accessToken: token.accessToken, expiresAt: token.expiresAt }));
}

function randomUrlString(bytes = 32): string {
  const values = new Uint8Array(bytes);
  window.crypto.getRandomValues(values);
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const value of new Uint8Array(digest)) binary += String.fromCharCode(value);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeScope(scope: string): string {
  const required = ['openid', 'profile', 'email'];
  const parts = new Set(scope.split(/\s+/).filter(Boolean));
  for (const item of required) parts.add(item);
  return [...parts].join(' ');
}

function readPendingPkce(): PendingPkce | null {
  const raw = storageGet(PKCE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const pending: PendingPkce = {
      state: clean(parsed.state),
      codeVerifier: clean(parsed.codeVerifier),
      returnTo: clean(parsed.returnTo) || '/',
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
    };
    if (!pending.state || !pending.codeVerifier || Date.now() - pending.createdAt > CALLBACK_MAX_AGE_MS) {
      storageRemove(PKCE_KEY);
      return null;
    }
    return pending;
  } catch {
    storageRemove(PKCE_KEY);
    return null;
  }
}

function safeReturnTo(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function accountFromClaims(claims: AuthClaims | null): AuthAccount | null {
  if (!claims) return null;
  const id = claims.oid || claims.sub;
  if (!id) return null;
  return {
    id,
    email: claims.email || claims.preferred_username,
    name: claims.name,
  };
}

async function exchangeCode(config: AuthConfig, code: string, verifier: string): Promise<StoredToken> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
    scope: normalizeScope(config.scope),
  });
  const res = await fetch(authEndpoint(config, 'token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await res.json().catch(() => null)) as unknown;
  if (!res.ok || !isRecord(payload) || typeof payload.access_token !== 'string') {
    throw new Error('Sign-in could not be completed.');
  }
  const token = payload as unknown as TokenResponse;
  const claims = parseClaims(token.access_token);
  const fromResponse = typeof token.expires_in === 'number' ? Date.now() + token.expires_in * 1000 : 0;
  const fromClaims = claims?.exp ? claims.exp * 1000 : 0;
  return {
    accessToken: token.access_token,
    expiresAt: fromResponse || fromClaims || Date.now() + 60 * 60 * 1000,
    claims,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useMemo(readConfig, []);
  const [snapshot, setSnapshot] = useState<StoredToken | null>(() => readStoredToken());
  const [loading, setLoading] = useState(Boolean(config));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAuthTokenProvider(() => readStoredToken()?.accessToken ?? null);
    return () => setAuthTokenProvider(null);
  }, []);

  useEffect(() => {
    const activeConfig = config;
    if (!activeConfig) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function finishCallback(callbackConfig: AuthConfig) {
      const params = new URLSearchParams(window.location.search);
      const callbackError = params.get('error_description') || params.get('error');
      const code = params.get('code');
      const state = params.get('state');
      if (!code && !callbackError) {
        setSnapshot(readStoredToken());
        setLoading(false);
        return;
      }

      const pending = readPendingPkce();
      const returnTo = safeReturnTo(pending?.returnTo ?? '/');
      try {
        if (callbackError) throw new Error(callbackError);
        if (!pending || pending.state !== state) throw new Error('Sign-in state could not be verified.');
        const token = await exchangeCode(callbackConfig, code ?? '', pending.codeVerifier);
        if (cancelled) return;
        writeStoredToken(token);
        storageRemove(PKCE_KEY);
        setSnapshot(token);
        setError(null);
        window.history.replaceState({}, document.title, returnTo);
      } catch (event) {
        if (cancelled) return;
        storageRemove(PKCE_KEY);
        setError(event instanceof Error ? event.message : 'Sign-in failed.');
        window.history.replaceState({}, document.title, returnTo);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void finishCallback(activeConfig);
    return () => {
      cancelled = true;
    };
  }, [config]);

  const signIn = useCallback(async () => {
    if (!config) {
      setError('Sign-in is not configured on this deployment.');
      return;
    }
    if (!window.crypto?.subtle) {
      setError('This browser cannot start secure sign-in.');
      return;
    }
    const codeVerifier = randomUrlString(64);
    const state = randomUrlString(24);
    const returnTo = safeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    storageSet(PKCE_KEY, JSON.stringify({ state, codeVerifier, returnTo, createdAt: Date.now() }));
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      response_mode: 'query',
      scope: normalizeScope(config.scope),
      state,
      code_challenge: await codeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });
    window.location.assign(`${authEndpoint(config, 'authorize')}?${params.toString()}`);
  }, [config]);

  const signOut = useCallback(() => {
    writeStoredToken(null);
    storageRemove(PKCE_KEY);
    setSnapshot(null);
    setError(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const roles = snapshot?.claims?.roles ?? [];
    return {
      enabled: Boolean(config),
      loading,
      authenticated: Boolean(snapshot),
      account: accountFromClaims(snapshot?.claims ?? null),
      roles,
      isAdmin: roles.includes('admin'),
      error,
      tokenExpiresAt: snapshot?.expiresAt ?? null,
      signIn,
      signOut,
      clearError: () => setError(null),
    };
  }, [config, error, loading, signIn, signOut, snapshot]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
