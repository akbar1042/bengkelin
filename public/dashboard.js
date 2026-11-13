(() => {
  const role = document.body.dataset.dashboardRole;
  const routes = {
    customer: "/dashboard/customer",
    partner: "/dashboard/partner",
    admin: "/dashboard/admin",
  };
  if (!routes[role]) return;
  const labels = {
    customer: "Pelanggan",
    partner: "Pemilik Bengkel",
    admin: "Admin",
  };
  const statusLabels = {
    pending: "Menunggu persetujuan",
    approved: "Disetujui",
    rejected: "Ditolak",
  };
  const el = (id) => document.getElementById(id);
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    const refreshBtn = el("refreshDashboard");
    if (refreshBtn) refreshBtn.disabled = true;
    el("dashboardStatus").textContent = "Memuat dashboard...";
    try {
      const response = await fetch("/api/dashboard/" + role, {
        cache: "no-store",
      });
      const data = await response.json();
      if (response.status === 401) {
        window.location.replace("/login.html");
        return;
      }
      if (
        response.status === 403 &&
        Object.values(routes).includes(data.dashboardUrl)
      ) {
        window.location.replace(data.dashboardUrl);
        return;
      }
      if (!response.ok) throw Error(data.message || "Dashboard gagal dimuat.");
      if (data.user.role !== role) throw Error("Role dashboard tidak sesuai.");
      if (el("dashboardEmail"))
        el("dashboardEmail").textContent = data.user.email;
      if (el("dashboardRole")) el("dashboardRole").textContent = labels[role];
      el("dashboardSummary").replaceChildren();
      const summaryLabels = {
        totalAccounts: "Total akun",
        totalWorkshops:
          role === "admin" ? "Total bengkel" : "Total pengajuan bengkel Anda",
        approvedWorkshops: "Bengkel disetujui",
        pendingWorkshops: "Menunggu persetujuan",
        rejectedWorkshops: "Pengajuan ditolak",
      };
      const adminSummaryLinks = {
        totalAccounts: "/admin-accounts.html?tab=akun",
        totalWorkshops: "/admin-accounts.html?tab=bengkel",
        approvedWorkshops: "/admin-accounts.html?tab=bengkel&status=approved",
        pendingWorkshops: "/admin-accounts.html?tab=bengkel&status=pending",
        rejectedWorkshops: "/admin-accounts.html?tab=bengkel&status=rejected",
      };
      for (const [key, value] of Object.entries(data.summary)) {
        const item = document.createElement("li");
        const label = summaryLabels[key] || key;
        if (role === "admin" && adminSummaryLinks[key]) {
          const link = document.createElement("a");
          link.href = adminSummaryLinks[key];
          link.className = "summary-card-link";
          const titleSpan = document.createElement("span");
          titleSpan.className = "summary-card-title";
          titleSpan.textContent = label + ": " + value;
          const actionSpan = document.createElement("span");
          actionSpan.className = "summary-card-action";
          actionSpan.textContent = "Lihat detail →";
          link.append(titleSpan, actionSpan);
          item.append(link);
        } else {
          item.textContent = label + ": " + value;
        }
        el("dashboardSummary").append(item);
      }
      if (el("dashboardItems")) {
        el("dashboardItems").replaceChildren();
        for (const row of data.workshops || []) {
          const item = document.createElement("li");
          item.textContent =
            row.name +
            " — " +
            (statusLabels[row.status] || row.status) +
            (role === "partner"
              ? ". Alamat: " +
                row.address +
                ". Layanan: " +
                row.services.join(", ")
              : "") +
            (row.review_note ? ". Catatan admin: " + row.review_note : "");
          el("dashboardItems").append(item);
        }
        if (!data.workshops?.length) {
          const item = document.createElement("li");
          item.textContent = "Belum ada pengajuan bengkel milik akun ini.";
          el("dashboardItems").append(item);
        }
      }
      el("dashboardStatus").textContent = "";
    } catch (error) {
      el("dashboardStatus").textContent = error.message;
    } finally {
      refreshing = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }
  el("refreshDashboard")?.addEventListener("click", refresh);
  el("dashboardLogout")?.addEventListener("click", async (event) => {
    const logoutBtn = event.currentTarget;
    if (logoutBtn.disabled) return;
    logoutBtn.disabled = true;
    try {
      await Bengkel.request("/api/logout", Bengkel.json("POST", {}));
      window.location.replace("/login.html");
    } catch (error) {
      el("dashboardStatus").textContent = error.message;
      logoutBtn.disabled = false;
    }
  });
  window.addEventListener("partners-updated", refresh);
  refresh();
})();
