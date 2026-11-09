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
  async function refresh() {
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
      for (const [key, value] of Object.entries(data.summary)) {
        const item = document.createElement("li");
        item.textContent = (summaryLabels[key] || key) + ": " + value;
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
    }
  }
  el("refreshDashboard")?.addEventListener("click", refresh);
  el("dashboardLogout")?.addEventListener("click", async () => {
    try {
      await Bengkel.request("/api/logout", Bengkel.json("POST", {}));
      window.location.replace("/login.html");
    } catch (error) {
      el("dashboardStatus").textContent = error.message;
    }
  });
  window.addEventListener("partners-updated", refresh);
  refresh();
})();
