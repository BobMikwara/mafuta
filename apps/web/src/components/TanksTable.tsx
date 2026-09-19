import type { Tank, Reading } from '../lib/api';

interface Props {
  tanks: Tank[];
  latestByTank: Record<string, Reading>;
}

function formatPercent(tank: Tank, reading?: Reading): string {
  if (!reading) return 'no data';
  if (tank.capacityLitres <= 0) return '0%';
  const pct = (reading.netVolumeLitres / tank.capacityLitres) * 100;
  return `${pct.toFixed(1)}%`;
}

export function TanksTable({ tanks, latestByTank }: Props) {
  if (tanks.length === 0) {
    return (
      <section className="panel">
        <h2>Tanks</h2>
        <p className="empty">No tanks registered for this tenant.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Tanks</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Tank</th>
              <th>Product</th>
              <th>Level</th>
              <th>Net Volume</th>
              <th>Fill</th>
              <th>Temp</th>
              <th>Water</th>
              <th>Observed</th>
            </tr>
          </thead>
          <tbody>
            {tanks.map((tank) => {
              const reading = latestByTank[tank.id];
              const pct = reading
                ? Math.max(0, Math.min(100, (reading.netVolumeLitres / tank.capacityLitres) * 100))
                : 0;
              return (
                <tr key={tank.id}>
                  <td>{tank.name}</td>
                  <td>{tank.product}</td>
                  <td className="numeric">{reading ? `${reading.levelMm.toFixed(0)} mm` : '-'}</td>
                  <td className="numeric">{reading ? `${reading.netVolumeLitres.toFixed(0)} L` : '-'}</td>
                  <td>
                    <div className="progress-wrap">
                      <progress max={100} value={pct} />
                      <span>{formatPercent(tank, reading)}</span>
                    </div>
                  </td>
                  <td className="numeric">{reading?.temperatureC != null ? `${reading.temperatureC.toFixed(1)} C` : '-'}</td>
                  <td className="numeric">{reading ? `${reading.waterLevelMm.toFixed(1)} mm` : '-'}</td>
                  <td className="numeric">{reading ? new Date(reading.recordedAt).toLocaleString() : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
