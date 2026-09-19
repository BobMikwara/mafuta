import type { Alarm } from '../lib/api';

interface Props {
  alarms: Alarm[];
}

export function AlarmsList({ alarms }: Props) {
  return (
    <section className="panel">
      <h2>Open Alarms</h2>
      {alarms.length === 0 ? (
        <p className="empty">No open alarms.</p>
      ) : (
        <ul className="alarms">
          {alarms.map((alarm) => (
            <li key={alarm.id} className={`alarm ${alarm.severity}`}>
              <span className={`tag ${alarm.severity}`}>{alarm.severity}</span>
              <strong>{alarm.type}</strong>
              <span>{alarm.message}</span>
              <span className="when">{new Date(alarm.raisedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
