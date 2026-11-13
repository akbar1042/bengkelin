const inFlightMutations = new Set();

window.Bengkel = {
  async request(url, options = {}, redirectLogin = true) {
    const method = String(options.method || "GET").toUpperCase();
    const isMutation = method !== "GET" && method !== "HEAD";
    const mutationKey = `${method}:${url}`;

    if (isMutation) {
      if (inFlightMutations.has(mutationKey)) {
        throw new Error("Permintaan sedang diproses. Mohon tunggu sebentar.");
      }
      inFlightMutations.add(mutationKey);
    }

    try {
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
    } finally {
      if (isMutation) {
        inFlightMutations.delete(mutationKey);
      }
    }
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

  const labels = {
    customer: "Pelanggan Terverifikasi",
    partner: "Mitra",
    admin: "Admin",
  };

  for (const profile of document.querySelectorAll("[data-account-profile]")) {
    const avatarEl = profile.querySelector("[data-profile-avatar]");
    const emailEl = profile.querySelector("[data-profile-email]");
    const roleEl = profile.querySelector("[data-profile-role]");
    if (avatarEl) avatarEl.textContent = user.email.slice(0, 2).toUpperCase();
    if (emailEl) emailEl.textContent = user.email;
    if (roleEl) roleEl.textContent = labels[user.role] ?? "Akun";
    profile.hidden = false;
    profile.style.cursor = "pointer";
    if (!profile.title) profile.title = "Buka Pengaturan Akun";
    if (!profile.dataset.accountSettingsLinked) {
      profile.dataset.accountSettingsLinked = "true";
      profile.addEventListener("click", (event) => {
        if (event.target.closest("a, button")) return;
        window.location.assign("/account-settings.html");
      });
    }
  }

  window.Bengkel.syncRoleNavbar(user);
};

window.Bengkel.syncRoleNavbar = function (user) {
  if (!user?.role) return;
  const header = document.querySelector("body > header");
  if (!header) return;

  const currentPath = window.location.pathname;
  const roleMenus = {
    customer: [
      { label: "Beranda", href: "/landing.html" },
      {
        label: "Cari bengkel",
        href: "/search.html",
        match: ["/search.html", "/partner-detail.html"],
      },
      { label: "Konsultasi AI", href: "/ai.html" },
      { label: "Customer Service", href: "/support.html" },
      { label: "Pusat bantuan", href: "/help.html" },
      { label: "Pengaturan akun", href: "/account-settings.html" },
    ],
    partner: [
      {
        label: "Dashboard saya",
        href: "/dashboard/partner",
        match: ["/dashboard", "/dashboard/partner", "/dashboard-mitra.html"],
      },
      { label: "Kelola pesanan bengkel", href: "/owner-orders.html" },
      { label: "Ubah profil bengkel", href: "/owner-workshops.html" },
      { label: "Pengaturan akun", href: "/account-settings.html" },
      { label: "Pusat bantuan", href: "/help.html" },
    ],
    admin: [
      {
        label: "Dashboard saya",
        href: "/dashboard/admin",
        match: ["/dashboard", "/dashboard/admin", "/admin-partners.html"],
      },
      { label: "Kelola akun", href: "/admin-accounts.html" },
      { label: "Log monitoring", href: "/admin-monitoring.html" },
      { label: "Pengaturan akun", href: "/account-settings.html" },
      { label: "Pusat bantuan", href: "/help.html" },
    ],
  };

  if (user.role === "partner" || user.role === "admin") {
    for (const element of document.querySelectorAll(
      "[data-customer-service]",
    )) {
      element.remove();
    }
  }

  // Brand link & brand title consistency per role
  const brandLink = header.querySelector("a.brand-mark, a:has(.brand-mark)");
  const brandMark = header.querySelector(".brand-mark");
  if (brandLink) {
    brandLink.href =
      user.role === "customer"
        ? "/landing.html"
        : user.role === "partner"
          ? "/dashboard/partner"
          : "/dashboard/admin";
  }
  if (brandMark) {
    brandMark.innerHTML = 'Kunci<span class="brand-mark__suffix">Garasi</span>';
  }

  // Cart icon: only for customer
  for (const cartLink of header.querySelectorAll('a[href="/orders.html"]')) {
    if (cartLink.closest("nav")) continue;
    if (user.role !== "customer") {
      cartLink.remove();
    }
  }

  // Synchronize primary nav links if page uses a single standard <nav>
  const navs = header.querySelectorAll("nav");
  if (navs.length === 1) {
    const nav = navs[0];
    const items = roleMenus[user.role] || roleMenus.customer;
    const isPartnerStyle =
      header.className.includes("bg-[#0b1326]/95") &&
      !header.className.includes("glass-panel");
    const isLegacyNavbar =
      header.classList.contains("partner-navbar") || !header.className.trim();

    nav.replaceChildren();
    for (const item of items) {
      const a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.label;
      const isActive =
        currentPath === item.href ||
        (Array.isArray(item.match) && item.match.includes(currentPath));
      if (isLegacyNavbar) {
        if (isActive) a.setAttribute("aria-current", "page");
      } else if (isPartnerStyle) {
        a.className = isActive
          ? "font-semibold text-[#4cd7f6] transition-colors whitespace-nowrap"
          : "font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap";
      } else {
        a.className = isActive
          ? "px-2.5 py-1.5 rounded-lg text-xs xl:text-sm font-semibold text-[#4cd7f6] hover:text-white hover:bg-white/5 transition-all whitespace-nowrap"
          : "px-2.5 py-1.5 rounded-lg text-xs xl:text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-all whitespace-nowrap";
      }
      nav.append(a);
    }
  }
};

async function loadNavbarProfile() {
  const accountUI = document.querySelector(
    "[data-account-profile]:not([data-profile-from-search]), [data-customer-service], body > header nav",
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
  document.addEventListener("DOMContentLoaded", loadNavbarProfile, {
    once: true,
  });
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
