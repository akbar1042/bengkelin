const { bad } = require("./workshop-utils");
const TERMS_VERSION = "2026-11-07";
const serviceCatalog = [
  ...new Set([
    ...require("../data/workshops").flatMap((w) => w.services),
    "Servis motor",
    "Servis mobil",
    "Injeksi motor",
    "CVT motor",
    "Transmisi mobil",
    "Kelistrikan motor",
    "Kelistrikan mobil",
  ]),
];

function validateRegistration(body) {
  const keys = [
    "name",
    "address",
    "phone",
    "lat",
    "lng",
    "services",
    "pickup",
    "onsite",
    "emergency",
    "open24",
    "vehicleTypes",
    "hours",
    "termsAccepted",
    "privacyAccepted",
    "termsVersion",
    "emergencyAccepted",
    "booking",
  ];

  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== "object" ||
    Object.keys(body).some((k) => !keys.includes(k))
  ) {
    throw bad(
      "Data pendaftaran tidak valid. Status dan pemilik ditentukan server.",
    );
  }

  for (const [k, max] of [
    ["name", 160],
    ["address", 500],
    ["phone", 30],
  ]) {
    if (typeof body[k] !== "string" || !body[k].trim() || body[k].length > max)
      throw bad(`${k} wajib diisi, maksimal ${max} karakter.`);
  }

  if (!/^[+\d\s()-]{6,30}$/.test(body.phone)) {
    throw bad("Nomor telepon tidak valid.");
  }

  if (
    !Number.isFinite(body.lat) ||
    !Number.isFinite(body.lng) ||
    Math.abs(body.lat) > 90 ||
    Math.abs(body.lng) > 180
  ) {
    throw bad("Koordinat bengkel tidak valid.");
  }

  if (
    !Array.isArray(body.services) ||
    !body.services.length ||
    body.services.length > 20 ||
    !body.services.every((s) => serviceCatalog.includes(s))
  ) {
    throw bad("Pilih layanan kerusakan dari daftar.");
  }

  if (
    !Array.isArray(body.vehicleTypes) ||
    !body.vehicleTypes.length ||
    body.vehicleTypes.length > 2 ||
    !body.vehicleTypes.every((v) => ["motor", "mobil"].includes(v))
  ) {
    throw bad("Pilih kategori motor dan/atau mobil.");
  }

  for (const flag of ["pickup", "onsite", "emergency", "open24"]) {
    if (body[flag] !== undefined && typeof body[flag] !== "boolean")
      throw bad(`${flag} harus boolean.`);
  }

  const h = body.hours;

  if (
    !h ||
    typeof h !== "object" ||
    !Array.isArray(h.days) ||
    !h.days.length ||
    h.days.length > 7 ||
    !h.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.open) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.close) ||
    (!body.open24 && h.open === h.close)
  ) {
    throw bad(
      "Hari dan jam operasional wajib valid; jam sama hanya untuk buka 24 jam.",
    );
  }

  if (
    body.termsAccepted !== true ||
    body.privacyAccepted !== true ||
    body.termsVersion !== TERMS_VERSION
  ) {
    throw bad(
      "Persetujuan syarat dan kebijakan mitra versi terbaru wajib diberikan.",
    );
  }

  if (body.emergency && body.emergencyAccepted !== true) {
    throw bad("Layanan darurat memerlukan persetujuan siap siaga 24 jam.");
  }

  const booking = body.booking || { capacity: 1, durations: {} };

  if (
    !Number.isInteger(booking.capacity) ||
    booking.capacity < 1 ||
    booking.capacity > 20 ||
    !booking.durations ||
    typeof booking.durations !== "object" ||
    Array.isArray(booking.durations) ||
    Object.entries(booking.durations).some(
      ([k, v]) =>
        !body.services.includes(k) || !Number.isInteger(v) || v < 15 || v > 480,
    )
  ) {
    throw bad("Kapasitas 1–20 dan durasi layanan 15–480 menit wajib valid.");
  }

  return {
    booking,
    name: body.name.trim(),
    address: body.address.trim(),
    phone: body.phone.trim(),
    lat: body.lat,
    lng: body.lng,
    services: [...new Set(body.services)],
    vehicleTypes: [...new Set(body.vehicleTypes)],
    hours: {
      days: [...new Set(h.days)],
      open: h.open,
      close: h.close,
      timeZone: "Asia/Jakarta",
    },
    ...Object.fromEntries(
      ["pickup", "onsite", "emergency", "open24"].map((k) => [
        k,
        body[k] ?? false,
      ]),
    ),
    termsVersion: TERMS_VERSION,
    termsAccepted: true,
    privacyAccepted: true,
    emergencyAccepted: body.emergency === true,
  };
}
module.exports = { validateRegistration, serviceCatalog, TERMS_VERSION };
