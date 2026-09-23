import { useState } from 'react';
import { ApiRequestError, type ApiIssue } from '../lib/api';
import { formatWhen } from '../lib/format';
import type { StationFormValues, TankWriteBody, UpdateStationBody } from '../lib/fleet-forms';
import { productLabel } from '../lib/labels';
import {
  createTank,
  fetchStation,
  fetchTankList,
  updateStation,
  type TankSummary,
} from '../lib/resources';
import { useResource } from '../components/data';
import { PageIntro, StationDrawer, TankDrawer } from '../components/forms';
import { AppLink, useRouter, useSession, useToast } from '../components/providers';
import { Banner, Button, EmptyState, FillBar, Pill, SkeletonStack } from '../components/ui';

export function StationPage({ stationId }: { stationId: string }) {
  const { apiKey, hasScope } = useSession();
  const { navigate } = useRouter();
  const { push } = useToast();
  const station = useResource(`station:${stationId}`, () => fetchStation(apiKey, stationId));
  const tanks = useResource(`station-tanks:${stationId}`, () =>
    fetchTankList(apiKey, { stationId }),
  );
  const [open, setOpen] = useState(false);
  const [editingStation, setEditingStation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<ReadonlyArray<ApiIssue>>([]);
  const record = station.data?.station;
  const summaries = tanks.data?.summaries ?? [];

  const onUpdateStation = async (body: UpdateStationBody) => {
    setSubmitting(true);
    setServerError(null);
    setServerIssues([]);
    try {
      const updated = await updateStation(apiKey, stationId, body);
      setEditingStation(false);
      push('ok', `${updated.station.name} was updated.`);
      station.reload();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerError(error.message);
        setServerIssues(error.issues);
      } else {
        setServerError(error instanceof Error ? error.message : 'Could not update the station.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onCreate = async (body: TankWriteBody) => {
    setSubmitting(true);
    setServerError(null);
    setServerIssues([]);
    try {
      const created = await createTank(apiKey, { ...body, stationId });
      setOpen(false);
      push('ok', `${created.tank.name} was added to ${record?.name ?? 'this station'}.`);
      tanks.reload();
      navigate(`/tanks/${created.tank.id}`);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerError(error.message);
        setServerIssues(error.issues);
      } else {
        setServerError(error instanceof Error ? error.message : 'Could not create the tank.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Station"
        title={record?.name ?? 'Station'}
        lede={record ? `${record.code} · ${record.timezone}` : 'Loading the station record.'}
        actions={
          <>
            <AppLink className="btn" to="/stations">
              All stations
            </AppLink>
            {hasScope('stations:write') && record ? (
              <Button
                onClick={() => {
                  setServerError(null);
                  setServerIssues([]);
                  setEditingStation(true);
                }}
              >
                Edit station
              </Button>
            ) : null}
            {hasScope('tanks:write') && record ? (
              <Button
                variant="primary"
                onClick={() => {
                  setServerError(null);
                  setServerIssues([]);
                  setOpen(true);
                }}
              >
                Add tank
              </Button>
            ) : null}
          </>
        }
      />
      {station.status === 'loading' ? <SkeletonStack /> : null}
      {station.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={station.reload}>Try again</Button>}>
          {station.error}
        </Banner>
      ) : null}
      {record ? (
        <section className="panel">
          <dl className="definition">
            <dt>Status</dt>
            <dd>
              <Pill tone={record.status}>{record.status}</Pill>
            </dd>
            <dt>Created</dt>
            <dd>{formatWhen(record.createdAt, record.timezone)}</dd>
            <dt>Updated</dt>
            <dd>{formatWhen(record.updatedAt, record.timezone)}</dd>
            <dt>Record</dt>
            <dd>
              <code>{record.id}</code>
            </dd>
          </dl>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-head">
          <h2>Tanks at this station</h2>
        </div>
        {tanks.status === 'error' ? <Banner tone="error">{tanks.error}</Banner> : null}
        {tanks.status === 'ready' && summaries.length === 0 ? (
          <EmptyState
            title="No tanks at this station"
            body="Add a tank with its shape, safe working capacity and alert thresholds. Readings can be recorded after the tank exists."
            action={
              hasScope('tanks:write') ? (
                <Button variant="primary" onClick={() => setOpen(true)}>
                  Add tank
                </Button>
              ) : (
                <p className="quiet">This key cannot add tanks.</p>
              )
            }
          />
        ) : null}
        <div className="grid">
          {summaries.map((summary) => (
            <TankLine key={summary.tank.id} summary={summary} timeZone={record?.timezone} />
          ))}
        </div>
      </section>
      {open && record ? (
        <TankDrawer
          mode="create"
          stations={[{ id: record.id, name: record.name, code: record.code }]}
          lockStation
          includeGeometry
          submitting={submitting}
          serverIssues={serverIssues}
          serverError={serverError}
          onClose={() => setOpen(false)}
          onCreate={(body) => void onCreate(body)}
          onUpdate={() => undefined}
        />
      ) : null}
      {editingStation && record ? (
        <StationDrawer
          mode="edit"
          initial={stationToForm(record)}
          submitting={submitting}
          serverIssues={serverIssues}
          serverError={serverError}
          onClose={() => setEditingStation(false)}
          onCreate={() => undefined}
          onUpdate={(body) => void onUpdateStation(body)}
        />
      ) : null}
    </>
  );
}

function stationToForm(station: {
  name: string;
  code: string;
  timezone: string;
  status: 'active' | 'inactive';
}): StationFormValues {
  return {
    name: station.name,
    code: station.code,
    timezone: station.timezone,
    status: station.status,
  };
}

function TankLine({ summary, timeZone }: { summary: TankSummary; timeZone?: string | undefined }) {
  return (
    <AppLink className="tank-row" to={`/tanks/${summary.tank.id}`}>
      <span className={`product-rail product-${summary.tank.product}`} />
      <span>
        <strong>{summary.tank.name}</strong>
        <span className="meta">
          <span>{productLabel(summary.tank.product)}</span>
          <span>{summary.tank.capacityLitres.toLocaleString('en-GB')} L capacity</span>
          <span>
            {summary.latestReading
              ? `Last reading ${formatWhen(summary.latestReading.recordedAt, timeZone)}`
              : 'No reading yet'}
          </span>
        </span>
        <FillBar
          percent={summary.fillPercent}
          tone={summary.stockStatus ?? undefined}
          label={summary.stockStatus ?? 'No stock status'}
        />
      </span>
      <Pill
        tone={summary.dataMissingOrStale ? 'stale' : (summary.stockStatus ?? summary.tank.status)}
      >
        {summary.dataMissingOrStale
          ? 'Stale or missing'
          : (summary.stockStatus ?? summary.tank.status)}
      </Pill>
    </AppLink>
  );
}
