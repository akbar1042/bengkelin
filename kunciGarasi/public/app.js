const searchQuery = new URLSearchParams(window.location.search);
const emergencySearch = searchQuery.get("category") === "emergency";
const state = {
  vehicleType: searchQuery.get("vehicleType") === "mobil" ? "mobil" : "motor",
  q: "",
  minRating: "",
  pickup: false,
  category: emergencySearch ? "emergency" : "",
  sort: "best",
  group: "partner",
  lat: null,
  lng: null,
  locationStatus: "idle",
};
const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let sourceConfig = null,
  controller = null,
  timer,
  locationRequest = 0;
let generalSnapshot = null;
function params() {
  const p = new URLSearchParams({
    group: state.group,
    sort: state.sort,
    vehicleType: state.vehicleType,
  });
  for (const key of ["q", "minRating", "category"])
    if (state[key]) p.set(key, state[key]);
  if (state.pickup) p.set("pickup", "true");
  if (state.lat !== null) {
    p.set("lat", state.lat);
    p.set("lng", state.lng);
  }
  return p;
}
function hasLocation() {
  return (
    state.locationStatus === "granted" &&
    Number.isFinite(state.lat) &&
    Number.isFinite(state.lng)
  );
}
function locationMessage() {
  if (state.locationStatus === "denied") return "Izin lokasi tidak diberikan.";
  if (state.group === "partner" && state.locationStatus !== "pending") {
    const reasons = {
      denied: "Izin lokasi tidak diberikan.",
      idle: "Lokasi perangkat belum diperoleh, sehingga ketersediaan mitra belum dapat diperiksa. Tekan Cari mitra untuk menggunakan lokasi Anda.",
      timeout:
        "Pengambilan lokasi melewati batas waktu; ketersediaan mitra belum dapat diperiksa.",
      unavailable:
        "Lokasi perangkat tidak tersedia; ketersediaan mitra belum dapat diperiksa.",
    };
    return reasons[state.locationStatus] || reasons.idle;
  }
  const messages = {
    denied: "Izin lokasi tidak diberikan.",
    pending:
      "Meminta lokasi perangkat. Izinkan akses lokasi untuk mencari bengkel dalam jangkauan 15 KM.",
    timeout:
      "Pengambilan lokasi melewati batas waktu. Bengkel umum belum dapat ditampilkan. Aktifkan lokasi perangkat lalu coba lagi.",
    unavailable:
      "Lokasi perangkat tidak tersedia. Bengkel umum belum dapat ditampilkan. Aktifkan lokasi perangkat lalu coba lagi.",
    idle: "Izin lokasi diperlukan untuk menampilkan bengkel umum di sekitarmu.",
  };
  return messages[state.locationStatus] || messages.idle;
}
function externalMaps() {
  $("mapsSearch").hidden = emergencySearch || !hasLocation();
  if ($("mapsSearch").hidden) {
    $("mapsSearch").removeAttribute("href");
    return;
  }
  const lat = state.lat,
    lng = state.lng;
  $("mapsSearch").href =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(`bengkel sekitar ${lat},${lng}`);
}
function showSource(group) {
  const labels = {
    partner: "Mitra Bengkelin — data pendaftaran yang disetujui admin",
    general: "Bengkel Umum — hasil langsung Google Maps",
    demo: "Data contoh fiktif — bukan bengkel hasil pencarian Google Maps",
  };
  $("workshopSource").textContent = labels[group];
  $("searchWorkshops").textContent =
    group === "general"
      ? "Cari di Google Maps"
      : group === "demo"
        ? "Cari data contoh"
        : "Cari mitra";
}
function validateSource(body, group, requestedLocation) {
  if (
    body.location?.isDefault !== false ||
    body.location.lat !== requestedLocation.lat ||
    body.location.lng !== requestedLocation.lng
  )
    throw new Error(
      "Titik pencarian tidak sesuai lokasi perangkat. Hasil tidak ditampilkan; coba izinkan lokasi kembali.",
    );
  const sources = {
    partner: "bengkelin",
    general: "google_places",
    demo: "demo",
  };
  const prefixes = { partner: "partner:", general: "google:", demo: "demo:" };
  if (
    body.group !== group ||
    body.source !== sources[group] ||
    !Array.isArray(body.data) ||
    body.data.some(
      (w) =>
        !w ||
        w.source !== sources[group] ||
        typeof w.id !== "string" ||
        !w.id.startsWith(prefixes[group]) ||
        w.isDemo !== (group === "demo") ||
        w.isPartner !== (group === "partner") ||
        (group === "partner" && w.membershipStatus !== "approved"),
    )
  )
    throw new Error(
      "Sumber hasil tidak sesuai kelompok yang dipilih. Data tidak ditampilkan; coba muat ulang halaman.",
    );
}
function clearResults() {
  window.BengkelMap?.clear();
  $("grid").replaceChildren();
  $("recommend").replaceChildren();
  $("providerAttributions").replaceChildren();
  $("googleAttribution").hidden = true;
  $("providerPolicies").hidden = true;
}
async function load({ googleSearch = false } = {}) {
  externalMaps();
  if (controller) controller.abort();
  const requestController = new AbortController();
  controller = requestController;
  const requestedGroup = state.group;
  const requestedLocation = { lat: state.lat, lng: state.lng };
  showSource(requestedGroup);
  clearResults();
  if (!hasLocation()) {
    $("count").textContent = locationMessage();
    return;
  }
  if (
    state.group === "general" &&
    !googleSearch &&
    generalSnapshot &&
    generalSnapshot.location.lat === state.lat &&
    generalSnapshot.location.lng === state.lng &&
    generalSnapshot.vehicleType === state.vehicleType
  ) {
    return render(filterGeneral(generalSnapshot));
  }
  if (state.group === "general" && !googleSearch) {
    clearResults();
    $("count").textContent = sourceConfig?.google.ready
      ? "Tekan Cari untuk mengambil hasil Google Maps."
      : "Pencarian Google Maps belum aktif. Kamu tetap dapat membuka Google Maps melalui tautan di bawah.";
    return;
  }
  $("count").textContent = "Memuat bengkel...";
  try {
    const query = params();
    if (state.group === "general") {
      for (const key of ["q", "minRating", "pickup", "category"])
        query.delete(key);
      query.set("sort", "distance");
    }
    const res = await fetch("/api/workshops?" + query, {
      signal: requestController.signal,
      cache: "no-store",
    });
    if (res.status === 401) {
      window.location.replace("/login.html");
      return;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || "Gagal memuat bengkel.");
    if (
      requestController.signal.aborted ||
      controller !== requestController ||
      state.group !== requestedGroup
    )
      return;
    validateSource(body, requestedGroup, requestedLocation);
    if (requestedGroup === "general") {
      generalSnapshot = { ...body, vehicleType: state.vehicleType };
      render(filterGeneral(generalSnapshot));
    } else render(body);
  } catch (error) {
    if (error.name === "AbortError" || controller !== requestController) return;
    clearResults();
    $("count").textContent = error.message;
  }
}
function filterGeneral(body) {
  let rows = body.data.filter(
    (w) =>
      (!state.q ||
        [w.name, w.address, ...(w.services || [])]
          .join(" ")
          .toLowerCase()
          .includes(state.q.toLowerCase())) &&
      (!state.minRating ||
        (w.rating != null && w.rating >= Number(state.minRating))) &&
      (!state.pickup || w.pickup === true) &&
      (!state.category || w[state.category] === true),
  );
  rows.sort(
    state.sort === "rating"
      ? (a, b) =>
          (b.rating ?? -1) - (a.rating ?? -1) || a.distanceKm - b.distanceKm
      : state.sort === "best"
        ? (a, b) => b.score - a.score || a.distanceKm - b.distanceKm
        : (a, b) => a.distanceKm - b.distanceKm,
  );
  return { ...body, data: rows, total: rows.length };
}
function tags(w) {
  const items = [
    w.isDemo
      ? "Data contoh fiktif"
      : w.isPartner
        ? "Mitra Bengkelin"
        : "Bengkel umum — Google Maps",
  ];
  if (w.pickup === true) items.push("Bisa jemput");
  if (w.onsite === true) items.push("Servis di lokasi");
  if (w.open24 === true) items.push("Buka 24 jam");
  return items.map((v) => `<span>${esc(v)}</span>`).join(" · ");
}
function render({ total, recommended, data, notice, group, google }) {
  window.bengkelSearchResults = {
    data,
    location: { lat: state.lat, lng: state.lng },
  };
  window.BengkelMap?.render(data, { lat: state.lat, lng: state.lng });
  $("count").textContent =
    group === "partner" && data.length === 0
      ? "Tidak ada mitra yang tersedia di lokasi Anda dengan jangkauan 15 KM."
      : `${total} bengkel ditemukan${notice ? " — " + notice : ""}`;
  if (recommended && state.sort === "best")
    $("recommend").innerHTML =
      `<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#4cd7f6]/30 bg-[#4cd7f6]/10 px-4 py-3 text-xs sm:text-sm font-semibold text-white"><span class="flex items-center gap-2"><span class="inline-block h-2 w-2 rounded-full bg-[#4cd7f6]"></span>${esc(recommended.isDemo ? "Contoh rekomendasi" : "Rekomendasi mitra")}: <strong class="text-[#4cd7f6]">${esc(recommended.name)}</strong></span><span class="rounded-lg bg-[#0b1326]/70 px-2.5 py-1 font-mono text-xs text-[#4cd7f6]">${esc(recommended.distanceKm)} km</span></div>`;
  else $("recommend").replaceChildren();
  $("grid").innerHTML = data.length
    ? data
        .map(
          (w) =>
            `<article class="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#131b2e] p-5 shadow-lg transition hover:-translate-y-1 hover:border-[#4cd7f6]/40"><div><div class="mb-3 flex items-start justify-between gap-3"><h3 class="text-lg font-heading font-bold text-white leading-snug">${esc(w.name)}</h3><span class="shrink-0 rounded-full border border-[#4cd7f6]/30 bg-[#4cd7f6]/10 px-2.5 py-1 font-mono text-xs font-bold text-[#4cd7f6]">${esc(w.distanceKm)} km</span></div><div class="flex flex-wrap items-center gap-1.5 text-xs font-semibold">${tags(w).replaceAll(" · ", "").replaceAll("<span>", '<span class="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">').replaceAll("</span>", "</span>")}</div><p class="mt-3 text-sm leading-relaxed text-slate-300">${esc(w.address || "")}</p>${w.rating != null ? `<p class="mt-2 text-xs font-bold text-amber-400">★ ${esc(w.rating)} (${esc(w.reviews ?? 0)} ulasan)</p>` : ""}<div class="mt-3 space-y-1.5 rounded-xl border border-white/5 bg-[#0b1326]/60 p-3 text-xs text-slate-300"><p><span class="text-slate-400">Layanan:</span> <strong class="text-white">${w.services?.length ? esc(w.services.join(" · ")) : "Layanan khusus belum dikonfirmasi"}</strong></p><p><span class="text-slate-400">Kategori:</span> <strong class="text-white uppercase">${w.vehicleTypes?.length ? esc(w.vehicleTypes.join(" / ")) : "Mengikuti kata kunci"}</strong></p>${w.phone ? `<p><span class="text-slate-400">Telepon:</span> <span class="font-mono text-slate-200">${esc(w.phone)}</span></p>` : ""}</div></div><div class="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">${w.isPartner ? `<a class="partner-detail-link inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#4cd7f6] px-3.5 py-2.5 text-xs font-bold text-[#060e20] no-underline shadow-sm transition hover:bg-sky-300" href="/partner-detail.html?id=${esc(w.partnerId)}">Detail &amp; pesan servis</a>` : ""}${w.googleMapsUrl ? `<a class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#4cd7f6] px-3.5 py-2.5 text-xs font-bold text-[#060e20] no-underline transition hover:bg-sky-300" href="${esc(w.googleMapsUrl)}" target="_blank" rel="noopener noreferrer">Buka di Google Maps ↗</a>` : ""}<button type="button" class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-[#4cd7f6]/50 hover:bg-[#4cd7f6]/10 hover:text-[#4cd7f6] cursor-pointer" data-map-lat="${esc(w.lat)}" data-map-lng="${esc(w.lng)}">Lihat di peta</button></div></article>`,
        )
        .join("")
    : `<p>${group === "partner" ? "Tidak ada mitra yang tersedia di lokasi Anda dengan jangkauan 15 KM." : "Tidak ada bengkel yang cocok dengan pencarian."}</p>`;
  $("googleAttribution").hidden = group !== "general";
  $("providerAttributions").replaceChildren();
  if (group === "general") {
    const seen = new Set();
    for (const w of data)
      for (const a of w.attributions || []) {
        const key = a.provider + "|" + a.providerUri;
        if (seen.has(key) || !a.provider) continue;
        seen.add(key);
        const item = document.createElement("li");
        if (a.providerUri) {
          const link = document.createElement("a");
          link.href = a.providerUri;
          link.textContent = a.provider;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          item.append(link);
        } else item.textContent = a.provider;
        $("providerAttributions").append(item);
      }
    if (google?.termsUrl) {
      $("providerTerms").href = google.termsUrl;
      $("providerPrivacy").href = google.privacyUrl;
      $("providerPolicies").hidden = false;
    }
  }
}
function selectGroup(group) {
  if (emergencySearch && group !== "partner") return;
  locationRequest++;
  state.group = group;
  showSource(group);
  state.minRating = "";
  state.pickup = false;
  state.category = emergencySearch ? "emergency" : "";
  state.sort = group === "general" ? "distance" : "best";
  $("sort").value = state.sort;
  for (const id of ["fRating", "fPickup"]) {
    $(id).disabled = false;
    $(id).classList.remove("on");
  }
  for (const option of $("sort").options) option.disabled = false;
  for (const node of document.querySelectorAll("[data-workshop-group]"))
    node.setAttribute(
      "aria-pressed",
      String(node.dataset.workshopGroup === group),
    );
  $("searchWorkshops").disabled =
    group === "general" && !sourceConfig?.google.ready;
  document.querySelectorAll(".service-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.category === "");
    card.setAttribute("aria-disabled", "false");
  });
  if (group !== "demo" || !hasLocation())
    return requestLocation({ googleSearch: group === "general" });
  if (state.locationStatus === "pending") state.locationStatus = "idle";
  return load();
}
$("q").addEventListener("input", (event) => {
  state.q = event.target.value.trim();
  clearTimeout(timer);
  if (state.group === "general") {
    return load();
  }
  timer = setTimeout(() => load(), 250);
});
$("searchWorkshops").addEventListener("click", () =>
  requestLocation({ googleSearch: state.group === "general" }),
);
for (const node of document.querySelectorAll("[data-workshop-group]"))
  node.addEventListener("click", () => selectGroup(node.dataset.workshopGroup));
$("fRating").addEventListener("click", (event) => {
  state.minRating = state.minRating ? "" : "4.0";
  event.currentTarget.classList.toggle("on", Boolean(state.minRating));
  load();
});
$("fPickup").addEventListener("click", (event) => {
  state.pickup = !state.pickup;
  event.currentTarget.classList.toggle("on", state.pickup);
  load();
});
$("sort").addEventListener("change", (event) => {
  state.sort = event.target.value;
  load();
});
document.querySelectorAll(".service-card").forEach((card) =>
  card.addEventListener("click", (event) => {
    if (state.group === "general") {
      event.preventDefault();
      $("count").textContent =
        "Filter layanan khusus digunakan untuk Mitra Bengkelin.";
      return;
    }
    document
      .querySelectorAll(".service-card")
      .forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    state.category = card.dataset.category;
    load();
  }),
);
async function requestLocation({ googleSearch = false } = {}) {
  const id = ++locationRequest,
    group = state.group;
  if (controller) controller.abort();
  clearResults();
  state.lat = null;
  state.lng = null;
  state.locationStatus = "pending";
  externalMaps();
  $("count").textContent = locationMessage();
  const outcome = await new Promise((resolve) => {
    if (!navigator.geolocation || window.isSecureContext === false)
      return resolve({ status: "unavailable" });
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ status: "granted", position }),
        (error) =>
          resolve({
            status:
              error.code === 1
                ? "denied"
                : error.code === 3
                  ? "timeout"
                  : "unavailable",
          }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      resolve({ status: "unavailable" });
    }
  });
  if (id !== locationRequest || state.group !== group) return;
  const lat = outcome.position?.coords.latitude,
    lng = outcome.position?.coords.longitude;
  if (
    outcome.status === "granted" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) {
    state.lat = lat;
    state.lng = lng;
    state.locationStatus = "granted";
    return load({ googleSearch: group === "general" && googleSearch });
  }
  state.locationStatus =
    outcome.status === "granted" ? "unavailable" : outcome.status;
  externalMaps();
  $("count").textContent = locationMessage();
  return;
}
$("locBtn").addEventListener("click", () =>
  requestLocation({ googleSearch: state.group === "general" }),
);
async function watchLocationPermission() {
  if (!navigator.permissions?.query) return;
  try {
    const permission = await navigator.permissions.query({
      name: "geolocation",
    });
    permission.onchange = () => {
      if (permission.state !== "denied") return;
      locationRequest++;
      if (controller) controller.abort();
      state.lat = null;
      state.lng = null;
      state.locationStatus = "denied";
      clearResults();
      externalMaps();
      $("count").textContent = locationMessage();
    };
  } catch {}
}
watchLocationPermission();
async function initializeAccount() {
  try {
    const response = await fetch("/api/me");
    if (response.status === 401) {
      window.location.replace("/login.html");
      return;
    }
    if (!response.ok) throw new Error("Gagal memuat akun.");
    const { user } = await response.json();
    window.Bengkel?.renderAccountProfiles(user);
    const adminPartnersLink = $("adminPartnersLink");
    if (adminPartnersLink) adminPartnersLink.hidden = user.role !== "admin";
    const res = await fetch("/api/workshops/sources", { cache: "no-store" });
    if (res.ok) sourceConfig = await res.json();
    await load();
  } catch (error) {
    $("accountMessage").textContent = error.message;
  }
}
$("logoutBtn").addEventListener("click", async () => {
  const btn = $("logoutBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) throw new Error("Logout gagal.");
    window.location.replace("/");
  } catch (error) {
    $("accountMessage").textContent = error.message;
    btn.disabled = false;
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) initializeAccount();
});
initializeAccount();

if ($("vehicleType"))
  $("vehicleType").addEventListener("change", (event) => {
    state.vehicleType = event.target.value;
    generalSnapshot = null;
    clearResults();
    if (hasLocation()) load({ googleSearch: state.group === "general" });
  });
if ($("serviceCategory"))
  $("serviceCategory").addEventListener("change", (event) => {
    state.category = emergencySearch ? "emergency" : event.target.value;
    load();
  });

const vehicleSelector = $("vehicleType");
if (vehicleSelector) vehicleSelector.value = state.vehicleType;
if (emergencySearch) {
  const notice = $("emergencySearchNotice");
  if (notice) notice.hidden = false;
  const category = $("serviceCategory");
  if (category) {
    category.value = "emergency";
    category.disabled = true;
  }
  for (const button of document.querySelectorAll("[data-workshop-group]")) {
    if (button.dataset.workshopGroup !== "partner") button.disabled = true;
  }
}
