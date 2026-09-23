import { AppShell, Gate } from './components/chrome';
import {
  AppLink,
  RouterProvider,
  SessionProvider,
  ToastProvider,
  useRouter,
  useSession,
} from './components/providers';
import { DashboardPage } from './pages/DashboardPage';
import { DevicePage, DevicesPage } from './pages/DevicesPage';
import { ReadingsPage } from './pages/ReadingsPage';
import {
  AlertsPage,
  DeliveriesPage,
  ReconciliationPage,
  ReportsPage,
  SettingsPage,
} from './pages/ReviewPages';
import { StationPage } from './pages/StationPage';
import { StationsPage } from './pages/StationsPage';
import { TankPage } from './pages/TankPage';
import { TanksPage } from './pages/TanksPage';
import { EmptyState } from './components/ui';

function Screen() {
  const session = useSession();
  const { route } = useRouter();
  if (session.status !== 'ready' || session.apiKey.length === 0) {
    return <Gate />;
  }

  return (
    <AppShell>
      {route.name === 'dashboard' ? <DashboardPage /> : null}
      {route.name === 'stations' ? <StationsPage /> : null}
      {route.name === 'station' && route.resourceId ? (
        <StationPage stationId={route.resourceId} />
      ) : null}
      {route.name === 'tanks' ? <TanksPage /> : null}
      {route.name === 'tank' && route.resourceId ? <TankPage tankId={route.resourceId} /> : null}
      {route.name === 'devices' ? <DevicesPage /> : null}
      {route.name === 'device' && route.resourceId ? (
        <DevicePage deviceId={route.resourceId} />
      ) : null}
      {route.name === 'readings' ? <ReadingsPage /> : null}
      {route.name === 'deliveries' ? <DeliveriesPage /> : null}
      {route.name === 'reconciliation' ? <ReconciliationPage /> : null}
      {route.name === 'alerts' ? <AlertsPage /> : null}
      {route.name === 'reports' ? <ReportsPage /> : null}
      {route.name === 'settings' ? <SettingsPage /> : null}
      {route.name === 'not-found' ? (
        <EmptyState
          title="That page is not in this console"
          body="The address does not match a screen that is implemented. Use the navigation to get back to the fleet."
          action={
            <AppLink className="btn primary" to="/">
              Dashboard
            </AppLink>
          }
        />
      ) : null}
    </AppShell>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <SessionProvider>
          <Screen />
        </SessionProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
