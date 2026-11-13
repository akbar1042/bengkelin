(() => {
  const el = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let tab = params.get("tab") === "bengkel" ? "bengkel" : "akun";
  let accounts = [];
  let workshops = [];
  let loading = false;

  const roleInfo = {
    customer: [
      "Pelanggan",
      "bg-[#4cd7f6]/15 text-[#4cd7f6] border-[#4cd7f6]/30",
    ],
    partner: [
      "Mitra",
      "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    ],
    admin: ["Admin", "bg-violet-500/15 text-violet-300 border-violet-500/30"],
  };
  const statusInfo = {
    approved: [
      "Disetujui",
      "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    ],
    pending: ["Menunggu", "bg-amber-500/15 text-amber-300 border-amber-500/30"],
    rejected: ["Ditolak", "bg-rose-500/15 text-rose-300 border-rose-500/30"],
  };
  const fmtDate = (v) =>
    v
      ? new Date(v).toLocaleString("id-ID", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const badge = (text, cls) =>
    node(
      "span",
      `px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`,
      text,
    );
  const field = (label, value) => {
    const box = node(
      "div",
      "rounded-xl bg-[#0b1326]/65 border border-white/5 p-2.5",
    );
    box.append(
      node(
        "span",
        "block text-[10px] uppercase tracking-wider text-slate-400 font-semibold",
        label,
      ),
      node(
        "span",
        "block text-xs font-medium text-slate-100 break-words",
        value,
      ),
    );
    return box;
  };
  const empty = (text) =>
    node(
      "div",
      "md:col-span-2 rounded-2xl bg-[#1a243b]/60 border border-white/5 p-6 text-center text-sm text-slate-400",
      text,
    );

  // Preselect filter dari URL (link kartu Ringkasan Platform)
  if (params.get("role")) el("filterRole").value = params.get("role");
  if (params.get("status")) el("filterStatus").value = params.get("status");

  function styleTabs() {
    for (const btn of document.querySelectorAll(".tab-btn")) {
      const active = btn.dataset.tab === tab;
      btn.className =
        "tab-btn px-4 py-2 rounded-xl text-xs transition-all cursor-pointer flex items-center gap-1.5 " +
        (active
          ? "font-bold bg-[#4cd7f6] text-slate-950"
          : "font-semibold bg-[#1a243b] text-slate-300 hover:text-white border border-white/10");
      btn.querySelector(".tab-badge").className =
        "tab-badge ml-1 px-2 py-0.5 rounded-full text-[11px] " +
        (active
          ? "bg-slate-950/20 text-slate-950"
          : "bg-white/10 text-slate-200");
    }
    el("panelAccounts").classList.toggle("hidden", tab !== "akun");
    el("panelWorkshops").classList.toggle("hidden", tab !== "bengkel");
    el("filterRole").classList.toggle("hidden", tab !== "akun");
    el("filterStatus").classList.toggle("hidden", tab !== "bengkel");
  }

  function syncUrl() {
    const q = new URLSearchParams({ tab });
    if (tab === "akun" && el("filterRole").value !== "all")
      q.set("role", el("filterRole").value);
    if (tab === "bengkel" && el("filterStatus").value !== "all")
      q.set("status", el("filterStatus").value);
    history.replaceState(null, "", "?" + q);
  }

  function renderAccounts() {
    const panel = el("panelAccounts");
    panel.replaceChildren();
    const q = el("searchAccounts").value.trim().toLowerCase();
    const role = el("filterRole").value;
    const list = accounts.filter((a) => {
      if (role === "inactive") {
        if (!a.deleted_at) return false;
      } else if (a.deleted_at) return false;
      else if (role !== "all" && a.role !== role) return false;
      return !q || a.email.toLowerCase().includes(q);
    });
    el("badgeAccounts").textContent = String(list.length);
    if (!list.length)
      return panel.append(empty("Tidak ada akun yang sesuai filter."));
    for (const a of list) {
      const card = node(
        "article",
        "rounded-2xl bg-[#1a243b] border border-white/10 p-4 space-y-3 transition-all hover:border-[#4cd7f6]/35",
      );
      const head = node(
        "div",
        "flex flex-wrap items-center justify-between gap-2",
      );
      const left = node("div", "flex items-center gap-2.5 min-w-0");
      left.append(
        node(
          "span",
          "w-9 h-9 rounded-full bg-[#0b1326] border border-[#4cd7f6]/40 flex items-center justify-center font-bold text-[#4cd7f6] text-xs shrink-0",
          a.email.slice(0, 2).toUpperCase(),
        ),
        node("strong", "text-sm text-white truncate", a.email),
      );
      const badges = node("div", "flex items-center gap-1.5");
      const [rl, rc] = roleInfo[a.role] || roleInfo.customer;
      badges.append(badge(rl, rc));
      if (a.deleted_at)
        badges.append(
          badge("Nonaktif", "bg-white/5 text-slate-400 border-white/15"),
        );
      head.append(left, badges);
      const grid = node("div", "grid grid-cols-3 gap-2");
      grid.append(
        field("Terdaftar", fmtDate(a.registered_at)),
        field("Bengkel", String(a.workshop_count)),
        field("Pesanan", String(a.order_count)),
      );
      card.append(head, grid);
      if (a.deleted_at)
        card.append(
          node(
            "p",
            "text-[11px] text-slate-400 m-0",
            "Dinonaktifkan: " + fmtDate(a.deleted_at),
          ),
        );
      if (a.workshop_count) {
        const link = node(
          "button",
          "text-xs font-semibold text-[#4cd7f6] hover:underline cursor-pointer",
          "Lihat bengkel milik akun ini →",
        );
        link.type = "button";
        link.addEventListener("click", () => {
          tab = "bengkel";
          el("filterStatus").value = "all";
          el("searchAccounts").value = a.email;
          render();
        });
        card.append(link);
      }
      panel.append(card);
    }
  }

  function renderWorkshops() {
    const panel = el("panelWorkshops");
    panel.replaceChildren();
    const q = el("searchAccounts").value.trim().toLowerCase();
    const status = el("filterStatus").value;
    const list = workshops.filter((w) => {
      if (status !== "all" && w.status !== status) return false;
      if (!q) return true;
      return [w.name, w.owner_email, w.address, w.phone, ...(w.services || [])]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    el("badgeWorkshops").textContent = String(list.length);
    if (!list.length)
      return panel.append(empty("Tidak ada bengkel yang sesuai filter."));
    for (const w of list) {
      const card = node(
        "article",
        "rounded-2xl bg-[#1a243b] border border-white/10 p-4 space-y-3 transition-all hover:border-[#4cd7f6]/35",
      );
      const head = node(
        "div",
        "flex flex-wrap items-start justify-between gap-2",
      );
      const title = node("div", "min-w-0");
      title.append(
        node("h3", "text-base font-headline font-bold text-white m-0", w.name),
        node("p", "text-xs text-slate-400 m-0", "Pemilik: " + w.owner_email),
      );
      const badges = node("div", "flex flex-wrap items-center gap-1.5");
      const [sl, sc] = statusInfo[w.status] || statusInfo.pending;
      badges.append(badge(sl, sc));
      if (w.has_pending_revision)
        badges.append(badge("Revisi menunggu", statusInfo.pending[1]));
      head.append(title, badges);

      const grid = node("div", "grid grid-cols-1 sm:grid-cols-2 gap-2");
      grid.append(
        field("Alamat", w.address),
        field("Telepon", w.phone),
        field("Layanan", (w.services || []).join(", ") || "—"),
        field(
          "Fasilitas",
          [
            w.pickup && "Jemput/Derek",
            w.onsite && "Servis di lokasi",
            w.emergency && "Darurat",
            w.open24 && "24 jam",
          ]
            .filter(Boolean)
            .join(" · ") || "Standar",
        ),
        field(
          "Pesanan aktif / selesai",
          `${w.active_orders} / ${w.completed_orders}`,
        ),
        field("Didaftarkan", fmtDate(w.created_at)),
      );
      card.append(head, grid);
      if (w.review_note)
        card.append(
          node(
            "p",
            "text-xs text-slate-300 m-0",
            `Catatan admin (${fmtDate(w.reviewed_at)}): ${w.review_note}`,
          ),
        );
      if (w.status === "pending" || w.has_pending_revision) {
        const a = node(
          "a",
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500 hover:text-slate-950 text-xs font-semibold transition-all",
          "Tinjau di dashboard →",
        );
        a.href = "/dashboard/admin";
        card.append(a);
      }
      panel.append(card);
    }
  }

  function render() {
    styleTabs();
    renderAccounts();
    renderWorkshops();
    syncUrl();
  }

  async function load() {
    if (loading) return;
    loading = true;
    el("refreshAccounts").disabled = true;
    el("accountsStatus").textContent = "Memuat data...";
    try {
      const [acc, ws] = await Promise.all([
        Bengkel.request("/api/admin/accounts", { cache: "no-store" }),
        Bengkel.request("/api/admin/workshops", { cache: "no-store" }),
      ]);
      accounts = acc.data || [];
      workshops = ws.data || [];
      render();
      el("accountsStatus").textContent =
        "Diperbarui " + new Date().toLocaleTimeString("id-ID");
    } catch (e) {
      el("accountsStatus").textContent = e.message;
    } finally {
      loading = false;
      el("refreshAccounts").disabled = false;
    }
  }

  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => {
      tab = btn.dataset.tab;
      el("searchAccounts").value = "";
      render();
    });
  }
  el("searchAccounts").addEventListener("input", render);
  el("filterRole").addEventListener("change", render);
  el("filterStatus").addEventListener("change", render);
  el("refreshAccounts").addEventListener("click", load);

  styleTabs();
  load();
})();
