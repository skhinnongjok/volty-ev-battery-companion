export const STATUS_REQUEST = Uint8Array.from([0x7e, 0xa1, 0x01, 0x00, 0x00, 0xbe, 0x18, 0x55, 0xaa, 0x55]);
export const DEVICE_INFO_REQUEST = Uint8Array.from([0x7e, 0xa1, 0x02, 0x6c, 0x02, 0x20, 0x58, 0xc4, 0xaa, 0x55]);

// Names recovered from the official Windows app's English.xml (2024-09-25).
export const PROTECTION_BITS = [
  "Set cell type", "Cell over-voltage", "Cell level-2 over-voltage", "Pack over-voltage",
  "Cell under-voltage", "Cell level-2 under-voltage", "Pack under-voltage", "Cell voltage difference",
  "Charge high temperature", "Discharge high temperature", "MOS high temperature", "Charge low temperature",
  "Discharge low temperature", "Charge over-current", "Discharge over-current", "Discharge level-2 over-current",
  "Short circuit", "Discharge MOS manually off 1", "Discharge MOS manually off 2", "Discharge MOS manually off 3",
  "Discharge MOS manually off 4", "Charge MOS manually off 1", "Charge MOS manually off 2", "Charge MOS manually off 3",
  "Charge MOS manually off 4", "Balance wire open", "Current error", "Discharge MOS error",
  "Charge MOS error", "Internal communication error", "Precharge failure", "BMS starting",
  "Self-check 1", "Self-check 2", "Charger connection detection", "DTU lost protection",
  "Anti-spark active", "Self-check 3", "Firmware upgrade required", "Relay precharge failure",
  "Relay adhesion", "Discharge fuse abnormal", "Charge fuse abnormal"
];

export const WARNING_BITS = [
  "Cell over-voltage warning", "Pack over-voltage warning", "Cell under-voltage warning", "Pack under-voltage warning",
  "Cell voltage difference warning", "Charge high-temperature warning", "Discharge high-temperature warning", "Charge low-temperature warning",
  "Discharge low-temperature warning", "MOS high-temperature warning", "Charge over-current warning", "Discharge over-current warning",
  "SOC level-1 warning", "SOC level-2 warning", "Cell voltage check error", "Cell count error",
  "Precharge failure", "Battery full", "Charging", "Discharging", "CAN charger connected", "RS485 charger connected",
  "Current charger connected", "Charge MOS on", "Discharge MOS on", "Balancing on", "Sleep", "Balance limit",
  "Balance voltage difference", "Auto balance", "Balancer high temperature", "Voltage protection",
  "Temperature protection", "System error", "DTU lost", "Balance test", "Electric heating on", "Forced output",
  "Bluetooth off", "Relay precharging", "MOS precharging", "Charge relay on", "Discharge relay on", "Crystal oscillator error",
  "Force charging"
];

export function decodeBitMask(bytes, labels) {
  const active = [];
  bytes.forEach((byte, byteIndex) => {
    for (let bit = 0; bit < 8; bit += 1) {
      const index = byteIndex * 8 + bit;
      if (byte & (1 << bit)) active.push({ bit: index, label: labels[index] ?? `Unknown bit ${index}` });
    }
  });
  return active;
}

export function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
    }
  }
  return crc & 0xffff;
}

export function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function validateFrame(input) {
  const frame = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (frame.length < 10) return { valid: false, reason: "frame too short" };
  if (frame[0] !== 0x7e || frame[1] !== 0xa1) return { valid: false, reason: "unknown header" };
  const expectedLength = frame[5] + 10;
  if (frame.length !== expectedLength) return { valid: false, reason: `expected ${expectedLength} bytes, got ${frame.length}` };
  if (frame.at(-2) !== 0xaa || frame.at(-1) !== 0x55) return { valid: false, reason: "invalid trailer" };
  const payloadLength = frame[5];
  const computed = crc16Modbus(frame.slice(1, 6 + payloadLength));
  const received = frame[6 + payloadLength] | (frame[7 + payloadLength] << 8);
  return computed === received
    ? { valid: true, computed, received }
    : { valid: false, reason: "CRC mismatch", computed, received };
}

function assertRange(view, offset, width, label) {
  if (offset < 0 || offset + width > view.byteLength) throw new RangeError(`${label} is outside payload`);
}

export function parseStatusFrame(input) {
  const frame = input instanceof Uint8Array ? input : new Uint8Array(input);
  const validation = validateFrame(frame);
  if (!validation.valid) throw new Error(`Invalid ANT frame: ${validation.reason}`);
  if (frame[2] !== 0x11) throw new Error(`Expected status response 0x11, got 0x${frame[2].toString(16)}`);

  const payload = frame.slice(6, 6 + frame[5]);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const temperatureCount = view.getUint8(2);
  const cellCount = view.getUint8(3);
  if (cellCount < 1 || cellCount > 32) throw new RangeError(`Implausible cell count: ${cellCount}`);
  if (temperatureCount > 16) throw new RangeError(`Implausible temperature count: ${temperatureCount}`);

  let cursor = 28;
  assertRange(view, cursor, cellCount * 2, "cell voltages");
  const cells = Array.from({ length: cellCount }, (_, index) => view.getUint16(cursor + index * 2, true) / 1000);
  cursor += cellCount * 2;
  assertRange(view, cursor, temperatureCount * 2 + 56, "dynamic status fields");
  const temperatures = Array.from({ length: temperatureCount }, (_, index) => view.getInt16(cursor + index * 2, true));
  cursor += temperatureCount * 2;

  const mosTemperature = view.getInt16(cursor, true); cursor += 2;
  const balancerTemperature = view.getInt16(cursor, true); cursor += 2;
  const voltage = view.getUint16(cursor, true) / 100; cursor += 2;
  const current = view.getInt16(cursor, true) / 10; cursor += 2;
  const soc = view.getUint16(cursor, true); cursor += 2;
  const soh = view.getUint16(cursor, true); cursor += 2;
  const chargeMos = view.getUint8(cursor); cursor += 1;
  const dischargeMos = view.getUint8(cursor); cursor += 1;
  const balancer = view.getUint8(cursor); cursor += 2;
  const totalCapacity = view.getUint32(cursor, true) / 1_000_000; cursor += 4;
  const remainingCapacity = view.getUint32(cursor, true) / 1_000_000; cursor += 4;
  const cycleCapacity = view.getUint32(cursor, true) / 1000; cursor += 4;
  const power = view.getInt32(cursor, true); cursor += 4;
  const runtimeSeconds = view.getUint32(cursor, true); cursor += 4;
  const balancedCellMask = view.getUint32(cursor, true); cursor += 4;
  const reportedMaxCell = view.getUint16(cursor, true) / 1000; cursor += 2;
  const maxCellIndex = view.getUint16(cursor, true); cursor += 2;
  const reportedMinCell = view.getUint16(cursor, true) / 1000; cursor += 2;
  const minCellIndex = view.getUint16(cursor, true); cursor += 2;
  const reportedDelta = view.getUint16(cursor, true) / 1000; cursor += 2;
  const reportedAverage = view.getUint16(cursor, true) / 1000;

  const protections = decodeBitMask(payload.slice(4, 12), PROTECTION_BITS);
  const warningAndStates = decodeBitMask(payload.slice(12, 20), WARNING_BITS);
  // The official app stores warnings and normal state flags in the same 64-bit field.
  // Keep normal states (charging, MOS on, auto balance, etc.) from producing false alarms.
  const warningIssueBits = new Set([...Array.from({ length: 17 }, (_, index) => index), 30, 31, 32, 33, 34, 43]);
  const warnings = warningAndStates.filter(({ bit }) => warningIssueBits.has(bit));
  return {
    protocol: "ANT-2021+", permissions: view.getUint8(0), statusCode: view.getUint8(1),
    cellCount, temperatureCount, cells, temperatures, mosTemperature, balancerTemperature,
    voltage, current, soc, soh, chargeMos, dischargeMos, balancer, totalCapacity,
    remainingCapacity, cycleCapacity, power, runtimeSeconds, balancedCellMask,
    maxCell: reportedMaxCell || Math.max(...cells), minCell: reportedMinCell || Math.min(...cells),
    maxCellIndex, minCellIndex, delta: reportedDelta || Math.max(...cells) - Math.min(...cells),
    averageCell: reportedAverage || cells.reduce((sum, value) => sum + value, 0) / cells.length,
    protections, warnings, states: warningAndStates.filter(({ bit }) => !warningIssueBits.has(bit)),
    protectionActive: protections.some(({ bit }) => bit !== 0 && bit !== 31 && bit !== 34 && bit !== 36),
    warningActive: warnings.length > 0, receivedAt: new Date()
  };
}

export function parseDeviceInfoFrame(input) {
  const frame = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (frame.length < 38 || frame[0] !== 0x7e || frame[1] !== 0xa1 || frame[2] !== 0x12) {
    throw new Error("Not an ANT device-info frame");
  }
  const decode = (bytes) => new TextDecoder().decode(bytes).replaceAll("\0", "").trim();
  return { hardwareVersion: decode(frame.slice(6, 22)), softwareVersion: decode(frame.slice(22, 38)) };
}

export class AntFrameAssembler {
  constructor() {
    this.buffer = new Uint8Array();
    this.lastDiscarded = 0;
  }
  push(chunk) {
    const incoming = chunk instanceof Uint8Array
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : new Uint8Array(chunk);
    const merged = new Uint8Array(this.buffer.length + incoming.length);
    merged.set(this.buffer); merged.set(incoming, this.buffer.length); this.buffer = merged;
    const frames = [];
    this.lastDiscarded = 0;
    while (this.buffer.length >= 2) {
      let start = -1;
      for (let i = 0; i < this.buffer.length - 1; i += 1) {
        if (this.buffer[i] === 0x7e && this.buffer[i + 1] === 0xa1) { start = i; break; }
      }
      if (start < 0) {
        this.buffer = this.buffer.at(-1) === 0x7e ? this.buffer.slice(-1) : new Uint8Array();
        break;
      }
      if (start > 0) this.buffer = this.buffer.slice(start);
      if (this.buffer.length < 6) break;
      const frameLength = this.buffer[5] + 10;
      if (this.buffer.length < frameLength) break;
      const candidate = this.buffer.slice(0, frameLength);
      if (validateFrame(candidate).valid) {
        frames.push(candidate);
        this.buffer = this.buffer.slice(frameLength);
      } else {
        // A dropped/duplicated BLE notification can make the next frame's header
        // appear inside an incomplete frame. Drop this header and rescan so the
        // next valid 7E A1 frame is recovered instead of reaching the UI as an error.
        this.lastDiscarded += 1;
        this.buffer = this.buffer.slice(1);
      }
    }
    return frames;
  }
  reset() { this.buffer = new Uint8Array(); this.lastDiscarded = 0; }
}
