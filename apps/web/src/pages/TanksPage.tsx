import { useMemo, useState } from 'react';
import { ApiRequestError, type ApiIssue } from '../lib/api';
import type { TankWriteBody } from '../lib/fleet-forms';
import { productLabel } from '../lib/labels';
import { createTank, fetchStations, fetchTankList, type TankSummary } from '../lib/resources';
import { useResource } from '../components/data';
import { PageIntro, TankDrawer } from '../components/forms';
import { AppLink, useRouter, useSession, useToast } from '../components/providers';
import { Banner, Button, EmptyState, FillBar, Pill, SkeletonStack } from '../components/ui';

export function TanksPage() {
  const { apiKey, hasScope } = useSession();
  const { search, navigate } = useRouter();
  const { push } = useToast();
  const stations = useResource('tank-stations', () => fetchStations(apiKey));
  const [stationId, setStationId] = useState(
    () => new URLSearchParams(search).get('station') ?? '',
  );
  const [status, setStatus] = useState('active');
  const tanks = useResource(`tanks:${stationId}:${status}`, () =>
    fetchTankList(apiKey, {
      stationId: stationId || undefined,
      status: status === 'all' ? undefined : status,
    }),
  );
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<ReadonlyArray<ApiIssue>>([]);
  const canWrite = hasScope('tanks:write');
  const stationOptions = stations.data?.stations ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (tanks.data?.summaries ?? []).filter((summary) => {
      if (needle.length === 0) return true;
      return (
        summary.tank.name.toLowerCase().includes(needle) ||
        (summary.station?.name.toLowerCase().includes(needle) ?? false) ||
        (summary.station?.code.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [tanks.data, query]);

  const onCreate = async (body: TankWriteBody) => {
    setSubmitting(true);
    setServerError(null);
    setServerIssues([]);
    try {
      const created = await createTank(apiKey, body);
      setOpen(false);
      push('ok', `${created.tank.name} was created.`);
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
        eyebrow="Network"
        title="Tanks"
        lede="Every tank belongs to one station. Capacity is a safe working volume, not a guess from a vendor nameplate."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              disabled={stationOptions.length === 0}
              onClick={() => setOpen(true)}
            >
              Add tank
            </Button>
          ) : null
        }
      />
      {stations.status === 'ready' && stationOptions.length === 0 ? (
        <EmptyState
          title="Add a station first"
          body="Tanks cannot be created until this tenant has a station to attach them to."
          action={
            <AppLink className="btn primary" to="/stations?new=1">
              Add station
            </AppLink>
          }
        />
      ) : null}
      <div className="toolbar">
        <input
          className="search"
          aria-label="Search tanks"
          placeholder="Search tank or station"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="search"
          aria-label="Filter by station"
          value={stationId}
          onChange={(event) => setStationId(event.target.value)}
        >
          <option value="">All stations</option>
          {stationOptions.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name}
            </option>
          ))}
        </select>
        <select
          className="search"
          aria-label="Filter by tank status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="active">Active</option>
          <option value="decommissioned">Decommissioned</option>
          <option value="all">All statuses</option>
        </select>
        <Button onClick={tanks.reload}>Reload</Button>
      </div>
      {tanks.status === 'loading' ? <SkeletonStack /> : null}
      {tanks.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={tanks.reload}>Try again</Button>}>
          {tanks.error}
        </Banner>
      ) : null}
      {tanks.status === 'ready' && rows.length === 0 && stationOptions.length > 0 ? (
        <EmptyState
          title="No tanks match"
          body="Change the station or status filter, or add a tank to an existing station."
        />
      ) : null}
      <div className="grid cards">
        {rows.map((summary) => (
          <TankCard key={summary.tank.id} summary={summary} />
        ))}
      </div>
      {open ? (
        <TankDrawer
          mode="create"
          stations={stationOptions}
          includeGeometry
          submitting={submitting}
          serverIssues={serverIssues}
          serverError={serverError}
          onClose={() => setOpen(false)}
          onCreate={(body) => void onCreate(body)}
          onUpdate={() => undefined}
        />
      ) : null}
    </>
  );
}

function TankCard({ summary }: { summary: TankSummary }) {
  return (
    <article className="card">
      <div className="card-top">
        <span className="code">{summary.station?.code ?? 'Station'}</span>
        <Pill
          tone={summary.dataMissingOrStale ? 'stale' : (summary.stockStatus ?? summary.tank.status)}
        >
          {summary.dataMissingOrStale
            ? 'Stale or missing'
            : (summary.stockStatus ?? summary.tank.status)}
        </Pill>
      </div>
      <h3>{summary.tank.name}</h3>
      <p className="meta">
        <span>{summary.station?.name ?? 'Unknown station'}</span>
        <span>{productLabel(summary.tank.product)}</span>
      </p>
      <FillBar
        percent={summary.fillPercent}
        tone={summary.stockStatus ?? undefined}
        label={`${summary.tank.capacityLitres.toLocaleString('en-GB')} L capacity`}
      />
      <div className="card-actions">
        <AppLink className="btn small primary" to={`/tanks/${summary.tank.id}`}>
          Open tank
        </AppLink>
      </div>
    </article>
  );
}
