const RADIUS_KM = 15;
function bad(message, status = 400, code = "INVALID_INPUT") {
  return Object.assign(new Error(message), { status, code });
}
function coordinates(query) {
  if (query.lat === undefined && query.lng === undefined)
    throw bad(
      "Lokasi perangkat diperlukan untuk pencarian bengkel dalam jangkauan 15 KM.",
      400,
      "LOCATION_REQUIRED",
    );
  const lat = Number(query.lat),
    lng = Number(query.lng);
  if (
    typeof query.lat !== "string" ||
    typeof query.lng !== "string" ||
    !query.lat.trim() ||
    !query.lng.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    throw bad("Koordinat tidak valid. Kirim lat dan lng yang lengkap.");
  return { lat, lng, isDefault: false };
}
function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (x) => (x * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function withDistance(w, location) {
  const distance = distanceKm(location.lat, location.lng, w.lat, w.lng);
  const proximity=1/(1+distance);
  const reviews=Number.isFinite(w.reviews)?Math.max(0,w.reviews):0;
  // Bayesian shrinkage avoids treating one 5-star review as stronger than many reviews.
  const adjusted=w.rating==null?null:(reviews*w.rating+20*3.5)/(reviews+20);
  return {...w,distanceKm:+distance.toFixed(1),_distance:distance,score:+(adjusted==null?0.6*proximity:0.6*proximity+0.4*adjusted/5).toFixed(5)};
}
const sorters = {
  best: (a, b) => b.score - a.score || a._distance - b._distance,
  rating: (a, b) =>
    (b.rating ?? -1) - (a.rating ?? -1) || a._distance - b._distance,
  distance: (a, b) => a._distance - b._distance,
};
function filterWorkshops(rows, query, location) {
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
  if (q.length > 100) throw bad("Pencarian maksimal 100 karakter.");
  if (query.sort !== undefined && !Object.hasOwn(sorters, query.sort))
    throw bad("Urutan tidak valid.");
  const min =
    query.minRating === undefined || query.minRating === ""
      ? null
      : Number(query.minRating);
  if (min !== null && (!Number.isFinite(min) || min < 0 || min > 5))
    throw bad("Rating minimum harus 0 sampai 5.");
  if (
    query.category !== undefined &&
    !["", "onsite", "pickup", "emergency"].includes(query.category)
  )
    throw bad("Kategori layanan tidak valid.");
  if(query.vehicleType!==undefined&&!['motor','mobil'].includes(query.vehicleType))throw bad("Kategori kendaraan tidak valid.");
  let result = rows
    .map((w) => withDistance(w, location))
    .filter((w) => w._distance <= RADIUS_KM);
  if(query.vehicleType)result=result.filter(w=>w.vehicleTypes?.includes(query.vehicleType)||(w.source==="google_places"&&w.vehicleQueryType===query.vehicleType));
  if (q)
    result = result.filter((w) =>
      [w.name, w.address || "", ...(w.services || [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  if (min !== null)
    result = result.filter((w) => w.rating !== null && w.rating >= min);
  if (query.pickup === "true") result = result.filter((w) => w.pickup === true);
  if (query.category === "emergency") {
    result = result.filter((workshop) =>
      workshop.isPartner === true && workshop.membershipStatus === "approved" &&
      workshop.pickup === true && workshop.photos?.some((photo) => photo.kind === "tow"),
    );
  } else if (query.category) {
    result = result.filter((workshop) => workshop[query.category] === true);
  }
  return result
    .sort(sorters[query.sort || "best"])
    .map(({ _distance, ...w }) => w);
}
function mapsSearchUrl(location) {
  return (
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(`bengkel sekitar ${location.lat},${location.lng}`)
  );
}
module.exports = {
  RADIUS_KM,
  bad,
  coordinates,
  distanceKm,
  filterWorkshops,
  mapsSearchUrl,
};
