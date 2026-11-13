(() => {
  const $ = (id) => document.getElementById(id),
    status = $("supportStatus");
  const request = (url, method = "GET", body) =>
    Bengkel.request(
      url,
      body === undefined ? { method } : Bengkel.json(method, body),
    );
  const p = (parent, text) => {
    const e = document.createElement("p");
    e.textContent = text;
    parent.append(e);
    return e;
  };
  function show(role, text, sources = []) {
    const row = document.createElement("article");
    row.dataset.role = role;
    p(row, role === "user" ? "Anda" : "AI Customer Service Bengkelin");
    p(row, text);
    for (const source of sources) {
      const a = document.createElement("a");
      a.textContent = source.title;
      a.href = source.url;
      a.className =
        "inline-block mt-2 text-xs text-bengkelin-cyan underline hover:text-white";
      row.append(a);
    }
    $("supportLog").append(row);
  }
  if ($("supportForm")) {
    let chatBusy = false;
    request("/api/support/messages")
      .then((data) =>
        data.messages.forEach((m) => show(m.role, m.content, m.sources)),
      )
      .catch((e) => (status.textContent = e.message));
    $("supportForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (chatBusy || $("supportSend").disabled || $("supportReset").disabled)
        return;
      const message = $("supportMessage").value.trim();
      if (!message) return;
      chatBusy = true;
      $("supportSend").disabled = true;
      $("supportReset").disabled = true;
      status.textContent = "Memeriksa pertanyaan…";
      try {
        const data = await request("/api/support/chat", "POST", { message });
        show("user", message);
        show("assistant", data.answer, data.sources);
        $("supportMessage").value = "";
        status.textContent =
          "Jawaban tersedia. Gunakan tautan sumber untuk melihat rincian.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        chatBusy = false;
        $("supportSend").disabled = false;
        $("supportReset").disabled = false;
      }
    });
    $("supportReset").addEventListener("click", async () => {
      if (chatBusy || $("supportReset").disabled || $("supportSend").disabled)
        return;
      chatBusy = true;
      $("supportReset").disabled = true;
      $("supportSend").disabled = true;
      try {
        await request("/api/support/messages", "DELETE");
        $("supportLog").replaceChildren();
        status.textContent = "Percakapan baru siap.";
      } catch (e) {
        status.textContent = e.message;
      } finally {
        chatBusy = false;
        $("supportReset").disabled = false;
        $("supportSend").disabled = false;
      }
    });
  }
})();

(() => {
  const $ = (id) => document.getElementById(id);
  const admin = document.body.dataset.supportAdmin === "true";
  const base = admin ? "/api/admin/support-tickets" : "/api/support/tickets";
  const list = $("ticketList");
  const filter = $("ticketFilter");
  if (!filter || !list) return;
  const log = $("ticketLog");
  const replyForm = $("ticketReplyForm");
  const replyInput = $("ticketReply");
  const closeButton = $("closeTicket");
  const status = $("ticketStatus");
  const dateFormat = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  let before,
    nextBefore,
    selectedId,
    listVersion = 0,
    threadVersion = 0;
  let listSnapshot,
    threadSnapshot,
    busy = false,
    refreshing = false;

  function updateSelection() {
    for (const button of list.querySelectorAll("button")) {
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.ticketId) === selectedId),
      );
    }
  }

  async function loadList() {
    const version = ++listVersion;
    const params = new URLSearchParams({ status: filter.value });
    if (before) params.set("before", before);
    const { data, nextBefore: next } = await Bengkel.request(
      base + "?" + params,
    );
    if (version !== listVersion) return;
    nextBefore = next;
    $("newestTickets").hidden = !before;
    $("olderTickets").hidden = !nextBefore;
    const snapshot = JSON.stringify(data);
    if (listSnapshot === snapshot) return;
    listSnapshot = snapshot;
    list.replaceChildren();
    if (!data.length) {
      const item = document.createElement("li");
      item.textContent =
        filter.value === "open"
          ? "Tidak ada tiket terbuka."
          : "Tidak ada tiket ditutup.";
      list.append(item);
    }
    for (const ticket of data) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const preview = document.createElement("small");
      button.type = "button";
      button.dataset.ticketId = ticket.id;
      button.textContent =
        "Tiket #" + ticket.id + (admin ? " · " + ticket.customer_email : "");
      preview.textContent =
        ticket.message.length > 80
          ? ticket.message.slice(0, 80) + "…"
          : ticket.message;
      button.append(preview);
      button.addEventListener("click", () => {
        openThread(ticket.id).catch(showError);
      });
      item.append(button);
      list.append(item);
    }
    updateSelection();
  }

  async function loadThread() {
    if (!selectedId) return;
    const version = ++threadVersion;
    const ticket = await Bengkel.request(base + "/" + selectedId);
    if (version !== threadVersion) return;
    $("ticketThread").hidden = false;
    $("ticketTitle").textContent =
      "Tiket #" +
      ticket.id +
      (ticket.status === "open" ? " · Terbuka" : " · Ditutup");
    replyForm.hidden = ticket.status !== "open";
    if (closeButton) closeButton.hidden = ticket.status !== "open";
    const snapshot = JSON.stringify(ticket.messages);
    if (threadSnapshot === snapshot) return;
    const scrollToEnd =
      threadSnapshot === undefined ||
      log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    threadSnapshot = snapshot;
    log.replaceChildren();
    for (const message of ticket.messages) {
      const bubble = document.createElement("div");
      const author = document.createElement("strong");
      const text = document.createElement("p");
      const time = document.createElement("small");
      const mine = message.role === (admin ? "admin" : "customer");
      bubble.className = "ticket-bubble";
      bubble.toggleAttribute("data-mine", mine);
      author.textContent = mine
        ? "Anda"
        : message.role === "admin"
          ? "Admin"
          : "Pelanggan";
      text.textContent = message.content;
      time.textContent = dateFormat.format(new Date(message.created_at));
      bubble.append(author, text, time);
      log.append(bubble);
    }
    if (scrollToEnd) log.scrollTop = log.scrollHeight;
  }

  async function openThread(id) {
    if (busy || id === selectedId) return;
    selectedId = id;
    threadSnapshot = undefined;
    replyInput.value = "";
    $("ticketThread").hidden = true;
    status.textContent = "";
    updateSelection();
    await loadThread();
    if (selectedId === id && !$("ticketThread").hidden)
      $("ticketTitle").focus();
  }

  function showError(error) {
    status.textContent = error.message;
  }

  async function refresh(showErrors = false) {
    if (refreshing || busy) return;
    refreshing = true;
    try {
      await Promise.all([loadList(), loadThread()]);
    } catch (error) {
      if (showErrors) showError(error);
    } finally {
      refreshing = false;
    }
  }

  function changePage(cursor) {
    before = cursor;
    loadList().catch(showError);
  }

  filter.addEventListener("change", () => changePage(undefined));
  $("refreshTickets").addEventListener("click", () => refresh(true));
  $("newestTickets").addEventListener("click", () => changePage(undefined));
  $("olderTickets").addEventListener("click", () => changePage(nextBefore));

  async function send(button, action) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
      button.disabled = false;
      // Refresh directly to supersede any request that was in flight before the write.
      Promise.all([loadList(), loadThread()]).catch(showError);
    }
  }

  $("ticketForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("ticketMessage");
    const message = input.value.trim();
    if (!message) return;
    send(event.currentTarget.querySelector("button"), async () => {
      const result = await Bengkel.request(
        base,
        Bengkel.json("POST", { message }),
      );
      input.value = "";
      filter.value = "open";
      before = undefined;
      selectedId = result.id;
      threadSnapshot = undefined;
      replyInput.value = "";
      $("ticketThread").hidden = true;
      status.textContent = result.message;
    });
  });

  replyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = replyInput.value.trim();
    if (!message) return;
    send(event.currentTarget.querySelector("button"), async () => {
      const result = await Bengkel.request(
        base + "/" + selectedId + "/messages",
        Bengkel.json("POST", { message }),
      );
      replyInput.value = "";
      threadSnapshot = undefined;
      status.textContent = result.message;
    });
  });

  closeButton?.addEventListener("click", () => {
    send(closeButton, async () => {
      const result = await Bengkel.request(
        base + "/" + selectedId,
        Bengkel.json("PATCH", { status: "closed" }),
      );
      status.textContent = result.message;
    });
  });

  refresh(true);
  function refreshVisible() {
    if (!document.hidden) refresh();
  }
  document.addEventListener("visibilitychange", refreshVisible);
  setInterval(refreshVisible, 10000);
})();
