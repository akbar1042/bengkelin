const assert = require("node:assert/strict"),
  express = require("express");
const { createWorkshopRouter } = require("../kunciGarasi/routes");
const {
  createGooglePlacesClient,
} = require("../kunciGarasi/services/google-places");
const { publicPartner } = require("../kunciGarasi/repositories/partners");
const { validateRegistration } = require("../kunciGarasi/routes/partners");
const location = { lat: -7.37364, lng: 112.75913 };
(async () => {
  const { filterWorkshops } = require("../kunciGarasi/lib/workshop-utils");
  const verified = {
    id: "tow",
    name: "Derek aktif",
    lat: location.lat,
    lng: location.lng,
    pickup: true,
    isPartner: true,
    membershipStatus: "approved",
    vehicleTypes: ["mobil"],
    photos: [{ kind: "tow" }],
  };
  const emergency = [
    verified,
    { ...verified, id: "flag-only", photos: [] },
    { ...verified, id: "not-approved", membershipStatus: "pending" },
    { ...verified, id: "general", isPartner: false },
    { ...verified, id: "motor-only", vehicleTypes: ["motor"] },
    { ...verified, id: "outside", lat: location.lat + 1 },
  ];
  assert.deepEqual(
    filterWorkshops(
      emergency,
      { category: "emergency", vehicleType: "mobil" },
      location,
    ).map((w) => w.id),
    ["tow"],
  );
  let providerCalls = 0;
  const config = {
    enabled: true,
    key: "test-key-not-real",
    termsUrl: "https://example.com/terms",
    privacyUrl: "https://example.com/privacy",
  };
  const fetchImpl = async (url, options) => {
    providerCalls++;
    assert.equal(url, "https://places.googleapis.com/v1/places:searchNearby");
    assert.equal(options.headers["X-Goog-Api-Key"], config.key);
    assert(options.headers["X-Goog-FieldMask"].includes("rating"));
    const request = JSON.parse(options.body);
    assert.equal(request.locationRestriction.circle.radius, 15000);
    assert.deepEqual(request.includedTypes, ["car_repair"]);
    return {
      ok: true,
      json: async () => ({
        places: [
          {
            id: "linked-place",
            displayName: { text: "Known partner" },
            location: { latitude: location.lat, longitude: location.lng },
          },
          {
            id: "general-place",
            displayName: { text: "General shop" },
            formattedAddress: "Alamat umum",
            location: {
              latitude: location.lat + 0.01,
              longitude: location.lng,
            },
            googleMapsUri: "https://www.google.com/maps?cid=123",
            attributions: [
              { provider: "Provider", providerUri: "https://example.com" },
            ],
          },
          {
            id: "general-place",
            displayName: { text: "Duplicate" },
            location: { latitude: location.lat, longitude: location.lng },
          },
          {
            id: "far-place",
            displayName: { text: "Outside" },
            location: { latitude: -6, longitude: 111 },
          },
          {
            id: "closed-place",
            displayName: { text: "Closed" },
            businessStatus: "CLOSED_PERMANENTLY",
            location: { latitude: location.lat, longitude: location.lng },
          },
        ],
      }),
    };
  };
  const google = createGooglePlacesClient({ fetchImpl, config: () => config });
  const pending = publicPartner({
    id: 99,
    status: "pending",
    name: "Pending",
    services: "[]",
    lat: location.lat,
    lng: location.lng,
  });
  assert.equal(pending.isPartner, false);
  const partner = publicPartner({
    id: 1,
    status: "approved",
    name: "Approved partner",
    services: '["Aki"]',
    lat: location.lat,
    lng: location.lng,
    google_place_id: "linked-place",
    pickup: 1,
  });
  const repository = {
    listApproved: async () => [partner],
    getApproved: async (id) => (id === 1 ? partner : null),
  };
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { id: 1 } };
    next();
  });
  app.use(createWorkshopRouter({ repository, google }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const noLocation = await fetch(
      base + "/api/workshops?group=general&sort=distance",
    );
    assert.equal(noLocation.status, 400);
    const missing = await noLocation.json();
    assert.equal(missing.code, "LOCATION_REQUIRED");
    assert.equal(missing.mapsSearchUrl, undefined);
    assert.equal(providerCalls, 0);
    for (const group of ["partner", "demo"]) {
      const absent = await fetch(base + "/api/workshops?group=" + group);
      assert.equal(absent.status, 400);
      assert.equal((await absent.json()).code, "LOCATION_REQUIRED");
    }
    let response = await fetch(
      base + "/api/workshops?lat=-7.37364&lng=112.75913",
    );
    let data = await response.json();
    assert.equal(data.group, "partner");
    assert.equal(data.total, 1);
    assert.equal(data.data[0].isPartner, true);
    assert.equal(data.data[0].isDemo, false);
    assert.equal(providerCalls, 0);
    response = await fetch(
      base + "/api/workshops?group=demo&lat=-7.37364&lng=112.75913",
    );
    data = await response.json();
    assert.equal(data.total, 20);
    assert(
      data.data.every((w) => w.isDemo && !w.isPartner && w.source === "demo"),
    );
    response = await fetch(
      base +
        "/api/workshops?group=general&sort=distance&lat=-7.37364&lng=112.75913",
    );
    data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.total, 1);
    assert.equal(data.data[0].googlePlaceId, "general-place");
    assert.equal(data.data[0].services, null);
    assert.equal(data.data[0].rating, null);
    assert.equal(data.data[0].pickup, null);
    assert.equal(data.recommended, null);
    assert.equal(providerCalls, 1);
    response = await fetch(
      base +
        "/api/workshops?group=general&sort=distance&lat=-7.37364&lng=112.75913",
    );
    assert.equal(response.status, 429);
    assert.equal(providerCalls, 1);
    response = await fetch(
      base +
        "/api/workshops?group=general&pickup=true&lat=-7.37364&lng=112.75913",
    );
    assert.equal(response.status, 429);
    assert.equal(providerCalls, 1);
    response = await fetch(base + "/api/workshops?lat=no&lng=112");
    assert.equal(response.status, 400);
    response = await fetch(
      base + "/api/workshops/partner:1?lat=-7.37364&lng=112.75913",
    );
    assert.equal(response.status, 200);
    response = await fetch(
      base + "/api/workshops/partner:2?lat=-7.37364&lng=112.75913",
    );
    assert.equal(response.status, 404);
    config.enabled = false;
    response = await fetch(
      base +
        "/api/workshops?group=general&sort=distance&lat=-7.37364&lng=112.75913",
    );
    assert.equal(response.status, 503);
    assert.equal(providerCalls, 1);
    const input = {
      name: "A",
      address: "Alamat",
      phone: "08123456789",
      lat: 0,
      lng: 0,
      services: ["Aki"],
      vehicleTypes: ["motor"],
      hours: { days: [1], open: "08:00", close: "17:00" },
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: "2026-11-07",
    };
    assert.equal(validateRegistration(input).lat, 0);
    assert.throws(() => validateRegistration({ ...input, status: "approved" }));
    assert.throws(() => validateRegistration({ ...input, owner_user_id: 999 }));
    assert.throws(() => validateRegistration({ ...input, lat: "0" }));
    console.log(
      "PASS: mitra/demo/Google terpisah, deduplikasi Place ID, radius, nilai tidak diketahui, pembatasan request, konfigurasi nonaktif, validasi anti-promosi. Tidak ada request Google nyata.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
