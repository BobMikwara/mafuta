import { useMemo, useState, type ReactNode } from 'react';
import type { ApiIssue } from '../lib/api';
import {
  buildCreateStationBody,
  buildCreateTankBody,
  buildRegisterDeviceBody,
  buildUpdateStationBody,
  buildUpdateTankBody,
  DEFAULT_TANK_FORM,
  emptyStationForm,
  issueMap,
  knownTimezones,
  suggestTankCapacity,
  validateDevice,
  validateStation,
  validateTank,
  type DeviceFormValues,
  type StationFormValues,
  type TankFormValues,
} from '../lib/fleet-forms';
import { FUEL_PRODUCTS, PRODUCT_LABELS, type FuelProduct } from '../lib/labels';
import { Drawer, fieldError, FormFooter, SelectField, TextField, onFormSubmit } from './ui';

function useDraft<T>(initial: T) {
  const [values, setValues] = useState(initial);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  return { values, set, dirty, confirmDiscard, setConfirmDiscard };
}

export function StationDrawer({
  mode,
  initial,
  submitting,
  serverIssues,
  serverError,
  onClose,
  onCreate,
  onUpdate,
}: {
  mode: 'create' | 'edit';
  initial?: StationFormValues | undefined;
  submitting: boolean;
  serverIssues: ReadonlyArray<ApiIssue>;
  serverError: string | null;
  onClose: () => void;
  onCreate: (body: ReturnType<typeof buildCreateStationBody>) => void;
  onUpdate: (body: ReturnType<typeof buildUpdateStationBody>) => void;
}) {
  const start = initial ?? emptyStationForm();
  const draft = useDraft(start);
  const [localIssues, setLocalIssues] = useState(issueMap([]));
  const issues = useMemo(() => {
    const merged = new Map(localIssues);
    for (const issue of serverIssues) {
      if (!merged.has(issue.path)) merged.set(issue.path, issue.message);
    }
    return merged;
  }, [localIssues, serverIssues]);

  const submit = () => {
    const next = validateStation(draft.values);
    setLocalIssues(issueMap(next));
    if (next.length > 0) return;
    if (mode === 'create') onCreate(buildCreateStationBody(draft.values));
    else onUpdate(buildUpdateStationBody(draft.values));
  };

  const requestClose = () => {
    if (draft.dirty && !draft.confirmDiscard) {
      draft.setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  return (
    <Drawer
      title={mode === 'create' ? 'Add station' : 'Edit station'}
      description="A station belongs to the tenant of this API key. The code is unique inside that tenant."
      onClose={requestClose}
      footer={
        <FormFooter
          submitting={submitting}
          submitLabel={mode === 'create' ? 'Create station' : 'Save changes'}
          onCancel={requestClose}
          dirty={draft.dirty}
          confirmDiscard={draft.confirmDiscard}
          onConfirmDiscard={onClose}
          formId="station-form"
        />
      }
    >
      <form onSubmit={(event) => onFormSubmit(event, submit)} id="station-form">
        {serverError ? <p className="error">{serverError}</p> : null}
        <div className="form-section">
          <TextField
            label="Station name"
            name="name"
            required
            value={draft.values.name}
            error={fieldError(issues, 'name')}
            help="The name operators use, for example Mlimani Service Station."
            onChange={(value) => draft.set('name', value)}
          />
          <TextField
            label="Station code"
            name="code"
            required
            value={draft.values.code}
            disabled={mode === 'edit'}
            error={fieldError(issues, 'code')}
            help="Letters, digits or hyphens. Stored in uppercase. This cannot be changed later."
            onChange={(value) => draft.set('code', value)}
          />
          <SelectField
            label="Timezone"
            name="timezone"
            value={draft.values.timezone}
            options={knownTimezones(draft.values.timezone)}
            error={fieldError(issues, 'timezone')}
            help="Used only when times are shown. Stored readings stay in UTC."
            onChange={(value) => draft.set('timezone', value)}
          />
          {mode === 'edit' ? (
            <SelectField
              label="Status"
              name="status"
              value={draft.values.status}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              help="Inactive stations stay in the record. They are not deleted."
              onChange={(value) => draft.set('status', value as StationFormValues['status'])}
            />
          ) : null}
        </div>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

export function TankDrawer({
  mode,
  stations,
  initial,
  lockStation,
  includeGeometry,
  submitting,
  serverIssues,
  serverError,
  onClose,
  onCreate,
  onUpdate,
}: {
  mode: 'create' | 'edit';
  stations: ReadonlyArray<{ id: string; name: string; code: string }>;
  initial?: TankFormValues | undefined;
  lockStation?: boolean | undefined;
  includeGeometry: boolean;
  submitting: boolean;
  serverIssues: ReadonlyArray<ApiIssue>;
  serverError: string | null;
  onClose: () => void;
  onCreate: (body: ReturnType<typeof buildCreateTankBody>) => void;
  onUpdate: (body: ReturnType<typeof buildUpdateTankBody>) => void;
}) {
  const draft = useDraft(initial ?? { ...DEFAULT_TANK_FORM, stationId: stations[0]?.id ?? '' });
  const [localIssues, setLocalIssues] = useState(issueMap([]));
  const [capacityTouched, setCapacityTouched] = useState(mode === 'edit');
  const issues = useMemo(() => {
    const merged = new Map(localIssues);
    for (const issue of serverIssues) merged.set(issue.path, issue.message);
    return merged;
  }, [localIssues, serverIssues]);
  const suggested = suggestTankCapacity(draft.values);

  const applySuggestion = () => {
    if (suggested === null) return;
    draft.set('capacityLitres', String(suggested));
    setCapacityTouched(false);
  };

  const onDimension = (key: 'diameterMm' | 'lengthOrHeightMm' | 'geometryKind', value: string) => {
    const next = { ...draft.values, [key]: value };
    draft.set(key, value as never);
    if (!capacityTouched) {
      const hint = suggestTankCapacity(next);
      if (hint !== null) draft.set('capacityLitres', String(hint));
    }
  };

  const submit = () => {
    const next = validateTank(draft.values).filter((issue) =>
      includeGeometry
        ? true
        : issue.path !== 'diameterMm' &&
          issue.path !== 'lengthOrHeightMm' &&
          issue.path !== 'capacityLitres' &&
          issue.path !== 'geometryKind',
    );
    setLocalIssues(issueMap(next));
    if (next.length > 0) return;
    if (mode === 'create') onCreate(buildCreateTankBody(draft.values));
    else onUpdate(buildUpdateTankBody(draft.values, { includeGeometry }));
  };

  const requestClose = () => {
    if (draft.dirty && !draft.confirmDiscard) {
      draft.setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  return (
    <Drawer
      title={mode === 'create' ? 'Add tank' : 'Edit tank'}
      description="A tank belongs to one station. Capacity cannot exceed what the declared shape can hold."
      onClose={requestClose}
      footer={
        <FormFooter
          submitting={submitting}
          submitLabel={mode === 'create' ? 'Create tank' : 'Save changes'}
          onCancel={requestClose}
          dirty={draft.dirty}
          confirmDiscard={draft.confirmDiscard}
          onConfirmDiscard={onClose}
          formId="tank-form"
        />
      }
    >
      <form id="tank-form" onSubmit={(event) => onFormSubmit(event, submit)}>
        {serverError ? <p className="error">{serverError}</p> : null}
        {stations.length === 0 ? (
          <p className="error">Create a station before adding a tank.</p>
        ) : null}
        <div className="form-section">
          <h3>Identity</h3>
          <SelectField
            label="Station"
            name="stationId"
            value={draft.values.stationId}
            disabled={lockStation || mode === 'edit'}
            error={fieldError(issues, 'stationId')}
            help="Tanks cannot be moved to another station from this form."
            options={stations.map((station) => ({
              value: station.id,
              label: `${station.name} (${station.code})`,
            }))}
            onChange={(value) => draft.set('stationId', value)}
          />
          <TextField
            label="Tank name"
            name="name"
            required
            value={draft.values.name}
            error={fieldError(issues, 'name')}
            help="A name the station team already uses, such as Diesel 1."
            onChange={(value) => draft.set('name', value)}
          />
          <SelectField
            label="Fuel product"
            name="product"
            value={draft.values.product}
            error={fieldError(issues, 'product')}
            options={FUEL_PRODUCTS.map((product) => ({
              value: product,
              label: PRODUCT_LABELS[product],
            }))}
            onChange={(value) => draft.set('product', value as FuelProduct)}
          />
        </div>
        {includeGeometry ? (
          <div className="form-section">
            <h3>Shape and capacity</h3>
            <SelectField
              label="Shape"
              name="geometryKind"
              value={draft.values.geometryKind}
              help="Underground station tanks are usually horizontal cylinders. This is geometry, not a vendor claim."
              options={[
                { value: 'horizontal-cylinder', label: 'Horizontal cylinder' },
                { value: 'vertical-cylinder', label: 'Vertical cylinder' },
              ]}
              onChange={(value) => onDimension('geometryKind', value)}
            />
            <div className="row-2">
              <TextField
                label="Diameter (mm)"
                name="diameterMm"
                type="number"
                required
                value={draft.values.diameterMm}
                error={fieldError(issues, 'diameterMm')}
                onChange={(value) => onDimension('diameterMm', value)}
              />
              <TextField
                label={
                  draft.values.geometryKind === 'vertical-cylinder' ? 'Height (mm)' : 'Length (mm)'
                }
                name="lengthOrHeightMm"
                type="number"
                required
                value={draft.values.lengthOrHeightMm}
                error={fieldError(issues, 'lengthOrHeightMm')}
                onChange={(value) => onDimension('lengthOrHeightMm', value)}
              />
            </div>
            <TextField
              label="Safe working capacity (L)"
              name="capacityLitres"
              type="number"
              required
              value={draft.values.capacityLitres}
              error={fieldError(issues, 'capacityLitres')}
              help={
                suggested === null
                  ? 'Must be greater than zero and not above the geometric capacity.'
                  : `Geometric capacity is about ${suggested.toLocaleString('en-GB')} L. Safe working capacity must not exceed it.`
              }
              onChange={(value) => {
                setCapacityTouched(true);
                draft.set('capacityLitres', value);
              }}
            />
            {suggested !== null ? (
              <button type="button" className="btn small" onClick={applySuggestion}>
                Use geometric capacity
              </button>
            ) : null}
          </div>
        ) : (
          <p className="quiet">
            This tank uses a geometry this form does not edit. Name, product, thresholds and status
            can still be saved.
          </p>
        )}
        <ThresholdFields values={draft.values} set={draft.set} issues={issues} />
        <div className="form-section">
          <h3>Calibration</h3>
          <TextField
            label="Calibration source"
            name="calibrationSource"
            value={draft.values.calibrationSource}
            error={fieldError(issues, 'calibrationSource')}
            help="Optional note, such as a certificate reference. This is recorded, not treated as validated."
            onChange={(value) => draft.set('calibrationSource', value)}
          />
          {mode === 'edit' ? (
            <SelectField
              label="Status"
              name="status"
              value={draft.values.status}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'decommissioned', label: 'Decommissioned' },
              ]}
              help="A decommissioned tank stays in history and rejects new readings."
              onChange={(value) => draft.set('status', value as TankFormValues['status'])}
            />
          ) : null}
        </div>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

function ThresholdFields({
  values,
  set,
  issues,
}: {
  values: TankFormValues;
  set: <K extends keyof TankFormValues>(key: K, value: TankFormValues[K]) => void;
  issues: ReadonlyMap<string, string>;
}) {
  return (
    <div className="form-section">
      <h3>Alert thresholds</h3>
      <div className="row-2">
        <TextField
          label="Critical level (%)"
          name="criticalLowPercent"
          type="number"
          value={values.criticalLowPercent}
          error={fieldError(issues, 'criticalLowPercent')}
          onChange={(value) => set('criticalLowPercent', value)}
        />
        <TextField
          label="Low-stock level (%)"
          name="lowPercent"
          type="number"
          value={values.lowPercent}
          error={fieldError(issues, 'lowPercent')}
          help="Must be above the critical level."
          onChange={(value) => set('lowPercent', value)}
        />
        <TextField
          label="High level (%)"
          name="highPercent"
          type="number"
          value={values.highPercent}
          error={fieldError(issues, 'highPercent')}
          onChange={(value) => set('highPercent', value)}
        />
        <TextField
          label="Water alarm (mm)"
          name="waterAlarmMm"
          type="number"
          value={values.waterAlarmMm}
          error={fieldError(issues, 'waterAlarmMm')}
          onChange={(value) => set('waterAlarmMm', value)}
        />
        <TextField
          label="Stale after (minutes)"
          name="staleAfterMinutes"
          type="number"
          value={values.staleAfterMinutes}
          error={fieldError(issues, 'staleAfterMinutes')}
          help="Older readings are shown as stale, never as live."
          onChange={(value) => set('staleAfterMinutes', value)}
        />
        <TextField
          label="Delivery minimum (L)"
          name="deliveryLitres"
          type="number"
          value={values.deliveryLitres}
          error={fieldError(issues, 'deliveryLitres')}
          help="A sustained rise at or above this volume becomes a candidate delivery, not a confirmed one."
          onChange={(value) => set('deliveryLitres', value)}
        />
        <TextField
          label="Delivery window (minutes)"
          name="deliveryWindowMinutes"
          type="number"
          value={values.deliveryWindowMinutes}
          error={fieldError(issues, 'deliveryWindowMinutes')}
          onChange={(value) => set('deliveryWindowMinutes', value)}
        />
        <TextField
          label="Decrease rate (L/h)"
          name="rapidDropLitresPerHour"
          type="number"
          value={values.rapidDropLitresPerHour}
          error={fieldError(issues, 'rapidDropLitresPerHour')}
          help="A sustained drop at or above this rate becomes a candidate for investigation. It is not a theft finding."
          onChange={(value) => set('rapidDropLitresPerHour', value)}
        />
      </div>
    </div>
  );
}

export function DeviceDrawer({
  submitting,
  serverError,
  onClose,
  onCreate,
}: {
  submitting: boolean;
  serverError: string | null;
  onClose: () => void;
  onCreate: (body: ReturnType<typeof buildRegisterDeviceBody>) => void;
}) {
  const draft = useDraft<DeviceFormValues>({
    manufacturer: '',
    model: '',
    serialNumber: '',
    protocol: 'http',
    firmwareVersion: '',
  });
  const [localIssues, setLocalIssues] = useState(issueMap([]));
  const submit = () => {
    const next = validateDevice(draft.values);
    setLocalIssues(issueMap(next));
    if (next.length > 0) return;
    onCreate(buildRegisterDeviceBody(draft.values));
  };
  return (
    <Drawer
      title="Register device"
      description="Manufacturer and protocol are labels. No vendor packet format is assumed."
      onClose={onClose}
      footer={
        <FormFooter
          submitting={submitting}
          submitLabel="Register device"
          onCancel={onClose}
          dirty={draft.dirty}
          confirmDiscard={false}
          onConfirmDiscard={onClose}
          formId="device-form"
        />
      }
    >
      <form id="device-form" onSubmit={(event) => onFormSubmit(event, submit)}>
        {serverError ? <p className="error">{serverError}</p> : null}
        <TextField
          label="Manufacturer"
          name="manufacturer"
          required
          value={draft.values.manufacturer}
          error={fieldError(localIssues, 'manufacturer')}
          onChange={(value) => draft.set('manufacturer', value)}
        />
        <TextField
          label="Model"
          name="model"
          required
          value={draft.values.model}
          error={fieldError(localIssues, 'model')}
          onChange={(value) => draft.set('model', value)}
        />
        <TextField
          label="Serial number"
          name="serialNumber"
          required
          value={draft.values.serialNumber}
          error={fieldError(localIssues, 'serialNumber')}
          onChange={(value) => draft.set('serialNumber', value)}
        />
        <SelectField
          label="Protocol"
          name="protocol"
          value={draft.values.protocol}
          options={[
            { value: 'http', label: 'HTTP' },
            { value: 'mqtt', label: 'MQTT' },
            { value: 'modbus_rtu', label: 'Modbus RTU' },
            { value: 'modbus_tcp', label: 'Modbus TCP' },
            { value: 'simulated', label: 'Simulated' },
            { value: 'other', label: 'Other' },
          ]}
          help="Choose Other when the protocol is not documented yet."
          onChange={(value) => draft.set('protocol', value)}
        />
        <TextField
          label="Firmware"
          name="firmwareVersion"
          value={draft.values.firmwareVersion}
          help="Optional."
          onChange={(value) => draft.set('firmwareVersion', value)}
        />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

export function ScopeNote({ missing, action }: { missing: boolean; action: string }) {
  if (!missing) return null;
  return (
    <p className="quiet">
      This key cannot {action}. Ask for a key that includes the required write scope.
    </p>
  );
}

export function PageIntro({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
  );
}
