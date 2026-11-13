const express = require("express");
const { coordinates } = require("../lib/workshop-utils");
function regionLabel(results) {
  const components = results.flatMap((r) => r.address_components || []);
  const get = (type) =>
    components.find((c) => c.types?.includes(type))?.long_name;
  const district =
    get("administrative_area_level_3") || get("sublocality_level_1");
  const city = get("administrative_area_level_2") || get("locality");
  const clean = (s) =>
    s?.replace(/^(Kecamatan|Kec\.|Kabupaten|Kab\.|Kota)\s+/i, "").trim();
  return (
    [...new Set([clean(district), clean(city)].filter(Boolean))].join(", ") ||
    null
  );
}
function createLocationRouter({ fetchImpl = fetch } = {}) {
  const router = express.Router(),
    calls = new Map();
  let guestBudget = { start: 0, count: 0 };
  const lookup = (guest) => async (req, res) => {
    try {
      const location = coordinates(req.query),
        key =
          process.env.GOOGLE_GEOCODING_API_KEY ||
          process.env.GOOGLE_PLACES_API_KEY;
      if (!key)
        return res
          .status(503)
          .json({
            message:
              "Nama wilayah belum tersedia. Geocoding API perlu dikonfigurasi.",
          });
      const id = guest ? `guest:${req.ip}` : `user:${req.session?.user?.id}`,
        now = Date.now();
      for (const [k, v] of calls) if (now - v.start > 60000) calls.delete(k);
      const entry = calls.get(id) || { start: now, count: 0 };
      if (++entry.count > (guest ? 5 : 30))
        return res
          .status(429)
          .json({ message: "Tunggu sebentar sebelum memeriksa lokasi lagi." });
      calls.set(id, entry);
      if (guest) {
        if (now - guestBudget.start >= 3600000)
          guestBudget = { start: now, count: 0 };
        if (guestBudget.count >= 60)
          return res
            .status(429)
            .json({
              message:
                "Pemeriksaan wilayah tamu sedang penuh. Anda tetap dapat memakai titik yang dipilih.",
            });
        guestBudget.count++;
      }
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", location.lat + "," + location.lng);
      url.searchParams.set("language", "id");
      url.searchParams.set("key", key);
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.json();
      const label =
        body.status === "OK" ? regionLabel(body.results || []) : null;
      res.set("Cache-Control", "no-store");
      if (!label)
        return res
          .status(503)
          .json({
            message:
              "Nama wilayah belum tersedia; periksa akses Geocoding API.",
          });
      res.json({
        label,
        source: "Google Maps",
        lat: location.lat,
        lng: location.lng,
      });
    } catch (e) {
      res
        .status(e.status || 503)
        .json({
          message: e.status ? e.message : "Nama wilayah belum dapat dimuat.",
        });
    }
  };
  router.get("/api/location-name", lookup(false));
  router.get("/api/mitra/location-name", lookup(true));
  return router;
}
module.exports = { createLocationRouter, regionLabel };
