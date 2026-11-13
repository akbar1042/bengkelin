(() => {
  const el = (id) => document.getElementById(id);
  const statusLabels = {
    waiting: "Menunggu Konfirmasi",
    accepted: "Diterima Bengkel",
    processing: "Sedang Diproses",
    completed: "Selesai",
    cancelled: "Dibatalkan",
  };
  const roleBadges = {
    customer: {
      text: "Pelanggan",
      cls: "bg-[#4cd7f6]/15 text-[#4cd7f6] border-[#4cd7f6]/30",
    },
    partner: {
      text: "Mitra Bengkel",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    },
    system: {
      text: "Sistem Otomatis",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    },
  };
  const statusStyles = {
    waiting: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    accepted: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    processing: "bg-[#4cd7f6]/15 text-[#4cd7f6] border-[#4cd7f6]/35",
    completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    cancelled: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  };

  const money = (v) =>
    v == null
      ? "Belum diajukan"
      : new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          maximumFractionDigits: 0,
        }).format(v);

  const fmtDate = (iso) =>
    iso
      ? new Date(iso).toLocaleString("id-ID", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

  const paymentLabel = (method, pStatus) => {
    const m = method === "qris" ? "QRIS" : "Bayar di Lokasi (COD)";
    const s =
      pStatus === "paid"
        ? "Lunas"
        : method === "qris"
          ? "Menunggu Pembayaran QRIS"
          : "Dibayar di Bengkel";
    return `${m} · ${s}`;
  };

  let allOrders = [];
  let allLogs = [];
  let activeTab = "transactions";
  let loading = false;

  function setTab(tab) {
    activeTab = tab;
    const btnTx = el("tabBtnTransactions");
    const btnLogs = el("tabBtnActivityLogs");
    const badgeTx = el("badgeTransactionsCount");
    const badgeLogs = el("badgeLogsCount");
    const panelTx = el("panelTransactions");
    const panelLogs = el("panelActivityLogs");

    if (tab === "transactions") {
      btnTx.className =
        "px-4 py-2 rounded-xl text-xs font-bold bg-[#4cd7f6] text-slate-950 transition-all cursor-pointer flex items-center gap-1.5";
      badgeTx.className =
        "ml-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-950/20 text-slate-950";
      btnLogs.className =
        "px-4 py-2 rounded-xl text-xs font-semibold bg-[#1a243b] text-slate-300 hover:text-white border border-white/10 transition-all cursor-pointer flex items-center gap-1.5";
      badgeLogs.className =
        "ml-1 px-2 py-0.5 rounded-full text-[11px] bg-white/10 text-slate-200";
      panelTx.classList.remove("hidden");
      panelLogs.classList.add("hidden");
    } else {
      btnLogs.className =
        "px-4 py-2 rounded-xl text-xs font-bold bg-[#4cd7f6] text-slate-950 transition-all cursor-pointer flex items-center gap-1.5";
      badgeLogs.className =
        "ml-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-950/20 text-slate-950";
      btnTx.className =
        "px-4 py-2 rounded-xl text-xs font-semibold bg-[#1a243b] text-slate-300 hover:text-white border border-white/10 transition-all cursor-pointer flex items-center gap-1.5";
      badgeTx.className =
        "ml-1 px-2 py-0.5 rounded-full text-[11px] bg-white/10 text-slate-200";
      panelLogs.classList.remove("hidden");
      panelTx.classList.add("hidden");
    }
    render();
  }

  function matchesFilter(item) {
    const q = (el("searchMonitoring")?.value || "").trim().toLowerCase();
    const statusFilter = el("filterStatusMonitoring")?.value || "all";
    const payFilter = el("filterPaymentMonitoring")?.value || "all";

    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (payFilter !== "all") {
      if (payFilter === "qris" && item.payment_method !== "qris") return false;
      if (payFilter === "cod" && item.payment_method !== "cod") return false;
      if (payFilter === "paid" && item.payment_status !== "paid") return false;
      if (payFilter === "unpaid" && item.payment_status === "paid")
        return false;
    }

    if (q) {
      const orderId = String(item.order_id ?? item.id ?? "");
      const hay = [
        "#" + orderId,
        orderId,
        item.workshop_name,
        item.customer_email,
        item.partner_email,
        item.actor_email,
        item.service,
        item.vehicle_type,
        item.note,
        item.cost_note,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderTransactions() {
    const panel = el("panelTransactions");
    if (!panel) return;
    panel.replaceChildren();

    const filtered = allOrders.filter(matchesFilter);
    if (el("badgeTransactionsCount"))
      el("badgeTransactionsCount").textContent = String(filtered.length);

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-2xl bg-[#1a243b]/60 border border-white/5 p-6 text-center text-sm text-slate-400";
      empty.textContent =
        "Tidak ada transaksi yang sesuai dengan filter pencarian.";
      panel.append(empty);
      return;
    }

    for (const o of filtered) {
      const card = document.createElement("article");
      card.className =
        "rounded-2xl bg-[#1a243b] border border-white/10 p-5 space-y-4 transition-all hover:border-[#4cd7f6]/35";

      // Baris Atas: ID Order, Bengkel, Status & Pembayaran
      const topRow = document.createElement("div");
      topRow.className =
        "flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3";

      const leftHead = document.createElement("div");
      leftHead.className = "flex flex-wrap items-center gap-2.5";

      const idBadge = document.createElement("span");
      idBadge.className =
        "px-2.5 py-1 rounded-lg bg-[#0b1326] border border-white/10 font-mono text-xs font-bold text-[#4cd7f6]";
      idBadge.textContent = `Order #${o.id}`;

      const wsName = document.createElement("h3");
      wsName.className = "text-base font-headline font-bold text-white m-0";
      wsName.textContent = o.workshop_name;

      leftHead.append(idBadge, wsName);

      const rightBadges = document.createElement("div");
      rightBadges.className = "flex flex-wrap items-center gap-2";

      const stBadge = document.createElement("span");
      stBadge.className = `px-2.5 py-1 rounded-full text-xs font-semibold border ${statusStyles[o.status] || statusStyles.waiting}`;
      stBadge.textContent = statusLabels[o.status] || o.status;

      const payBadge = document.createElement("span");
      payBadge.className = `px-2.5 py-1 rounded-full text-xs font-semibold border ${
        o.payment_status === "paid"
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          : "bg-white/5 text-slate-300 border-white/15"
      }`;
      payBadge.textContent = paymentLabel(o.payment_method, o.payment_status);

      rightBadges.append(payBadge, stBadge);
      topRow.append(leftHead, rightBadges);
      card.append(topRow);

      // Grid Informasi Pihak & Detail Transaksi
      const grid = document.createElement("div");
      grid.className =
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs";

      const cell = (label, value, subValue = "") => {
        const box = document.createElement("div");
        box.className =
          "rounded-xl bg-[#0b1326]/65 border border-white/5 p-3 space-y-0.5";
        const l = document.createElement("span");
        l.className =
          "block text-[10px] uppercase tracking-wider text-slate-400 font-semibold";
        l.textContent = label;
        const v = document.createElement("strong");
        v.className = "block font-semibold text-slate-100 break-words";
        v.textContent = value;
        box.append(l, v);
        if (subValue) {
          const s = document.createElement("span");
          s.className = "block text-[11px] text-slate-400 break-words";
          s.textContent = subValue;
          box.append(s);
        }
        return box;
      };

      const costApproved =
        o.cost_version > 0 && o.accepted_cost_version === o.cost_version;
      grid.append(
        cell(
          "Pelanggan (Customer)",
          o.customer_email,
          `Dibuat: ${fmtDate(o.created_at)}`,
        ),
        cell(
          "Mitra Bengkel",
          o.partner_email,
          `Telp: ${o.workshop_phone || "—"}`,
        ),
        cell(
          "Kendaraan & Layanan",
          `${(o.vehicle_type || "").toUpperCase()} · ${o.service}`,
          `Jadwal: ${fmtDate(o.scheduled_at)}`,
        ),
        cell(
          "Biaya & Konfirmasi",
          money(o.confirmed_cost),
          o.confirmed_cost != null
            ? `${costApproved ? "✓ Disetujui Pelanggan" : "Menunggu persetujuan"}${o.cost_note ? " · " + o.cost_note : ""}`
            : "Belum diajukan mitra",
        ),
      );
      card.append(grid);

      // Baris Status Penyelesaian Kedua Pihak & Riwayat Log Order
      const footRow = document.createElement("div");
      footRow.className =
        "flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5 text-xs text-slate-400";

      const dualInfo = document.createElement("div");
      dualInfo.className = "flex flex-wrap items-center gap-x-4 gap-y-1";

      const custDone = document.createElement("span");
      custDone.className = o.customer_completed_at
        ? "text-emerald-400 font-medium"
        : "text-slate-400";
      custDone.textContent = `Konfirmasi Selesai Pelanggan: ${o.customer_completed_at ? "✓ " + fmtDate(o.customer_completed_at) : "Belum"}`;

      const partDone = document.createElement("span");
      partDone.className = o.partner_completed_at
        ? "text-emerald-400 font-medium"
        : "text-slate-400";
      partDone.textContent = `Konfirmasi Selesai Mitra: ${o.partner_completed_at ? "✓ " + fmtDate(o.partner_completed_at) : "Belum"}`;

      dualInfo.append(custDone, partDone);
      if (o.cancellation_reason) {
        const cancelSpan = document.createElement("span");
        cancelSpan.className = "text-rose-300 font-medium";
        cancelSpan.textContent = `Alasan Batal: ${o.cancellation_reason}`;
        dualInfo.append(cancelSpan);
      }

      const orderLogs = allLogs.filter((l) => l.order_id === o.id);
      const toggleLogsBtn = document.createElement("button");
      toggleLogsBtn.type = "button";
      toggleLogsBtn.className =
        "px-3 py-1.5 rounded-xl bg-white/5 hover:bg-[#4cd7f6]/15 text-slate-200 hover:text-[#4cd7f6] border border-white/10 hover:border-[#4cd7f6]/40 text-xs font-semibold transition-all cursor-pointer";
      toggleLogsBtn.textContent = `Lihat Log Aktivitas (${orderLogs.length})`;

      const logsDrawer = document.createElement("div");
      logsDrawer.hidden = true;
      logsDrawer.className = "mt-3 pt-3 border-t border-white/10 space-y-2";

      toggleLogsBtn.addEventListener("click", () => {
        logsDrawer.hidden = !logsDrawer.hidden;
        toggleLogsBtn.textContent = logsDrawer.hidden
          ? `Lihat Log Aktivitas (${orderLogs.length})`
          : "Sembunyikan Log";
      });

      for (const ev of orderLogs) {
        const row = document.createElement("div");
        row.className =
          "flex flex-wrap items-start justify-between gap-2 rounded-xl bg-[#0b1326]/80 border border-white/5 px-3.5 py-2.5 text-xs";
        const left = document.createElement("div");
        left.className = "space-y-0.5";
        const roleInfo = roleBadges[ev.actor_role] || roleBadges.customer;
        const headLine = document.createElement("div");
        headLine.className = "flex flex-wrap items-center gap-2";

        const rBadge = document.createElement("span");
        rBadge.className = `px-2 py-0.5 rounded-md text-[10px] font-bold border ${roleInfo.cls}`;
        rBadge.textContent = roleInfo.text;

        const actorSpan = document.createElement("span");
        actorSpan.className = "font-mono text-slate-200 font-semibold";
        actorSpan.textContent = ev.actor_email;

        const stSpan = document.createElement("span");
        stSpan.className = "text-[#4cd7f6] font-semibold";
        stSpan.textContent = `→ ${statusLabels[ev.status] || ev.status}`;

        headLine.append(rBadge, actorSpan, stSpan);
        left.append(headLine);

        if (ev.note) {
          const noteP = document.createElement("p");
          noteP.className = "text-slate-300 m-0 pt-0.5";
          noteP.textContent = ev.note;
          left.append(noteP);
        }

        const timeSpan = document.createElement("span");
        timeSpan.className = "font-mono text-[11px] text-slate-400 shrink-0";
        timeSpan.textContent = fmtDate(ev.created_at);

        row.append(left, timeSpan);
        logsDrawer.append(row);
      }

      footRow.append(dualInfo, toggleLogsBtn);
      card.append(footRow, logsDrawer);
      panel.append(card);
    }
  }

  function renderActivityLogs() {
    const panel = el("panelActivityLogs");
    if (!panel) return;
    panel.replaceChildren();

    const filtered = allLogs.filter(matchesFilter);
    if (el("badgeLogsCount"))
      el("badgeLogsCount").textContent = String(filtered.length);

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className =
        "rounded-2xl bg-[#1a243b]/60 border border-white/5 p-6 text-center text-sm text-slate-400";
      empty.textContent = "Belum ada log aktivitas yang sesuai dengan filter.";
      panel.append(empty);
      return;
    }

    for (const ev of filtered) {
      const item = document.createElement("article");
      item.className =
        "rounded-2xl bg-[#1a243b] border border-white/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all hover:border-[#4cd7f6]/35";

      const left = document.createElement("div");
      left.className = "space-y-1.5";

      const badgesRow = document.createElement("div");
      badgesRow.className = "flex flex-wrap items-center gap-2";

      const ordBadge = document.createElement("span");
      ordBadge.className =
        "px-2.5 py-0.5 rounded-lg bg-[#0b1326] border border-white/10 font-mono text-xs font-bold text-[#4cd7f6]";
      ordBadge.textContent = `Order #${ev.order_id}`;

      const roleInfo = roleBadges[ev.actor_role] || roleBadges.customer;
      const actorBadge = document.createElement("span");
      actorBadge.className = `px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${roleInfo.cls}`;
      actorBadge.textContent = `${roleInfo.text}: ${ev.actor_email}`;

      const stBadge = document.createElement("span");
      stBadge.className = `px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusStyles[ev.status] || statusStyles.waiting}`;
      stBadge.textContent = statusLabels[ev.status] || ev.status;

      badgesRow.append(ordBadge, actorBadge, stBadge);

      const desc = document.createElement("p");
      desc.className = "text-sm font-medium text-white m-0";
      desc.textContent =
        ev.note ||
        `Perubahan status pesanan #${ev.order_id} menjadi ${statusLabels[ev.status] || ev.status}`;

      const parties = document.createElement("p");
      parties.className = "text-xs text-slate-400 m-0";
      parties.textContent = `Bengkel: ${ev.workshop_name} (${ev.partner_email}) · Pelanggan: ${ev.customer_email} · Layanan: ${(ev.vehicle_type || "").toUpperCase()} - ${ev.service} · Biaya: ${money(ev.confirmed_cost)} (${paymentLabel(ev.payment_method, ev.payment_status)})`;

      left.append(badgesRow, desc, parties);

      const right = document.createElement("div");
      right.className =
        "shrink-0 text-left sm:text-right font-mono text-xs text-slate-400";
      right.textContent = fmtDate(ev.created_at);

      item.append(left, right);
      panel.append(item);
    }
  }

  function render() {
    renderTransactions();
    renderActivityLogs();
  }

  async function loadMonitoring() {
    if (loading) return;
    loading = true;
    const statusEl = el("monitoringStatus");
    const refreshBtn = el("refreshMonitoring");
    if (refreshBtn) refreshBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Memperbarui data monitoring...";

    try {
      const data = await Bengkel.request("/api/admin/monitoring", {
        cache: "no-store",
      });
      const s = data.summary || {};
      allOrders = data.orders || [];
      allLogs = data.logs || [];

      if (el("statTotalOrders"))
        el("statTotalOrders").textContent = String(s.totalOrders ?? 0);
      if (el("statActiveOrders"))
        el("statActiveOrders").textContent = String(s.activeOrders ?? 0);
      if (el("statCompletedOrders"))
        el("statCompletedOrders").textContent = String(s.completedOrders ?? 0);
      if (el("statCancelledOrders"))
        el("statCancelledOrders").textContent = String(s.cancelledOrders ?? 0);
      if (el("statPaymentMethods")) {
        el("statPaymentMethods").textContent =
          `${s.qrisOrders ?? 0} QRIS / ${s.codOrders ?? 0} COD`;
      }
      if (el("statTotalRevenue")) {
        el("statTotalRevenue").textContent = money(s.totalRevenue ?? 0);
      }

      render();
      if (statusEl) {
        statusEl.textContent =
          "Terakhir diperbarui: " +
          new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message;
    } finally {
      loading = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  el("tabBtnTransactions")?.addEventListener("click", () =>
    setTab("transactions"),
  );
  el("tabBtnActivityLogs")?.addEventListener("click", () => setTab("logs"));
  el("refreshMonitoring")?.addEventListener("click", loadMonitoring);
  el("searchMonitoring")?.addEventListener("input", render);
  el("filterStatusMonitoring")?.addEventListener("change", render);
  el("filterPaymentMonitoring")?.addEventListener("change", render);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadMonitoring();
  });
  setInterval(() => {
    if (!document.hidden) loadMonitoring();
  }, 15000);

  loadMonitoring();
})();
