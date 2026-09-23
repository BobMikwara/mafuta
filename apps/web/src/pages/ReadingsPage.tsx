import { formatLitres, formatWhen } from '../lib/format';
import { qualityLabel, sourceLabel } from '../lib/labels';
import { fetchReadings, fetchTankList } from '../lib/resources';
import { useResource } from '../components/data';
import { PageIntro } from '../components/forms';
import { AppLink, useRouter, useSession } from '../components/providers';
import { Banner, Button, EmptyState, Pill, SkeletonStack } from '../components/ui';

export function ReadingsPage() {
  const { apiKey } = useSession();
  const { search, navigate } = useRouter();
  const params = new URLSearchParams(search);
  const tankId = params.get('tank') ?? params.get('tankId') ?? '';
  const tanks = useResource('reading-tanks', () => fetchTankList(apiKey));
  const readings = useResource(tankId.length === 0 ? 'readings:none' : `readings:${tankId}`, () =>
    tankId.length === 0 ? Promise.resolve({ readings: [] }) : fetchReadings(apiKey, tankId, 100),
  );
  const selected = (tanks.data?.summaries ?? []).find((summary) => summary.tank.id === tankId);
  const timeZone = selected?.station?.timezone;

  return (
    <>
      <PageIntro
        eyebrow="Operate"
        title="Readings"
        lede="Stored measurements for one tank. Simulated and manual dips are labelled. A missing row is missing data, not a zero."
        actions={
          tankId ? (
            <AppLink className="btn" to={`/tanks/${tankId}`}>
              Open tank
            </AppLink>
          ) : null
        }
      />
      <div className="toolbar">
        <select
          className="search"
          aria-label="Tank"
          value={tankId}
          onChange={(event) => {
            const next = event.target.value;
            navigate(
              next.length === 0 ? '/readings' : `/readings?tank=${encodeURIComponent(next)}`,
            );
          }}
        >
          <option value="">Choose a tank</option>
          {(tanks.data?.tanks ?? []).map((tank) => (
            <option key={tank.id} value={tank.id}>
              {tank.name}
            </option>
          ))}
        </select>
        <Button onClick={readings.reload} disabled={tankId.length === 0}>
          Reload
        </Button>
      </div>
      {tanks.status === 'error' ? <Banner tone="error">{tanks.error}</Banner> : null}
      {tankId.length === 0 ? (
        <EmptyState
          title="Choose a tank"
          body="Readings belong to one tank. Pick a tank to see the stored history, including source and quality."
        />
      ) : null}
      {tankId && readings.status === 'loading' ? <SkeletonStack /> : null}
      {tankId && readings.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={readings.reload}>Try again</Button>}>
          {readings.error}
        </Banner>
      ) : null}
      {tankId && readings.status === 'ready' && (readings.data?.readings.length ?? 0) === 0 ? (
        <EmptyState
          title="No readings stored"
          body="Record a manual dip from the tank page, or wait for an assigned device to report. Nothing here is invented."
          action={
            <AppLink className="btn primary" to={`/tanks/${tankId}`}>
              Open tank
            </AppLink>
          }
        />
      ) : null}
      {(readings.data?.readings.length ?? 0) > 0 ? (
        <div className="table-scroll panel">
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
              {readings.data?.readings.map((reading) => (
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
      ) : null}
    </>
  );
}
