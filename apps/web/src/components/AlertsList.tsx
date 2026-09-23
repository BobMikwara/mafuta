import type { Alert } from '../lib/api';
import type { AlertsState } from '../hooks/useConsoleData';

interface Props {
  state: AlertsState;
  onRetry: () => void;
}

function AlertRows({ alerts }: { alerts: ReadonlyArray<Alert> }) {
  if (alerts.length === 0) {
    return <p className="empty">No open alerts for this tenant.</p>;
  }
  return (
    <ul className="alert-list">
      {alerts.map((alert) => (
        <li key={alert.id} className={`alert-row ${alert.severity}`}>
          <span className={`tag ${alert.severity}`}>{alert.severity}</span>
          <strong>{alert.type}</strong>
          <span>{alert.message}</span>
          <span className="when">{new Date(alert.raisedAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

export function AlertsList({ state, onRetry }: Props) {
  return (
    <section className="panel" aria-busy={state.status === 'loading'}>
      <h2>Open Alerts</h2>
      {state.status === 'idle' ? <p className="empty">Connect to load alerts.</p> : null}
      {state.status === 'loading' ? <p className="empty">Loading alerts.</p> : null}
      {state.status === 'ready' ? <AlertRows alerts={state.alerts} /> : null}
      {state.status === 'error' ? (
        <div className={`panel-error ${state.kind}`} role="alert">
          <strong>
            {state.kind === 'forbidden' ? 'Alerts are not available to this key' : 'Alerts failed'}
          </strong>
          <p>{state.message}</p>
          <button type="button" className="btn small-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}
