import type { Alert } from '../lib/api';

interface Props {
  alerts: Alert[];
}

export function AlertsList({ alerts }: Props) {
  return (
    <section className="panel">
      <h2>Open Alerts</h2>
      {alerts.length === 0 ? (
        <p className="empty">No open alerts.</p>
      ) : (
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
      )}
    </section>
  );
}
