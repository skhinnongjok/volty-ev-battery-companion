const DB_NAME = "volty-local";
const DB_VERSION = 1;
const STORE_NAME = "trips";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const chord = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  const safeChord = Math.min(1, Math.max(0, chord));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(safeChord), Math.sqrt(1 - safeChord));
}

export function addPosition(trip, position) {
  const point = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: finite(position.coords.accuracy),
    altitude: finite(position.coords.altitude),
    speed: finite(position.coords.speed),
    recordedAt: new Date(position.timestamp ?? Date.now()).toISOString()
  };
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false;
  if (point.accuracy !== null && point.accuracy > 100) return false;

  const previous = trip.positions.at(-1);
  if (previous) {
    const segment = haversineMeters(previous, point);
    const seconds = Math.max(0.001, (Date.parse(point.recordedAt) - Date.parse(previous.recordedAt)) / 1000);
    if (segment < Math.max(3, ((previous.accuracy || 0) + (point.accuracy || 0)) * 0.15)) return false;
    if (segment / seconds > 55) return false;
    trip.distanceMeters += segment;
  }
  trip.positions.push(point);
  return true;
}

export function createBmsSample(data, recordedAt = new Date()) {
  const hottest = Math.max(data.mosTemperature ?? -Infinity, data.balancerTemperature ?? -Infinity, ...(data.temperatures ?? []));
  return {
    recordedAt: recordedAt.toISOString(),
    soc: finite(data.soc),
    packVoltage: finite(data.voltage),
    current: finite(data.current),
    remainingAh: finite(data.remainingCapacity),
    temperature: Number.isFinite(hottest) ? hottest : null,
    cellDeltaMv: Number.isFinite(data.delta) ? data.delta * 1000 : null
  };
}

export function summarizeTrip(trip, endedAt = new Date()) {
  const samples = trip.samples || [];
  const start = samples[0] || {};
  const end = samples.at(-1) || {};
  let dischargeWh = 0;
  let integratedAh = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const hours = Math.max(0, (Date.parse(current.recordedAt) - Date.parse(previous.recordedAt)) / 3_600_000);
    const averageCurrent = ((previous.current ?? 0) + (current.current ?? 0)) / 2;
    const averageVoltage = ((previous.packVoltage ?? 0) + (current.packVoltage ?? 0)) / 2;
    dischargeWh += Math.max(0, averageVoltage * averageCurrent * hours);
    integratedAh += Math.max(0, averageCurrent * hours);
  }

  const socUsed = Number.isFinite(start.soc) && Number.isFinite(end.soc) ? Math.max(0, start.soc - end.soc) : null;
  const measuredAh = Number.isFinite(start.remainingAh) && Number.isFinite(end.remainingAh)
    ? Math.max(0, start.remainingAh - end.remainingAh)
    : null;
  const ahUsed = measuredAh !== null && measuredAh > 0 ? measuredAh : integratedAh;
  const validVoltages = samples.map((sample) => sample.packVoltage).filter(Number.isFinite);
  const averageVoltage = validVoltages.length ? validVoltages.reduce((sum, value) => sum + value, 0) / validVoltages.length : 0;
  const consumedWh = dischargeWh > 0 ? dischargeWh : ahUsed * averageVoltage;
  const distanceKm = (trip.distanceMeters || 0) / 1000;
  const temperatures = samples.map((sample) => sample.temperature).filter(Number.isFinite);
  const deltas = samples.map((sample) => sample.cellDeltaMv).filter(Number.isFinite);

  return {
    distanceKm,
    durationSeconds: Math.max(0, (endedAt.getTime() - Date.parse(trip.startedAt)) / 1000),
    socStart: finite(start.soc),
    socEnd: finite(end.soc),
    socUsed,
    ahUsed,
    consumedWh,
    consumedKwh: consumedWh / 1000,
    averageWhPerKm: distanceKm >= 0.05 ? consumedWh / distanceKm : null,
    maxTemperature: temperatures.length ? Math.max(...temperatures) : null,
    maxCellDeltaMv: deltas.length ? Math.max(...deltas) : null
  };
}

export class TripStore {
  constructor() { this.databasePromise = null; }

  open() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("startedAt", "startedAt");
            store.createIndex("status", "status");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.databasePromise;
  }

  async transact(mode, action) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  put(trip) { return this.transact("readwrite", (store) => store.put(trip)); }
  get(id) { return this.transact("readonly", (store) => store.get(id)); }
  getAll() { return this.transact("readonly", (store) => store.getAll()); }

  async getActive() {
    const trips = await this.getAll();
    return trips.find((trip) => trip.status === "active") || null;
  }

  async getCompleted() {
    const trips = await this.getAll();
    return trips.filter((trip) => trip.status === "completed").sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }
}
