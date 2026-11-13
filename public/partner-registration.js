(() => {
  const $ = (id) => document.getElementById(id),
    form = $("partnerForm");
  let account = null,
    version = "",
    busy = false,
    submitted = false;
  const selected = (name) =>
    [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(
      (n) => n.value,
    );
  function refresh() {
    $("accountPasswordConfirm").setCustomValidity(
      !account &&
        $("accountPassword").value !== $("accountPasswordConfirm").value
        ? "Konfirmasi password tidak cocok."
        : "",
    );
    $("towPhoto").required = $("pickup").checked;
    $("towGroup").hidden = !$("pickup").checked;
    $("emergencyBox").hidden = !$("emergency").checked;
    $("emergencyAccepted").required = $("emergency").checked;
    $("openTime").required = !$("open24").checked;
    $("closeTime").required = !$("open24").checked;
    $("openTime").disabled = $("open24").checked;
    $("closeTime").disabled = $("open24").checked;
    const serviceCount = selected("services").length;
    const valid =
      form.checkValidity() &&
      selected("vehicleTypes").length > 0 &&
      selected("days").length > 0 &&
      serviceCount >= 1 &&
      serviceCount <= 20 &&
      version !== "" &&
      $("workshopPhotos").files.length > 0 &&
      (!$("pickup").checked || $("towPhoto").files.length > 0) &&
      (!$("emergency").checked || $("emergencyAccepted").checked);
    $("send").disabled = !valid || busy || submitted;
  }
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  $("useLocation").addEventListener("click", () => {
    if ($("useLocation").disabled || busy) return;
    $("useLocation").disabled = true;
    $("message").textContent =
      "Meminta izin lokasi bengkel. Pastikan Anda berada di bengkel.";
    const fail = (error) => {
      $("useLocation").disabled = false;
      $("manualCoordinates").hidden = false;
      $("lat").readOnly = false;
      $("lng").readOnly = false;
      $("message").textContent =
        error?.code === 1
          ? "Izin lokasi tidak diberikan. Isi latitude dan longitude bengkel secara manual."
          : "Lokasi belum tersedia. Isi latitude dan longitude bengkel secara manual.";
      refresh();
    };
    if (!navigator.geolocation || !isSecureContext) return fail();
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          $("lat").value = p.coords.latitude;
          $("lng").value = p.coords.longitude;
          $("lat").readOnly = true;
          $("lng").readOnly = true;
          $("manualCoordinates").hidden = true;
          $("message").textContent =
            "Lokasi diperoleh. Periksa nama wilayah dan alamat bengkel.";
          await BengkelRegion.render(
            $("regionName"),
            p.coords.latitude,
            p.coords.longitude,
            () => true,
            !account,
          );
          refresh();
        } finally {
          $("useLocation").disabled = false;
        }
      },
      fail,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
  $("manualLocation").addEventListener("click", () => {
    $("manualCoordinates").hidden = false;
    $("lat").readOnly = false;
    $("lng").readOnly = false;
  });
  $("checkRegion").addEventListener("click", async () => {
    if ($("checkRegion").disabled || busy || !$("lat").value || !$("lng").value)
      return;
    $("checkRegion").disabled = true;
    try {
      await BengkelRegion.render(
        $("regionName"),
        Number($("lat").value),
        Number($("lng").value),
        () => true,
        !account,
      );
    } finally {
      $("checkRegion").disabled = false;
    }
  });
  for (const id of ["lat", "lng"])
    $(id).addEventListener("input", () => {
      $("regionName").textContent =
        "Periksa nama wilayah setelah mengisi titik bengkel.";
    });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    refresh();
    if ($("send").disabled) return;
    $("termsAccepted").checked = false;
    $("privacyAccepted").checked = false;
    $("confirmTerms").disabled = true;
    $("partnerTerms").showModal();
  });
  for (const id of ["termsAccepted", "privacyAccepted"])
    $(id).addEventListener("change", () => {
      $("confirmTerms").disabled =
        !$("termsAccepted").checked || !$("privacyAccepted").checked || busy;
    });
  $("cancelTerms").addEventListener("click", () => $("partnerTerms").close());
  $("confirmTerms").addEventListener("click", async () => {
    if (busy || !$("termsAccepted").checked || !$("privacyAccepted").checked)
      return;
    busy = true;
    $("confirmTerms").disabled = true;
    refresh();
    $("message").textContent = "Mengirim pengajuan dan persetujuanâ€¦";
    try {
      const input = {};
      for (const key of ["name", "address", "phone"])
        input[key] = $(key).value.trim();
      Object.assign(input, {
        lat: Number($("lat").value),
        lng: Number($("lng").value),
        services: selected("services"),
        vehicleTypes: selected("vehicleTypes"),
        hours: {
          days: selected("days").map(Number),
          open: $("open24").checked ? "00:00" : $("openTime").value,
          close: $("open24").checked ? "00:00" : $("closeTime").value,
        },
        termsAccepted: true,
        privacyAccepted: true,
        termsVersion: version,
        emergencyAccepted:
          $("emergency").checked && $("emergencyAccepted").checked,
      });
      for (const key of ["pickup", "onsite", "emergency", "open24"])
        input[key] = $(key).checked;
      const data = new FormData();
      data.append("data", JSON.stringify(input));
      for (const photo of $("workshopPhotos").files)
        data.append("workshopPhotos", photo);
      if (input.pickup) data.append("towPhoto", $("towPhoto").files[0]);
      if (!account)
        data.append(
          "account",
          JSON.stringify({
            email: $("accountEmailInput").value.trim(),
            password: $("accountPassword").value,
          }),
        );
      const response = await Bengkel.request(
        account ? "/api/partners" : "/api/mitra-register",
        { method: "POST", body: data },
        Boolean(account),
      );
      submitted = true;
      $("partnerTerms").close();
      $("message").textContent = response.message;
      const link = document.createElement("a");
      link.href = response.redirect;
      link.textContent = account
        ? "Lihat status pengajuan"
        : "Masuk untuk melihat status pengajuan";
      $("message").append(document.createElement("br"), link);
    } catch (error) {
      $("partnerTerms").close();
      $("message").textContent = error.message;
    } finally {
      busy = false;
      refresh();
    }
  });
  (async () => {
    try {
      const [catalog, me] = await Promise.all([
        Bengkel.request("/api/mitra-services", {}, false),
        fetch("/api/me", { cache: "no-store" }).then(async (r) =>
          r.ok ? (await r.json()).user : null,
        ),
      ]);
      account = me;
      version = catalog.termsVersion;
      const services = $("services");
      for (const service of catalog.services) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = "services";
        input.value = service;
        label.append(input, service);
        services.append(label);
      }
      $("accountFields").hidden = Boolean(account);
      for (const node of $("accountFields").querySelectorAll("input")) {
        node.required = !account;
        node.disabled = Boolean(account);
      }
      if (account) {
        $("accountStatus").textContent = "Mengajukan sebagai " + account.email;
        const mine = await Bengkel.request("/api/partners/mine");
        for (const row of mine.data) {
          const li = document.createElement("li");
          li.textContent =
            row.name +
            " â€” " +
            row.status +
            (row.review_note ? " â€” " + row.review_note : "");
          $("mine").append(li);
        }
      }
      refresh();
    } catch (e) {
      $("message").textContent = e.message;
    }
  })();
})();
