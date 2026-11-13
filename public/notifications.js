(() => {
  let last = 0,
    active = true,
    timer = null;
  let before = null,
    nextBefore = null,
    requestVersion = 0;
  const list = document.getElementById("notificationList");
  const heading = document.getElementById("notificationTitle");
  const nav =
    document.querySelector("header nav") || document.querySelector("nav");
  if (!nav) return;
  const badge = document.createElement("a");
  badge.href = "/notifications.html";
  badge.textContent = "Notifikasi";
  const bell = document.querySelector(
    'header a[href="/notifications.html"][title="Notifikasi"]',
  );
  if (!bell) nav.append(badge);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.className = "sr-only";
  nav.after(status);
  async function refresh() {
    if (!active || document.hidden) return;
    const version = ++requestVersion;
    try {
      const query = before ? "?" + new URLSearchParams({ before }) : "";
      const response = await fetch("/api/notifications" + query, {
        cache: "no-store",
      });
      if (version !== requestVersion) return;
      if (response.status === 401) {
        active = false;
        return;
      }
      if (!response.ok) return;
      const body = await response.json();
      if (version !== requestVersion) return;
      if (heading)
        heading.textContent =
          body.role === "partner" ? "Notifikasi Mitra" : "Notifikasi Aktivitas";
      nextBefore = body.nextBefore;
      updateControls();
      const unread =
        body.unreadCount ?? body.data.filter((n) => !n.read_at).length;
      const hasRealBell = bell && typeof bell.querySelector === "function";
      if (hasRealBell) {
        const label = unread
          ? `Notifikasi (${unread} belum dibaca)`
          : "Notifikasi";
        bell.setAttribute("aria-label", label);

        const dot = bell.querySelector("[data-notification-dot]");
        if (dot) dot.hidden = unread === 0;
      } else {
        badge.textContent = unread ? `Notifikasi (${unread})` : "Notifikasi";
      }
      const latest = body.data[0]?.id || 0;
      if (!before) {
        if (last && latest > last) {
          status.textContent = "Ada notifikasi baru.";
          window.dispatchEvent(
            new CustomEvent("bengkel:notification", { detail: body.data[0] }),
          );
        }
        last = latest;
      }
      if (list) {
        list.replaceChildren();
        if (!body.data.length) {
          const p = document.createElement("p");
          p.textContent = "Belum ada notifikasi.";
          list.append(p);
        }
        for (const n of body.data) {
          const row = document.createElement("article"),
            title = document.createElement("h2"),
            text = document.createElement("p"),
            a = document.createElement("a");
          const isSos =
            Boolean(n.need_towing) || (n.title && n.title.includes("SOS"));
          if (isSos) {
            row.style.cssText =
              "border:1px solid rgba(244,63,94,0.55);background:rgba(244,63,94,0.08);";
            title.style.color = "#fda4af";
          }
          title.textContent =
            isSos && !n.title.includes("SOS")
              ? "🚨 [SOS DEREK] " + n.title
              : n.title;
          text.textContent = n.message;
          const partnerOrder = n.audience === "partner";
          a.href = n.order_id
            ? partnerOrder
              ? "/owner-orders.html"
              : "/orders.html"
            : "/help.html";
          a.textContent = n.order_id
            ? partnerOrder
              ? "Buka pesanan bengkel"
              : "Buka pesanan saya"
            : "Buka pusat bantuan";
          row.append(title, text, a);
          if (!n.read_at) {
            const button = document.createElement("button");
            button.textContent = "Tandai dibaca";
            button.addEventListener("click", async () => {
              if (button.disabled) return;
              button.disabled = true;
              try {
                await Bengkel.request(
                  "/api/notifications/" + n.id + "/read",
                  Bengkel.json("PATCH", {}),
                );
                await refresh();
              } catch (e) {
                status.textContent = e.message;
                button.disabled = false;
              }
            });
            row.append(button);
          }
          list.append(row);
        }
      }
    } catch {
      /* Retry at the next poll without disrupting the user's form. */
    }
  }
  let older, newest;
  function updateControls() {
    if (older) older.disabled = !nextBefore;
    if (newest) newest.disabled = !before;
  }
  if (list) {
    const controls = document.createElement("div");
    const control = (text, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", action);
      controls.append(button);
      return button;
    };
    newest = control("Kembali ke notifikasi terbaru", () => {
      before = null;
      refresh();
    });
    older = control("Notifikasi lebih lama", () => {
      if (nextBefore) {
        before = nextBefore;
        refresh();
      }
    });
    control("Tandai semua dibaca", async (event) => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      try {
        const result = await Bengkel.request(
          "/api/notifications/read-all",
          Bengkel.json("PATCH", {}),
        );
        status.textContent = result.message;
        await refresh();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    list.before(controls);
    updateControls();
  }
  function start() {
    if (timer === null) timer = setInterval(refresh, 20000);
    refresh();
  }
  window.addEventListener("pagehide", () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  });
  window.addEventListener("pageshow", () => {
    active = true;
    start();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  start();
})();
