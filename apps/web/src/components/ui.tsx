import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import type { ApiIssue } from '../lib/api';

export function Button({
  children,
  variant = 'default',
  size = 'default',
  type = 'button',
  disabled,
  onClick,
  label,
}: {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'copper';
  size?: 'default' | 'small';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  return (
    <button
      type={type}
      className={`btn ${variant === 'default' ? '' : variant} ${size === 'small' ? 'small' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  name,
  value,
  onChange,
  help,
  error,
  type = 'text',
  required,
  autoComplete,
  placeholder,
  disabled,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  error?: string | undefined;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="sr-only"> required</span> : null}
      </label>
      <input
        id={id}
        name={name}
        className={`input${error ? ' invalid' : ''}`}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && !error ? (
        <p className="help" id={`${id}-help`}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  help,
  error,
  disabled,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  help?: string;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        className={`input${error ? ' invalid' : ''}`}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {help && !error ? <p className="help">{help}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  value,
  onChange,
  help,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  error?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={name}
        className={`input${error ? ' invalid' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && !error ? <p className="help">{help}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

export function Banner({
  tone,
  children,
  action,
}: {
  tone: 'error' | 'warn' | 'info';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <svg width="72" height="40" viewBox="0 0 72 40" aria-hidden="true">
        <path
          d="M6 20c0-8 13-14 30-14s30 6 30 14-13 14-30 14S6 28 6 20Z"
          fill="none"
          stroke="#c4622d"
          strokeWidth="1.5"
        />
        <path d="M10 20c1 5 10 9 26 9s25-4 26-9" fill="none" stroke="#0f6b52" strokeWidth="1.5" />
      </svg>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function SkeletonStack() {
  return (
    <div className="grid cards" aria-busy="true" aria-label="Loading">
      <div className="skeleton block" />
      <div className="skeleton block" />
      <div className="skeleton block" />
    </div>
  );
}

export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function FillBar({
  percent,
  tone,
  label,
}: {
  percent: number | null;
  tone?: string | undefined;
  label: string;
}) {
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="fill">
      <div className={`fill-track ${tone ?? ''}`} aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </div>
      <div className="fill-meta">
        <span>{label}</span>
        <span>{percent === null ? 'No reading' : `${percent.toFixed(1)}%`}</span>
      </div>
    </div>
  );
}

export function Drawer({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previously = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previously?.focus();
    };
  }, []);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={ref}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h2 id="drawer-title">{title}</h2>
            {description ? <p className="quiet">{description}</p> : null}
          </div>
          <Button variant="ghost" onClick={onClose} label="Close">
            Close
          </Button>
        </div>
        <div className="drawer-body">{children}</div>
        <div className="drawer-foot">{footer}</div>
      </div>
    </div>
  );
}

export function FormFooter({
  submitting,
  submitLabel,
  onCancel,
  dirty,
  confirmDiscard,
  onConfirmDiscard,
  formId,
}: {
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
  dirty: boolean;
  confirmDiscard: boolean;
  onConfirmDiscard: () => void;
  formId: string;
}) {
  return (
    <>
      {confirmDiscard ? (
        <span className="quiet">Discard unsaved changes?</span>
      ) : (
        <span className="quiet">{dirty ? 'Unsaved changes' : ''}</span>
      )}
      <div className="head-actions">
        {confirmDiscard ? (
          <Button variant="danger" onClick={onConfirmDiscard}>
            Discard
          </Button>
        ) : (
          <Button onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <button className="btn primary" type="submit" form={formId} disabled={submitting}>
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </>
  );
}

function isIssueMap(
  issues: ReadonlyArray<ApiIssue> | ReadonlyMap<string, string>,
): issues is ReadonlyMap<string, string> {
  return !Array.isArray(issues);
}

export function fieldError(
  issues: ReadonlyArray<ApiIssue> | ReadonlyMap<string, string>,
  path: string,
): string | undefined {
  if (isIssueMap(issues)) {
    const leaf = path.split('.').at(-1) ?? path;
    return issues.get(path) ?? issues.get(leaf);
  }
  return (
    issues.find((issue) => issue.path === path || issue.path.endsWith(`.${path}`))?.message ??
    issues.find((issue) => issue.path.startsWith(`${path}.`))?.message
  );
}

export function onFormSubmit(event: FormEvent, submit: () => void) {
  event.preventDefault();
  submit();
}
