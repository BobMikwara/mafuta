import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiRequestError, fetchHealth, normalizeApiKey, type ServiceHealth } from '../lib/api';
import { parsePath, type ParsedRoute } from '../lib/router';
import { fetchSession, fetchStations, type SessionInfo } from '../lib/resources';

const STORAGE_KEY = 'fueltrack.apiKey';

interface SessionValue {
  readonly apiKey: string;
  readonly session: SessionInfo | null;
  readonly scopesKnown: boolean;
  readonly health: ServiceHealth | null;
  readonly status: 'checking' | 'ready' | 'signed-out' | 'error';
  readonly message: string;
  connect: (raw: string) => Promise<void>;
  disconnect: () => void;
  hasScope: (scope: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState('');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [scopesKnown, setScopesKnown] = useState(false);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [status, setStatus] = useState<SessionValue['status']>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetchHealth()
      .then((result) => {
        if (active) setHealth(result);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = useCallback(async (raw: string) => {
    const key = normalizeApiKey(raw);
    if (key.length === 0) {
      setStatus('error');
      setMessage('Enter the API key issued for this tenant.');
      return;
    }
    setStatus('checking');
    setMessage('');
    try {
      let info: SessionInfo;
      let known = true;
      try {
        info = await fetchSession(key);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) {
          await fetchStations(key);
          known = false;
          info = { tenantId: '', principalId: '', scopes: [] };
        } else {
          throw error;
        }
      }
      sessionStorage.setItem(STORAGE_KEY, key);
      setApiKey(key);
      setSession(info);
      setScopesKnown(known);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not connect.');
    }
  }, []);

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setApiKey('');
    setSession(null);
    setScopesKnown(false);
    setStatus('signed-out');
    setMessage('');
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY) ?? '';
    if (stored.length === 0) {
      setStatus('signed-out');
      return;
    }
    void connect(stored);
  }, [connect]);

  const value = useMemo<SessionValue>(
    () => ({
      apiKey,
      session,
      scopesKnown,
      health,
      status,
      message,
      connect,
      disconnect,
      hasScope: (scope: string) => {
        if (!scopesKnown) return true;
        return session?.scopes.includes(scope) ?? false;
      },
    }),
    [apiKey, session, scopesKnown, health, status, message, connect, disconnect],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('Session is not available');
  }
  return value;
}

interface ToastItem {
  readonly id: number;
  readonly tone: 'ok' | 'error';
  readonly message: string;
}

const ToastContext = createContext<{
  push: (tone: 'ok' | 'error', message: string) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((tone: 'ok' | 'error', message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone === 'error' ? 'error' : ''}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error('Toasts are not available');
  }
  return value;
}

interface RouterValue {
  readonly route: ParsedRoute;
  readonly search: string;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [href, setHref] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const onPop = () => setHref(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    setHref(window.location.pathname + window.location.search);
  }, []);
  const value = useMemo<RouterValue>(() => {
    const url = new URL(href, 'http://fueltrack.local');
    return { route: parsePath(url.pathname), search: url.search, navigate };
  }, [href, navigate]);

  useEffect(() => {
    document.title = `${value.route.title} - FuelTrack EA`;
  }, [value.route.title]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === null) {
    throw new Error('Router is not available');
  }
  return value;
}

export function AppLink({
  to,
  className,
  children,
  onClick,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
