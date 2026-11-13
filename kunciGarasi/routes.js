const express = require("express");
const repositoryDefault = require("./repositories/partners");
const { createGooglePlacesClient } = require("./services/google-places");
const demo = require("./data/workshops");
const {
  coordinates,
  filterWorkshops,
  mapsSearchUrl,
  bad,
  RADIUS_KM,
} = require("./lib/workshop-utils");
function asDemo(w) {
  return {
    ...w,
    id: "demo:" + w.id,
    source: "demo",
    classification: "demo",
    membershipStatus: "demo",
    isPartner: false,
    isDemo: true,
  };
}
function createWorkshopRouter({
  repository = repositoryDefault,
  google = createGooglePlacesClient(),
  now = Date.now,
} = {}) {
  const router = express.Router(),
    calls = new Map();
  let hourStart = now(),
    total = 0;
  function limit(userId) {
    const time = now();
    if (time - hourStart >= 3600000) {
      hourStart = time;
      total = 0;
      calls.clear();
    }
    const user = calls.get(userId) || { count: 0, last: -Infinity };
    if (time - user.last < 10000 || user.count >= 20 || total >= 60)
      throw bad(
        "Batas pencarian Google Maps tercapai. Coba lagi nanti.",
        429,
        "GOOGLE_RATE_LIMIT",
      );
    calls.set(userId, { count: user.count + 1, last: time });
    total++;
  }
  router.get("/api/workshops/sources", (req, res) =>
    res.json({
      google: google.status(),
      groups: ["partner", "general", "demo"],
      radiusKm: RADIUS_KM,
    }),
  );
  router.get("/api/workshops", async (req, res, next) => {
    try {
      const location = coordinates(req.query),
        group = req.query.group || "partner";
      if (!["partner", "general", "demo"].includes(group))
        throw bad("Kelompok bengkel tidak valid.");
      let rows,
        notice = null;
      if (group === "demo") {
        rows = demo.map(asDemo);
        notice =
          "Data contoh fiktif, bukan mitra terdaftar atau hasil Google Maps.";
      } else if (group === "partner") {
        rows = await repository.listApproved();
      } else {
        if (!google.status().ready)
          throw bad(
            "Pencarian Google Maps belum aktif. Gunakan tautan Google Maps atau tunggu konfigurasi server.",
            503,
            "GOOGLE_NOT_READY",
          );
        const partners = await repository.listApproved();
        limit(req.session?.user?.id || "local");
        const ids = new Set(
          partners.map((w) => w.googlePlaceId).filter(Boolean),
        );
        rows = (await google.search(location, req.query.vehicleType)).filter(
          (w) => !ids.has(w.googlePlaceId),
        );
        notice =
          "Hasil terdekat Google Maps, maksimal 20 sebelum filter. Keanggotaan belum cocok dengan mitra yang ditautkan. Rating hanya ditampilkan jika tersedia dari Google; layanan khusus dan kategori belum diverifikasi bengkel.";
      }
      const data = filterWorkshops(rows, req.query, location);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        group,
        source:
          group === "partner"
            ? "bengkelin"
            : group === "general"
              ? "google_places"
              : "demo",
        location,
        radiusKm: RADIUS_KM,
        total: data.length,
        recommended:
          group !== "general" &&
          req.query.sort !== "distance" &&
          req.query.sort !== "rating"
            ? data[0] || null
            : null,
        data,
        notice,
        mapsSearchUrl: mapsSearchUrl(location),
        google: group === "general" ? google.status() : undefined,
      });
    } catch (error) {
      if (error.status) {
        const location = (() => {
          try {
            return coordinates(req.query);
          } catch {
            return null;
          }
        })();
        if (error.status === 429) res.setHeader("Retry-After", "10");
        return res.status(error.status).json({
          message: error.message,
          code: error.code,
          mapsSearchUrl:
            location && error.code !== "LOCATION_REQUIRED"
              ? mapsSearchUrl(location)
              : undefined,
        });
      }
      next(error);
    }
  });
  router.get("/api/workshops/:id", async (req, res, next) => {
    try {
      const location = coordinates(req.query),
        id = req.params.id;
      let row;
      if (/^demo:\d+$/.test(id)) {
        const item = demo.find((w) => w.id === Number(id.slice(5)));
        row = item ? asDemo(item) : null;
      } else if (/^(?:partner:)?\d+$/.test(id)) {
        row = await repository.getApproved(Number(id.replace("partner:", "")));
      } else throw bad("Gunakan tautan Google Maps untuk detail bengkel umum.");
      if (!row)
        return res.status(404).json({ message: "Bengkel tidak ditemukan." });
      const data = filterWorkshops([row], {}, location);
      if (!data.length)
        return res
          .status(404)
          .json({ message: "Bengkel berada di luar radius pencarian." });
      res.json(data[0]);
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      next(error);
    }
  });
  router.use((error, req, res, next) => {
    console.error("Workshop request gagal:", error.code || error.name);
    res.status(503).json({
      message:
        "Data bengkel belum tersedia. Periksa koneksi dan migrasi database.",
    });
  });
  return router;
}
module.exports = createWorkshopRouter();
module.exports.createWorkshopRouter = createWorkshopRouter;
module.exports.asDemo = asDemo;
