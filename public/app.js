window.Bengkel = {
  async request(url, options = {}, redirectLogin = true) {
    const response = await fetch(url, options);
    if (response.status === 401 && redirectLogin)
      window.location.replace("/login.html");

    const text = await response.text();
    let data = {};
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Server mengirim respons bukan JSON (HTTP ${response.status}). Buka halaman melalui http://localhost:3000/login.html.`,
        );
      }
    }
    if (!response.ok) {
      const message =
        response.status === 405
          ? "Server tidak menerima metode request ini. Jalankan backend dan buka http://localhost:3000/login.html."
          : `Permintaan gagal (HTTP ${response.status}).`;
      throw new Error(data?.error || data?.message || message);
    }
    if (!text.trim() || data === null || typeof data !== "object")
      throw new Error("Respons JSON dari server kosong atau tidak sesuai.");
    return data;
  },
  json(method, data) {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  },
};

window.Bengkel.renderAccountProfiles = function (user) {
  if (!user?.email) return;

  if (user.role === "partner") {
    for (const element of document.querySelectorAll("[data-customer-service]")) element.remove();
    for (const link of document.querySelectorAll("body > header a[href]")) {
      const path = new URL(link.href, window.location.href).pathname;
      if (path === "/landing.html") {
        link.href = user.dashboardUrl;
        link.textContent = "Dashboard saya";
      } else if (["/search.html", "/orders.html", "/favorites.html", "/ai.html", "/support.html"].includes(path)) {
        link.remove();
      }
    }
  }

  const labels = {
    customer: "Pelanggan Terverifikasi",
    partner: "Mitra",
    admin: "Admin",
  };

  for (const profile of document.querySelectorAll("[data-account-profile]")) {
    profile.querySelector("[data-profile-avatar]").textContent =
      user.email.slice(0, 2).toUpperCase();
    profile.querySelector("[data-profile-email]").textContent = user.email;
    profile.querySelector("[data-profile-role]").textContent =
      labels[user.role] ?? "Akun";
    profile.hidden = false;
  }
};

async function loadNavbarProfile() {
  const accountUI = document.querySelector(
    "[data-account-profile]:not([data-profile-from-search]), [data-customer-service]",
  );
  if (!accountUI) return;

  try {
    const { user } = await window.Bengkel.request(
      "/api/me",
      { cache: "no-store" },
      false,
    );
    window.Bengkel.renderAccountProfiles(user);
  } catch {
    // Profil tetap tersembunyi jika sesi tidak tersedia.
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadNavbarProfile, { once: true });
} else {
  loadNavbarProfile();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-landing-logout]");
  if (!button || button.disabled) return;

  button.disabled = true;
  try {
    await Bengkel.request("/api/logout", Bengkel.json("POST", {}));
    window.location.replace("/");
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
  }
});
