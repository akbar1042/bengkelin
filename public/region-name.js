window.BengkelRegion = {
  async label(lat, lng, guest = false) {
    const response = await fetch(
      (guest ? "/api/mitra/location-name?" : "/api/location-name?") +
        new URLSearchParams({ lat, lng }),
      { cache: "no-store" },
    );
    if (response.status === 401 && !guest) {
      location.assign("/login.html");
      throw Error("Silakan login.");
    }
    const data = await response.json();
    if (!response.ok)
      throw Error(data.message || "Nama wilayah belum tersedia.");
    return data.label;
  },
  async render(node, lat, lng, isCurrent = () => true, guest = false) {
    if (!node) return;
    node.textContent = "Memuat nama wilayah…";
    try {
      const label = await this.label(lat, lng, guest);
      if (isCurrent()) node.textContent = label;
    } catch {
      if (isCurrent()) node.textContent = "Nama wilayah belum tersedia";
    }
  },
};
