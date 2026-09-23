import { useState } from 'react';
import { ApiRequestError } from '../lib/api';
import { formatWhen } from '../lib/format';
import { protocolLabel } from '../lib/labels';
import {
  assignDevice,
  fetchDevice,
  fetchDevices,
  fetchTankList,
  registerDevice,
  unassignDevice,
  type DeviceView,
} from '../lib/resources';
import { useResource } from '../components/data';
import { DeviceDrawer, PageIntro } from '../components/forms';
import { AppLink, useSession, useToast } from '../components/providers';
import { Banner, Button, EmptyState, Pill, SkeletonStack } from '../components/ui';

export function DevicesPage() {
  const { apiKey, hasScope } = useSession();
  const { push } = useToast();
  const devices = useResource('devices', () => fetchDevices(apiKey));
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const rows = devices.data?.devices ?? [];
  const canWrite = hasScope('devices:write');

  const onCreate = async (body: {
    manufacturer: string;
    model: string;
    serialNumber: string;
    protocol: string;
    firmwareVersion?: string;
  }) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const created = await registerDevice(apiKey, body);
      setOpen(false);
      push('ok', `${created.device.serialNumber} was registered.`);
      devices.reload();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not register the device.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Operate"
        title="Devices"
        lede="A device is a probe or gateway registered for this tenant. Protocol is a label. This console does not invent a vendor packet format."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setOpen(true)}>
              Register device
            </Button>
          ) : null
        }
      />
      {devices.status === 'loading' ? <SkeletonStack /> : null}
      {devices.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={devices.reload}>Try again</Button>}>
          {devices.error}
        </Banner>
      ) : null}
      {devices.status === 'ready' && rows.length === 0 ? (
        <EmptyState
          title="No devices registered"
          body="Register a probe when you know its manufacturer, model and serial number. Until it reports, it is shown as offline, not as a live gauge."
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setOpen(true)}>
                Register device
              </Button>
            ) : null
          }
        />
      ) : null}
      {rows.length > 0 ? (
        <div className="table-scroll panel">
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Model</th>
                <th>Protocol</th>
                <th>Connection</th>
                <th>Station</th>
                <th>Tank</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((view) => (
                <DeviceRow key={view.device.id} view={view} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {open ? (
        <DeviceDrawer
          submitting={submitting}
          serverError={serverError}
          onClose={() => setOpen(false)}
          onCreate={(body) => void onCreate(body)}
        />
      ) : null}
    </>
  );
}

function DeviceRow({ view }: { view: DeviceView }) {
  return (
    <tr>
      <td>
        <AppLink to={`/devices/${view.device.id}`}>{view.device.serialNumber}</AppLink>
      </td>
      <td>
        {view.device.manufacturer} {view.device.model}
      </td>
      <td>
        <Pill tone={view.device.protocol === 'simulated' ? 'simulated' : 'neutral'}>
          {protocolLabel(view.device.protocol)}
        </Pill>
      </td>
      <td>
        <Pill tone={view.online ? 'ok' : 'offline'}>{view.online ? 'Online' : 'Offline'}</Pill>
      </td>
      <td>{view.stationName ?? 'Unassigned'}</td>
      <td>{view.tankName ?? 'Unassigned'}</td>
      <td>{view.device.lastSeenAt ? formatWhen(view.device.lastSeenAt) : 'Never reported'}</td>
    </tr>
  );
}

export function DevicePage({ deviceId }: { deviceId: string }) {
  const { apiKey, hasScope } = useSession();
  const { push } = useToast();
  const detail = useResource(`device:${deviceId}`, () => fetchDevice(apiKey, deviceId));
  const tanks = useResource('device-tanks', () => fetchTankList(apiKey, { status: 'active' }));
  const [tankId, setTankId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = detail.data?.device;
  const canWrite = hasScope('devices:write');

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      push('ok', message);
      detail.reload();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'The device action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Device"
        title={view?.device.serialNumber ?? 'Device'}
        lede={
          view
            ? `${view.device.manufacturer} ${view.device.model}. Protocol ${protocolLabel(view.device.protocol)}.`
            : 'Loading the device record.'
        }
        actions={
          <AppLink className="btn" to="/devices">
            All devices
          </AppLink>
        }
      />
      {detail.status === 'loading' ? <SkeletonStack /> : null}
      {detail.status === 'error' ? <Banner tone="error">{detail.error}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {view && detail.data ? (
        <section className="grid two">
          <article className="panel">
            <dl className="definition">
              <dt>Status</dt>
              <dd>
                <Pill tone={view.device.status === 'active' ? 'ok' : 'neutral'}>
                  {view.device.status}
                </Pill>
              </dd>
              <dt>Connection</dt>
              <dd>
                <Pill tone={view.online ? 'ok' : 'offline'}>
                  {view.online ? 'Online' : 'Offline'}
                </Pill>
              </dd>
              <dt>Last seen</dt>
              <dd>
                {view.device.lastSeenAt ? formatWhen(view.device.lastSeenAt) : 'Never reported'}
              </dd>
              <dt>Assigned tank</dt>
              <dd>
                {view.tankId ? (
                  <AppLink to={`/tanks/${view.tankId}`}>{view.tankName}</AppLink>
                ) : (
                  'Not assigned'
                )}
              </dd>
              <dt>Raw messages retained</dt>
              <dd>{detail.data.rawMessageCount}. This console does not display raw payloads.</dd>
            </dl>
            {canWrite ? (
              <div className="form-section">
                <label htmlFor="assign-tank">Assign to tank</label>
                <select
                  id="assign-tank"
                  className="input"
                  value={tankId}
                  onChange={(event) => setTankId(event.target.value)}
                >
                  <option value="">Choose a tank</option>
                  {(tanks.data?.tanks ?? []).map((tank) => (
                    <option key={tank.id} value={tank.id}>
                      {tank.name}
                    </option>
                  ))}
                </select>
                <div className="head-actions">
                  <Button
                    variant="primary"
                    disabled={busy || tankId.length === 0}
                    onClick={() =>
                      void run(() => assignDevice(apiKey, deviceId, tankId), 'Device assigned.')
                    }
                  >
                    Assign
                  </Button>
                  <Button
                    disabled={busy || view.tankId === null}
                    onClick={() =>
                      void run(() => unassignDevice(apiKey, deviceId), 'Device unassigned.')
                    }
                  >
                    Unassign
                  </Button>
                </div>
              </div>
            ) : (
              <p className="quiet">This key cannot change device assignments.</p>
            )}
          </article>
          <article className="panel">
            <h2>Assignment history</h2>
            {detail.data.assignmentHistory.length === 0 ? (
              <p className="quiet">No assignment has been recorded.</p>
            ) : (
              <ul className="notes">
                {detail.data.assignmentHistory.map((item) => (
                  <li key={item.id}>
                    Tank {item.tankId}, {item.status}, from {formatWhen(item.assignedAt)}
                    {item.unassignedAt ? ` until ${formatWhen(item.unassignedAt)}` : ''}.
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      ) : null}
    </>
  );
}
