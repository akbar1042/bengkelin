(() => {
  const $ = (id) => document.getElementById(id);
  let generation = 0;
  let points = [],
    position = null,
    selected = null,
    map = null,
    markers = [],
    circle = null,
    pending;
  const canvas = document.createElement("div");
  canvas.id = "googleMapCanvas";
  canvas.hidden = true;
  $("workshopMapPanel").append(canvas);
  async function loadMap() {
    if (window.google?.maps?.Map) return true;
    if (pending) return pending;
    pending = (async () => {
      try {
        const c = await Bengkel.request("/api/map-config");
        if (!c.browserKey) return false;
        return await new Promise((resolve) => {
          const tag = document.createElement("script");
          const timeout = setTimeout(() => resolve(false), 12000);
          window.bengkelMapsReady = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          tag.src =
            "https://maps.googleapis.com/maps/api/js?" +
            new URLSearchParams({
              key: c.browserKey,
              callback: "bengkelMapsReady",
              loading: "async",
              v: "weekly",
            });
          tag.async = true;
          tag.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
          };
          document.head.append(tag);
        });
      } catch {
        return false;
      }
    })();
    return pending;
  }
  function fallback(point) {
    canvas.hidden = true;
    if (!point) return;
    const url = new URL("https://maps.google.com/maps");
    url.searchParams.set("q", point.lat + "," + point.lng);
    url.searchParams.set("z", "14");
    url.searchParams.set("output", "embed");
    $("workshopMap").src = url;
    $("workshopMap").hidden = false;
    $("mapMessage").textContent =
      "Peta titik terpilih. Untuk menampilkan lokasi Anda dan seluruh bengkel sekaligus, konfigurasi Google Maps browser belum lengkap.";
  }
  async function draw() {
    const version = generation;
    if ($("workshopMapPanel").hidden) return;
    const base = selected || position || points[0];
    if (!base) return;
    const ready = await loadMap();
    if (version !== generation) return;
    if (!ready) return fallback(base);
    if ($("workshopMapPanel").hidden) return;
    canvas.hidden = false;
    $("workshopMap").hidden = true;
    if (!map)
      map = new google.maps.Map(canvas, {
        center: base,
        zoom: 13,
        mapTypeControl: false,
      });
    for (const marker of markers) marker.setMap(null);
    markers = [];
    circle?.setMap(null);
    const bounds = new google.maps.LatLngBounds();
    if (position) {
      markers.push(
        new google.maps.Marker({
          map,
          position,
          title: "Lokasi Anda",
          label: "A",
        }),
      );
      bounds.extend(position);
      circle = new google.maps.Circle({
        map,
        center: position,
        radius: 15000,
        strokeColor: "#2684ff",
        strokeOpacity: 0.5,
        fillColor: "#2684ff",
        fillOpacity: 0.05,
      });
    }
    points.forEach((p, i) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: p.lat, lng: p.lng },
        title: p.name,
        label: String(i + 1),
      });
      marker.addListener("click", () => {
        const text = document.createElement("p");
        text.textContent = p.name;
        const popup = new google.maps.InfoWindow({ content: text });
        popup.open({ map, anchor: marker });
      });
      markers.push(marker);
      bounds.extend({ lat: p.lat, lng: p.lng });
    });
    if (selected) {
      map.setCenter(selected);
      map.setZoom(15);
    } else if (!bounds.isEmpty()) map.fitBounds(bounds, 40);
    $("mapMessage").textContent =
      "A = lokasi Anda. Angka = bengkel pada hasil pencarian. Lingkaran = radius garis lurus 15 KM.";
  }
  function view(active) {
    $("workshopMapPanel").hidden = !active;
    $("listView").setAttribute("aria-pressed", String(!active));
    $("mapView").setAttribute("aria-pressed", String(active));
    if (active) draw();
  }
  window.BengkelMap = {
    render(data, location) {
      generation++;
      points = data;
      position = location;
      selected = null;
      draw();
    },
    clear() {
      generation++;
      points = [];
      position = null;
      selected = null;
      for (const m of markers) m.setMap(null);
      markers = [];
      circle?.setMap(null);
      canvas.hidden = true;
      $("workshopMap").hidden = true;
      $("workshopMap").removeAttribute("src");
      $("mapMessage").textContent =
        "Izinkan lokasi dan cari bengkel untuk menampilkan peta.";
    },
  };
  $("listView").addEventListener("click", () => view(false));
  $("mapView").addEventListener("click", () => view(true));
  $("grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-map-lat]");
    if (!b) return;
    selected = { lat: Number(b.dataset.mapLat), lng: Number(b.dataset.mapLng) };
    view(true);
    $("workshopMapPanel").scrollIntoView({ behavior: "smooth" });
  });
  if (window.bengkelSearchResults)
    window.BengkelMap.render(
      window.bengkelSearchResults.data,
      window.bengkelSearchResults.location,
    );
})();
