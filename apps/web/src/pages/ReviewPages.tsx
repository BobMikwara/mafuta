import { useState } from 'react';
import { ApiRequestError } from '../lib/api';
import { formatLitres, formatWhen, litresFromMl } from '../lib/format';
import { alertLabel, eventLabel, productLabel } from '../lib/labels';
import {
  acknowledgeAlert,
  assignAlert,
  confirmEvent,
  downloadReportCsv,
  fetchAlerts,
  fetchAudit,
  fetchDeliveries,
  fetchEvents,
  fetchReport,
  rejectEvent,
  resolveAlert,
  type ReportTable,
} from '../lib/resources';
import { useResource } from '../components/data';
import { PageIntro } from '../components/forms';
import { useSession, useToast } from '../components/providers';
import { Banner, Button, EmptyState, Pill, SkeletonStack } from '../components/ui';

const REPORTS = [
  { id: 'inventory', label: 'Current inventory' },
  { id: 'stock-movement', label: 'Stock movement' },
  { id: 'deliveries', label: 'Confirmed deliveries' },
  { id: 'device-health', label: 'Device health' },
  { id: 'alerts', label: 'Alert history' },
  { id: 'reconciliation', label: 'Reconciliation' },
] as const;

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

export function DeliveriesPage() {
  const { apiKey } = useSession();
  const deliveries = useResource('deliveries', () => fetchDeliveries(apiKey));
  const rows = deliveries.data?.deliveries ?? [];
  return (
    <>
      <PageIntro
        eyebrow="Review"
        title="Deliveries"
        lede="A delivery exists only after a person confirms a candidate. Measured volume is what the probe saw. Recorded volume is what the docket said. The difference is a variance, not a verdict."
      />
      {deliveries.status === 'loading' ? <SkeletonStack /> : null}
      {deliveries.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={deliveries.reload}>Try again</Button>}>
          {deliveries.error}
        </Banner>
      ) : null}
      {deliveries.status === 'ready' && rows.length === 0 ? (
        <EmptyState
          title="No confirmed deliveries"
          body="Candidate rises stay on the reconciliation page until someone confirms or rejects them. This ledger does not fill itself."
        />
      ) : null}
      {rows.length > 0 ? (
        <div className="table-scroll panel">
          <table>
            <thead>
              <tr>
                <th>Confirmed</th>
                <th>Station</th>
                <th>Tank</th>
                <th>Product</th>
                <th>Reference</th>
                <th className="num">Measured</th>
                <th className="num">Recorded</th>
                <th className="num">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.delivery.id}>
                  <td>{formatWhen(row.delivery.confirmedAt)}</td>
                  <td>{row.stationName}</td>
                  <td>{row.tankName}</td>
                  <td>{productLabel(row.product)}</td>
                  <td>{row.delivery.reference ?? 'Not recorded'}</td>
                  <td className="num">{litresFromMl(row.delivery.measuredVolumeMl)}</td>
                  <td className="num">{litresFromMl(row.delivery.recordedVolumeMl)}</td>
                  <td className="num">{litresFromMl(row.varianceMl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

export function ReconciliationPage() {
  const { apiKey, hasScope } = useSession();
  const { push } = useToast();
  const events = useResource('events:candidate', () => fetchEvents(apiKey, 'candidate'));
  const report = useResource('report:reconciliation', () => fetchReport(apiKey, 'reconciliation'));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = hasScope('events:write');
  const rows = events.data?.events ?? [];

  const decide = async (eventId: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(eventId);
    setError(null);
    try {
      await action();
      push('ok', message);
      events.reload();
      report.reload();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Review"
        title="Reconciliation"
        lede="Candidate movements wait for a decision. Confirming a rise records a delivery. Rejecting keeps the event, with the reason. Nothing here is classified as theft."
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {events.status === 'loading' ? <SkeletonStack /> : null}
      {events.status === 'error' ? <Banner tone="error">{events.error}</Banner> : null}
      {events.status === 'ready' && rows.length === 0 ? (
        <EmptyState
          title="No candidates waiting"
          body="A sustained rise or an unexplained decrease appears here only after the rules observe it in stored readings."
        />
      ) : null}
      <div className="grid">
        {rows.map((view) => (
          <CandidateCard
            key={view.event.id}
            view={view}
            busy={busyId === view.event.id}
            canWrite={canWrite}
            onConfirm={(input) =>
              decide(
                view.event.id,
                () => confirmEvent(apiKey, view.event.id, input),
                'Candidate confirmed as a delivery.',
              )
            }
            onReject={(note) =>
              decide(
                view.event.id,
                () => rejectEvent(apiKey, view.event.id, note),
                'Candidate rejected.',
              )
            }
          />
        ))}
      </div>
      <ReportBlock
        table={report.data}
        status={report.status}
        error={report.error}
        onRetry={report.reload}
      />
    </>
  );
}

function CandidateCard({
  view,
  busy,
  canWrite,
  onConfirm,
  onReject,
}: {
  view: {
    event: {
      id: string;
      type: string;
      confidence: number;
      notes: string | null;
      evidence: {
        rule: string;
        possibleExplanations: ReadonlyArray<string>;
        investigationRequired: boolean;
      };
    };
    tankName: string | null;
    stationName: string | null;
    volumeChangeLitres: number;
  };
  busy: boolean;
  canWrite: boolean;
  onConfirm: (input: {
    recordedVolumeLitres?: number;
    reference?: string;
    supplier?: string;
    note?: string;
  }) => void;
  onReject: (note: string) => void;
}) {
  const [reference, setReference] = useState('');
  const [supplier, setSupplier] = useState('');
  const [recorded, setRecorded] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const delivery = view.event.type === 'candidate_delivery';

  return (
    <article className="panel">
      <div className="panel-head">
        <h2>
          {view.tankName ?? 'Tank'} at {view.stationName ?? 'unknown station'}
        </h2>
        <Pill tone="candidate">{eventLabel(view.event.type)}</Pill>
      </div>
      <p>
        Observed change {formatLitres(view.volumeChangeLitres)}. Confidence{' '}
        {(view.event.confidence * 100).toFixed(0)}%, which is a score of how far the movement
        exceeded the threshold, not a probability of a cause.
      </p>
      <p className="quiet">{view.event.evidence.rule}</p>
      <ul className="notes">
        {view.event.evidence.possibleExplanations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {view.event.evidence.investigationRequired ? (
        <p className="quiet">
          Investigation is required. The platform has not decided what this movement means.
        </p>
      ) : null}
      {localError ? <p className="error">{localError}</p> : null}
      {canWrite && delivery ? (
        <div className="form-section">
          <div className="row-2">
            <input
              className="input"
              placeholder="Docket reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
            <input
              className="input"
              placeholder="Supplier"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
            />
            <input
              className="input"
              placeholder="Recorded litres, optional"
              value={recorded}
              onChange={(event) => setRecorded(event.target.value)}
            />
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              const trimmed = recorded.trim();
              const litres = trimmed.length === 0 ? undefined : Number(trimmed);
              if (litres !== undefined && (!Number.isFinite(litres) || litres <= 0)) {
                setLocalError(
                  'Recorded volume must be greater than zero, or left blank to use the measured rise.',
                );
                return;
              }
              setLocalError(null);
              onConfirm({
                ...(litres === undefined ? {} : { recordedVolumeLitres: litres }),
                ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
                ...(supplier.trim() === '' ? {} : { supplier: supplier.trim() }),
              });
            }}
          >
            Confirm delivery
          </Button>
        </div>
      ) : null}
      {canWrite ? (
        <div className="form-section">
          <input
            className="input"
            placeholder="Reason for rejecting this candidate"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            disabled={busy}
            onClick={() => {
              if (note.trim().length < 3) {
                setLocalError('A rejection needs a reason of at least 3 characters.');
                return;
              }
              setLocalError(null);
              onReject(note.trim());
            }}
          >
            Reject candidate
          </Button>
        </div>
      ) : (
        <p className="quiet">This key can review candidates but cannot confirm or reject them.</p>
      )}
    </article>
  );
}

export function AlertsPage() {
  const { apiKey, hasScope } = useSession();
  const { push } = useToast();
  const [status, setStatus] = useState('open');
  const alerts = useResource(`alerts:${status}`, () =>
    fetchAlerts(apiKey, status === 'all' ? {} : { status }),
  );
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canWrite = hasScope('alerts:write');
  const rows = alerts.data?.alerts ?? [];

  const run = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      push('ok', message);
      alerts.reload();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : failureText(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Review"
        title="Alerts"
        lede="Open conditions from the alert rules. Acknowledging records that a person has seen it. Resolving closes it. Neither action invents a fuel movement."
      />
      <div className="toolbar">
        <select
          className="search"
          aria-label="Alert status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <Button onClick={alerts.reload}>Reload</Button>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {alerts.status === 'loading' ? <SkeletonStack /> : null}
      {alerts.status === 'error' ? <Banner tone="error">{alerts.error}</Banner> : null}
      {alerts.status === 'ready' && rows.length === 0 ? (
        <EmptyState
          title="No alerts in this filter"
          body="Change the status filter, or wait until a rule observes a condition in stored data."
        />
      ) : null}
      <div className="grid">
        {rows.map((alert) => (
          <article className="panel" key={alert.id}>
            <div className="panel-head">
              <h2>{alertLabel(alert.type)}</h2>
              <Pill tone={alert.severity}>{alert.severity}</Pill>
            </div>
            <p>{alert.message}</p>
            <p className="quiet">
              {alert.status} since {formatWhen(alert.raisedAt)}
              {alert.assignedTo ? ` · assigned to ${alert.assignedTo}` : ''}
            </p>
            {canWrite && alert.status !== 'resolved' ? (
              <div className="head-actions">
                <Button
                  size="small"
                  disabled={busyId === alert.id}
                  onClick={() =>
                    void run(
                      alert.id,
                      () => acknowledgeAlert(apiKey, alert.id, note),
                      'Alert acknowledged.',
                    )
                  }
                >
                  Acknowledge
                </Button>
                <Button
                  size="small"
                  disabled={busyId === alert.id}
                  onClick={() =>
                    void run(
                      alert.id,
                      () => resolveAlert(apiKey, alert.id, note),
                      'Alert resolved.',
                    )
                  }
                >
                  Resolve
                </Button>
                <Button
                  size="small"
                  disabled={busyId === alert.id || assignee.trim().length === 0}
                  onClick={() =>
                    void run(
                      alert.id,
                      () => assignAlert(apiKey, alert.id, assignee.trim()),
                      'Alert assigned.',
                    )
                  }
                >
                  Assign
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {canWrite && rows.length > 0 ? (
        <div className="row-2">
          <input
            className="input"
            placeholder="Note for acknowledge or resolve"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <input
            className="input"
            placeholder="Assignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          />
        </div>
      ) : null}
    </>
  );
}

export function ReportsPage() {
  const { apiKey, hasScope } = useSession();
  const { push } = useToast();
  const [report, setReport] = useState<string>('inventory');
  const table = useResource(`report:${report}`, () => fetchReport(apiKey, report));
  const [error, setError] = useState<string | null>(null);
  const canExport = hasScope('reports:read');

  return (
    <>
      <PageIntro
        eyebrow="Review"
        title="Reports"
        lede="Each report states its formula in the notes. CSV is the same table, and the download is audited."
        actions={
          canExport ? (
            <Button
              onClick={() => {
                setError(null);
                downloadReportCsv(apiKey, report)
                  .then(() => push('ok', 'CSV downloaded.'))
                  .catch((caught: unknown) => setError(failureText(caught)));
              }}
            >
              Download CSV
            </Button>
          ) : null
        }
      />
      <div className="toolbar">
        <select
          className="search"
          aria-label="Report"
          value={report}
          onChange={(event) => setReport(event.target.value)}
        >
          {REPORTS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <Button onClick={table.reload}>Reload</Button>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <ReportBlock
        table={table.data}
        status={table.status}
        error={table.error}
        onRetry={table.reload}
      />
    </>
  );
}

function ReportBlock({
  table,
  status,
  error,
  onRetry,
}: {
  table: ReportTable | null;
  status: 'loading' | 'ready' | 'error';
  error: string;
  onRetry: () => void;
}) {
  if (status === 'loading') return <SkeletonStack />;
  if (status === 'error') {
    return (
      <Banner tone="error" action={<Button onClick={onRetry}>Try again</Button>}>
        {error}
      </Banner>
    );
  }
  if (table === null) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{table.title}</h2>
        <span className="quiet">Generated {formatWhen(table.generatedAt)}</span>
      </div>
      {table.range?.from ? (
        <p className="quiet">
          Window {formatWhen(table.range.from)} to {formatWhen(table.range.to)}.
        </p>
      ) : null}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column.key} className={column.align === 'right' ? 'num' : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length}>No rows in this report.</td>
              </tr>
            ) : (
              table.rows.map((row, index) => (
                <tr key={`${table.report}-${index}`}>
                  {table.columns.map((column) => (
                    <td key={column.key} className={column.align === 'right' ? 'num' : undefined}>
                      {row[column.key] === null ||
                      row[column.key] === undefined ||
                      row[column.key] === ''
                        ? '-'
                        : String(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ul className="notes">
        {table.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsPage() {
  const session = useSession();
  const audit = useResource(session.hasScope('audit:read') ? 'audit' : 'audit:skip', () =>
    session.hasScope('audit:read')
      ? fetchAudit(session.apiKey)
      : Promise.resolve({ auditLogs: [] }),
  );
  return (
    <>
      <PageIntro
        eyebrow="Account"
        title="Settings"
        lede="This console signs in with an API key kept in this browser tab. It does not create users, and it does not show the key again after you connect."
        actions={<Button onClick={session.disconnect}>Sign out</Button>}
      />
      <section className="panel">
        <h2>This credential</h2>
        <dl className="definition">
          <dt>Tenant</dt>
          <dd>{session.session?.tenantId || 'Not returned by this API'}</dd>
          <dt>Principal</dt>
          <dd>{session.session?.principalId || 'Not returned by this API'}</dd>
          <dt>API</dt>
          <dd>
            {session.health?.status ?? 'unknown'} / database {session.health?.database ?? 'unknown'}
          </dd>
          <dt>Credentials store</dt>
          <dd>{session.health?.credentials ?? 'unknown'}</dd>
        </dl>
        <div className="meta">
          {(session.session?.scopes ?? []).map((scope) => (
            <Pill key={scope} tone="neutral">
              {scope}
            </Pill>
          ))}
        </div>
        {!session.scopesKnown ? (
          <p className="quiet">Scopes were not returned, so this page cannot list them.</p>
        ) : null}
      </section>
      {session.hasScope('audit:read') ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Recent audit</h2>
            <Button size="small" onClick={audit.reload}>
              Reload
            </Button>
          </div>
          {audit.status === 'error' ? <Banner tone="error">{audit.error}</Banner> : null}
          {(audit.data?.auditLogs.length ?? 0) === 0 ? (
            <p className="quiet">No audit entries returned.</p>
          ) : null}
          <ul className="notes">
            {(audit.data?.auditLogs ?? []).map((entry) => (
              <li key={entry.id}>
                {formatWhen(entry.occurredAt)} · {entry.action} · {entry.resourceType}
                {entry.resourceId ? ` ${entry.resourceId}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Banner tone="info">This key cannot read the audit trail.</Banner>
      )}
    </>
  );
}
