const chatForm = document.getElementById("chatForm");
const chatLog = document.getElementById("chatLog");
const chatStatus = document.getElementById("chatStatus");
const chatInput = document.getElementById("chatMessage");
const chatSend = document.getElementById("chatSend");
const chatReset = document.getElementById("chatReset");
const initialWelcomeCard = document.getElementById("aiWelcomeCard")
  ? document.getElementById("aiWelcomeCard").cloneNode(true)
  : null;

function ensureWelcomeCard() {
  if (
    chatLog &&
    initialWelcomeCard &&
    !document.getElementById("aiWelcomeCard")
  ) {
    chatLog.prepend(initialWelcomeCard.cloneNode(true));
  }
}

function cleanUserText(text) {
  return String(text || "").replace(/^Kendaraan\s+(?:motor|mobil)\.\s*/i, "");
}

function addChat(role, text, details = null) {
  const isUser = role === "user";
  const row = document.createElement("article");
  row.dataset.role = role;
  row.className = isUser
    ? "max-w-[80%] self-end ml-auto mb-3 flex flex-col"
    : "max-w-[85%] self-start mr-auto mb-3 flex flex-col";

  const label = document.createElement("p");
  label.className =
    "font-semibold text-xs mb-1 " +
    (isUser ? "text-bengkelin-cyan text-right" : "text-emerald-400");
  label.textContent = isUser ? "Anda" : "AI Teknis Bengkelin";

  const bubble = document.createElement("div");
  bubble.className = isUser
    ? "px-4 py-2.5 rounded-2xl bg-bengkelin-cyan/10 border border-bengkelin-cyan/40 text-sm text-slate-100 whitespace-pre-line"
    : "p-4 rounded-2xl bg-[#131b2e] border border-white/10 text-sm text-slate-200 leading-relaxed space-y-2 whitespace-pre-line";

  const mainText = document.createElement("p");
  mainText.textContent = isUser ? cleanUserText(text) : text;
  bubble.append(mainText);

  if (!isUser && details) {
    if (
      Array.isArray(details.kemungkinan_penyebab) &&
      details.kemungkinan_penyebab.length
    ) {
      const causesBox = document.createElement("div");
      causesBox.className =
        "pt-2 border-t border-white/10 text-xs text-slate-300 space-y-1";
      const title = document.createElement("p");
      title.className = "font-semibold text-bengkelin-cyan";
      title.textContent = "Kemungkinan Penyebab:";
      const list = document.createElement("ul");
      list.className = "list-disc list-inside space-y-0.5";
      details.kemungkinan_penyebab.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      });
      causesBox.append(title, list);
      bubble.append(causesBox);
    }

    if (
      Array.isArray(details.kategori_layanan) &&
      details.kategori_layanan.length
    ) {
      const catLine = document.createElement("p");
      catLine.className = "text-xs text-slate-400 pt-1";
      catLine.textContent =
        "Layanan terkait: " + details.kategori_layanan.join(", ");
      bubble.append(catLine);
    }
  }

  row.append(label, bubble);
  chatLog.append(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function resetLogWithWelcome() {
  chatLog.replaceChildren();
  ensureWelcomeCard();
}

async function chatRequest(method, body) {
  const response = await fetch("/api/chat", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Sesi berakhir. Silakan login kembali.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Permintaan gagal");
  return data;
}

chatRequest("GET")
  .then((data) => {
    if (data.vehicleType)
      document.getElementById("chatVehicle").value = data.vehicleType;
    ensureWelcomeCard();
    data.messages.forEach((m) => addChat(m.role, m.content));
  })
  .catch((e) => (chatStatus.textContent = e.message));

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (
    chatSend.disabled ||
    chatReset.disabled ||
    chatForm.dataset.busy === "true"
  )
    return;
  const message = chatInput.value.trim();
  if (!message) return;
  const vehicleType = document.getElementById("chatVehicle").value;
  if (!["motor", "mobil"].includes(vehicleType)) {
    chatStatus.textContent = "Pilih motor atau mobil sebelum konsultasi.";
    return;
  }
  chatForm.dataset.busy = "true";
  document.getElementById("chatVehicle").disabled = true;
  chatSend.disabled = true;
  chatReset.disabled = true;
  chatStatus.textContent = "Memeriksa keluhan kendaraan…";
  try {
    const data = await chatRequest("POST", { message, vehicleType });
    addChat("user", message);
    addChat("assistant", data.jawaban, data);
    chatStatus.textContent =
      "Urgensi: " + data.tingkat_urgensi + ". " + data.catatan;
    chatInput.value = "";
  } catch (error) {
    chatStatus.textContent = error.message;
  } finally {
    delete chatForm.dataset.busy;
    document.getElementById("chatVehicle").disabled = false;
    chatSend.disabled = false;
    chatReset.disabled = false;
  }
});

chatReset.addEventListener("click", async () => {
  if (
    chatReset.disabled ||
    chatSend.disabled ||
    chatForm.dataset.busy === "true"
  )
    return;
  chatForm.dataset.busy = "true";
  chatReset.disabled = true;
  chatSend.disabled = true;
  try {
    await chatRequest("DELETE");
    resetLogWithWelcome();
    chatStatus.textContent = "Percakapan baru siap.";
  } catch (error) {
    chatStatus.textContent = error.message;
  } finally {
    delete chatForm.dataset.busy;
    chatReset.disabled = false;
    chatSend.disabled = false;
  }
});

document
  .getElementById("chatVehicle")
  .addEventListener("change", async (event) => {
    if (chatSend.disabled) return;
    chatSend.disabled = true;
    chatReset.disabled = true;
    try {
      await chatRequest("DELETE");
      resetLogWithWelcome();
      chatStatus.textContent =
        "Percakapan " + (event.target.value || "baru") + " siap.";
    } catch (e) {
      chatStatus.textContent = e.message;
    } finally {
      chatSend.disabled = false;
      chatReset.disabled = false;
    }
  });
