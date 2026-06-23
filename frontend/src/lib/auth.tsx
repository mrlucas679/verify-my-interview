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
const ERROR_KEY = 'vmi.auth.error.v1';
const DEBUG_KEY = 'vmi.auth.debug.v1';
const CALLBACK_MAX_AGE_MS = 10 * 60 * 1000;
const EXPIRY_SKEW_MS = 60 * 1000;

interface AuthConfig {
  clientId: string;
  authority: string;
  scope: string;
  redirectUri: string;
}

interface AuthConfigPayload {
  enabled?: unknown;
  clientId?: unknown;
  authority?: unknown;
  scope?: unknown;
  redirectUri?: unknown;
}

interface PendingPkce {
  state: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

interface CallbackSnapshot {
  search: string;
}

interface StoredToken {
  accessToken: string;
  idToken?: string;
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
  redirecting: boolean;
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

function readBuildConfig(): AuthConfig | null {
  const clientId = clean(import.meta.env.VITE_AUTH_CLIENT_ID);
  const authority = clean(import.meta.env.VITE_AUTH_AUTHORITY);
  const scope = clean(import.meta.env.VITE_AUTH_SCOPE);
  if (!clientId || !authority || !scope) return null;
  const redirectUri = clean(import.meta.env.VITE_AUTH_REDIRECT_URI) || `${window.location.origin}/auth/callback`;
  return { clientId, authority: normalizeAuthority(authority), scope, redirectUri };
}

function configFromPayload(value: unknown): AuthConfig | null {
  if (!isRecord(value)) return null;
  const payload = value as AuthConfigPayload;
  if (payload.enabled !== true) return null;
  const clientId = clean(payload.clientId);
  const authority = clean(payload.authority);
  const scope = clean(payload.scope);
  const redirectUri = clean(payload.redirectUri);
  if (!clientId || !authority || !scope || !redirectUri) return null;
  return { clientId, authority: normalizeAuthority(authority), scope, redirectUri };
}

async function readRuntimeConfig(signal: AbortSignal): Promise<AuthConfig | null> {
  const res = await fetch('/auth/config', {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return configFromPayload(await res.json());
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

function storageSet(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignored */
  }
}

function writeAuthDebug(stage: string, detail: Record<string, string | number | boolean | null | undefined> = {}): void {
  const bounded: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail).slice(0, 20)) {
    if (typeof value === 'string') bounded[key] = value.slice(0, 300);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) bounded[key] = value;
  }
  const params = new URLSearchParams(window.location.search);
  storageSet(
    DEBUG_KEY,
    JSON.stringify({
      at: new Date().toISOString(),
      stage,
      path: window.location.pathname,
      hasCode: params.has('code'),
      hasError: params.has('error') || params.has('error_description'),
      detail: bounded,
    })
  );
}

function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value.slice(0, 300);
  }
}

export function readAuthDiagnosticText(): string {
  return JSON.stringify(
    {
      authDebug: safeJsonParse(storageGet(DEBUG_KEY)),
      authError: storageGet(ERROR_KEY),
    },
    null,
    2
  );
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

function mergeClaims(accessClaims: AuthClaims | null, idClaims: AuthClaims | null): AuthClaims | null {
  if (!accessClaims && !idClaims) return null;
  const roles = new Set<string>();
  for (const role of accessClaims?.roles ?? []) roles.add(role);
  for (const role of idClaims?.roles ?? []) roles.add(role);
  return {
    sub: idClaims?.sub || accessClaims?.sub,
    oid: idClaims?.oid || accessClaims?.oid,
    email: idClaims?.email || accessClaims?.email,
    preferred_username: idClaims?.preferred_username || accessClaims?.preferred_username,
    name: idClaims?.name || accessClaims?.name,
    roles: [...roles],
    exp: accessClaims?.exp || idClaims?.exp,
  };
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
    const idToken = clean(parsed.idToken) || undefined;
    return {
      accessToken,
      idToken,
      expiresAt,
      claims: mergeClaims(parseClaims(accessToken), idToken ? parseClaims(idToken) : null),
    };
  } catch {
    storageRemove(TOKEN_KEY);
    return null;
  }
}

function writeStoredToken(token: StoredToken | null): boolean {
  if (!token) {
    storageRemove(TOKEN_KEY);
    return true;
  }
  return storageSet(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: token.accessToken,
      idToken: token.idToken,
      expiresAt: token.expiresAt,
    })
  );
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

function readCallbackSnapshot(): CallbackSnapshot | null {
  if (window.location.pathname !== '/auth/callback') return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('error') && !params.has('error_description')) return null;
  return { search: window.location.search };
}

function replaceAppUrl(target: string): void {
  window.history.replaceState({}, document.title, target);
  try {
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  } catch {
    window.dispatchEvent(new Event('popstate'));
  }
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
  let res: Response;
  try {
    res = await fetch(authEndpoint(config, 'token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    writeAuthDebug('token_exchange_network_failed', {
      authority: config.authority,
      redirectUri: config.redirectUri,
    });
    throw new Error('Microsoft returned to the app, but the browser could not exchange the sign-in code. Check that the redirect URI is configured as a Single-page application in Entra.');
  }
  const payload = (await res.json().catch(() => null)) as unknown;
  writeAuthDebug('token_exchange_response', {
    status: res.status,
    ok: res.ok,
    hasAccessToken: isRecord(payload) && typeof payload.access_token === 'string',
    hasIdToken: isRecord(payload) && typeof payload.id_token === 'string',
  });
  if (!res.ok || !isRecord(payload) || typeof payload.access_token !== 'string') {
    const detail = isRecord(payload)
      ? clean(payload.error_description) || clean(payload.error)
      : '';
    throw new Error(detail || `Microsoft token exchange failed with HTTP ${res.status}.`);
  }
  const token = payload as unknown as TokenResponse;
  const idToken = clean(token.id_token) || undefined;
  const claims = mergeClaims(parseClaims(token.access_token), idToken ? parseClaims(idToken) : null);
  if (!claims?.oid && !claims?.sub) {
    throw new Error('Sign-in completed, but Microsoft did not return a user profile.');
  }
  const fromResponse = typeof token.expires_in === 'number' ? Date.now() + token.expires_in * 1000 : 0;
  const fromClaims = claims?.exp ? claims.exp * 1000 : 0;
  return {
    accessToken: token.access_token,
    idToken,
    expiresAt: fromResponse || fromClaims || Date.now() + 60 * 60 * 1000,
    claims,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const buildConfig = useMemo(readBuildConfig, []);
  const [callbackSnapshot] = useState<CallbackSnapshot | null>(() => readCallbackSnapshot());
  const [config, setConfig] = useState<AuthConfig | null>(buildConfig);
  const [configReady, setConfigReady] = useState(false);
  const [snapshot, setSnapshot] = useState<StoredToken | null>(() => readStoredToken());
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setErrorState] = useState<string | null>(() => storageGet(ERROR_KEY));

  const setAuthError = useCallback((message: string | null) => {
    if (message) storageSet(ERROR_KEY, message);
    else storageRemove(ERROR_KEY);
    setErrorState(message);
  }, []);

  useEffect(() => {
    setAuthTokenProvider(() => readStoredToken()?.accessToken ?? null);
    return () => setAuthTokenProvider(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    readRuntimeConfig(controller.signal)
      .then((runtimeConfig) => {
        if (!cancelled && runtimeConfig) setConfig(runtimeConfig);
      })
      .catch(() => {
        /* Build-time config remains a valid fallback for local/offline builds. */
      })
      .finally(() => {
        if (!cancelled) setConfigReady(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!configReady) return;
    const activeConfig = config;
    if (!activeConfig) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function finishCallback(callbackConfig: AuthConfig) {
      const params = new URLSearchParams(callbackSnapshot?.search ?? window.location.search);
      const callbackError = params.get('error_description') || params.get('error');
      const code = params.get('code');
      const state = params.get('state');
      if (!code && !callbackError) {
        if (window.location.pathname === '/auth/callback') {
          setAuthError('Microsoft returned without a sign-in code. Please try again.');
          writeAuthDebug('callback_missing_response');
        }
        setSnapshot(readStoredToken());
        setRedirecting(false);
        setLoading(false);
        return;
      }

      const pending = readPendingPkce();
      const returnTo = safeReturnTo(pending?.returnTo ?? '/');
      writeAuthDebug('callback_received', {
        hasCode: Boolean(code),
        hasError: Boolean(callbackError),
        hasPending: Boolean(pending),
        stateMatches: Boolean(pending && pending.state === state),
        redirectUri: callbackConfig.redirectUri,
      });
      try {
        if (callbackError) throw new Error(callbackError);
        if (!pending || pending.state !== state) throw new Error('Sign-in state could not be verified.');
        writeAuthDebug('token_exchange_start', { redirectUri: callbackConfig.redirectUri });
        const token = await exchangeCode(callbackConfig, code ?? '', pending.codeVerifier);
        if (cancelled) return;
        if (!writeStoredToken(token)) {
          writeAuthDebug('token_storage_failed');
          throw new Error('Your browser blocked the sign-in session. Allow site storage, then try again.');
        }
        storageRemove(PKCE_KEY);
        setSnapshot(token);
        setAuthError(null);
        setRedirecting(false);
        writeAuthDebug('signed_in', {
          hasEmail: Boolean(token.claims?.email || token.claims?.preferred_username),
          hasName: Boolean(token.claims?.name),
        });
        replaceAppUrl(returnTo);
      } catch (event) {
        if (cancelled) return;
        storageRemove(PKCE_KEY);
        const message = event instanceof Error ? event.message : 'Sign-in failed.';
        setAuthError(message);
        setRedirecting(false);
        writeAuthDebug('sign_in_failed', { message });
        replaceAppUrl('/auth/callback');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void finishCallback(activeConfig);
    return () => {
      cancelled = true;
    };
  }, [callbackSnapshot, config, configReady, setAuthError]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    setRedirecting(false);
    if (!config) {
      setAuthError('Sign-in is not configured on this deployment.');
      writeAuthDebug('sign_in_not_configured');
      return;
    }
    if (!window.crypto?.subtle) {
      setAuthError('This browser cannot start secure sign-in.');
      writeAuthDebug('crypto_unavailable');
      return;
    }
    const codeVerifier = randomUrlString(64);
    const state = randomUrlString(24);
    const returnTo = safeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    const pendingSaved = storageSet(PKCE_KEY, JSON.stringify({ state, codeVerifier, returnTo, createdAt: Date.now() }));
    const pending = readPendingPkce();
    if (!pendingSaved || pending?.state !== state) {
      setAuthError('Your browser blocked temporary sign-in storage. Allow site storage, then try again.');
      writeAuthDebug('pkce_storage_blocked');
      return;
    }
    try {
      setRedirecting(true);
      writeAuthDebug('redirecting_to_microsoft', {
        authority: config.authority,
        redirectUri: config.redirectUri,
      });
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        response_mode: 'query',
        scope: normalizeScope(config.scope),
        state,
        code_challenge: await codeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      window.location.assign(`${authEndpoint(config, 'authorize')}?${params.toString()}`);
    } catch (event) {
      setRedirecting(false);
      setAuthError(event instanceof Error ? event.message : 'Could not open Microsoft sign-in.');
    }
  }, [config, setAuthError]);

  const signOut = useCallback(() => {
    writeStoredToken(null);
    storageRemove(PKCE_KEY);
    setSnapshot(null);
    setRedirecting(false);
    setAuthError(null);
  }, [setAuthError]);

  const value = useMemo<AuthContextValue>(() => {
    const roles = snapshot?.claims?.roles ?? [];
    return {
      enabled: Boolean(config),
      loading,
      redirecting,
      authenticated: Boolean(snapshot),
      account: accountFromClaims(snapshot?.claims ?? null),
      roles,
      isAdmin: roles.includes('admin'),
      error,
      tokenExpiresAt: snapshot?.expiresAt ?? null,
      signIn,
      signOut,
      clearError: () => setAuthError(null),
    };
  }, [config, error, loading, redirecting, setAuthError, signIn, signOut, snapshot]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
