const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const nodes = new Map();
function element() {
  return {
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    options: [],
    dataset: {},
    listeners: {},
    classList: { remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute(name) {
      delete this[name];
    },
    append() {},
    replaceChildren() {
      this.innerHTML = "";
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
  };
}
const get = (id) => {
  if (!nodes.has(id)) nodes.set(id, element());
  return nodes.get(id);
};
get("sort").options = ["best", "rating", "distance"].map((value) => ({
  value,
}));
const groups = ["partner", "general", "demo"].map((group) =>
  Object.assign(element(), { dataset: { workshopGroup: group } }),
);
const rows = {
  partner: {
    id: "partner:1",
    name: "Mitra Uji",
    source: "bengkelin",
    isPartner: true,
    isDemo: false,
    membershipStatus: "approved",
    services: [],
  },
  general: {
    id: "google:real-place-id",
    name: "Google Uji",
    source: "google_places",
    isPartner: false,
    isDemo: false,
    services: null,
  },
  demo: {
    id: "demo:1",
    name: "Dummy Uji",
    source: "demo",
    isPartner: false,
    isDemo: true,
    services: [],
  },
};
const sources = {
  partner: "bengkelin",
  general: "google_places",
  demo: "demo",
};
let mode = "normal",
  googleCalls = 0,
  geoMode = "denied",
  geoCalls = 0,
  pendingPartner,
  pendingGeneral,
  pendingLocation,
  lastGoogleQuery;
const coords = { latitude: -7.9666, longitude: 112.6326 },
  permission = { state: "prompt", onchange: null };
const geolocation = {
  getCurrentPosition(success, failure, options) {
    geoCalls++;
    if (geoMode === "throws") throw new Error("Location API unavailable");
    assert.equal(options.maximumAge, 0);
    assert.equal(options.enableHighAccuracy, true);
    if (geoMode === "pending") {
      pendingLocation = success;
      return;
    }
    if (geoMode === "granted") return success({ coords });
    failure({ code: geoMode === "denied" ? 1 : geoMode === "timeout" ? 3 : 2 });
  },
};
const response = (body) => ({ ok: true, status: 200, json: async () => body });
const payload = (group) => ({
  group,
  source: sources[group],
  total: 1,
  data: [rows[group]],
  location: { lat: coords.latitude, lng: coords.longitude, isDefault: false },
  google: {
    termsUrl: "https://example.com/terms",
    privacyUrl: "https://example.com/privacy",
  },
});
const context = vm.createContext({
  document: {
    getElementById: get,
    querySelectorAll: (selector) =>
      selector === "[data-workshop-group]" ? groups : [],
    createElement: element,
  },
  window: {
    isSecureContext: true,
    location: { replace() {} },
    addEventListener() {},
  },
  navigator: { geolocation, permissions: { query: async () => permission } },
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: async (url) => {
    if (url === "/api/me")
      return response({
        user: { email: "test@example.com", role: "customer" },
      });
    if (url === "/api/workshops/sources")
      return response({ google: { ready: true } });
    const query = new URLSearchParams(url.split("?")[1]),
      group = query.get("group");
    if (group === "general") {
      googleCalls++;
      lastGoogleQuery = query;
    }
    if (mode === "defer" && group === "partner")
      return new Promise((resolve) => {
        pendingPartner = () => resolve(response(payload(group)));
      });
    if (mode === "defer-general" && group === "general")
      return new Promise((resolve) => {
        pendingGeneral = () => resolve(response(payload(group)));
      });
    if (mode === "failure") throw Error("Provider unavailable");
    const body = payload(group);
    if (mode === "empty") {
      body.data = [];
      body.total = 0;
    }
    if (mode === "wrong-group") body.group = "demo";
    if (mode === "dummy-in-google") body.data = [rows.demo];
    if (mode === "wrong-location")
      body.location = { lat: -7.37364, lng: 112.75913, isDefault: true };
    return response(body);
  },
});
const run = (code) => vm.runInContext(code, context);
(async () => {
  run(fs.readFileSync(require.resolve("../kunciGarasi/public/app.js"), "utf8"));
  await new Promise(setImmediate);
  assert.equal(get("grid").innerHTML, "");
  assert(get("count").textContent.includes("Lokasi perangkat belum diperoleh"));
  await run('selectGroup("partner")');
  assert(get("count").textContent.includes("Izin lokasi tidak diberikan."));
  assert.equal(get("grid").innerHTML, "");
  geoMode = "granted";
  await run('selectGroup("partner")');
  assert(get("grid").innerHTML.includes("Mitra Uji"));
  mode = "empty";
  await run('selectGroup("partner")');
  assert.equal(
    get("count").textContent,
    "Tidak ada mitra yang tersedia di lokasi Anda dengan jangkauan 15 KM.",
  );
  assert(!get("grid").innerHTML.includes("Izin lokasi tidak diberikan"));
  mode = "normal";
  await run('selectGroup("demo")');
  assert(get("grid").innerHTML.includes("Dummy Uji"));
  geoMode = "denied";
  await run('selectGroup("general")');
  assert.equal(get("grid").innerHTML, "");
  assert.equal(googleCalls, 0);
  assert(geoCalls > 0);
  assert(get("count").textContent.includes("Izin lokasi tidak diberikan."));
  assert.equal(get("mapsSearch").hidden, true);
  await run("load({googleSearch:true})");
  assert.equal(googleCalls, 0);
  geoMode = "granted";
  await run('selectGroup("general")');
  assert.equal(googleCalls, 1);
  assert.equal(lastGoogleQuery.get("lat"), String(coords.latitude));
  assert.equal(lastGoogleQuery.get("lng"), String(coords.longitude));
  assert(get("grid").innerHTML.includes("Google Uji"));
  assert(!get("grid").innerHTML.includes("Dummy Uji"));
  for (const bad of ["dummy-in-google", "wrong-group"]) {
    mode = bad;
    await run("load({googleSearch:true})");
    assert.equal(get("grid").innerHTML, "");
    assert(get("count").textContent.includes("Sumber hasil tidak sesuai"));
  }
  mode = "wrong-location";
  await run("load({googleSearch:true})");
  assert.equal(get("grid").innerHTML, "");
  assert(get("count").textContent.includes("Titik pencarian tidak sesuai"));
  mode = "failure";
  await run("load({googleSearch:true})");
  assert.equal(get("grid").innerHTML, "");
  assert.equal(get("count").textContent, "Provider unavailable");
  mode = "normal";
  for (const status of ["timeout", "unavailable", "throws"]) {
    geoMode = status;
    const before = googleCalls;
    await run('selectGroup("general")');
    assert.equal(googleCalls, before);
    assert.equal(get("grid").innerHTML, "");
    assert(get("count").textContent.includes("belum dapat ditampilkan"));
  }
  for (const status of ["timeout", "unavailable", "denied"]) {
    geoMode = status;
    await run('selectGroup("partner")');
    assert.equal(get("grid").innerHTML, "");
    assert(
      get("count").textContent.includes(
        status === "denied"
          ? "Izin lokasi tidak diberikan."
          : "ketersediaan mitra belum dapat diperiksa",
      ),
    );
  }
  geoMode = "pending";
  const locate = run('selectGroup("general")');
  geoMode = "granted";
  await run('selectGroup("partner")');
  const beforeLate = googleCalls;
  pendingLocation({ coords });
  await locate;
  assert.equal(googleCalls, beforeLate);
  assert(get("grid").innerHTML.includes("Mitra Uji"));
  geoMode = "granted";
  mode = "defer-general";
  const lateGeneral = run('selectGroup("general")');
  await new Promise(setImmediate);
  assert(pendingGeneral);
  permission.state = "denied";
  permission.onchange();
  pendingGeneral();
  await lateGeneral;
  assert.equal(get("grid").innerHTML, "");
  assert(get("count").textContent.includes("Izin lokasi tidak diberikan."));
  geoMode = "granted";
  mode = "defer";
  const old = run('selectGroup("partner")');
  await new Promise(setImmediate);
  assert(pendingPartner);
  geoMode = "denied";
  await run('selectGroup("general")');
  pendingPartner();
  await old;
  assert.equal(get("grid").innerHTML, "");
  assert(get("workshopSource").textContent.includes("Google Maps"));
  console.log(
    "PASS UI: izin lokasi wajib, ditolak/timeout/gagal memblokir Google, koordinat Malang terkirim, dummy/default ditolak, pencabutan izin dan respons terlambat aman.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
