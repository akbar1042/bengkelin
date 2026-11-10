
// Menentukan batas maksimal jarak pencarian bengkel (15 KM)
const RADIUS_KM = 15;

// Membuat objek error dengan pesan, status HTTP, dan kode error
function bad(message, status = 400, code = "INVALID_INPUT") {
  return Object.assign(new Error(message), { status, code });
}

// Mengambil dan memvalidasi koordinat lokasi pengguna
function coordinates(query) {
  // Memastikan lokasi perangkat telah dikirim
  if (query.lat === undefined && query.lng === undefined)
    throw bad(
      "Lokasi perangkat diperlukan untuk pencarian bengkel dalam jangkauan 15 KM.",
      400,
      "LOCATION_REQUIRED",
    );

  // Mengubah koordinat menjadi angka
  const lat = Number(query.lat),
    lng = Number(query.lng);

  // Memastikan format dan rentang koordinat valid
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

  // Mengembalikan lokasi pengguna
  return { lat, lng, isDefault: false };
}

// Menghitung jarak dua koordinat menggunakan rumus Haversine
function distanceKm(lat1, lng1, lat2, lng2) {
  // Mengubah derajat menjadi radian
  const rad = (x) => (x * Math.PI) / 180;

  // Menghitung perbedaan posisi kedua koordinat
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(rad(lng2 - lng1) / 2) ** 2;

  // Mengembalikan jarak dalam kilometer (radius bumi 6371 KM)
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

// Menambahkan jarak dan skor rekomendasi pada data bengkel
function withDistance(w, location) {
  
  // Menghitung jarak bengkel dari pengguna
  const distance = distanceKm(location.lat, location.lng, w.lat, w.lng);

  // Menghitung skor kedekatan, semakin dekat semakin tinggi
  const proximity = 1 / (1 + distance);

  // Mengambil jumlah ulasan bengkel
  const reviews = Number.isFinite(w.reviews) ? Math.max(0, w.reviews) : 0;

  // Menyesuaikan rating berdasarkan jumlah ulasan agar lebih adil
  const adjusted =
    w.rating == null ? null : (reviews * w.rating + 20 * 3.5) / (reviews + 20);

  // Menggabungkan data bengkel dengan jarak dan skor rekomendasi
  return {
    ...w,
    distanceKm: +distance.toFixed(1),
    _distance: distance,
    score: +(
      adjusted == null
        ? 0.6 * proximity
        : 0.6 * proximity + (0.4 * adjusted) / 5
    ).toFixed(5),
  };
}

// Menentukan metode pengurutan bengkel
const sorters = {
  
  // Mengurutkan berdasarkan skor rekomendasi tertinggi
  best: (a, b) => b.score - a.score || a._distance - b._distance,

  // Mengurutkan berdasarkan rating tertinggi
  rating: (a, b) =>
    (b.rating ?? -1) - (a.rating ?? -1) || a._distance - b._distance,

  // Mengurutkan berdasarkan jarak terdekat
  distance: (a, b) => a._distance - b._distance,
};

// Menyaring bengkel berdasarkan lokasi dan preferensi pengguna
function filterWorkshops(rows, query, location) {
  
  // Mengambil kata kunci pencarian
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";

  // Membatasi panjang kata kunci pencarian
  if (q.length > 100) throw bad("Pencarian maksimal 100 karakter.");

  // Memvalidasi metode pengurutan
  if (query.sort !== undefined && !Object.hasOwn(sorters, query.sort))
    throw bad("Urutan tidak valid.");

  // Mengambil nilai rating minimum
  const min =
    query.minRating === undefined || query.minRating === ""
      ? null
      : Number(query.minRating);

  // Memastikan rating berada pada rentang 0 sampai 5
  if (min !== null && (!Number.isFinite(min) || min < 0 || min > 5))
    throw bad("Rating minimum harus 0 sampai 5.");

  // Memvalidasi kategori layanan bengkel
  if (
    query.category !== undefined &&
    !["", "onsite", "pickup", "emergency"].includes(query.category)
  )
    throw bad("Kategori layanan tidak valid.");

  // Memvalidasi jenis kendaraan
  if (
    query.vehicleType !== undefined &&
    !["motor", "mobil"].includes(query.vehicleType)
  )
    throw bad("Kategori kendaraan tidak valid.");

  // Menghitung jarak dan mengambil bengkel dalam radius 15 KM
  let result = rows
    .map((w) => withDistance(w, location))
    .filter((w) => w._distance <= RADIUS_KM);

  // Memfilter bengkel berdasarkan jenis kendaraan
  if (query.vehicleType)
    result = result.filter(
      (w) =>
        w.vehicleTypes?.includes(query.vehicleType) ||
        (w.source === "google_places" &&
          w.vehicleQueryType === query.vehicleType),
    );

  // Mencari bengkel berdasarkan nama, alamat, atau layanan
  if (q)
    result = result.filter((w) =>
      [w.name, w.address || "", ...(w.services || [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );

  // Memfilter bengkel berdasarkan rating minimum
  if (min !== null)
    result = result.filter((w) => w.rating !== null && w.rating >= min);

  // Memfilter bengkel yang menyediakan layanan penjemputan
  if (query.pickup === "true") result = result.filter((w) => w.pickup === true);

  // Memfilter bengkel untuk layanan darurat
  if (query.category === "emergency") {
    result = result.filter(
      (workshop) =>
        workshop.isPartner === true &&
        workshop.membershipStatus === "approved" &&
        workshop.pickup === true &&
        workshop.photos?.some((photo) => photo.kind === "tow"),
    );

  // Memfilter bengkel berdasarkan kategori layanan lainnya
  } else if (query.category) {
    result = result.filter((workshop) => workshop[query.category] === true);
  }

  // Mengurutkan hasil dan menghapus properti jarak internal
  return result
    .sort(sorters[query.sort || "best"])
    .map(({ _distance, ...w }) => w);
}

// Membuat URL Google Maps untuk pencarian bengkel sekitar pengguna
function mapsSearchUrl(location) {
  return (
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(`bengkel sekitar ${location.lat},${location.lng}`)
  );
}

// Mengekspor fungsi dan konstanta agar dapat digunakan pada file lain
module.exports = {
  RADIUS_KM,
  bad,
  coordinates,
  distanceKm,
  filterWorkshops,
  mapsSearchUrl,
};
