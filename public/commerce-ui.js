(() => {
  const root = document.getElementById("featureContent"),
    message = document.getElementById("featureMessage"),
    feature = document.body.dataset.feature;
  const labels = {
    waiting: "Menunggu",
    accepted: "Diterima",
    processing: "Diproses",
    completed: "Selesai",
    cancelled: "Dibatalkan",
    pending: "Menunggu moderasi",
    approved: "Disetujui",
    rejected: "Ditolak",
  };
  // Daftar opsi alasan pembatalan (silakan ubah/tambahkan teks di dalam array di bawah ini)
  const CANCEL_REASONS = {
    customer: [
      "Jadwal atau rencana berubah",
      "Biaya servis belum sesuai",
      "Salah memilih bengkel atau layanan",
      "Kendaraan sudah ditangani di tempat lain",
      "Lainnya",
    ],
    partner: [
      "Kapasitas atau mekanik bengkel sedang penuh",
      "Suku cadang tidak tersedia",
      "Layanan tidak sesuai fasilitas bengkel",
      "Pelanggan tidak dapat dihubungi / tidak hadir",
      "Lainnya",
    ],
  };
  const composeCancelNote = (reason, extra) => {
    const r = (reason || "").trim(),
      e = (extra || "").trim();
    return e ? `${r} — ${e}` : r;
  };
  const req = (url, method = "GET", body) =>
    Bengkel.request(
      url,
      body === undefined ? { method } : Bengkel.json(method, body),
    );
  const node = (tag, text, attrs = {}) => {
    const e = document.createElement(tag);
    if (text !== null) e.textContent = text;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const link = (text, url) => node("a", text, { href: url });
  const info = (parent, text) => parent.append(node("p", text));
  let actionBusy = false;
  function setButtonsDisabled(scope, disabled) {
    if (!scope) return;
    for (const el of scope.querySelectorAll(
      'button, input[type="submit"], input[type="button"]',
    )) {
      if (disabled) {
        el.dataset.prevDisabled = String(el.disabled);
        el.disabled = true;
      } else if (el.dataset.prevDisabled !== undefined) {
        el.disabled = el.dataset.prevDisabled === "true";
        delete el.dataset.prevDisabled;
      }
    }
  }
  function button(parent, text, action) {
    const b = node("button", text, { type: "button" });
    b.addEventListener("click", async () => {
      if (b.disabled || actionBusy) return;
      actionBusy = true;
      const scope = b.closest("article") || parent;
      setButtonsDisabled(scope, true);
      b.disabled = true;
      message.textContent = "";
      try {
        await action();
      } catch (e) {
        message.textContent = e.message;
      } finally {
        actionBusy = false;
        if (scope && scope.isConnected) setButtonsDisabled(scope, false);
        if (b.isConnected) b.disabled = false;
      }
    });
    parent.append(b);
    return b;
  }
  function field(
    form,
    name,
    label,
    type = "text",
    value = "",
    required = true,
  ) {
    const wrap = node("label", label),
      input = node(type === "textarea" ? "textarea" : "input", null, { name });
    if (type !== "textarea") input.type = type;
    input.value = value;
    input.required = required;
    wrap.append(input);
    form.append(wrap);
    return input;
  }
  function choice(form, name, label, values, value) {
    const wrap = node("label", label),
      select = node("select", null, { name });
    select.required = true;
    for (const [key, text] of values) {
      const option = node("option", text, { value: key });
      select.append(option);
    }
    select.value = value != null ? value : values[0] ? values[0][0] : "";
    wrap.append(select);
    form.append(wrap);
    return select;
  }
  function submit(form, text, action) {
    const b = node("button", text, { type: "submit" });
    form.append(b);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (b.disabled || form.dataset.busy === "true" || actionBusy) return;
      if (!form.reportValidity()) return;
      actionBusy = true;
      form.dataset.busy = "true";
      const scope = form.closest("article") || form;
      setButtonsDisabled(scope, true);
      b.disabled = true;
      message.textContent = "";
      try {
        await action();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        actionBusy = false;
        delete form.dataset.busy;
        if (scope && scope.isConnected) setButtonsDisabled(scope, false);
        if (b.isConnected) b.disabled = false;
      }
    });
    return b;
  }
  const money = (v) =>
    v == null
      ? "Belum dikonfirmasi"
      : new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          maximumFractionDigits: 0,
        }).format(v);
  const paymentLabel = (method, status) => {
    const m = method === "qris" ? "QRIS" : "Bayar di Lokasi (COD)";
    const s =
      status === "paid"
        ? "Lunas"
        : method === "qris"
          ? "Menunggu Pembayaran QRIS"
          : "Dibayar di Bengkel";
    return `${m} · ${s}`;
  };
  function formatRemaining(targetMs) {
    const diff = targetMs - Date.now();
    if (diff <= 0) return "Segera diproses otomatis oleh sistem…";
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}j ${pad(m)}m ${pad(s)}d`;
  }
  function getOrderDeadlineInfo(o) {
    if (o.status === "waiting") {
      const createdMs = o.created_at
        ? new Date(o.created_at).getTime()
        : Date.now();
      const schedMs = new Date(o.scheduled_at).getTime();
      const deadline = Math.min(createdMs + 24 * 3600000, schedMs);
      return {
        deadline,
        prefix: "Sisa waktu konfirmasi bengkel sebelum kedaluwarsa: ",
      };
    }
    if (
      o.status === "accepted" &&
      (o.confirmed_cost == null || o.accepted_cost_version !== o.cost_version)
    ) {
      const baseMs = o.updated_at
        ? new Date(o.updated_at).getTime()
        : o.created_at
          ? new Date(o.created_at).getTime()
          : Date.now();
      return {
        deadline: baseMs + 24 * 3600000,
        prefix: "Sisa waktu konfirmasi biaya & pembayaran: ",
      };
    }
    if (o.status === "processing") {
      if (
        o.confirmed_cost != null &&
        o.accepted_cost_version !== o.cost_version
      ) {
        const baseMs = o.updated_at
          ? new Date(o.updated_at).getTime()
          : Date.now();
        return {
          deadline: baseMs + 24 * 3600000,
          prefix: "Sisa waktu konfirmasi biaya & pembayaran: ",
        };
      }
      if (o.customer_completed_at && !o.partner_completed_at) {
        return {
          deadline: new Date(o.customer_completed_at).getTime() + 24 * 3600000,
          prefix:
            "Pelanggan sudah konfirmasi selesai. Sisa waktu konfirmasi mitra (otomatis selesai): ",
        };
      }
      if (o.partner_completed_at && !o.customer_completed_at) {
        return {
          deadline: new Date(o.partner_completed_at).getTime() + 24 * 3600000,
          prefix:
            "Mitra sudah konfirmasi selesai. Sisa waktu konfirmasi pelanggan (otomatis selesai): ",
        };
      }
      const baseMs = o.cost_accepted_at
        ? new Date(o.cost_accepted_at).getTime()
        : o.updated_at
          ? new Date(o.updated_at).getTime()
          : Date.now();
      const isCodWaitingPartner =
        o.payment_method === "cod" &&
        o.payment_status !== "paid" &&
        !o.partner_completed_at;
      return {
        deadline: baseMs + 24 * 3600000,
        prefix: isCodWaitingPartner
          ? "Sisa waktu konfirmasi penyelesaian mitra & pelanggan (otomatis selesai 24 jam): "
          : "Sisa waktu konfirmasi penyelesaian kedua pihak (otomatis selesai 24 jam): ",
      };
    }
    return null;
  }
  function createCountdownBanner(o) {
    const infoData = getOrderDeadlineInfo(o);
    if (!infoData) return null;
    const wrap = node("div", null, {
      class:
        "mt-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono flex items-center gap-2",
      "data-countdown-deadline": String(infoData.deadline),
      "data-countdown-prefix": infoData.prefix,
    });
    wrap.textContent =
      "⏱ " + infoData.prefix + formatRemaining(infoData.deadline);
    return wrap;
  }
  setInterval(() => {
    for (const el of document.querySelectorAll("[data-countdown-deadline]")) {
      const deadline = Number(el.dataset.countdownDeadline);
      const prefix = el.dataset.countdownPrefix || "";
      el.textContent = "⏱ " + prefix + formatRemaining(deadline);
    }
  }, 1000);
  function openQrisModal(o, onConfirm) {
    let dialog = document.getElementById("qrisPaymentModal");
    if (dialog) dialog.remove();
    dialog = node("dialog", null, {
      id: "qrisPaymentModal",
      style:
        "background:#131b2e;color:#f1f5f9;border:1px solid rgba(76,215,246,0.35);border-radius:1.5rem;padding:1.5rem;max-width:400px;width:92vw;box-shadow:0 25px 50px -12px rgba(0,0,0,0.75);",
    });
    const title = node("h3", "Pembayaran QRIS — Pesanan #" + o.id, {
      style:
        "margin:0 0 0.25rem 0;font-size:1.1rem;font-weight:800;color:#ffffff;",
    });
    const sub = node(
      "p",
      o.workshop_name + " · Total: " + money(o.confirmed_cost),
      {
        style:
          "margin:0 0 1rem 0;font-size:0.85rem;color:#4cd7f6;font-weight:700;",
      },
    );
    const imgWrap = node("div", null, {
      style:
        "background:#ffffff;padding:0.75rem;border-radius:1rem;text-align:center;margin-bottom:1rem;",
    });
    const img = node("img", null, {
      src: "/images/qris-static.svg",
      alt: "QRIS Bengkelin",
      style: "width:100%;max-width:260px;height:auto;display:inline-block;",
    });
    imgWrap.append(img);
    const hint = node(
      "p",
      "Ini adalah simulasi QRIS statis. Setelah QRIS tampil, klik tombol di bawah untuk langsung melanjutkan proses pesanan.",
      {
        style:
          "font-size:0.75rem;color:#cbd5e1;line-height:1.5;margin:0 0 1rem 0;text-align:center;",
      },
    );
    const btnRow = node("div", null, {
      style: "display:flex;gap:0.5rem;justify-content:flex-end;",
    });
    const cancelBtn = node("button", "Batal", {
      type: "button",
      style:
        "padding:0.6rem 1rem;border-radius:0.75rem;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;font-size:0.75rem;font-weight:600;cursor:pointer;",
    });
    const nextBtn = node("button", " Pembayaran Selesai — Lanjut Progress", {
      type: "button",
      style:
        "padding:0.6rem 1rem;border-radius:0.75rem;background:#4cd7f6;border:0;color:#060e20;font-size:0.75rem;font-weight:800;cursor:pointer;flex:1;",
    });
    cancelBtn.addEventListener("click", () => dialog.close());
    nextBtn.addEventListener("click", async () => {
      if (nextBtn.disabled) return;
      nextBtn.disabled = true;
      cancelBtn.disabled = true;
      nextBtn.textContent = "Memproses pembayaran…";
      try {
        await onConfirm();
        dialog.close();
      } catch (e) {
        nextBtn.disabled = false;
        cancelBtn.disabled = false;
        nextBtn.textContent = "✓ Pembayaran Selesai — Lanjut Progress";
        if (message) message.textContent = e.message;
      }
    });
    btnRow.append(cancelBtn, nextBtn);
    dialog.append(title, sub, imgWrap, hint, btnRow);
    document.body.append(dialog);
    dialog.showModal();
  }
  let user;
  async function detail() {
    const id = new URL(location.href).searchParams.get("id");
    if (!id) throw Error("Pilih mitra dari halaman pencarian.");
    const data = await req("/api/customer/partners/" + encodeURIComponent(id)),
      w = data.workshop;
    const days = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    const digits = w.phone.replace(/\D/g, ""),
      wa = digits.startsWith("0") ? "62" + digits.slice(1) : digits;

    // Card Ringkasan Profil Bengkel
    const infoCard = node("div", null, {
      class:
        "rounded-2xl border border-white/10 bg-[#0b1326]/60 p-5 sm:p-6 space-y-4",
    });
    const topRow = node("div", null, {
      class:
        "flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-white/10 pb-4",
    });
    const titleWrap = node("div", null);
    titleWrap.append(
      node("h2", w.name, {
        class: "font-heading font-extrabold text-xl sm:text-2xl text-white m-0",
      }),
      node("p", w.address, { class: "text-sm text-slate-300 mt-1 mb-0" }),
    );
    const badges = node("div", null, {
      class: "flex flex-wrap items-center gap-1.5",
    });
    for (const label of [
      "Mitra Resmi",
      w.pickup ? "Penjemputan/derek" : "",
      w.onsite ? "Servis di lokasi" : "",
      w.emergency ? "Darurat 24 Jam" : "",
    ].filter(Boolean)) {
      badges.append(
        node("span", label, {
          class:
            "inline-flex items-center rounded-full border border-[#4cd7f6]/30 bg-[#4cd7f6]/10 px-2.5 py-1 text-xs font-semibold text-[#4cd7f6]",
        }),
      );
    }
    topRow.append(titleWrap, badges);
    infoCard.append(topRow);

    // Grid Detail Bengkel
    const metaGrid = node("div", null, {
      class: "grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm",
    });
    const metaItem = (lbl, val) => {
      const box = node("div", null, {
        class: "rounded-xl border border-white/5 bg-[#131b2e]/90 p-3",
      });
      box.append(
        node("span", lbl, {
          class:
            "block text-[11px] uppercase tracking-wider text-slate-400 font-semibold",
        }),
        node("span", val, { class: "mt-1 block font-medium text-white" }),
      );
      return box;
    };
    metaGrid.append(
      metaItem(
        "Kategori Kendaraan",
        (w.vehicleTypes.join(" / ") || "Belum dilengkapi").toUpperCase(),
      ),
      metaItem("Layanan Tersedia", w.services.join(", ")),
      metaItem(
        "Kapasitas & Estimasi Durasi",
        (w.booking?.capacity || 1) +
          " pesanan bersamaan · " +
          w.services
            .map((v) => v + " (" + (w.booking?.durations?.[v] || 60) + " mnt)")
            .join(", "),
      ),
      metaItem(
        "Jam Operasional",
        w.hours
          ? w.hours.days.map((d) => days[d]).join(", ") +
              " · " +
              (w.open24
                ? "Buka 24 Jam"
                : w.hours.open + "–" + w.hours.close + " WIB")
          : "Jam operasional belum dilengkapi",
      ),
    );
    infoCard.append(metaGrid);

    // Baris Kontak & Tombol Aksi
    const contactRow = node("div", null, {
      class: "flex flex-wrap items-center justify-between gap-3 pt-2",
    });
    contactRow.append(
      node("p", "Telepon Bengkel: " + w.phone, {
        class: "font-mono text-xs sm:text-sm text-slate-200 m-0",
      }),
    );
    const contactBtns = node("div", null, {
      class: "flex flex-wrap items-center gap-2",
    });
    contactBtns.append(
      link("Hubungi bengkel", "tel:" + digits),
      link("WhatsApp bengkel", "https://wa.me/" + wa),
    );
    contactRow.append(contactBtns);
    infoCard.append(contactRow);

    // Galeri Foto Bengkel
    if ((w.photos || []).length) {
      const galleryWrap = node("div", null, {
        class: "pt-3 border-t border-white/10",
      });
      galleryWrap.append(
        node("p", "Foto Bengkel & Armada", {
          class:
            "text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5",
        }),
      );
      const photoGrid = node("div", null, {
        class: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3",
      });
      for (const photo of w.photos) {
        const img = node("img", null, {
          src: photo.url,
          alt:
            photo.kind === "tow"
              ? "Kendaraan penjemputan bengkel"
              : "Foto bengkel",
          loading: "lazy",
        });
        img.className =
          "w-full h-44 object-cover rounded-xl border border-white/10 bg-[#060e20]";
        photoGrid.append(img);
      }
      galleryWrap.append(photoGrid);
      infoCard.append(galleryWrap);
    }
    root.append(infoCard);

    if (user.role === "customer") {
      const formSection = node("div", null, { class: "pt-2" });
      formSection.append(node("h2", "Pesan servis"));
      info(
        formSection,
        "Durasi mengikuti layanan yang dipilih, minimal 15 menit dari sekarang, maksimal 90 hari. Waktu mengikuti zona perangkat Anda. Pilih metode pembayaran di lokasi (COD) atau QRIS.",
      );
      const form = node("form", null),
        vehicle = choice(
          form,
          "vehicleType",
          "Kendaraan",
          w.vehicleTypes.map((v) => [v, v === "motor" ? "Motor" : "Mobil"]),
        ),
        service = choice(
          form,
          "service",
          "Layanan",
          w.services.map((v) => [v, v]),
        );
      const paymentMethod = choice(form, "paymentMethod", "Metode Pembayaran", [
        ["cod", "Bayar di Lokasi (COD)"],
        ["qris", "QRIS (Langsung Lanjut Progress)"],
      ]);
      const scheduled = field(
        form,
        "scheduledAt",
        "Jadwal (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")",
        "datetime-local",
      );
      const notes = field(
        form,
        "notes",
        "Keluhan/catatan",
        "textarea",
        "",
        false,
      );
      notes.maxLength = 1500;
      const towingLabel = node("label", null, {
        style:
          "display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1rem;border-radius:0.75rem;background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.25);cursor:pointer;margin:0;",
      });
      const needTowing = node("input", null, {
        type: "checkbox",
        id: "orderNeedTowing",
        style:
          "width:1.1rem;height:1.1rem;min-width:1.1rem;margin:0;accent-color:#4cd7f6;cursor:pointer;flex-shrink:0;",
      });
      const towingText = node(
        "span",
        "🚨 Butuh layanan derek / penjemputan darurat (SOS)",
        {
          style:
            "font-size:0.85rem;font-weight:600;color:#f1f5f9;text-transform:none;letter-spacing:normal;",
        },
      );
      towingLabel.append(needTowing, towingText);
      form.append(towingLabel);
      const formFeedback = node("p", "");
      formFeedback.style.cssText =
        "font-size:0.875rem;font-weight:600;color:#4cd7f6;margin:0;";
      submit(form, "Kirim pesanan", async () => {
        formFeedback.textContent = "";
        try {
          const result = await req("/api/customer/orders", "POST", {
            workshopId: w.partnerId,
            vehicleType: vehicle.value,
            service: service.value,
            paymentMethod: paymentMethod.value,
            needTowing: needTowing.checked,
            scheduledAt: new Date(scheduled.value).toISOString(),
            notes: notes.value,
          });
          message.textContent = result.message;
          formFeedback.style.color = "#34d399";
          formFeedback.textContent = "✓ " + result.message;
          if (!root.querySelector('a[href="/orders.html"]'))
            root.append(link("Lihat pesanan saya", "/orders.html"));
          form.reset();
          message.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        } catch (err) {
          formFeedback.style.color = "#fb7185";
          formFeedback.textContent = "⚠️ " + err.message;
          throw err;
        }
      });
      form.append(formFeedback);
      formSection.append(form);
      root.append(formSection);
    }
  }
  async function orders(owner) {
    const { data } = await req(
      owner ? "/api/owner/orders" : "/api/customer/orders",
    );
    if (!data.length) info(root, "Belum ada pesanan.");
    for (const o of data) {
      const a = node("article", null);
      a.append(node("h2", "#" + o.id + " — " + o.workshop_name));
      info(a, "Status: " + labels[o.status]);
      info(
        a,
        o.vehicle_type +
          " · " +
          o.service +
          " · " +
          new Date(o.scheduled_at).toLocaleString("id-ID"),
      );
      info(
        a,
        "Metode Pembayaran: " +
          paymentLabel(o.payment_method, o.payment_status),
      );
      info(a, "Catatan: " + (o.notes || "—"));
      if (owner) info(a, "Pelanggan: " + o.customer_email);
      else
        a.append(
          link("Hubungi bengkel", "tel:" + o.workshop_phone.replace(/\D/g, "")),
        );
      const timerBanner = createCountdownBanner(o);
      if (timerBanner) a.append(timerBanner);
      info(a, "Biaya yang diinformasikan bengkel: " + money(o.confirmed_cost));
      if (o.cost_note) info(a, o.cost_note);
      info(a, "Durasi terjadwal: " + (o.duration_minutes || 60) + " menit");
      if (o.confirmed_cost != null)
        info(
          a,
          o.cost_version > 0 && o.accepted_cost_version === o.cost_version
            ? "Biaya versi " +
                o.cost_version +
                " disetujui pelanggan (" +
                paymentLabel(o.payment_method, o.payment_status) +
                ")."
            : "Biaya menunggu persetujuan pelanggan.",
        );
      const customerConfirmedPayment =
        o.payment_status === "paid" ||
        (o.cost_version > 0 && o.accepted_cost_version === o.cost_version);
      const isCodWaitingPartner =
        o.payment_method === "cod" &&
        o.payment_status !== "paid" &&
        !o.partner_completed_at;
      if (
        customerConfirmedPayment &&
        (o.status === "processing" ||
          ["accepted", "processing"].includes(o.status))
      ) {
        info(
          a,
          "Konfirmasi Selesai Pelanggan: " +
            (o.customer_completed_at
              ? "✓ Sudah dikonfirmasi (" +
                new Date(o.customer_completed_at).toLocaleString("id-ID") +
                ")"
              : isCodWaitingPartner
                ? "Menunggu konfirmasi selesai dari mitra terlebih dahulu (COD)"
                : "Menunggu konfirmasi"),
        );
        info(
          a,
          "Konfirmasi Selesai Mitra: " +
            (o.partner_completed_at
              ? "✓ Sudah dikonfirmasi (" +
                new Date(o.partner_completed_at).toLocaleString("id-ID") +
                ")"
              : "Menunggu konfirmasi"),
        );
      }
      if (
        !owner &&
        ["waiting", "accepted", "processing"].includes(o.status) &&
        o.cost_version > 0 &&
        o.accepted_cost_version !== o.cost_version
      ) {
        button(
          a,
          "Setujui Biaya (Bayar di Lokasi / COD) " + money(o.confirmed_cost),
          async () => {
            await req(
              "/api/customer/orders/" + o.id + "/cost-approval",
              "POST",
              { version: o.cost_version, paymentMethod: "cod" },
            );
            await render();
            message.textContent =
              "Biaya disetujui dengan metode Bayar di Lokasi (COD).";
          },
        );
        button(
          a,
          "Bayar & Setujui dengan QRIS " + money(o.confirmed_cost),
          async () => {
            openQrisModal(o, async () => {
              const res = await req(
                "/api/customer/orders/" + o.id + "/cost-approval",
                "POST",
                { version: o.cost_version, paymentMethod: "qris" },
              );
              await render();
              message.textContent =
                res.message || "Pembayaran QRIS berhasil dan biaya disetujui.";
            });
          },
        );
      } else if (
        !owner &&
        ["waiting", "accepted", "processing"].includes(o.status) &&
        o.confirmed_cost != null &&
        o.cost_version > 0 &&
        o.payment_status !== "paid"
      ) {
        button(
          a,
          "Bayar Sekarang via QRIS " + money(o.confirmed_cost),
          async () => {
            openQrisModal(o, async () => {
              const res = await req(
                "/api/customer/orders/" + o.id + "/cost-approval",
                "POST",
                { version: o.cost_version, paymentMethod: "qris" },
              );
              await render();
              message.textContent =
                res.message ||
                "Pembayaran QRIS selesai dan notifikasi telah dikirim ke mitra.";
            });
          },
        );
      }
      if (
        !owner &&
        o.status === "processing" &&
        customerConfirmedPayment &&
        !o.customer_completed_at
      ) {
        if (isCodWaitingPartner) {
          info(
            a,
            "Menunggu mitra bengkel melakukan konfirmasi selesai terlebih dahulu (metode Bayar di Lokasi / COD).",
          );
        } else {
          button(a, "✓ Konfirmasi Order Selesai (Pelanggan)", async () => {
            const res = await req(
              "/api/customer/orders/" + o.id + "/status",
              "PATCH",
              {
                status: "completed",
                dualConfirm: true,
                note: "Pelanggan mengonfirmasi pesanan servis selesai",
              },
            );
            await render();
            message.textContent = res.message;
          });
        }
      }
      if (o.need_towing) {
        const sosBadge = node(
          "div",
          "🚨 SOS DEREK — Layanan Penjemputan Darurat (Prioritas)",
          {
            style:
              "display:inline-block;padding:0.35rem 0.75rem;border-radius:0.5rem;background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.45);color:#fda4af;font-size:0.75rem;font-weight:700;margin-bottom:0.5rem;",
          },
        );
        a.prepend(sosBadge);
        if (owner && ["accepted", "processing"].includes(o.status)) {
          if (o.towing_status === "requested") {
            const otwBtn = button(
              a,
              "🚚 Konfirmasi Menuju Lokasi",
              async () => {
                const res = await req(
                  "/api/orders/" + o.id + "/towing",
                  "PATCH",
                  { action: "on_the_way" },
                );
                await render();
                message.textContent = res.message;
              },
            );
            otwBtn.style.cssText =
              "background-color:#f59e0b;color:#060e20;border:1px solid #f59e0b;font-weight:700;padding:0.55rem 1.15rem;border-radius:0.75rem;margin-bottom:0.5rem;";
          } else if (o.towing_status === "on_the_way") {
            info(
              a,
              "🚚 Status Derek: Mitra sedang menuju lokasi (Menunggu konfirmasi kedatangan dari pelanggan).",
            );
          } else if (o.towing_status === "arrived") {
            info(
              a,
              "✓ Status Derek: Mitra sudah sampai di lokasi & sedang menangani layanan.",
            );
            if (o.confirmed_cost == null || o.cost_version < 1) {
              const cf = node("form", null, {
                class:
                  "mt-3 p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 space-y-2",
              });
              cf.append(node("h3", "Kirim Rincian Biaya (Layanan Derek)"));
              const cAmount = field(
                cf,
                "amount",
                "Biaya servis & derek (Rp)",
                "text",
                "",
                true,
              );
              cAmount.inputMode = "numeric";
              cAmount.placeholder = "Contoh: 150000";
              cAmount.addEventListener("input", () => {
                const digits = cAmount.value.replace(/\D/g, "");
                cAmount.value = digits
                  ? Number(digits).toLocaleString("id-ID")
                  : "";
              });
              const cNote = field(
                cf,
                "costNote",
                "Rincian biaya",
                "textarea",
                "",
                true,
              );
              cNote.maxLength = 500;
              cNote.placeholder = "Contoh: Jasa derek + perbaikan ban";
              submit(cf, "Kirim Biaya ke Pelanggan", async () => {
                const amt = Number(cAmount.value.replace(/\D/g, ""));
                const res = await req(
                  "/api/owner/orders/" + o.id + "/cost",
                  "PATCH",
                  { amount: amt, note: cNote.value.trim() },
                );
                await render();
                message.textContent = res.message;
              });
              a.append(cf);
            } else if (
              customerConfirmedPayment &&
              o.payment_status !== "paid"
            ) {
              const payConfirmBtn = button(
                a,
                "💰 Konfirmasi Pembayaran Diterima",
                async () => {
                  const res = await req(
                    "/api/owner/orders/" + o.id + "/confirm-payment",
                    "PATCH",
                    {},
                  );
                  await render();
                  message.textContent = res.message;
                },
              );
              payConfirmBtn.style.cssText =
                "background-color:#4cd7f6;color:#060e20;border:1px solid #4cd7f6;font-weight:700;padding:0.55rem 1.15rem;border-radius:0.75rem;margin-bottom:0.5rem;";
            } else if (!customerConfirmedPayment) {
              info(
                a,
                "⏳ Menunggu pelanggan melakukan pembayaran (" +
                  money(o.confirmed_cost) +
                  ").",
              );
            }
          }
        }
      }
      if (
        owner &&
        o.status === "processing" &&
        customerConfirmedPayment &&
        !o.partner_completed_at &&
        (!o.need_towing ||
          (o.towing_status === "arrived" && o.payment_status === "paid"))
      ) {
        button(a, "✓ Konfirmasi Order Selesai (Mitra)", async () => {
          const res = await req(
            "/api/customer/orders/" + o.id + "/status",
            "PATCH",
            {
              status: "completed",
              dualConfirm: true,
              note: "Mitra mengonfirmasi pengerjaan servis selesai",
            },
          );
          await render();
          message.textContent = res.message;
        });
      }
      if (o.cancellation_reason)
        info(a, "Alasan pembatalan: " + o.cancellation_reason);
      button(a, "Lihat riwayat status", async () => {
        const result = await req("/api/customer/orders/" + o.id + "/events");
        let list = a.querySelector(".order-history");
        if (list) list.remove();
        list = node("ul", null, { class: "order-history" });
        for (const e of result.data)
          list.append(
            node(
              "li",
              labels[e.status] +
                " — " +
                e.note +
                " (" +
                new Date(e.created_at).toLocaleString("id-ID") +
                ")",
            ),
          );
        a.append(list);
      });
      if (owner && o.status === "waiting") {
        const actionWrap = node("div", null, {
          class: "mt-3 pt-3 border-t border-white/10 space-y-3",
        });
        const btnRow = node("div", null, {
          class: "flex flex-wrap items-center gap-2.5",
        });
        const acceptBtn = button(
          btnRow,
          o.need_towing
            ? "🚨 Terima Pesanan (Wajib - SOS)"
            : "✓ Terima Pesanan",
          async () => {
            const res = await req(
              "/api/customer/orders/" + o.id + "/status",
              "PATCH",
              { status: "accepted", note: "Pesanan diterima oleh bengkel" },
            );
            await render();
            message.textContent =
              res.message ||
              "Pesanan diterima. Silakan isi rincian biaya dan lanjut ke status Diproses.";
          },
        );
        acceptBtn.style.cssText =
          "background-color:#10b981;color:#060e20;border:1px solid #10b981;font-weight:700;padding:0.55rem 1.15rem;border-radius:0.75rem;";

        const rejectFormWrap = node("div", null, { hidden: "" });
        if (!o.need_towing) {
          const rejectBtn = node("button", "✕ Tolak Pesanan", {
            type: "button",
            "data-action": "reject",
          });
          rejectBtn.style.cssText =
            "background-color:#f43f5e;color:#ffffff;border:1px solid #f43f5e;font-weight:700;padding:0.55rem 1.15rem;border-radius:0.75rem;";
          rejectBtn.addEventListener("click", () => {
            rejectFormWrap.hidden = !rejectFormWrap.hidden;
          });
          btnRow.append(rejectBtn);
        }
        actionWrap.append(btnRow);

        const rf = node("form", null, {
            class:
              "mt-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/5 space-y-2",
          }),
          rReason = choice(
            rf,
            "cancelReason",
            "Alasan penolakan",
            CANCEL_REASONS.partner.map((r) => [r, r]),
          ),
          rNote = field(
            rf,
            "note",
            "Catatan tambahan (opsional)",
            "text",
            "",
            false,
          );
        rNote.maxLength = 400;
        const rSubmit = submit(rf, "Konfirmasi Tolak Pesanan", async () => {
          const res = await req(
            "/api/customer/orders/" + o.id + "/status",
            "PATCH",
            {
              status: "cancelled",
              note: composeCancelNote(rReason.value, rNote.value),
            },
          );
          await render();
          message.textContent = res.message || "Pesanan ditolak.";
        });
        rSubmit.setAttribute("data-action", "reject");
        rSubmit.style.cssText =
          "background-color:#f43f5e;color:#ffffff;border:1px solid #f43f5e;font-weight:700;";
        rejectFormWrap.append(rf);
        actionWrap.append(rejectFormWrap);
        a.append(actionWrap);
      } else if (!(owner && o.need_towing)) {
        let next = owner
          ? {
              accepted: customerConfirmedPayment
                ? ["processing"]
                : ["processing", "cancelled"],
              processing: o.partner_completed_at
                ? []
                : customerConfirmedPayment
                  ? ["completed"]
                  : ["cancelled"],
            }[o.status] || []
          : ["waiting", "accepted"].includes(o.status)
            ? ["cancelled"]
            : [];
        if (next.length) {
          const f = node("form", null),
            status = choice(
              f,
              "status",
              "Ubah status",
              next.map((v) => [
                v,
                v === "completed" ? "Konfirmasi Selesai (Mitra)" : labels[v],
              ]),
            ),
            needsCostInput =
              owner &&
              ["waiting", "accepted"].includes(o.status) &&
              o.confirmed_cost == null &&
              !(o.cost_version > 0),
            costAmount = needsCostInput
              ? field(f, "amount", "Biaya servis (Rp)", "text", "", true)
              : null,
            costDetail = needsCostInput
              ? field(
                  f,
                  "costNote",
                  "Rincian / konfirmasi biaya",
                  "textarea",
                  "",
                  true,
                )
              : null,
            reasons = (
              owner ? CANCEL_REASONS.partner : CANCEL_REASONS.customer
            ).map((r) => [r, r]),
            reason = choice(f, "cancelReason", "Alasan pembatalan", reasons),
            note = field(
              f,
              "note",
              "Catatan tambahan (opsional)",
              "text",
              "",
              false,
            ),
            inlineErr = node("p", "");
          inlineErr.style.cssText =
            "font-size:0.8125rem;font-weight:600;color:#fb7185;margin:0.35rem 0 0 0;";
          if (costAmount) {
            costAmount.inputMode = "numeric";
            costAmount.placeholder = "Contoh: 50000";
            costAmount.addEventListener("input", () => {
              const digits = costAmount.value.replace(/\D/g, "");
              costAmount.value = digits
                ? Number(digits).toLocaleString("id-ID")
                : "";
            });
          }
          if (costDetail) {
            costDetail.maxLength = 500;
            costDetail.placeholder = "Contoh: Jasa tambal ban + ganti pentil";
          }
          note.maxLength = 400;
          const syncFields = () => {
            const c = status.value === "cancelled";
            reason.disabled = !c;
            reason.required = c;
            reason.parentElement.hidden = !c;
            reason.parentElement.style.display = c ? "" : "none";
            if (costAmount && costDetail) {
              const requireCost = status.value === "processing";
              costAmount.disabled = !requireCost;
              costAmount.required = requireCost;
              costAmount.parentElement.hidden = !requireCost;
              costAmount.parentElement.style.display = requireCost
                ? ""
                : "none";
              costDetail.disabled = !requireCost;
              costDetail.required = requireCost;
              costDetail.parentElement.hidden = !requireCost;
              costDetail.parentElement.style.display = requireCost
                ? ""
                : "none";
            }
          };
          status.addEventListener("change", syncFields);
          syncFields();
          submit(f, "Simpan status", async () => {
            inlineErr.textContent = "";
            try {
              const finalNote =
                status.value === "cancelled"
                  ? composeCancelNote(reason.value, note.value)
                  : note.value;
              let payload;
              if (status.value === "completed") {
                payload = {
                  status: "completed",
                  dualConfirm: true,
                  note: finalNote,
                };
              } else if (
                status.value === "processing" &&
                costAmount &&
                !costAmount.disabled
              ) {
                const parsedAmount = Number(
                  String(costAmount.value).replace(/\D/g, ""),
                );
                if (
                  !Number.isSafeInteger(parsedAmount) ||
                  parsedAmount < 1 ||
                  parsedAmount > 1000000000
                ) {
                  throw Error(
                    "Masukkan nominal biaya servis (Rp) yang valid (1 – 1.000.000.000).",
                  );
                }
                if (!costDetail.value.trim()) {
                  throw Error("Masukkan rincian / konfirmasi biaya servis.");
                }
                payload = {
                  status: "processing",
                  withCost: true,
                  amount: parsedAmount,
                  costNote: costDetail.value.trim(),
                  note: finalNote,
                };
              } else {
                payload = { status: status.value, note: finalNote };
              }
              const res = await req(
                "/api/customer/orders/" + o.id + "/status",
                "PATCH",
                payload,
              );
              await render();
              message.textContent =
                res.message ||
                "Status diperbarui dan rincian biaya telah dikirim ke pelanggan.";
            } catch (err) {
              inlineErr.textContent = "⚠️ " + err.message;
              throw err;
            }
          });
          f.append(inlineErr);
          a.append(f);
        }
      }
      root.append(a);
    }
  }
  // ---- Halaman Pesanan Saya (customer) dengan tab Berlangsung / Riwayat ----
  const ACTIVE_STATUSES = ["waiting", "accepted", "processing"];
  const STATUS_STYLE = {
    waiting: {
      icon: "schedule",
      tone: "amber",
      text: "Menunggu konfirmasi bengkel",
    },
    accepted: { icon: "thumb_up", tone: "sky", text: "Diterima bengkel" },
    processing: { icon: "build", tone: "cyan", text: "Sedang dikerjakan" },
    completed: { icon: "task_alt", tone: "emerald", text: "Selesai" },
    cancelled: { icon: "cancel", tone: "rose", text: "Dibatalkan" },
  };
  const TONE = {
    amber: ["bg-amber-500/10", "text-amber-400", "border-amber-500/30"],
    sky: ["bg-sky-500/10", "text-sky-400", "border-sky-500/30"],
    cyan: ["bg-cyan-500/10", "text-cyan-400", "border-cyan-500/30"],
    emerald: ["bg-emerald-500/10", "text-emerald-400", "border-emerald-500/30"],
    rose: ["bg-rose-500/10", "text-rose-400", "border-rose-500/30"],
  };
  const CLS = {
    btnPrimary:
      "h-10 px-4 rounded-xl bg-bengkelin-cyan text-bengkelin-navy font-heading font-bold text-xs hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer border-0",
    btnGhost:
      "h-10 px-4 rounded-xl bg-transparent border border-white/10 text-white text-xs font-medium hover:bg-white/5 transition-all disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5 no-underline",
    btnDanger:
      "h-10 px-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-all disabled:opacity-50 cursor-pointer",
    input:
      "block w-full mt-1 rounded-xl bg-bengkelin-navy border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-bengkelin-cyan",
    label: "block text-xs text-bengkelin-muted",
  };
  const icon = (name) =>
    node("span", name, {
      class: "material-symbols-outlined text-[18px]",
      "aria-hidden": "true",
    });
  const styleField = (input) => {
    input.className = CLS.input;
    input.parentElement.className = CLS.label;
    return input;
  };
  function detailCell(label, value, extra = "") {
    const d = node("div", null);
    d.append(
      node("span", label, { class: "text-bengkelin-muted block" }),
      node("span", value, { class: "font-semibold text-white " + extra }),
    );
    return d;
  }
  function customerCard(o) {
    const st = STATUS_STYLE[o.status] || STATUS_STYLE.waiting,
      tone = TONE[st.tone];
    const card = node("article", null, {
      class:
        "rounded-2xl bg-bengkelin-card border border-white/10 p-5 shadow-lg hover:border-white/20 transition-all" +
        (o.status === "cancelled" ? " opacity-85 hover:opacity-100" : ""),
    });
    // Header: bengkel, jadwal, badge status
    const head = node("div", null, {
      class:
        "flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10",
    });
    const left = node("div", null, { class: "flex items-center gap-3" });
    const box = node("div", null, {
      class:
        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 " +
        tone[0] +
        " " +
        tone[1],
    });
    box.append(icon(st.icon));
    const title = node("div", null);
    title.append(
      node("h3", o.workshop_name, {
        class: "font-heading font-bold text-white text-base m-0",
      }),
      node(
        "p",
        "Pesanan #" +
          o.id +
          " · " +
          new Date(o.scheduled_at).toLocaleString("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        { class: "font-mono text-xs text-bengkelin-muted m-0" },
      ),
    );
    left.append(box, title);
    const badge = node("span", null, {
      class:
        "inline-flex items-center gap-1 px-3 py-1 rounded-full border font-mono text-xs font-semibold self-start sm:self-auto " +
        tone.join(" "),
    });
    badge.append(icon(st.icon), document.createTextNode(" " + st.text));
    head.append(left, badge);
    card.append(head);
    // Detail
    const grid = node("div", null, {
      class: "grid grid-cols-1 sm:grid-cols-3 gap-3 py-3 text-xs",
    });
    grid.append(
      detailCell("Kendaraan:", o.vehicle_type === "mobil" ? "Mobil" : "Motor"),
      detailCell("Layanan:", o.service),
      detailCell(
        "Pembayaran:",
        paymentLabel(o.payment_method, o.payment_status),
        "text-bengkelin-cyan",
      ),
    );
    card.append(grid);
    if (o.notes)
      card.append(
        node("p", "Catatan: " + o.notes, {
          class: "text-xs text-bengkelin-muted pb-3 m-0",
        }),
      );
    // Sisa waktu konfirmasi
    const timerBanner = createCountdownBanner(o);
    if (timerBanner) card.append(timerBanner);
    // Biaya & Pembayaran
    const costApproved =
      o.cost_version > 0 && o.accepted_cost_version === o.cost_version;
    const cost = node("div", null, {
      class:
        "flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-white/5",
    });
    const costInfo = node("div", null);
    costInfo.append(
      node("span", "Biaya dari bengkel:", {
        class: "text-[11px] text-bengkelin-muted block",
      }),
      node("span", money(o.confirmed_cost), {
        class: "font-heading font-bold text-lg text-white",
      }),
    );
    if (o.cost_note)
      costInfo.append(
        node("span", o.cost_note, {
          class: "text-xs text-bengkelin-muted block",
        }),
      );
    if (o.confirmed_cost != null)
      costInfo.append(
        node(
          "span",
          costApproved
            ? "✓ Biaya versi " +
                o.cost_version +
                " sudah Anda setujui (" +
                paymentLabel(o.payment_method, o.payment_status) +
                ")"
            : "Menunggu persetujuan & pilihan pembayaran Anda",
          {
            class:
              "text-xs block mt-1 " +
              (costApproved ? "text-emerald-400" : "text-amber-400"),
          },
        ),
      );
    cost.append(costInfo);
    if (
      ["waiting", "accepted", "processing"].includes(o.status) &&
      o.cost_version > 0 &&
      !costApproved
    ) {
      const payBtns = node("div", null, {
        class: "flex flex-wrap items-center gap-2",
      });
      const bQris = button(
        payBtns,
        "Bayar dengan QRIS " + money(o.confirmed_cost),
        async () => {
          openQrisModal(o, async () => {
            const res = await req(
              "/api/customer/orders/" + o.id + "/cost-approval",
              "POST",
              { version: o.cost_version, paymentMethod: "qris" },
            );
            await render();
            message.textContent =
              res.message ||
              "Pembayaran QRIS selesai dan biaya disetujui. Bengkel telah menerima notifikasi.";
          });
        },
      );
      bQris.className = CLS.btnPrimary;
      const bCod = button(payBtns, "Bayar di Lokasi (COD)", async () => {
        await req("/api/customer/orders/" + o.id + "/cost-approval", "POST", {
          version: o.cost_version,
          paymentMethod: "cod",
        });
        await render();
        message.textContent =
          "Biaya disetujui dengan metode Bayar di Lokasi (COD). Bengkel dapat mulai mengerjakan servis.";
      });
      bCod.className = CLS.btnGhost;
      cost.append(payBtns);
    } else if (
      ["waiting", "accepted", "processing"].includes(o.status) &&
      o.confirmed_cost != null &&
      o.cost_version > 0 &&
      o.payment_status !== "paid"
    ) {
      const bSwitchQris = button(cost, "Bayar Sekarang via QRIS", async () => {
        openQrisModal(o, async () => {
          const res = await req(
            "/api/customer/orders/" + o.id + "/cost-approval",
            "POST",
            { version: o.cost_version, paymentMethod: "qris" },
          );
          await render();
          message.textContent =
            res.message ||
            "Pembayaran QRIS selesai dan notifikasi telah dikirim ke mitra.";
        });
      });
      bSwitchQris.className = CLS.btnGhost;
    }
    card.append(cost);
    // Status Layanan Derek (SOS) untuk Pelanggan
    if (o.need_towing) {
      const sosTop = node("div", "🚨 SOS DEREK — Layanan Penjemputan Darurat", {
        class:
          "inline-block px-3 py-1 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold mb-2",
      });
      card.prepend(sosTop);
      if (["waiting", "accepted", "processing"].includes(o.status)) {
        const towBox = node("div", null, {
          class:
            "mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs",
        });
        const towLabel =
          o.status === "waiting"
            ? "🚨 SOS Derek: Menunggu konfirmasi wajib dari mitra."
            : o.towing_status === "requested"
              ? "🚨 SOS Derek: Mitra menerima pesanan, menunggu konfirmasi mitra menuju lokasi."
              : o.towing_status === "on_the_way"
                ? "🚚 SOS Derek: Mitra sedang menuju lokasi Anda."
                : "✓ SOS Derek: Mitra sudah sampai & sedang menangani layanan.";
        towBox.append(
          node("span", towLabel, { class: "text-rose-200 font-medium" }),
        );
        if (o.status !== "waiting" && o.towing_status === "on_the_way") {
          const arrivedBtn = button(
            towBox,
            "✓ Mitra Sudah Sampai & Menangani",
            async () => {
              const res = await req(
                "/api/orders/" + o.id + "/towing",
                "PATCH",
                { action: "arrived" },
              );
              await render();
              message.textContent = res.message;
            },
          );
          arrivedBtn.className = CLS.btnPrimary;
        }
        card.append(towBox);
      }
    }
    // Konfirmasi Penyelesaian 2 Pihak (Pelanggan & Mitra) — hanya muncul setelah pelanggan menyelesaikan konfirmasi pembayaran (dan untuk derek setelah mitra konfirmasi pembayaran)
    const customerConfirmedPayment =
      o.payment_status === "paid" || costApproved;
    const isCodWaitingPartner =
      o.payment_method === "cod" &&
      o.payment_status !== "paid" &&
      !o.partner_completed_at;
    const readyForCompletion = o.need_towing
      ? o.status === "processing" &&
        o.towing_status === "arrived" &&
        o.payment_status === "paid"
      : o.status === "processing" && customerConfirmedPayment;
    if (readyForCompletion || o.status === "completed") {
      const compBox = node("div", null, {
        class:
          "mt-3 pt-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3",
      });
      const compStatus = node("div", null, { class: "text-xs space-y-1" });
      compStatus.append(
        node(
          "div",
          "Konfirmasi Pelanggan: " +
            (o.customer_completed_at
              ? "✓ Selesai (" +
                new Date(o.customer_completed_at).toLocaleString("id-ID", {
                  dateStyle: "short",
                  timeStyle: "short",
                }) +
                ")"
              : isCodWaitingPartner ||
                  (o.need_towing && !o.partner_completed_at)
                ? "Menunggu konfirmasi selesai dari mitra terlebih dahulu"
                : "Menunggu konfirmasi Anda"),
          {
            class: o.customer_completed_at
              ? "text-emerald-400 font-medium"
              : "text-amber-400",
          },
        ),
        node(
          "div",
          "Konfirmasi Mitra Bengkel: " +
            (o.partner_completed_at
              ? "✓ Selesai (" +
                new Date(o.partner_completed_at).toLocaleString("id-ID", {
                  dateStyle: "short",
                  timeStyle: "short",
                }) +
                ")"
              : "Menunggu konfirmasi mitra"),
          {
            class: o.partner_completed_at
              ? "text-emerald-400 font-medium"
              : "text-bengkelin-muted",
          },
        ),
      );
      compBox.append(compStatus);
      if (
        o.status === "processing" &&
        !o.customer_completed_at &&
        (!o.need_towing || o.towing_status === "arrived")
      ) {
        if (isCodWaitingPartner || (o.need_towing && !o.partner_completed_at)) {
          const waitBadge = node(
            "span",
            "Menunggu konfirmasi selesai dari mitra",
            {
              class:
                "text-xs font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded-xl self-start sm:self-center",
            },
          );
          compBox.append(waitBadge);
        } else {
          const bComplete = button(
            compBox,
            "✓ Konfirmasi Order Selesai",
            async () => {
              const res = await req(
                "/api/customer/orders/" + o.id + "/status",
                "PATCH",
                {
                  status: "completed",
                  dualConfirm: true,
                  note: "Pelanggan mengonfirmasi pesanan servis selesai",
                },
              );
              await render();
              message.textContent =
                res.message ||
                "Konfirmasi penyelesaian pesanan berhasil dikirim.";
            },
          );
          bComplete.className = CLS.btnPrimary;
        }
      }
      card.append(compBox);
    } else if (
      o.need_towing &&
      customerConfirmedPayment &&
      o.payment_status !== "paid"
    ) {
      card.append(
        node(
          "p",
          "⏳ Menunggu mitra mengonfirmasi pembayaran telah diterima sebelum penyelesaian order.",
          { class: "mt-3 text-xs text-amber-300 font-medium" },
        ),
      );
    }
    if (o.cancellation_reason) {
      const c = node("div", null, { class: "pt-3" });
      c.append(
        node("span", "Alasan pembatalan:", {
          class: "text-[11px] text-rose-400 block font-medium",
        }),
        node("span", o.cancellation_reason, {
          class: "text-xs text-bengkelin-muted",
        }),
      );
      card.append(c);
    }
    // Aksi
    const actions = node("div", null, {
      class: "flex flex-wrap items-center gap-2 pt-4",
    });
    if (o.workshop_phone) {
      const tel = link("", "tel:" + o.workshop_phone.replace(/\D/g, ""));
      tel.className = CLS.btnGhost;
      tel.append(icon("call"), document.createTextNode("Hubungi bengkel"));
      actions.append(tel);
    }
    const historyBox = node("div", null, { class: "w-full" });
    const hb = button(actions, "Lihat riwayat status", async () => {
      if (historyBox.firstChild) {
        historyBox.replaceChildren();
        hb.textContent = "Lihat riwayat status";
        return;
      }
      const result = await req("/api/customer/orders/" + o.id + "/events");
      const list = node("ol", null, {
        class:
          "order-history mt-2 space-y-1 text-xs text-bengkelin-muted border-l border-white/10 pl-4",
      });
      for (const e of result.data)
        list.append(
          node(
            "li",
            labels[e.status] +
              (e.note ? " — " + e.note : "") +
              " (" +
              new Date(e.created_at).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              }) +
              ")",
          ),
        );
      historyBox.append(list);
      hb.textContent = "Sembunyikan riwayat";
    });
    hb.className = CLS.btnGhost;
    card.append(actions);
    // Batalkan (hanya waiting/accepted)
    if (["waiting", "accepted"].includes(o.status)) {
      const details = node("details", null, { class: "w-full mt-2" });
      details.append(
        node("summary", "Batalkan pesanan", {
          class: "cursor-pointer text-xs text-rose-300 hover:text-rose-200",
        }),
      );
      const f = node("form", null, { class: "mt-2 space-y-2" }),
        reason = styleField(
          choice(
            f,
            "cancelReason",
            "Alasan pembatalan",
            CANCEL_REASONS.customer.map((r) => [r, r]),
          ),
        ),
        note = styleField(
          field(
            f,
            "note",
            "Catatan tambahan (opsional)",
            "textarea",
            "",
            false,
          ),
        );
      note.maxLength = 400;
      const sb = submit(f, "Konfirmasi pembatalan", async () => {
        await req("/api/customer/orders/" + o.id + "/status", "PATCH", {
          status: "cancelled",
          note: composeCancelNote(reason.value, note.value),
        });
        await render();
        message.textContent = "Pesanan dibatalkan.";
      });
      sb.className = CLS.btnDanger;
      details.append(f);
      card.append(details);
    }
    card.append(historyBox);
    return card;
  }
  async function customerOrders() {
    const active = document.getElementById("ordersActive"),
      history = document.getElementById("ordersHistory");
    const { data } = await req("/api/customer/orders");
    const current = data.filter((o) => ACTIVE_STATUSES.includes(o.status)),
      past = data.filter((o) => !ACTIVE_STATUSES.includes(o.status));
    const count = (id, n) => {
      const e = document.getElementById(id);
      if (e) e.textContent = String(n);
    };
    count("ordersActiveCount", current.length);
    count("ordersHistoryCount", past.length);
    const empty = (id) => document.getElementById(id).content.cloneNode(true);
    active.replaceChildren(
      ...(current.length
        ? current.map(customerCard)
        : [empty("ordersEmptyActive")]),
    );
    history.replaceChildren(
      ...(past.length ? past.map(customerCard) : [empty("ordersEmptyHistory")]),
    );
  }
  async function workshops() {
    const [{ data }, catalog] = await Promise.all([
      req("/api/owner/workshops"),
      req("/api/mitra-services"),
    ]);
    if (!data.length)
      info(root, "Belum ada bengkel. Daftarkan bengkel terlebih dahulu.");
    for (const w of data) {
      const a = node("article", null);
      a.append(node("h2", w.name));
      info(a, "Status: " + labels[w.status]);
      if (w.revision_status)
        info(
          a,
          "Revisi profil: " +
            labels[w.revision_status] +
            (w.revision_note ? " — " + w.revision_note : ""),
        );
      info(
        a,
        "Perubahan profil disimpan sebagai revisi; profil approved lama tetap tampil sampai revisi disetujui.",
      );
      const form = node("form", null),
        fields = {};
      for (const [k, label, type] of [
        ["name", "Nama bengkel", "text"],
        ["address", "Alamat", "textarea"],
        ["phone", "Telepon", "tel"],
        ["lat", "Latitude bengkel", "number"],
        ["lng", "Longitude bengkel", "number"],
      ]) {
        fields[k] = field(form, k, label, type, w[k]);
        if (type === "number") fields[k].step = "any";
      }
      const checks = (name, label, options, values) => {
        const f = node("fieldset", null);
        f.append(node("legend", label));
        const items = options.map(([v, text]) => {
          const wrap = node("label", text),
            input = node("input", null, { type: "checkbox", name, value: v });
          input.checked = values.includes(v);
          wrap.prepend(input);
          f.append(wrap);
          return input;
        });
        form.append(f);
        return () => items.filter((i) => i.checked).map((i) => i.value);
      };
      const vehicles = checks(
          "vehicleTypes",
          "Kategori kendaraan",
          [
            ["motor", "Motor"],
            ["mobil", "Mobil"],
          ],
          w.vehicleTypes || [],
        ),
        services = checks(
          "services",
          "Layanan",
          catalog.services.map((s) => [s, s]),
          w.services,
        );
      const days = checks(
        "days",
        "Hari buka",
        ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"].map(
          (s, i) => [String(i), s],
        ),
        (w.hours?.days || []).map(String),
      );
      const open = field(
          form,
          "open",
          "Jam buka WIB",
          "time",
          w.hours?.open || "08:00",
        ),
        close = field(
          form,
          "close",
          "Jam tutup WIB",
          "time",
          w.hours?.close || "17:00",
        );
      const flags = {};
      for (const [k, label] of [
        [
          "pickup",
          "Penjemputan/derek (memerlukan foto derek yang sudah terdaftar)",
        ],
        ["onsite", "Servis di lokasi pelanggan"],
        ["emergency", "Layanan darurat — menyetujui siap siaga 24 jam"],
        ["open24", "Buka 24 jam"],
      ]) {
        const wrap = node("label", label),
          input = node("input", null, { type: "checkbox" });
        input.checked = Boolean(w[k]);
        wrap.prepend(input);
        form.append(wrap);
        flags[k] = input;
      }
      const capacity = field(
        form,
        "capacity",
        "Kapasitas pesanan bersamaan",
        "number",
        w.booking?.capacity || 1,
      );
      capacity.min = 1;
      capacity.max = 20;
      capacity.step = 1;
      const durationFields = {};
      for (const service of catalog.services) {
        const input = field(
          form,
          "duration-" + service,
          "Durasi " + service + " (menit)",
          "number",
          w.booking?.durations?.[service] || 60,
        );
        input.min = 15;
        input.max = 480;
        input.step = 1;
        durationFields[service] = input;
      }
      const refreshDurations = () => {
        const chosen = services();
        for (const [name, input] of Object.entries(durationFields)) {
          input.disabled = !chosen.includes(name);
          input.parentElement.hidden = input.disabled;
        }
      };
      form.addEventListener("change", refreshDurations);
      refreshDurations();
      const terms = node(
          "label",
          "Saya menyetujui syarat dan kebijakan mitra untuk perubahan ini.",
        ),
        accept = node("input", null, { type: "checkbox", required: "" });
      terms.prepend(accept);
      form.append(
        terms,
        link("Syarat mitra", "/partner-terms.html"),
        link("Privasi mitra", "/partner-privacy.html"),
      );
      submit(form, "Simpan dan ajukan peninjauan ulang", async () => {
        const input = {};
        for (const k of ["name", "address", "phone"])
          input[k] = fields[k].value;
        for (const k of ["lat", "lng"]) input[k] = Number(fields[k].value);
        Object.assign(input, {
          vehicleTypes: vehicles(),
          services: services(),
          booking: {
            capacity: Number(capacity.value),
            durations: Object.fromEntries(
              services().map((name) => [
                name,
                Number(durationFields[name].value),
              ]),
            ),
          },
          hours: {
            days: days().map(Number),
            open: open.value,
            close: close.value,
          },
          termsVersion: catalog.termsVersion,
          termsAccepted: accept.checked,
          privacyAccepted: accept.checked,
          emergencyAccepted: flags.emergency.checked,
        });
        for (const k of Object.keys(flags)) input[k] = flags[k].checked;
        const result = await req("/api/owner/workshops/" + w.id, "PUT", input);
        await render();
        message.textContent = result.message;
      });
      a.append(form);
      const upload = document.createElement("form");
      const shop = field(
        upload,
        "workshopPhotos",
        "Foto bengkel pengganti (1–4 foto)",
        "file",
      );
      shop.multiple = true;
      shop.accept = "image/jpeg,image/png,image/webp";
      const tow = field(
        upload,
        "towPhoto",
        "Foto derek pengganti (opsional)",
        "file",
        "",
        false,
      );
      tow.accept = shop.accept;
      submit(upload, "Ajukan perubahan foto", async () => {
        const data = new FormData();
        for (const photo of shop.files) data.append("workshopPhotos", photo);
        if (tow.files[0]) data.append("towPhoto", tow.files[0]);
        const result = await Bengkel.request(
          "/api/owner/workshops/" + w.id + "/photos",
          { method: "POST", body: data },
        );
        message.textContent = result.message;
        upload.reset();
      });
      a.append(upload);
      root.append(a);
    }
  }
  async function settings() {
    info(root, "Akun: " + user.email);
    root.append(node("h2", "Ganti password"));
    const form = node("form", null),
      current = field(form, "currentPassword", "Password saat ini", "password"),
      password = field(form, "password", "Password baru", "password"),
      confirm = field(
        form,
        "confirmation",
        "Konfirmasi password baru",
        "password",
      );
    password.minLength = 8;
    submit(form, "Ganti password dan keluarkan sesi lama", async () => {
      if (password.value !== confirm.value)
        throw Error("Konfirmasi password tidak cocok.");
      await req("/api/account/password", "POST", {
        currentPassword: current.value,
        password: password.value,
      });
      location.assign("/login.html");
    });
    root.append(form, node("h2", "Hapus akun"));
    info(
      root,
      "Akun dinonaktifkan dan email login dianonimkan. Riwayat layanan tetap disimpan. Pesanan aktif harus diselesaikan/dibatalkan; pengajuan bengkel akan dinonaktifkan.",
    );
    const deletion = node("form", null),
      pass = field(
        deletion,
        "password",
        "Password untuk penghapusan",
        "password",
      ),
      confirmation = field(deletion, "confirmation", "Ketik HAPUS AKUN");
    submit(deletion, "Hapus akun saya", async () => {
      await req("/api/account", "DELETE", {
        password: pass.value,
        confirmation: confirmation.value,
      });
      location.assign("/");
    });
    root.append(deletion);
  }
  async function render() {
    if (root) root.replaceChildren();
    if (!user) user = (await req("/api/me")).user;
    await {
      detail,
      orders: () =>
        document.getElementById("ordersActive")
          ? customerOrders()
          : orders(false),
      "owner-orders": () => orders(true),
      "owner-workshops": workshops,
      "account-settings": settings,
    }[feature]();
  }
  if (["orders", "owner-orders"].includes(feature)) {
    const safeRefresh = () => {
      if (actionBusy || document.hidden) return;
      const activeEl = document.activeElement;
      if (
        activeEl &&
        root &&
        root.contains(activeEl) &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName)
      )
        return;
      render().catch(() => {});
    };
    window.addEventListener("bengkel:notification", safeRefresh);
    document.addEventListener("visibilitychange", safeRefresh);
  }
  render().catch((e) => {
    if (message) message.textContent = e.message;
    else console.error(e);
  });
})();
