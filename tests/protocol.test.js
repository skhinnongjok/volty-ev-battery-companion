import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AntFrameAssembler, STATUS_REQUEST, crc16Modbus, decodeBitMask, parseStatusFrame, validateFrame } from "../src/protocol.js";
import { estimateChargeMinutes } from "../src/metrics.js";

function writeU16(bytes, offset, value) { new DataView(bytes.buffer).setUint16(offset, value, true); }
function writeI16(bytes, offset, value) { new DataView(bytes.buffer).setInt16(offset, value, true); }
function writeU32(bytes, offset, value) { new DataView(bytes.buffer).setUint32(offset, value, true); }
function buildStatusFrame() {
  const payload = new Uint8Array(142); payload[0] = 5; payload[1] = 3; payload[2] = 3; payload[3] = 20;
  const cells = Array.from({ length: 20 }, (_, index) => 3600 + index);
  let cursor = 28; cells.forEach((value) => { writeU16(payload, cursor, value); cursor += 2; });
  [29, 30, 31].forEach((value) => { writeI16(payload, cursor, value); cursor += 2; });
  writeI16(payload, cursor, 34); cursor += 2; writeI16(payload, cursor, 32); cursor += 2;
  writeU16(payload, cursor, 7219); cursor += 2; writeI16(payload, cursor, 186); cursor += 2;
  writeU16(payload, cursor, 78); cursor += 2; writeU16(payload, cursor, 98); cursor += 2;
  payload[cursor++] = 1; payload[cursor++] = 1; payload[cursor++] = 4; cursor += 1;
  writeU32(payload, cursor, 30_000_000); cursor += 4; writeU32(payload, cursor, 23_400_000); cursor += 4;
  writeU32(payload, cursor, 12_000); cursor += 4; new DataView(payload.buffer).setInt32(cursor, 1343, true); cursor += 4;
  writeU32(payload, cursor, 86400); cursor += 4; writeU32(payload, cursor, 0); cursor += 4;
  writeU16(payload, cursor, 3619); cursor += 2; writeU16(payload, cursor, 20); cursor += 2;
  writeU16(payload, cursor, 3600); cursor += 2; writeU16(payload, cursor, 1); cursor += 2;
  writeU16(payload, cursor, 19); cursor += 2; writeU16(payload, cursor, 3610);
  const frame = new Uint8Array(152); frame.set([0x7e, 0xa1, 0x11, 0, 0, 142]); frame.set(payload, 6);
  const crc = crc16Modbus(frame.slice(1, 148)); frame[148] = crc & 0xff; frame[149] = crc >> 8; frame[150] = 0xaa; frame[151] = 0x55;
  return frame;
}

test("known status request has valid Modbus CRC", () => {
  assert.equal(crc16Modbus(STATUS_REQUEST.slice(1, 6)), 0x5518);
  assert.deepEqual([...STATUS_REQUEST.slice(6, 8)], [0x18, 0x55]);
});

test("estimates charge time from BMS capacity and current", () => {
  assert.equal(estimateChargeMinutes({ totalCapacity: 24, remainingCapacity: 20.2, soc: 85 }, 8.2), 28);
  assert.equal(estimateChargeMinutes({ totalCapacity: 24, remainingCapacity: 24, soc: 100 }, 8.2), 0);
  assert.equal(estimateChargeMinutes({ totalCapacity: 24, remainingCapacity: 20.2, soc: 85 }, 0), null);
});

test("infers total capacity from SOC when BMS total is unavailable", () => {
  assert.equal(estimateChargeMinutes({ remainingCapacity: 20.4, soc: 85 }, 8), 27);
});

test("parses a 20S dynamic status payload", () => {
  const parsed = parseStatusFrame(buildStatusFrame());
  assert.equal(parsed.cellCount, 20); assert.equal(parsed.cells[0], 3.6); assert.equal(parsed.cells[19], 3.619);
  assert.equal(parsed.voltage, 72.19); assert.equal(parsed.current, 18.6); assert.equal(parsed.soc, 78);
  assert.equal(parsed.temperatures[2], 31); assert.equal(parsed.remainingCapacity, 23.4); assert.equal(parsed.delta, 0.019);
});

test("reassembles fragmented BLE notifications", () => {
  const frame = buildStatusFrame(); const assembler = new AntFrameAssembler();
  assert.deepEqual(assembler.push(frame.slice(0, 20)), []); assert.deepEqual(assembler.push(frame.slice(20, 88)), []);
  const result = assembler.push(frame.slice(88)); assert.equal(result.length, 1); assert.deepEqual(result[0], frame);
});

test("resynchronizes after an incomplete frame runs into the next response", () => {
  const frame = buildStatusFrame();
  const incomplete = new Uint8Array(frame.length - 20);
  incomplete.set(frame.slice(0, 60)); incomplete.set(frame.slice(80), 60);
  const combined = new Uint8Array(incomplete.length + frame.length);
  combined.set(incomplete); combined.set(frame, incomplete.length);
  const assembler = new AntFrameAssembler();
  const result = assembler.push(combined);
  assert.equal(assembler.lastDiscarded, 1);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], frame);
});

test("does not emit a CRC-corrupted frame", () => {
  const corrupted = buildStatusFrame(); corrupted[70] ^= 0xff;
  const valid = buildStatusFrame();
  const combined = new Uint8Array(corrupted.length + valid.length);
  combined.set(corrupted); combined.set(valid, corrupted.length);
  const assembler = new AntFrameAssembler();
  const result = assembler.push(combined);
  assert.equal(assembler.lastDiscarded, 1);
  assert.deepEqual(result, [valid]);
});

test("rejects corrupted frames", () => {
  const frame = buildStatusFrame(); frame[70] ^= 0xff;
  assert.equal(validateFrame(frame).valid, false); assert.throws(() => parseStatusFrame(frame), /CRC mismatch/);
});

test("decodes masks least-significant bit first", () => {
  assert.deepEqual(decodeBitMask(Uint8Array.from([0b00000101, 0b00000010]), ["zero", "one", "two"]), [
    { bit: 0, label: "zero" }, { bit: 2, label: "two" }, { bit: 9, label: "Unknown bit 9" }
  ]);
});

test("parses a verified ANT-BLE24CACB-1272 idle frame", () => {
  const hex = readFileSync(new URL("fixtures/24cacb-idle.hex", import.meta.url), "utf8").trim();
  const frame = Uint8Array.from(hex.split(/\s+/).map((byte) => Number.parseInt(byte, 16)));
  assert.equal(frame[5], 0xa8);
  assert.equal(validateFrame(frame).valid, true);
  const parsed = parseStatusFrame(frame);
  assert.equal(parsed.cellCount, 20);
  assert.equal(parsed.temperatureCount, 4);
  assert.equal(parsed.voltage, 80.56);
  assert.equal(parsed.soc, 92);
  assert.equal(parsed.cells[16], 4.071);
  assert.equal(parsed.cells[1], 3.906);
  assert.equal(parsed.delta, 0.165);
});
