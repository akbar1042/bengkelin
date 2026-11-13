const container = document.getElementById("pending"),
  message = document.getElementById("message");

function badgeEl(text, variant = "cyan") {
  const span = document.createElement("span");
  const styles = {
    cyan: "bg-[#4cd7f6]/10 text-[#4cd7f6] border-[#4cd7f6]/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    rose: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    slate: "bg-white/5 text-slate-300 border-white/10",
  };
  span.className = `inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${styles[variant] || styles.cyan}`;
  span.textContent = text;
  return span;
}

async function loadPending() {
  if (!container) return;
  try {
    const data = await Bengkel.request("/api/admin/partners");
    container.replaceChildren();
    const pendingBadge = document.getElementById("pendingCountBadge");
    if (pendingBadge)
      pendingBadge.textContent = `${data.data.length} Pengajuan`;

    if (!data.data.length) {
      container.innerHTML =
        '<div class="rounded-2xl border border-white/10 bg-[#1a243b]/60 p-6 text-center text-sm text-slate-400 md:col-span-2">Tidak ada pendaftaran atau revisi profil mitra yang menunggu keputusan.</div>';
      return;
    }

    for (const row of data.data) {
      const section = document.createElement("section");
      section.className =
        "rounded-2xl border border-white/10 bg-[#1a243b] p-5 sm:p-6 shadow-lg space-y-4 transition-all hover:border-[#4cd7f6]/35";

      const headerRow = document.createElement("div");
      headerRow.className =
        "flex flex-wrap items-start justify-between gap-2 border-b border-white/10 pb-3";

      const title = document.createElement("h3");
      title.className = "text-lg font-headline font-bold text-white m-0";
      title.textContent = (row.isRevision ? "Revisi Profil — " : "") + row.name;

      headerRow.append(
        title,
        badgeEl(
          row.isRevision ? "Revisi Profil" : "Pendaftaran Baru",
          row.isRevision ? "amber" : "cyan",
        ),
      );
      section.append(headerRow);

      const info = document.createElement("div");
      info.className =
        "grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-300 bg-[#0b1326]/60 p-3.5 rounded-xl border border-white/5";
      const makeField = (lbl, val) => {
        const d = document.createElement("div");
        const l = document.createElement("span");
        l.className =
          "block text-[10px] uppercase tracking-wider text-slate-400 font-semibold";
        l.textContent = lbl;
        const v = document.createElement("span");
        v.className = "font-medium text-slate-100 break-words";
        v.textContent = val;
        d.append(l, v);
        return d;
      };
      info.append(
        makeField("Email Pemilik", row.owner_email),
        makeField("Telepon", row.phone),
        makeField("Alamat", row.address),
        makeField("Koordinat", `${row.lat}, ${row.lng}`),
        makeField(
          "Kategori Kendaraan",
          (row.vehicleTypes?.join(" / ") || "Belum diisi").toUpperCase(),
        ),
        makeField(
          "Jam Operasional",
          row.hours
            ? `${row.hours.open}–${row.hours.close} WIB${row.open24 ? " (24 Jam)" : ""}`
            : "Belum diisi",
        ),
        makeField("Layanan", (row.services || []).join(", ") || "—"),
        makeField(
          "Fasilitas",
          [
            row.pickup ? "Jemput/Derek" : null,
            row.onsite ? "Servis di Lokasi" : null,
            row.emergency ? "Darurat 24 Jam" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Standar Bengkel",
        ),
      );
      section.append(info);

      if ((row.photos || []).length) {
        const photoWrap = document.createElement("div");
        photoWrap.className = "flex flex-wrap items-center gap-2 pt-1";
        for (const photo of row.photos || []) {
          const link = document.createElement("a");
          link.href = photo.url;
          link.target = "_blank";
          link.rel = "noopener";
          link.className =
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#4cd7f6]/10 text-[#4cd7f6] border border-[#4cd7f6]/30 hover:bg-[#4cd7f6] hover:text-slate-950 transition-all";
          link.textContent =
            photo.kind === "tow"
              ? "📷 Foto Kendaraan Derek"
              : "📷 Foto Bengkel";
          photoWrap.append(link);
        }
        section.append(photoWrap);
      }

      const formFields = document.createElement("div");
      formFields.className = "space-y-3 pt-2 border-t border-white/10";

      const noteLabel = document.createElement("label"),
        note = document.createElement("input");
      note.id = "note-" + row.id;
      note.maxLength = 500;
      note.placeholder =
        "Masukkan catatan persetujuan atau alasan penolakan...";
      noteLabel.htmlFor = note.id;
      noteLabel.textContent = "Catatan keputusan";
      noteLabel.className =
        "block text-xs font-semibold uppercase tracking-wider text-slate-300";
      note.className =
        "mt-1.5 w-full rounded-xl border border-white/15 bg-[#060e20]/85 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-[#4cd7f6] focus:ring-1 focus:ring-[#4cd7f6]";
      noteLabel.append(note);

      const placeLabel = document.createElement("label"),
        place = document.createElement("input");
      place.id = "place-" + row.id;
      place.maxLength = 255;
      place.placeholder = "Opsional: ChIJ...";
      placeLabel.htmlFor = place.id;
      placeLabel.textContent = "Google Place ID terverifikasi (opsional)";
      placeLabel.className =
        "block text-xs font-semibold uppercase tracking-wider text-slate-300";
      place.className =
        "mt-1.5 w-full rounded-xl border border-white/15 bg-[#060e20]/85 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-[#4cd7f6] focus:ring-1 focus:ring-[#4cd7f6]";
      placeLabel.append(place);

      formFields.append(noteLabel, placeLabel);
      section.append(formFields);

      const btnWrap = document.createElement("div");
      btnWrap.className = "flex flex-wrap items-center gap-2.5 pt-2";
      const actionButtons = [];
      for (const [status, label] of [
        ["approved", "✓ Setujui Mitra"],
        ["rejected", "✕ Tolak Pengajuan"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.className =
          status === "approved"
            ? "px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            : "px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/35 text-xs font-bold transition-all cursor-pointer disabled:opacity-50";
        actionButtons.push(button);
        button.addEventListener("click", async () => {
          if (button.disabled || section.dataset.busy === "true") return;
          section.dataset.busy = "true";
          for (const btn of actionButtons) btn.disabled = true;
          note.disabled = true;
          place.disabled = true;
          try {
            const data = await Bengkel.request(
              `/api/admin/partners/${row.id}/review`,
              Bengkel.json("POST", {
                status,
                note: note.value,
                googlePlaceId: place.value.trim() || null,
                reviewVersion: row.reviewVersion,
              }),
            );
            if (message) message.textContent = data.message;
            await Promise.all([loadPending(), loadActivePartners()]);
            window.dispatchEvent(new Event("partners-updated"));
          } catch (error) {
            if (message) message.textContent = error.message;
            delete section.dataset.busy;
            for (const btn of actionButtons) btn.disabled = false;
            note.disabled = false;
            place.disabled = false;
          }
        });
        btnWrap.append(button);
      }
      section.append(btnWrap);
      container.append(section);
    }
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}

let activeList = document.getElementById("activePartnersList");
if (!activeList && container) {
  const activePartners = document.createElement("section");
  activePartners.className =
    "mt-8 bg-[#131b2e]/90 backdrop-blur border border-white/10 rounded-3xl p-6 shadow-xl space-y-4";
  const activeHeading = document.createElement("h2");
  activeHeading.className = "text-lg font-headline font-bold text-white";
  activeHeading.textContent = "Mitra aktif";
  activeList = document.createElement("div");
  activeList.id = "activePartnersList";
  activeList.className = "grid gap-4 md:grid-cols-2";
  activePartners.append(activeHeading, activeList);
  container.after(activePartners);
}

async function loadActivePartners() {
  if (!activeList) return;
  try {
    const { data } = await Bengkel.request("/api/admin/partners/active");
    activeList.replaceChildren();
    const activeBadge = document.getElementById("activePartnersCountBadge");
    if (activeBadge) activeBadge.textContent = `${data.length} Mitra Aktif`;

    if (!data.length) {
      activeList.innerHTML =
        '<div class="rounded-2xl border border-white/10 bg-[#1a243b]/60 p-6 text-center text-sm text-slate-400 md:col-span-2">Belum ada mitra aktif yang disetujui.</div>';
      return;
    }
    for (const workshop of data) {
      const form = document.createElement("form");
      form.className =
        "rounded-2xl border border-white/10 bg-[#1a243b] p-5 space-y-3.5 transition-all hover:border-[#4cd7f6]/35 flex flex-col justify-between";

      const topBox = document.createElement("div");
      topBox.className = "space-y-2";

      const head = document.createElement("div");
      head.className = "flex items-start justify-between gap-2";
      const title = document.createElement("h3");
      title.className = "text-base font-headline font-bold text-white m-0";
      title.textContent = workshop.name;
      head.append(title, badgeEl("Mitra Resmi", "emerald"));

      const meta = document.createElement("p");
      meta.className = "text-xs text-slate-300 leading-relaxed m-0";
      meta.textContent = `${workshop.address || "—"} · Telp: ${workshop.phone || "—"} · Layanan: ${(workshop.services || []).join(", ")}`;

      topBox.append(head, meta);

      const bottomBox = document.createElement("div");
      bottomBox.className = "pt-3 border-t border-white/10 space-y-2.5";

      const label = document.createElement("label");
      label.className =
        "block text-xs font-semibold uppercase tracking-wider text-slate-300";
      label.textContent = "Alasan pencabutan";
      const note = document.createElement("input");
      note.required = true;
      note.maxLength = 500;
      note.placeholder = "Isi alasan pencabutan status mitra...";
      note.className =
        "mt-1.5 w-full rounded-xl border border-white/15 bg-[#060e20]/85 px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400";
      label.append(note);

      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Cabut status mitra";
      button.className =
        "px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/35 text-xs font-bold transition-all cursor-pointer disabled:opacity-50";

      bottomBox.append(label, button);
      form.append(topBox, bottomBox);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (button.disabled || form.dataset.busy === "true") return;
        form.dataset.busy = "true";
        button.disabled = true;
        note.disabled = true;
        try {
          const result = await Bengkel.request(
            `/api/admin/partners/${workshop.partnerId}/revoke`,
            Bengkel.json("POST", { note: note.value }),
          );
          if (message) message.textContent = result.message;
          await Promise.all([loadPending(), loadActivePartners()]);
          window.dispatchEvent(new Event("partners-updated"));
        } catch (error) {
          if (message) message.textContent = error.message;
          delete form.dataset.busy;
          button.disabled = false;
          note.disabled = false;
        }
      });
      activeList.append(form);
    }
  } catch (error) {
    activeList.textContent = error.message;
  }
}

document.getElementById("refreshDashboard")?.addEventListener("click", () => {
  loadPending();
  loadActivePartners();
});

loadPending();
loadActivePartners();
