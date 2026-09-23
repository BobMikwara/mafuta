import { useState, type ReactNode } from 'react';
import { normalizeApiKey } from '../lib/api';
import { NAV_ITEMS } from '../lib/router';
import { AppLink, useRouter, useSession } from './providers';
import { Icon, Mark } from './icons';
import { Banner, Button, TextField } from './ui';

export function AppShell({ children }: { children: ReactNode }) {
  const { route } = useRouter();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const current = NAV_ITEMS.find((item) => item.name === route.nav) ?? NAV_ITEMS[0];

  return (
    <div className="app-frame">
      <a className="skip" href="#main">
        Skip to content
      </a>
      {open ? (
        <button
          type="button"
          className="backdrop-btn"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <Mark />
          <div>
            <div className="brand-name">
              Fuel<span>Track</span>
            </div>
            <p className="brand-kicker">East Africa</p>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {(['Operate', 'Review', 'Account'] as const).map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-label">{group}</p>
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                <AppLink
                  key={item.name}
                  to={item.href}
                  className={`nav-link${route.nav === item.name ? ' active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </AppLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <strong>{session.health?.status === 'ok' ? 'API reachable' : 'API not confirmed'}</strong>
          <div>Database {session.health?.database ?? 'unknown'}</div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-actions">
            <button type="button" className="btn small menu-btn" onClick={() => setOpen(true)}>
              Menu
            </button>
            <h1 className="topbar-title">{current?.label ?? route.title}</h1>
          </div>
          <div className="topbar-actions">
            {session.session?.tenantId ? (
              <span className="tenant-chip" title={session.session.tenantId}>
                {session.session.tenantId.slice(0, 8)}
              </span>
            ) : null}
            <Button size="small" onClick={session.disconnect}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="main" id="main">
          {session.health?.database === 'not_configured' || session.health?.database === 'down' ? (
            <Banner tone="warn">
              The API database is {session.health.database}. Station and tank saves cannot succeed
              until that is fixed.
            </Banner>
          ) : null}
          {session.health?.database === 'unmigrated' ? (
            <Banner tone="warn">
              The database has not been migrated. Creates will fail until the committed migrations
              have been applied.
            </Banner>
          ) : null}
          {session.health?.credentials === 'empty' ? (
            <Banner tone="warn">
              No API key is provisioned on this deployment. A correct key will still be rejected
              until one is installed.
            </Banner>
          ) : null}
          {!session.scopesKnown ? (
            <Banner tone="info">
              This API did not return a session, so write actions stay visible and the server
              decides. A refusal names the missing scope.
            </Banner>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export function Gate() {
  const session = useSession();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);

  return (
    <div className="gate">
      <section className="gate-copy">
        <div>
          <div className="brand">
            <Mark />
            <div>
              <div className="brand-name">
                Fuel<span>Track</span>
              </div>
              <p className="brand-kicker">East Africa</p>
            </div>
          </div>
          <h1>Know what is in the tank.</h1>
          <p>
            A tenant console for station inventory, probe readings, candidate deliveries and alerts.
            Nothing here is invented, and nothing is marked live unless the reading says so.
          </p>
          <ul className="principles">
            <li>
              <strong>One tenant per key</strong>
              Stations and tanks stay inside the tenant this key was issued for.
            </li>
            <li>
              <strong>Candidates are not deliveries</strong>A rise in level waits for a human
              confirmation.
            </li>
            <li>
              <strong>Stale is labelled stale</strong>A missing probe is shown as missing, not as a
              quiet zero.
            </li>
          </ul>
        </div>
        <p className="quiet" style={{ color: '#a8b8b0' }}>
          {session.health === null
            ? 'Checking the API...'
            : `API ${session.health.status}, database ${session.health.database}.`}
        </p>
      </section>
      <form
        className="gate-form"
        onSubmit={(event) => {
          event.preventDefault();
          void session.connect(key);
        }}
      >
        <p className="eyebrow">Console access</p>
        <h2>Connect with an API key</h2>
        <p className="lede">
          The key is kept in this browser tab only. It is sent as a bearer token and is never
          written into the page source.
        </p>
        <TextField
          label="API key"
          name="apiKey"
          type={show ? 'text' : 'password'}
          autoComplete="off"
          required
          value={key}
          placeholder="ftk_live_..."
          error={session.status === 'error' ? session.message : undefined}
          help="Paste the full key, including the ftk_live_ prefix."
          onChange={setKey}
        />
        <label className="quiet">
          <input
            type="checkbox"
            checked={show}
            onChange={(event) => setShow(event.target.checked)}
          />{' '}
          Show key
        </label>
        <Button
          variant="primary"
          type="submit"
          disabled={session.status === 'checking' || normalizeApiKey(key).length === 0}
        >
          {session.status === 'checking' ? 'Checking key...' : 'Open console'}
        </Button>
      </form>
    </div>
  );
}
