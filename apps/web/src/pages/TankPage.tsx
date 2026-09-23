import { useState } from 'react';
import { ApiRequestError, type ApiIssue } from '../lib/api';
import { formatLitres, formatWhen, litresFromMl } from '../lib/format';
import {
  buildDipBody,
  DEFAULT_TANK_FORM,
  issueMap,
  validateDip,
  type DipFormValues,
  type TankFormValues,
  type UpdateTankBody,
} from '../lib/fleet-forms';
import { isFuelProduct, productLabel, qualityLabel, sourceLabel } from '../lib/labels';
import {
  fetchReadings,
  fetchSeries,
  fetchTank,
  recordDip,
  updateTank,
  type Reading,
  type Tank,
} from '../lib/resources';
import { usePolling, useResource } from '../components/data';
import { PageIntro, TankDrawer } from '../components/forms';
import { AppLink, useSession, useToast } from '../components/providers';
import {
  Banner,
  Button,
  Drawer,
  FillBar,
  FormFooter,
  Pill,
  SkeletonStack,
  TextField,
  fieldError,
  onFormSubmit,
} from '../components/ui';

export function TankPage({ tankId }: { tankId: string }) {
  const { apiKey, hasScope } = useSession();
  const { push } = useToast();
  const summary = useResource(`tank:${tankId}`, () => fetchTank(apiKey, tankId));
  const readings = useResource(`readings:${tankId}`, () => fetchReadings(apiKey, tankId, 30));
  const series = useResource(`series:${tankId}`, () => fetchSeries(apiKey, tankId, 24));
  usePolling(summary.reload, 30_000, summary.status !== 'error');
  const [editing, setEditing] = useState(false);
  const [dipping, setDipping] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<ReadonlyArray<ApiIssue>>([]);
  const tank = summary.data?.tank;
  const timeZone = summary.data?.station?.timezone;

  const onUpdate = async (body: UpdateTankBody) => {
    setSubmitting(true);
    setServerError(null);
    setServerIssues([]);
    try {
      const updated = await updateTank(apiKey, tankId, body);
      setEditing(false);
      push('ok', `${updated.tank.name} was updated.`);
      summary.reload();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setServerError(error.message);
        setServerIssues(error.issues);
      } else {
        setServerError(error instanceof Error ? error.message : 'Could not update the tank.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow={summary.data?.station?.name ?? 'Tank'}
        title={tank?.name ?? 'Tank'}
        lede={
          tank
            ? `${productLabel(tank.product)} · ${tank.capacityLitres.toLocaleString('en-GB')} L safe working capacity`
            : 'Loading the tank record.'
        }
        actions={
          <>
            <AppLink className="btn" to="/tanks">
              All tanks
            </AppLink>
            {hasScope('readings:write') && tank?.status === 'active' ? (
              <Button onClick={() => setDipping(true)}>Record dip</Button>
            ) : null}
            {hasScope('tanks:write') && tank ? (
              <Button variant="primary" onClick={() => setEditing(true)}>
                Edit tank
              </Button>
            ) : null}
          </>
        }
      />
      {summary.status === 'loading' ? <SkeletonStack /> : null}
      {summary.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={summary.reload}>Try again</Button>}>
          {summary.error}
        </Banner>
      ) : null}
      {summary.data && tank ? (
        <>
          {summary.data.dataMissingOrStale ? (
            <Banner tone="warn">
              {summary.data.latestReading
                ? "The latest reading is older than this tank's stale threshold. It is shown as stale, not as a live level."
                : 'This tank has no reading yet. Stock is unknown, not zero.'}
            </Banner>
          ) : null}
          <section className="grid metrics">
            <article className="metric featured">
              <span className="label">Net volume</span>
              <span className="value">
                {summary.data.netVolumeMl === null
                  ? 'Unknown'
                  : litresFromMl(summary.data.netVolumeMl)}
              </span>
              <span className="hint">
                {summary.data.latestReading
                  ? `Reading ${formatWhen(summary.data.latestReading.recordedAt, timeZone)}`
                  : 'No reading recorded'}
              </span>
            </article>
            <article className="metric">
              <span className="label">Fill</span>
              <FillBar
                percent={summary.data.fillPercent}
                tone={summary.data.stockStatus ?? undefined}
                label="of capacity"
              />
            </article>
            <article className="metric">
              <span className="label">Stock status</span>
              <span className="value" style={{ fontSize: 22 }}>
                {summary.data.stockStatus ?? 'Unknown'}
              </span>
              <span className="hint">{summary.data.openAlertCount} open alerts</span>
            </article>
            <article className="metric">
              <span className="label">Tank status</span>
              <Pill tone={tank.status}>{tank.status}</Pill>
              <span className="hint">{tank.geometry.kind}</span>
            </article>
          </section>
          <section className="grid two">
            <article className="panel">
              <div className="panel-head">
                <h2>Last 24 hours</h2>
              </div>
              <SeriesChart
                points={series.data?.series.buckets ?? []}
                capacityMl={series.data?.series.capacityMl ?? 0}
              />
              <p className="chart-note">
                Each point is a real bucket from stored readings. Gaps mean no accepted reading in
                that hour.
              </p>
            </article>
            <article className="panel">
              <div className="panel-head">
                <h2>Record</h2>
              </div>
              <dl className="definition">
                <dt>Station</dt>
                <dd>
                  {summary.data.station ? (
                    <AppLink to={`/stations/${summary.data.station.id}`}>
                      {summary.data.station.name}
                    </AppLink>
                  ) : (
                    'Unknown'
                  )}
                </dd>
                <dt>Product</dt>
                <dd>{productLabel(tank.product)}</dd>
                <dt>Calibration</dt>
                <dd>{tank.calibrationSource ?? 'Not recorded'}</dd>
                <dt>Water alarm</dt>
                <dd>{tank.thresholds.waterAlarmMm} mm</dd>
                <dt>Stale after</dt>
                <dd>{tank.thresholds.staleAfterMinutes} minutes</dd>
                <dt>Updated</dt>
                <dd>{formatWhen(tank.updatedAt, timeZone)}</dd>
              </dl>
            </article>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Readings</h2>
              <AppLink to={`/readings?tank=${encodeURIComponent(tank.id)}`}>Open readings</AppLink>
            </div>
            {readings.status === 'error' ? <Banner tone="error">{readings.error}</Banner> : null}
            <ReadingTable readings={readings.data?.readings ?? []} timeZone={timeZone} />
          </section>
        </>
      ) : null}
      {editing && tank ? (
        <TankDrawer
          mode="edit"
          stations={
            summary.data?.station
              ? [
                  {
                    id: summary.data.station.id,
                    name: summary.data.station.name,
                    code: summary.data.station.code,
                  },
                ]
              : []
          }
          initial={tankToForm(tank)}
          includeGeometry={
            tank.geometry.kind === 'horizontal-cylinder' ||
            tank.geometry.kind === 'vertical-cylinder'
          }
          submitting={submitting}
          serverIssues={serverIssues}
          serverError={serverError}
          onClose={() => setEditing(false)}
          onCreate={() => undefined}
          onUpdate={(body) => void onUpdate(body)}
        />
      ) : null}
      {dipping && tank ? (
        <DipDrawer
          timeZone={timeZone ?? 'UTC'}
          submitting={submitting}
          onClose={() => setDipping(false)}
          onSubmit={async (values) => {
            const body = buildDipBody(values, timeZone ?? 'UTC', crypto.randomUUID());
            if (body === null) return;
            setSubmitting(true);
            try {
              const result = await recordDip(apiKey, tankId, body);
              setDipping(false);
              push('ok', result.duplicate ? 'That dip was already recorded.' : 'Dip recorded.');
              summary.reload();
              readings.reload();
              series.reload();
            } catch (error) {
              push('error', error instanceof Error ? error.message : 'Could not record the dip.');
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function tankToForm(tank: Tank): TankFormValues {
  const kind =
    tank.geometry.kind === 'vertical-cylinder' ? 'vertical-cylinder' : 'horizontal-cylinder';
  const span =
    tank.geometry.kind === 'vertical-cylinder'
      ? tank.geometry.heightMm
      : tank.geometry.kind === 'horizontal-cylinder'
        ? tank.geometry.lengthMm
        : null;
  const diameter = tank.geometry.kind === 'strapping-table' ? null : tank.geometry.diameterMm;
  return {
    ...DEFAULT_TANK_FORM,
    stationId: tank.stationId,
    name: tank.name,
    product: isFuelProduct(tank.product) ? tank.product : DEFAULT_TANK_FORM.product,
    geometryKind: kind,
    diameterMm: diameter === null ? '' : String(diameter),
    lengthOrHeightMm: span === null ? '' : String(span),
    capacityLitres: String(tank.capacityLitres),
    criticalLowPercent: String(tank.thresholds.criticalLowPercent),
    lowPercent: String(tank.thresholds.lowPercent),
    highPercent: String(tank.thresholds.highPercent),
    waterAlarmMm: String(tank.thresholds.waterAlarmMm),
    rapidDropLitresPerHour: String(tank.thresholds.rapidDropLitresPerHour),
    deliveryLitres: String(tank.thresholds.deliveryLitres),
    deliveryWindowMinutes: String(tank.thresholds.deliveryWindowMinutes),
    staleAfterMinutes: String(tank.thresholds.staleAfterMinutes),
    calibrationSource: tank.calibrationSource ?? '',
    status: tank.status,
  };
}

function SeriesChart({
  points,
  capacityMl,
}: {
  points: ReadonlyArray<{ at: string; netVolumeMl: number; readingCount: number }>;
  capacityMl: number;
}) {
  const measured = points.filter((point) => point.readingCount > 0);
  if (measured.length === 0) {
    return <p className="quiet">No accepted readings in the last 24 hours.</p>;
  }
  const width = 640;
  const height = 180;
  const max = Math.max(capacityMl, ...measured.map((point) => point.netVolumeMl), 1);
  const step = points.length === 1 ? width : width / (points.length - 1);
  const coords = measured.map((point) => {
    const index = points.indexOf(point);
    const x = index * step;
    const y = height - (point.netVolumeMl / max) * (height - 12) - 6;
    return `${x},${y}`;
  });
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Net volume over the last 24 hours"
    >
      <polyline fill="none" stroke="#0f6b52" strokeWidth="2.5" points={coords.join(' ')} />
    </svg>
  );
}

function ReadingTable({
  readings,
  timeZone,
}: {
  readings: ReadonlyArray<Reading>;
  timeZone?: string | undefined;
}) {
  if (readings.length === 0) {
    return <p className="quiet">No readings stored for this tank.</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Recorded</th>
            <th>Source</th>
            <th>Quality</th>
            <th className="num">Level</th>
            <th className="num">Water</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {readings.map((reading) => (
            <tr key={reading.id}>
              <td>
                {formatWhen(reading.recordedAt, timeZone)}
                {reading.isStale ? <Pill tone="stale">Stale</Pill> : null}
              </td>
              <td>
                <Pill
                  tone={
                    reading.source === 'simulated'
                      ? 'simulated'
                      : reading.source === 'manual'
                        ? 'manual'
                        : 'neutral'
                  }
                >
                  {sourceLabel(reading.source)}
                </Pill>
              </td>
              <td>{qualityLabel(reading.quality)}</td>
              <td className="num">{reading.levelMm} mm</td>
              <td className="num">{reading.waterLevelMm} mm</td>
              <td className="num">{formatLitres(reading.netVolumeLitres)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DipDrawer({
  timeZone,
  submitting,
  onClose,
  onSubmit,
}: {
  timeZone: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: DipFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<DipFormValues>({
    observedAtLocal: '',
    levelMm: '',
    waterLevelMm: '0',
    temperatureC: '',
  });
  const [issues, setIssues] = useState(issueMap([]));
  const submit = () => {
    const next = validateDip(values);
    setIssues(issueMap(next));
    if (
      next.length > 0 ||
      buildDipBody(values, timeZone, '00000000-0000-4000-8000-000000000000') === null
    )
      return;
    void onSubmit(values);
  };
  return (
    <Drawer
      title="Record a manual dip"
      description={`The time is interpreted in ${timeZone} and stored in UTC. This is an operator measurement, not a probe reading.`}
      onClose={onClose}
      footer={
        <FormFooter
          formId="dip-form"
          submitting={submitting}
          submitLabel="Save dip"
          onCancel={onClose}
          dirty={values.levelMm.length > 0}
          confirmDiscard={false}
          onConfirmDiscard={onClose}
        />
      }
    >
      <form id="dip-form" onSubmit={(event) => onFormSubmit(event, submit)}>
        <TextField
          label="Observed at"
          name="observedAt"
          type="datetime-local"
          required
          value={values.observedAtLocal}
          error={fieldError(issues, 'observedAtLocal')}
          onChange={(value) => setValues((current) => ({ ...current, observedAtLocal: value }))}
        />
        <TextField
          label="Product level (mm)"
          name="levelMm"
          type="number"
          required
          value={values.levelMm}
          error={fieldError(issues, 'levelMm')}
          onChange={(value) => setValues((current) => ({ ...current, levelMm: value }))}
        />
        <TextField
          label="Water level (mm)"
          name="waterLevelMm"
          type="number"
          value={values.waterLevelMm}
          error={fieldError(issues, 'waterLevelMm')}
          onChange={(value) => setValues((current) => ({ ...current, waterLevelMm: value }))}
        />
        <TextField
          label="Temperature (C)"
          name="temperatureC"
          type="number"
          value={values.temperatureC}
          help="Optional."
          error={fieldError(issues, 'temperatureC')}
          onChange={(value) => setValues((current) => ({ ...current, temperatureC: value }))}
        />
      </form>
    </Drawer>
  );
}
