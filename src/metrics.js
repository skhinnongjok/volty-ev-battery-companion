export function estimateChargeMinutes(data, chargeCurrent) {
  if (!Number.isFinite(chargeCurrent) || chargeCurrent < 0.2) return null;

  const total = data.totalCapacity;
  const remaining = data.remainingCapacity;
  const soc = data.soc;
  let missingCapacity = null;

  if (Number.isFinite(total) && total > 0) {
    if (Number.isFinite(remaining) && remaining >= 0 && remaining <= total * 1.05) {
      missingCapacity = Math.max(0, total - remaining);
    } else if (Number.isFinite(soc)) {
      missingCapacity = total * Math.max(0, 100 - soc) / 100;
    }
  } else if (Number.isFinite(remaining) && remaining > 0 && Number.isFinite(soc) && soc > 0 && soc < 100) {
    const inferredTotal = remaining / (soc / 100);
    missingCapacity = inferredTotal - remaining;
  }

  if (!Number.isFinite(missingCapacity)) return null;
  if (missingCapacity <= 0.02 || soc >= 100) return 0;
  const minutes = Math.ceil((missingCapacity / chargeCurrent) * 60 - 1e-9);
  return minutes > 0 && minutes <= 72 * 60 ? minutes : null;
}
