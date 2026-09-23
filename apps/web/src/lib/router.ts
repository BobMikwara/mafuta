export type PageName =
  | 'dashboard'
  | 'stations'
  | 'station'
  | 'tanks'
  | 'tank'
  | 'devices'
  | 'device'
  | 'readings'
  | 'deliveries'
  | 'reconciliation'
  | 'alerts'
  | 'reports'
  | 'settings'
  | 'not-found';

export interface ParsedRoute {
  readonly name: PageName;
  readonly resourceId: string | null;
  readonly title: string;
  readonly nav: PageName;
}

export interface NavItem {
  readonly name: PageName;
  readonly href: string;
  readonly label: string;
  readonly group: 'Operate' | 'Review' | 'Account';
  readonly icon: string;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { name: 'dashboard', href: '/', label: 'Dashboard', group: 'Operate', icon: 'dashboard' },
  { name: 'stations', href: '/stations', label: 'Stations', group: 'Operate', icon: 'stations' },
  { name: 'tanks', href: '/tanks', label: 'Tanks', group: 'Operate', icon: 'tanks' },
  { name: 'devices', href: '/devices', label: 'Devices', group: 'Operate', icon: 'devices' },
  { name: 'readings', href: '/readings', label: 'Readings', group: 'Operate', icon: 'readings' },
  {
    name: 'deliveries',
    href: '/deliveries',
    label: 'Deliveries',
    group: 'Review',
    icon: 'deliveries',
  },
  {
    name: 'reconciliation',
    href: '/reconciliation',
    label: 'Reconciliation',
    group: 'Review',
    icon: 'reconciliation',
  },
  { name: 'alerts', href: '/alerts', label: 'Alerts', group: 'Review', icon: 'alerts' },
  { name: 'reports', href: '/reports', label: 'Reports', group: 'Review', icon: 'reports' },
  { name: 'settings', href: '/settings', label: 'Settings', group: 'Account', icon: 'settings' },
];

const TITLES: Record<PageName, string> = {
  dashboard: 'Dashboard',
  stations: 'Stations',
  station: 'Station',
  tanks: 'Tanks',
  tank: 'Tank',
  devices: 'Devices',
  device: 'Device',
  readings: 'Fuel readings',
  deliveries: 'Deliveries',
  reconciliation: 'Reconciliation',
  alerts: 'Alerts',
  reports: 'Reports',
  settings: 'Settings',
  'not-found': 'Page not found',
};

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Maps a pathname onto a page. Query strings are ignored here; callers read
 * them from `location.search` so filters survive a refresh.
 */
export function parsePath(pathname: string): ParsedRoute {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const parts = path.split('/').filter((part) => part.length > 0);

  if (parts.length === 0) {
    return { name: 'dashboard', resourceId: null, title: TITLES.dashboard, nav: 'dashboard' };
  }

  const head = parts[0];
  const id = parts[1] === undefined ? null : decodeSegment(parts[1]);

  if (head === 'stations' && parts.length === 1) {
    return { name: 'stations', resourceId: null, title: TITLES.stations, nav: 'stations' };
  }
  if (head === 'stations' && id !== null && parts.length === 2) {
    return { name: 'station', resourceId: id, title: TITLES.station, nav: 'stations' };
  }
  if (head === 'tanks' && parts.length === 1) {
    return { name: 'tanks', resourceId: null, title: TITLES.tanks, nav: 'tanks' };
  }
  if (head === 'tanks' && id !== null && parts.length === 2) {
    return { name: 'tank', resourceId: id, title: TITLES.tank, nav: 'tanks' };
  }
  if (head === 'devices' && parts.length === 1) {
    return { name: 'devices', resourceId: null, title: TITLES.devices, nav: 'devices' };
  }
  if (head === 'devices' && id !== null && parts.length === 2) {
    return { name: 'device', resourceId: id, title: TITLES.device, nav: 'devices' };
  }
  if (head === 'readings' && parts.length === 1) {
    return { name: 'readings', resourceId: null, title: TITLES.readings, nav: 'readings' };
  }
  if (head === 'deliveries' && parts.length === 1) {
    return { name: 'deliveries', resourceId: null, title: TITLES.deliveries, nav: 'deliveries' };
  }
  if (head === 'reconciliation' && parts.length === 1) {
    return {
      name: 'reconciliation',
      resourceId: null,
      title: TITLES.reconciliation,
      nav: 'reconciliation',
    };
  }
  if (head === 'alerts' && parts.length === 1) {
    return { name: 'alerts', resourceId: null, title: TITLES.alerts, nav: 'alerts' };
  }
  if (head === 'reports' && parts.length === 1) {
    return { name: 'reports', resourceId: null, title: TITLES.reports, nav: 'reports' };
  }
  if (head === 'settings' && parts.length === 1) {
    return { name: 'settings', resourceId: null, title: TITLES.settings, nav: 'settings' };
  }
  if (head === 'dashboard' && parts.length === 1) {
    return { name: 'dashboard', resourceId: null, title: TITLES.dashboard, nav: 'dashboard' };
  }

  return { name: 'not-found', resourceId: null, title: TITLES['not-found'], nav: 'dashboard' };
}

export function stationPath(stationId: string): string {
  return `/stations/${encodeURIComponent(stationId)}`;
}

export function tankPath(tankId: string): string {
  return `/tanks/${encodeURIComponent(tankId)}`;
}

export function devicePath(deviceId: string): string {
  return `/devices/${encodeURIComponent(deviceId)}`;
}

export function readingsPath(tankId?: string): string {
  if (tankId === undefined || tankId === '') {
    return '/readings';
  }
  return `/readings?tank=${encodeURIComponent(tankId)}`;
}

export function tanksPath(stationId?: string): string {
  if (stationId === undefined || stationId === '') {
    return '/tanks';
  }
  return `/tanks?station=${encodeURIComponent(stationId)}`;
}
