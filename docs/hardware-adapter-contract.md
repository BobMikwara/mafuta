# Hardware adapter contract

No real tank gauge integration exists in this repository, and none will be written from
guesses. This document states the contract a vendor adapter must satisfy and lists exactly
what is needed from the gauge vendor before one can be built.

## What was built instead

`TankGaugeAdapter` in `packages/core/src/ports/tank-gauge-adapter.ts` is the boundary. It
describes **physical observations only**:

```ts
interface TankGaugeAdapter {
  readonly vendor: string;
  readonly model: string | null;
  readonly kind: 'simulated' | 'hardware';
  readonly capabilities: AdapterCapabilities;
  readTank(request: ReadTankRequest): Promise<Result<ProbeSample, AdapterError>>;
  healthCheck(): Promise<Result<AdapterHealth, AdapterError>>;
}

interface ProbeSample {
  tankId: TankId;
  observedAt: string; // ISO 8601, UTC
  levelMm: number; // product level from the tank bottom
  waterLevelMm: number; // free water level from the tank bottom
  temperatureC: number | null;
  deviceId: string | null;
  source: ReadingSource; // 'simulated' | 'device' | 'manual'
  signalQualityPercent?: number;
}
```

Volume is never taken from the device. The adapter reports a level and the platform converts
it to a volume using the tank geometry and its calibration table. That keeps a gauge
replacement from silently changing the inventory numbers.

`SimulatedTankGaugeAdapter` implements this interface today with `kind: 'simulated'` and
`capabilities.simulated: true`. Swapping it for a real adapter requires no change above this
line.

## Information required from the vendor

Everything below is needed before implementation. Partial answers produce an adapter that
cannot be trusted with inventory.

1. **Exact make and model** of the tank gauge, probe, and any console or gateway in the
   path. Firmware versions too.
2. **Physical layer**: RS-232, RS-485, Modbus RTU, Modbus TCP, 4-20 mA loop, CAN, or
   Ethernet. Connector pinout and cable specification.
3. **Protocol specification**: the actual document. Register map or command set, byte
   order, framing, checksum or CRC algorithm, baud rate and serial parameters, and the
   polling interval the device tolerates.
4. **Data model**: which values the device reports natively (product level, ullage, water
   level, temperature, density, signal quality), their units and resolution, and whether
   the device computes volume itself.
5. **Accuracy and calibration**: stated accuracy for level and temperature, the calibration
   procedure, and whether the device holds its own strapping table. If it does, that table
   must be exportable, because the platform needs the same table to agree with the device.
6. **Error and fault signalling**: how a stuck probe, a disconnected sensor, a
   communication timeout, or a out-of-range reading presents itself. Silent failures are
   the dangerous case and must be mapped onto `AdapterError` codes.
7. **Multi-tank topology**: one console serving several tanks, addressing scheme, and
   whether polling is per tank or per console.
8. **Safety constraints**: anything that must never be written to the device, and any
   command with a physical effect. This platform is read-only by design. Confirm the device
   supports read-only operation.
9. **Environmental and power requirements** for the site, and whether the vendor offers a
   hosted telemetry option that would remove the need for a local gateway.

## Rules for any adapter written against this contract

- Report observations only. Volumes are computed by the platform.
- Never invent a value. If the device does not report it, return `null` and declare it in
  `capabilities`.
- Every failure maps to an `AdapterError` with a code and a `retryable` flag. A silent
  success with stale data is worse than a visible failure.
- Set `kind: 'hardware'` and `capabilities.simulated: false`. Only the simulator may
  produce `source: 'simulated'` samples.
- Keep vendor protocol code inside the adapter package. No register numbers, byte layouts
  or serial parameters may appear in the domain, service, or API layers.
- Include a conformance test suite that runs against recorded device traces, plus a test
  proving the adapter rejects malformed frames rather than throwing raw errors upward.

## Verification before any hardware data is trusted

1. Run the new adapter in parallel with the manual dip readings for at least one full
   delivery cycle per tank.
2. Confirm platform volume against the gauge's own reported volume at several levels.
3. Confirm the alarm engine fires on a controlled event, for example a deliberate rapid
   draw, before relying on it operationally.
