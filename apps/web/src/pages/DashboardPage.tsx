import { formatCount, formatWhen, litresFromMl } from '../lib/format';
import { productLabel } from '../lib/labels';
import { fetchDashboard } from '../lib/resources';
import { usePolling, useResource } from '../components/data';
import { PageIntro } from '../components/forms';
import { AppLink, useSession } from '../components/providers';
import { Banner, Button, EmptyState, FillBar, Pill, SkeletonStack } from '../components/ui';

export function DashboardPage() {
  const { apiKey, hasScope } = useSession();
  const resource = useResource('dashboard', () => fetchDashboard(apiKey));
  usePolling(resource.reload, 30_000, resource.status !== 'error');
  const data = resource.data;

  return (
    <>
      <PageIntro
        eyebrow="Overview"
        title="What needs a decision"
        lede="Stock, alerts and candidate deliveries from the stored tenant record. This page reloads every 30 seconds. It does not invent readings."
        actions={
          <>
            <Button onClick={resource.reload}>Reload</Button>
            {hasScope('stations:write') ? (
              <AppLink className="btn primary" to="/stations?new=1">
                Add station
              </AppLink>
            ) : null}
          </>
        }
      />
      {resource.status === 'loading' ? <SkeletonStack /> : null}
      {resource.status === 'error' ? (
        <Banner tone="error" action={<Button onClick={resource.reload}>Try again</Button>}>
          {resource.error}
        </Banner>
      ) : null}
      {data && data.counts.stations === 0 ? (
        <EmptyState
          title="No stations in this tenant yet"
          body="Add the first station, then add the tanks that belong to it. The dashboard stays empty until those records exist."
          action={
            hasScope('stations:write') ? (
              <AppLink className="btn primary" to="/stations?new=1">
                Add station
              </AppLink>
            ) : (
              <p className="quiet">This key cannot create stations.</p>
            )
          }
        />
      ) : null}
      {data && data.counts.stations > 0 ? (
        <>
          <section className="grid metrics" aria-label="Stock summary">
            <article className="metric featured">
              <span className="label">Net volume on hand</span>
              <span className="value">{litresFromMl(data.stock.netVolumeMl)}</span>
              <span className="hint">
                {data.stock.fillPercent}% of {litresFromMl(data.stock.capacityMl)} capacity. Updated{' '}
                {formatWhen(data.generatedAt)}.
              </span>
            </article>
            <article className="metric">
              <span className="label">Below critical</span>
              <span className="value">{formatCount(data.stock.tanksBelowCritical)}</span>
              <span className="hint">
                {formatCount(data.stock.tanksBelowLow)} tanks at or below low.
              </span>
            </article>
            <article className="metric">
              <span className="label">Open alerts</span>
              <span className="value">{formatCount(data.alerts.open)}</span>
              <span className="hint">{formatCount(data.alerts.bySeverity.critical)} critical.</span>
            </article>
            <article className="metric">
              <span className="label">Awaiting a decision</span>
              <span className="value">{formatCount(data.counts.eventsAwaitingDecision)}</span>
              <span className="hint">Candidate events are not confirmed deliveries.</span>
            </article>
          </section>
          {(data.stock.tanksWithoutReading > 0 || data.stock.tanksWithStaleData > 0) && (
            <Banner tone="warn">
              {formatCount(data.stock.tanksWithoutReading)} tanks have no reading, and{' '}
              {formatCount(data.stock.tanksWithStaleData)} have data older than their stale
              threshold. Those tanks are not shown as zero stock.
            </Banner>
          )}
          <section className="grid two">
            <article className="panel">
              <div className="panel-head">
                <h2>Tanks needing attention</h2>
                <AppLink to="/tanks">All tanks</AppLink>
              </div>
              {data.tanksNeedingAttention.length === 0 ? (
                <p className="quiet">
                  No open alerts, low stock, or stale readings in the current summaries.
                </p>
              ) : (
                <div className="grid">
                  {data.tanksNeedingAttention.slice(0, 6).map((summary) => (
                    <AppLink
                      key={summary.tank.id}
                      className="tank-row"
                      to={`/tanks/${summary.tank.id}`}
                    >
                      <span className={`product-rail product-${summary.tank.product}`} />
                      <span>
                        <strong>{summary.tank.name}</strong>
                        <span className="meta">
                          <span>{summary.station?.name ?? 'Unassigned station'}</span>
                          <span>{productLabel(summary.tank.product)}</span>
                        </span>
                      </span>
                      <Pill
                        tone={
                          summary.stockStatus ?? (summary.dataMissingOrStale ? 'stale' : 'neutral')
                        }
                      >
                        {summary.dataMissingOrStale
                          ? 'Stale or missing'
                          : (summary.stockStatus ?? 'Unknown')}
                      </Pill>
                    </AppLink>
                  ))}
                </div>
              )}
            </article>
            <article className="panel">
              <div className="panel-head">
                <h2>By product</h2>
              </div>
              <div className="bars">
                {data.products.length === 0 ? (
                  <p className="quiet">No product totals yet.</p>
                ) : null}
                {data.products.map((product) => (
                  <div className="bar-row" key={product.product}>
                    <span>{productLabel(product.product)}</span>
                    <div className="bar-track" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, product.fillPercent)}%` }} />
                    </div>
                    <span className="quiet">{product.fillPercent}%</span>
                  </div>
                ))}
              </div>
              <p className="chart-note">
                Devices online {formatCount(data.counts.devicesOnline)} of{' '}
                {formatCount(data.counts.devices)}. Readings in the last 24 hours:{' '}
                {formatCount(data.counts.readingsLast24h)}.
              </p>
            </article>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Stations</h2>
              <AppLink to="/stations">Manage stations</AppLink>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>Code</th>
                    <th className="num">Tanks</th>
                    <th className="num">Net volume</th>
                    <th className="num">Fill</th>
                    <th className="num">Open alerts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map((row) => (
                    <tr key={row.station.id}>
                      <td>
                        <AppLink to={`/stations/${row.station.id}`}>{row.station.name}</AppLink>
                      </td>
                      <td className="code">{row.station.code}</td>
                      <td className="num">{formatCount(row.tankCount)}</td>
                      <td className="num">{litresFromMl(row.netVolumeMl)}</td>
                      <td className="num">{row.fillPercent}%</td>
                      <td className="num">{formatCount(row.openAlertCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {data.recentDeliveries.length > 0 ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Confirmed deliveries</h2>
                <AppLink to="/deliveries">Ledger</AppLink>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Station</th>
                      <th>Tank</th>
                      <th className="num">Recorded</th>
                      <th className="num">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentDeliveries.map((delivery) => (
                      <tr key={delivery.id}>
                        <td>{formatWhen(delivery.confirmedAt)}</td>
                        <td>{delivery.stationName}</td>
                        <td>{delivery.tankName}</td>
                        <td className="num">{litresFromMl(delivery.recordedVolumeMl)}</td>
                        <td className="num">{litresFromMl(delivery.varianceMl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="chart-note">
                Times on this overview are UTC. A station page uses that station's timezone.
              </p>
            </section>
          ) : null}
          <FillBar percent={data.stock.fillPercent} label="Fleet fill" />
        </>
      ) : null}
    </>
  );
}
