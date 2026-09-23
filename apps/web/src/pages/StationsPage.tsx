import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError, type ApiIssue } from '../lib/api';
import type { CreateStationBody, StationFormValues, UpdateStationBody } from '../lib/fleet-forms';
import { createStation, fetchStations, updateStation, type Station } from '../lib/resources';
import { useResource } from '../components/data';
import { PageIntro, StationDrawer } from '../components/forms';
import { AppLink, useRouter, useSession, useToast } from '../components/providers';
import { Banner, Button, EmptyState, Pill, SkeletonStack } from '../components/ui';

export function StationsPage() {
  const { apiKey, hasScope } = useSession();
  const { search, navigate } = useRouter();
  const { push } = useToast();
  const resource = useResource(`stations:${apiKey.slice(-6)}`, () => fetchStations(apiKey));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState<'create' | Station | null>(
    new URLSearchParams(search).get('new') === '1' ? 'create' : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<ReadonlyArray<ApiIssue>>([]);
  const canWrite = hasScope('stations:write');

  useEffect(() => {
    if (new URLSearchParams(search).get('new') === '1' && canWrite) {
      setOpen('create');
    }
  }, [search, canWrite]);

  const stations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (resource.data?.stations ?? [])
      .filter((station) => (status === 'all' ? true : station.status === status))
      .filter((station) =>
        needle.length === 0
          ? true
          : station.name.toLowerCase().includes(needle) ||
            station.code.toLowerCase().includes(needle),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [resource.data, query, status]);

  const fail = (error: unknown) => {
    if (error instanceof ApiRequestError) {
      setServerError(error.message);
      setServerIssues(error.issues);
      return;
    }
    setServerError(error instanceof Error ? error.message : 'Could not save the station.');
  };

  const onCreate = async (body: CreateStationBody) => {
    setSubmitting(true);
    setServerError(null);
    setServerIssues([]);
    try {
      const created = await createStation(apiKey, body);
      setOpen(null);
      push('ok', `${created.station.name} was created.`);
      resource.reload();
      navigate(`/stations/${created.station.id}`);
    } catch (error) {
      fail(error);
    } finally {
      setSubmitting(false);
    }
  };

  const onUpdate = async (body: UpdateStationBody) => {
    if (open === null || open === 'create') return;
    setSubmitting(true);
    setServerError(null);
    setServerIssues([]);
    try {
      const updated = await updateStation(apiKey, open.id, body);
      setOpen(null);
      push('ok', `${updated.station.name} was updated.`);
      resource.reload();
    } catch (error) {
      fail(error);
    } finally {
      setSubmitting(false);
    }
  };

  const editing: StationFormValues | undefined =
    open && open !== 'create'
      ? { name: open.name, code: open.code, timezone: open.timezone, status: open.status }
      : undefined;

  return (
    <>
      <PageIntro
        eyebrow="Network"
        title="Stations"
        lede="Each station is a site in this tenant. Codes are unique here and cannot be reused after creation."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              onClick={() => {
                setServerError(null);
                setServerIssues([]);
                setOpen('create');
              }}
            >
              Add station
            </Button>
          ) : null
        }
      />
      {!canWrite ? (
        <Banner tone="info">This key can view stations but cannot create or edit them.</Banner>
      ) : null}
      <div className="toolbar">
        <input
          className="search"
          value={query}
          placeholder="Search name or code"
          aria-label="Search stations"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="search"
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <Button onClick={resource.reload}>Reload</Button>
      </div>
      {resource.status === 'loading' ? <SkeletonStack /> : null}
      {resource.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={resource.reload}>Try again</Button>}>
          {resource.error}
        </Banner>
      ) : null}
      {resource.status === 'ready' && stations.length === 0 ? (
        <EmptyState
          title={
            resource.data?.stations.length ? 'No stations match this filter' : 'No stations yet'
          }
          body={
            resource.data?.stations.length
              ? 'Clear the search or status filter to see the rest of the network.'
              : 'Add a station before you add tanks. A station without tanks is a valid starting point.'
          }
          action={
            canWrite && !resource.data?.stations.length ? (
              <Button variant="primary" onClick={() => setOpen('create')}>
                Add station
              </Button>
            ) : null
          }
        />
      ) : null}
      {stations.length > 0 ? (
        <div className="grid cards">
          {stations.map((station) => (
            <article className="card" key={station.id}>
              <div className="card-top">
                <span className="code">{station.code}</span>
                <Pill tone={station.status}>{station.status}</Pill>
              </div>
              <h3>{station.name}</h3>
              <p className="quiet">{station.timezone}</p>
              <div className="card-actions">
                <AppLink className="btn small primary" to={`/stations/${station.id}`}>
                  Open
                </AppLink>
                {canWrite ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setServerError(null);
                      setServerIssues([]);
                      setOpen(station);
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {open ? (
        <StationDrawer
          mode={open === 'create' ? 'create' : 'edit'}
          initial={editing}
          submitting={submitting}
          serverIssues={serverIssues}
          serverError={serverError}
          onClose={() => {
            setOpen(null);
            if (new URLSearchParams(search).get('new') === '1') {
              navigate('/stations');
            }
          }}
          onCreate={(body) => void onCreate(body)}
          onUpdate={(body) => void onUpdate(body)}
        />
      ) : null}
    </>
  );
}
