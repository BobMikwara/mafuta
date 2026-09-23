import type { ReactNode } from 'react';

interface IconProps {
  readonly name: string;
}

const PATHS: Record<string, ReactNode> = {
  dashboard: <path d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z" />,
  stations: <path d="M4 18V8l8-4 8 4v10M8 18v-5h8v5" />,
  tanks: (
    <path d="M6 8c0-2 2.7-3.5 6-3.5S18 6 18 8v8c0 2-2.7 3.5-6 3.5S6 18 6 16zM6 12c1.2 1.2 3.4 1.8 6 1.8s4.8-.6 6-1.8" />
  ),
  devices: <path d="M8 4h8v4H8zM6 8h12v10H6zM10 18v2M14 18v2M9 12h2M13 12h2" />,
  readings: <path d="M4 16l4-5 3 3 5-7 4 4" />,
  deliveries: <path d="M4 8h10l4 4v6H4zM14 8v4h4M7 18a1 1 0 1 0 0.01 0M15 18a1 1 0 1 0 0.01 0" />,
  reconciliation: <path d="M6 6h12M6 12h12M6 18h8M4 6l2 2-2 2" />,
  alerts: <path d="M12 4l8 14H4zM12 10v4M12 16.5v.5" />,
  reports: <path d="M6 4h8l4 4v12H6zM14 4v4h4M8 12h8M8 16h6" />,
  settings: (
    <path d="M12 8a4 4 0 1 0 0.01 0M4 12h2M18 12h2M12 4v2M12 18v2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4" />
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({ name }: IconProps) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {PATHS[name] ?? null}
    </svg>
  );
}

export function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 36 36" aria-hidden="true">
      <rect width="36" height="36" rx="10" fill="#1c2c26" />
      <path
        d="M7 21c0-4.4 4.9-8 11-8s11 3.6 11 8-4.9 8-11 8-11-3.6-11-8Z"
        stroke="#e7efe9"
        strokeWidth="1.6"
      />
      <path
        d="M9.2 21c.5 2.6 4 4.6 8.8 4.6s8.3-2 8.8-4.6"
        stroke="#c4622d"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M18 7.5v6" stroke="#3ea887" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
