import { AntBleClient } from "./ble.js";
import { estimateChargeMinutes } from "./metrics.js";
import { bytesToHex, parseDeviceInfoFrame, parseStatusFrame } from "./protocol.js";

const $ = (id) => document.getElementById(id);
const client = new AntBleClient();
const logs = [];
let latestData = null;
let connected = false;
let intentionalDisconnect = false;
let chargeCurrentSamples = [];
let currentVehicleSlide = 0;
let vehicleTouchStartX = null;

const statusNames = ["ไม่ทราบสถานะ", "พัก", "กำลังชาร์จ", "กำลังคายประจุ", "สแตนด์บาย", "ผิดปกติ"];
const bluetoothIcon = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10-5 4V3l5 4L7 17"/></svg>';

function format(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "—"; }

function setPill(id, value, active = null) {
  const element = $(id); element.textContent = value;
  element.className = active === null ? "neutral" : active ? "" : "off";
}

function showVehicleSlide(index) {
  const slides = $("vehicleTrack").children.length;
  currentVehicleSlide = (index + slides) % slides;
  $("vehicleTrack").style.transform = `translateX(-${currentVehicleSlide * 100}%)`;
  document.querySelectorAll("[data-vehicle-slide]").forEach((dot, dotIndex) => {
    dot.classList.toggle("active", dotIndex === currentVehicleSlide);
    dot.setAttribute("aria-current", dotIndex === currentVehicleSlide ? "true" : "false");
  });
}

function resetDashboard() {
  latestData = null;
  chargeCurrentSamples = [];
  $("socValue").textContent = "—";
  $("socRing").style.setProperty("--soc", 0);
  $("socRing").classList.remove("is-charging");
  $("socLabel").textContent = "รอข้อมูล";
  $("batteryStatus").textContent = "พร้อมสำหรับการเชื่อมต่อ";
  $("rideState").classList.remove("is-charging");
  $("remainingCapacity").innerHTML = "— <small>Ah</small>";
  $("voltageValue").textContent = "—";
  $("currentValue").textContent = "—";
  $("currentDirection").textContent = "รอข้อมูล";
  $("temperatureValue").textContent = "—";
  $("temperatureLabel").textContent = "รอข้อมูล";
  $("deltaValue").textContent = "—";
  $("deltaLabel").textContent = "รอข้อมูล";
  $("cellMinScale").textContent = "— V";
  $("cellAverage").textContent = "— V";
  $("cellMaxScale").textContent = "— V";
  $("cellsGrid").innerHTML = '<div class="cells-empty"><span class="empty-icon">20S</span><strong>ยังไม่มีข้อมูลเซลล์</strong><p>เลือก ANT BMS เพื่อดูแรงดันทั้ง 20 เซลล์</p></div>';
  $("sohValue").textContent = "—";
  $("healthTitle").textContent = "รอการเชื่อมต่อ";
  $("healthText").textContent = "สถานะ protection และ warning จะแสดงที่นี่";
  $("batteryHealthValue").textContent = "รอข้อมูล";
  $("batterySohValue").textContent = "—% SOH";
  setPill("chargeMos", "—");
  setPill("dischargeMos", "—");
  setPill("balancerStatus", "—");
  setPill("lastUpdated", "—");
  $("chargeEta").hidden = true;
  $("chargeEtaValue").textContent = "กำลังคำนวณ…";
  $("chargeEtaClock").textContent = "";
  $("versionText").textContent = "เชื่อมต่อ BMS เพื่ออ่านข้อมูลรถแบบเรียลไทม์";
}

function formatDuration(minutes) {
  if (minutes === 0) return "ใกล้เต็มแล้ว";
  if (minutes < 60) return `ประมาณ ${minutes} นาที`;
  const hours = Math.floor(minutes / 60); const remainder = minutes % 60;
  return remainder ? `ประมาณ ${hours} ชม. ${remainder} นาที` : `ประมาณ ${hours} ชม.`;
}

function renderChargeEta(data, isCharging) {
  const eta = $("chargeEta");
  if (!isCharging) {
    eta.hidden = true; chargeCurrentSamples = []; return;
  }

  eta.hidden = false;
  const now = Date.now(); const amps = Math.abs(data.current);
  if (Number.isFinite(data.current) && data.current <= -0.2) chargeCurrentSamples.push({ time: now, amps });
  chargeCurrentSamples = chargeCurrentSamples.filter((sample) => sample.time >= now - 60_000);
  const averageCurrent = chargeCurrentSamples.length
    ? chargeCurrentSamples.reduce((sum, sample) => sum + sample.amps, 0) / chargeCurrentSamples.length
    : 0;
  const minutes = estimateChargeMinutes(data, averageCurrent);
  if (minutes === null) {
    $("chargeEtaValue").textContent = "กำลังคำนวณ…";
    $("chargeEtaClock").textContent = "รอค่ากระแสชาร์จที่เสถียร";
    return;
  }
  $("chargeEtaValue").textContent = formatDuration(minutes);
  const finishTime = new Date(now + minutes * 60_000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  $("chargeEtaClock").textContent = minutes === 0 ? `SOC ${Math.round(data.soc)}%` : `ประมาณ ${finishTime} น. · เฉลี่ย ${averageCurrent.toFixed(1)} A`;
}

function render(data) {
  latestData = data;
  document.body.classList.remove("data-stale");
  $("socValue").textContent = Math.round(data.soc);
  $("socRing").style.setProperty("--soc", Math.max(0, Math.min(100, data.soc)));
  $("socLabel").textContent = data.soc >= 60 ? "พร้อมเดินทาง" : data.soc >= 25 ? "ควรวางแผนชาร์จ" : "ควรชาร์จแบตเตอรี่";
  $("batteryStatus").textContent = statusNames[data.statusCode] || statusNames[0];
  const isCharging = data.statusCode === 2 || data.current < -0.05;
  $("rideState").classList.toggle("is-charging", isCharging);
  $("socRing").classList.toggle("is-charging", isCharging);
  renderChargeEta(data, isCharging);
  $("remainingCapacity").innerHTML = `${format(data.remainingCapacity, 1)} <small>Ah</small>`;
  $("voltageValue").textContent = format(data.voltage, 2);
  $("currentValue").textContent = format(Math.abs(data.current), 1);
  $("currentDirection").textContent = data.current < 0 ? "กำลังชาร์จ" : data.current > 0 ? "กำลังจ่ายไฟ" : "ไม่มีโหลด";
  const hottest = Math.max(data.mosTemperature ?? -Infinity, data.balancerTemperature ?? -Infinity, ...(data.temperatures ?? []));
  $("temperatureValue").textContent = Number.isFinite(hottest) ? Math.round(hottest) : "—";
  $("temperatureLabel").textContent = hottest >= 55 ? "อุณหภูมิสูง" : hottest >= 45 ? "ควรเฝ้าดู" : "ปกติ";
  const deltaMv = data.delta * 1000;
  $("deltaValue").textContent = Math.round(deltaMv);
  $("deltaLabel").textContent = deltaMv <= 25 ? "สมดุลดี" : deltaMv <= 60 ? "ควรเฝ้าดู" : "ต่างกันสูง";
  $("cellMinScale").textContent = `${format(data.minCell, 3)} V`;
  $("cellMaxScale").textContent = `${format(data.maxCell, 3)} V`;
  $("cellAverage").textContent = `${format(data.averageCell, 3)} V`;
  $("sohValue").textContent = Math.round(data.soh);
  const unhealthy = data.protectionActive || data.warningActive;
  const healthTitle = data.protectionActive ? "Protection ทำงาน" : data.warningActive ? "มีคำเตือน" : "ระบบปกติ";
  $("healthTitle").textContent = healthTitle;
  $("batteryHealthValue").textContent = healthTitle;
  $("batterySohValue").textContent = `${Math.round(data.soh)}% SOH`;
  const firstIssue = data.protections?.find(({ bit }) => bit !== 0 && bit !== 31 && bit !== 34 && bit !== 36)?.label || data.warnings?.[0]?.label;
  $("healthText").textContent = unhealthy ? (firstIssue || "ตรวจสอบในแอป ANT BMS") : "ไม่พบ protection หรือ warning จาก BMS";
  setPill("chargeMos", data.chargeMos === 1 ? "ON" : "OFF", data.chargeMos === 1);
  setPill("dischargeMos", data.dischargeMos === 1 ? "ON" : "OFF", data.dischargeMos === 1);
  setPill("balancerStatus", data.balancer === 4 ? "AUTO" : data.balancer ? "ON" : "OFF", Boolean(data.balancer));
  setPill("lastUpdated", data.receivedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  $("dataAge").textContent = "LIVE"; $("dataAge").classList.add("live");
  renderCells(data);
}

function renderCells(data) {
  const range = Math.max(data.maxCell - data.minCell, 0.001);
  $("cellsGrid").replaceChildren(...data.cells.slice(0, 20).map((voltage, index) => {
    const cell = document.createElement("div");
    const isMin = voltage === data.minCell; const isMax = voltage === data.maxCell;
    cell.className = `cell${isMin ? " is-low" : ""}${isMax ? " is-high" : ""}`;
    cell.style.setProperty("--level", `${32 + ((voltage - data.minCell) / range) * 60}%`);
    cell.innerHTML = `<span>C${String(index + 1).padStart(2, "0")}</span><div class="cell-bar"><i></i></div><strong>${format(voltage, 3)}</strong>`;
    return cell;
  }));
}

function addLog(message, level = "info") {
  const entry = { time: new Date().toISOString(), level, message };
  logs.push(entry); if (logs.length > 300) logs.shift();
  $("debugLog").textContent = logs.slice(-80).map((item) => `[${item.time.slice(11, 19)}] ${item.message}`).join("\n");
  $("debugLog").scrollTop = $("debugLog").scrollHeight;
}

function showToast(message, error = false) {
  const toast = $("toast"); toast.textContent = message; toast.className = `toast show${error ? " error" : ""}`;
  window.setTimeout(() => { toast.className = "toast"; }, 3600);
}

async function refreshDeviceList(extraDevice = null) {
  const list = $("deviceList"); list.innerHTML = '<div class="list-loading">กำลังตรวจสอบอุปกรณ์…</div>';
  try {
    const known = await client.getKnownDevices();
    const devices = [...known];
    if (extraDevice && !devices.some(({ id }) => id === extraDevice.id)) devices.unshift(extraDevice);
    if (!devices.length) {
      list.innerHTML = '<div class="no-devices"><strong>ยังไม่มีอุปกรณ์ที่เคยอนุญาต</strong><br>กด “ค้นหาอุปกรณ์ใหม่” เพื่อเริ่มต้น</div>';
      return;
    }
    list.replaceChildren(...devices.map((device) => {
      const option = document.createElement("button"); option.className = "device-option";
      option.innerHTML = `<span class="device-option-icon">${bluetoothIcon}</span><span class="device-option-copy"><strong></strong><span>แตะเพื่อเชื่อมต่อ</span></span><span class="device-arrow">›</span>`;
      option.querySelector("strong").textContent = device.name || "Bluetooth device";
      option.addEventListener("click", () => connectDevice(device));
      return option;
    }));
  } catch (error) {
    list.innerHTML = `<div class="no-devices">ไม่สามารถอ่านรายการอุปกรณ์ที่เคยอนุญาตได้</div>`;
    addLog(`DEVICE LIST ERROR ${error.message}`, "error");
  }
}

function openDeviceSheet() {
  if (!client.supported) { showToast("เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth", true); return; }
  $("deviceSheet").hidden = false; document.body.classList.add("no-scroll"); refreshDeviceList();
}

function closeDeviceSheet() { $("deviceSheet").hidden = true; document.body.classList.remove("no-scroll"); }

async function connectDevice(device) {
  closeDeviceSheet();
  try {
    intentionalDisconnect = false;
    $("connectButton").disabled = true; $("connectButton").querySelector("span").textContent = "กำลังเชื่อมต่อ…";
    $("dataAge").textContent = "SYNC";
    await client.connect(device);
  } catch (error) {
    addLog(`ERROR ${error.message}`, "error"); showToast(error.message, true);
    $("dataAge").textContent = "OFFLINE";
  } finally {
    $("connectButton").disabled = false;
    if (!connected) $("connectButton").querySelector("span").textContent = "เลือกอุปกรณ์";
  }
}

function openDisconnectDialog() {
  $("disconnectDialog").hidden = false;
  document.body.classList.add("no-scroll");
  window.setTimeout(() => $("cancelDisconnect").focus(), 0);
}

function closeDisconnectDialog() {
  $("disconnectDialog").hidden = true;
  document.body.classList.remove("no-scroll");
}

function handleConnectButton() {
  if (connected) openDisconnectDialog();
  else openDeviceSheet();
}

$("connectButton").addEventListener("click", handleConnectButton);
$("navConnect").addEventListener("click", handleConnectButton);
$("vehiclePrev").addEventListener("click", () => showVehicleSlide(currentVehicleSlide - 1));
$("vehicleNext").addEventListener("click", () => showVehicleSlide(currentVehicleSlide + 1));
document.querySelectorAll("[data-vehicle-slide]").forEach((dot) => {
  dot.addEventListener("click", () => showVehicleSlide(Number(dot.dataset.vehicleSlide)));
});
$("vehicleCarousel").addEventListener("touchstart", (event) => {
  vehicleTouchStartX = event.changedTouches[0]?.clientX ?? null;
}, { passive: true });
$("vehicleCarousel").addEventListener("touchend", (event) => {
  if (vehicleTouchStartX === null) return;
  const distance = (event.changedTouches[0]?.clientX ?? vehicleTouchStartX) - vehicleTouchStartX;
  if (Math.abs(distance) >= 35) showVehicleSlide(currentVehicleSlide + (distance < 0 ? 1 : -1));
  vehicleTouchStartX = null;
}, { passive: true });
$("closeSheet").addEventListener("click", closeDeviceSheet);
$("deviceSheet").addEventListener("click", (event) => { if (event.target === $("deviceSheet")) closeDeviceSheet(); });
$("cancelDisconnect").addEventListener("click", closeDisconnectDialog);
$("disconnectDialog").addEventListener("click", (event) => { if (event.target === $("disconnectDialog")) closeDisconnectDialog(); });
$("confirmDisconnect").addEventListener("click", () => {
  closeDisconnectDialog();
  intentionalDisconnect = true;
  client.disconnect();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("disconnectDialog").hidden) closeDisconnectDialog();
});
$("discoverButton").addEventListener("click", async () => {
  try {
    $("discoverButton").disabled = true;
    const device = await client.requestDevice();
    await refreshDeviceList(device);
    await connectDevice(device);
  } catch (error) {
    if (error.name !== "NotFoundError") { addLog(`ERROR ${error.message}`, "error"); showToast(error.message, true); }
  } finally { $("discoverButton").disabled = false; }
});
$("pollButton").addEventListener("click", () => client.poll().catch((error) => showToast(error.message, true)));
$("clearButton").addEventListener("click", () => { logs.length = 0; $("debugLog").textContent = "[system] ล้าง log แล้ว"; });
$("debugToggle").addEventListener("click", () => {
  const expanded = $("debugToggle").getAttribute("aria-expanded") === "true";
  $("debugToggle").setAttribute("aria-expanded", String(!expanded)); $("debugContent").hidden = expanded;
});
$("navMore").addEventListener("click", () => {
  $("debugToggle").setAttribute("aria-expanded", "true"); $("debugContent").hidden = false;
  $("debugToggle").scrollIntoView({ behavior: "smooth", block: "center" });
});
$("exportButton").addEventListener("click", () => {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), device: client.device?.name, latestData, logs }, null, 2);
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([data], { type: "application/json" })), download: `ant-bms-log-${Date.now()}.json` });
  link.click(); URL.revokeObjectURL(link.href);
});

client.addEventListener("connection", ({ detail }) => {
  connected = detail.connected;
  $("navConnect").classList.toggle("connected", connected);
  $("connectionLabel").textContent = connected ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ";
  $("deviceName").textContent = connected ? detail.name : "VOLTY Electric Motorcycle";
  $("connectButton").classList.toggle("disconnect", connected);
  $("connectButton").querySelector("span").textContent = connected ? "ตัดการเชื่อมต่อ" : "เลือกอุปกรณ์";
  $("pollButton").disabled = !connected;
  $("dataAge").textContent = connected ? "SYNC" : "OFFLINE"; $("dataAge").classList.toggle("live", connected);
  if (!connected) { document.body.classList.add("data-stale"); resetDashboard(); }
  addLog(connected ? `CONNECTED ${detail.name}` : `DISCONNECTED ${detail.name}`);
  if (!connected && !intentionalDisconnect) showToast("Bluetooth ถูกตัดการเชื่อมต่อ", true);
  else if (connected) showToast(`เชื่อมต่อ ${detail.name} แล้ว`);
  intentionalDisconnect = false;
});

client.addEventListener("log", ({ detail }) => addLog(`${detail.direction}${detail.chunk ? " CHUNK" : ""} ${detail.hex}`));
client.addEventListener("error", ({ detail }) => addLog(`ERROR ${detail.error.message}`, "error"));
client.addEventListener("frame", ({ detail }) => {
  try {
    addLog(`FRAME ${bytesToHex(detail.frame)}`);
    if (detail.frame[2] === 0x11) render(parseStatusFrame(detail.frame));
    else if (detail.frame[2] === 0x12) {
      const info = parseDeviceInfoFrame(detail.frame);
      $("versionText").textContent = `HW ${info.hardwareVersion || "—"} · SW ${info.softwareVersion || "—"}`;
      addLog(`DEVICE HW=${info.hardwareVersion} SW=${info.softwareVersion}`);
    } else addLog(`UNHANDLED function 0x${detail.frame[2].toString(16)}`);
  } catch (error) { addLog(`PARSE ERROR ${error.message}`, "error"); showToast(`อ่านข้อมูลไม่ได้: ${error.message}`, true); }
});

if (!client.supported) {
  $("compatibilityText").textContent = "เบราว์เซอร์นี้ไม่มี Web Bluetooth — ใช้ Chrome/Edge บน Android หรือคอมพิวเตอร์";
  $("connectButton").disabled = true; $("navConnect").disabled = true; $("discoverButton").disabled = true;
}
$("pollButton").disabled = true;
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("service-worker.js").catch(() => {});
