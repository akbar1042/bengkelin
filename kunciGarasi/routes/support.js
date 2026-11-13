const express = require("express"),
  db = require("../../db");
const tickets = require("../services/tickets");
const { bad } = require("../lib/workshop-utils");
const { generateStructured } = require("../services/gemini");
const knowledge = [
  {
    id: "booking",
    title: "Pemesanan servis",
    words: ["pesan", "booking", "jadwal", "reservasi"],
    answer:
      "Login sebagai pelanggan, cari mitra, buka detail, lalu pilih motor/mobil, layanan dan jadwal. Durasi dan kapasitas mengikuti pengaturan bengkel. Jadwal minimal 15 menit dari sekarang dan maksimal 90 hari. Pengajuan menunggu konfirmasi bengkel; tidak ada pembayaran online.",
    url: "/search.html",
  },
  {
    id: "cancel",
    title: "Pembatalan pesanan",
    words: ["batal", "cancel", "tolak"],
    answer:
      "Pelanggan dapat membatalkan pesanan saat menunggu atau diterima dengan alasan. Setelah diproses, hubungi bengkel. Pengajuan menunggu akan dibatalkan otomatis jika jadwal terlewati atau tidak dikonfirmasi selama 24 jam.",
    url: "/orders.html",
  },
  {
    id: "cost",
    title: "Biaya dan persetujuan",
    words: ["biaya", "harga", "bayar", "tarif", "setuju", "garansi"],
    answer:
      "Tidak ada pembayaran online. Bengkel mengajukan rincian biaya dan pelanggan menyetujuinya dari Pesanan saya sebelum proses dimulai. Jika biaya diubah sebelum pengerjaan, persetujuan lama tidak berlaku dan pelanggan harus menyetujui versi baru.",
    url: "/orders.html",
  },
  {
    id: "partner",
    title: "Pendaftaran dan perubahan mitra",
    words: ["mitra", "daftar bengkel", "profil", "foto"],
    answer:
      "Isi identitas, kontak, lokasi, motor/mobil, layanan, jam buka dan foto. Setujui syarat sebelum mengirim. Foto derek wajib jika memilih penjemputan. Layanan darurat memerlukan kesiapsiagaan 24 jam. Admin menyetujui pendaftaran dan perubahan profil; profil approved lama tetap tampil selama revisi ditinjau.",
    url: "/registrasi-mitra.html",
  },
  {
    id: "location",
    title: "Lokasi dan peta",
    words: ["lokasi", "peta", "radius", "gps", "terdekat", "cari bengkel"],
    answer:
      "Pencarian memakai lokasi perangkat dengan izin dan radius 15 KM. Tidak ada lokasi default. Radius adalah jarak garis lurus, bukan jarak tempuh. Nama kecamatan/kabupaten memerlukan Geocoding; peta beberapa titik memerlukan konfigurasi key browser.",
    url: "/search.html",
  },
  {
    id: "account",
    title: "Akun dan password",
    words: ["akun", "password", "sandi", "login", "email", "hapus akun"],
    answer:
      "Ganti password di Pengaturan akun. Penonaktifan akun memerlukan password dan teks HAPUS AKUN; selesaikan pesanan aktif dahulu. Jangan kirim password ke chat.",
    url: "/account-settings.html",
  },
  {
    id: "diagnosis",
    title: "Konsultasi AI Kendaraan",
    words: [
      "brebet",
      "mesin",
      "starter",
      "rem",
      "mogok",
      "motor rusak",
      "mobil rusak",
      "oli",
      "aki",
      "kopling",
      "ban",
      "overheat",
      "knalpot",
      "ac mobil",
      "kelistrikan",
      "suspensi",
      "kaki-kaki",
      "busi",
      "karburator",
      "injeksi",
      "cvt",
    ],
    answer:
      "Maaf, saya adalah AI Customer Service Bengkelin yang khusus melayani pertanyaan seputar fitur dan penggunaan aplikasi Bengkelin. Untuk konsultasi masalah teknis motor atau mobil, silakan tanyakan langsung kepada AI Teknis Bengkelin di halaman Konsultasi AI.",
    url: "/ai.html",
  },
  {
    id: "admin",
    title: "Pusat bantuan",
    words: [
      "admin",
      "bantuan",
      "komplain",
      "keluhan layanan",
      "manusia",
      "kendala lainnya",
    ],
    answer:
      "Kontak telepon admin belum aktif; nomor pada bantuan adalah contoh. Anda dapat melihat panduan lengkap aplikasi melalui halaman Pusat Bantuan.",
    url: "/help.html",
  },
];
const unknown = {
  id: "unknown",
  title: "Bantuan Aplikasi Bengkelin",
  answer:
    "Halo! Saya adalah AI Customer Service Bengkelin yang khusus membantu seputar fitur aplikasi Bengkelin (Akun & Login, Cari Bengkel & Peta, Pemesanan Servis, Persetujuan Biaya, Pembatalan Pesanan, dan Pendaftaran Mitra). Silakan tanyakan fitur yang ingin Anda ketahui, atau gunakan halaman Konsultasi AI jika Anda ingin berkonsultasi mengenai masalah teknis motor/mobil.",
  url: "/support.html",
};

const CS_SYSTEM_PROMPT = `Kamu adalah AI Customer Service Bengkelin, asisten resmi layanan pelanggan aplikasi Bengkelin.
Peranmu sudah dipatenkan sebagai AI Customer Service Bengkelin.
Ruang lingkup (scope) kamu HANYA seputar fitur-fitur dan penggunaan aplikasi Bengkelin berdasarkan panduan resmi berikut:
${JSON.stringify(knowledge.map(({ id, title, answer, url }) => ({ id, title, answer, url })))}

Aturan mutlak:
1. Jawab selalu dalam Bahasa Indonesia yang ramah, jelas, sopan, dan profesional sebagai AI Customer Service Bengkelin.
2. HANYA gunakan fakta fitur yang ada di panduan resmi Bengkelin dan data akun pengguna yang diberikan (jika ada). JANGAN mengarang fitur yang tidak ada (misalnya jangan menyebut ada pembayaran online/transfer di aplikasi, jangan mengarang garansi 30 hari, atau fitur favorit/ulasan karena fitur tersebut tidak ada).
3. BATASAN SCOPE — MASALAH TEKNIS MOTOR/MOBIL: Jika pengguna bertanya tentang keluhan teknis/mekanis kendaraan (seperti mesin brebet, motor susah starter, rem bunyi/blong, ganti oli, aki tekor, AC mobil tidak dingin, ban, servis mesin, dll.), JANGAN memberikan diagnosis teknis. Tolak dengan sopan, jelaskan bahwa kamu adalah AI Customer Service Bengkelin yang hanya menangani seputar fitur aplikasi Bengkelin, dan arahkan pengguna untuk bertanya di halaman **Konsultasi AI** (/ai.html) kepada AI Teknis Bengkelin, serta pilih topic_id = "diagnosis".
4. BATASAN SCOPE — TOPIK DI LUAR FITUR BENGKELIN: Jika pengguna bertanya hal umum di luar fitur aplikasi Bengkelin, tolak dengan sopan sebagai AI Customer Service Bengkelin, sebutkan fitur-fitur Bengkelin yang bisa kamu bantu, dan pilih topic_id = "unknown".
5. Jika pengguna hanya menyapa (halo, hai, pagi, atau mengetik angka pilihan menu seperti "1", "2", "3", "4"), sambut dengan ramah sebagai AI Customer Service Bengkelin dan jelaskan topik yang sesuai (1 = account, 2 = booking/status pesanan, 3 = cost/biaya & persetujuan, 4 = admin).`;
function retrieve(message) {
  const text = message.toLowerCase();
  return knowledge
    .map((k) => ({
      ...k,
      score: k.words.reduce(
        (n, w) => n + (text.includes(w) ? (w === "pesan" ? 0.25 : 1) : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
}
function createSupportRouter({ database = db, fetchImpl = fetch } = {}) {
  const r = express.Router(),
    active = new Set();
  r.get("/api/support/messages", async (req, res) => {
    const [rows] = await database.execute(
      "SELECT messages FROM support_conversations WHERE user_id=?",
      [req.account.id],
    );
    res.json({
      messages: rows[0]
        ? typeof rows[0].messages === "string"
          ? JSON.parse(rows[0].messages)
          : rows[0].messages
        : [],
    });
  });
  r.delete("/api/support/messages", async (req, res) => {
    await database.execute(
      "DELETE FROM support_conversations WHERE user_id=?",
      [req.account.id],
    );
    res.json({ message: "Percakapan dihapus." });
  });
  r.post("/api/support/chat", async (req, res, next) => {
    const message = req.body?.message;
    if (typeof message !== "string" || !message.trim() || message.length > 1500)
      return res
        .status(400)
        .json({ message: "Pertanyaan wajib diisi, maksimal 1500 karakter." });
    if (active.has(req.account.id))
      return res
        .status(409)
        .json({ message: "Tunggu jawaban pertanyaan sebelumnya." });
    active.add(req.account.id);
    try {
      const [historyRows] = await database.execute(
        "SELECT messages FROM support_conversations WHERE user_id=?",
        [req.account.id],
      );
      let history = historyRows[0]
        ? typeof historyRows[0].messages === "string"
          ? JSON.parse(historyRows[0].messages)
          : historyRows[0].messages
        : [];
      const text = message.toLowerCase();
      let answer,
        sources = [],
        method = "panduan_aplikasi";
      if (
        /(?:password|kata sandi|token|api.?key)\s*[:=]\s*\S+/i.test(message)
      ) {
        answer =
          "Jangan kirim password, token atau API key ke chat. Gunakan Pengaturan akun untuk mengganti password ketika sudah login.";
        history = [];
      } else if (
        /(?:pesanan|pesananku|order)/i.test(message) &&
        /(?:status|saya|ku\b|biaya|harga|#|nomor)/i.test(message)
      ) {
        const found = message.match(
          /(?:#|pesanan\s*(?:nomor|no\.?|id)?\s*)(\d+)/i,
        );
        const id = found ? Number(found[1]) : null;
        const [orders] = await database.execute(
          "SELECT o.id,o.status,o.service,o.confirmed_cost,o.cost_version,o.accepted_cost_version,p.name FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE " +
            (req.account.role === "partner"
              ? "p.owner_user_id"
              : "o.customer_id") +
            "=?" +
            (id ? " AND o.id=?" : "") +
            " ORDER BY o.id DESC LIMIT 3",
          id ? [req.account.id, id] : [req.account.id],
        );
        const labels = {
          waiting: "menunggu",
          accepted: "diterima",
          processing: "diproses",
          completed: "selesai",
          cancelled: "dibatalkan",
        };
        answer = orders.length
          ? orders
              .map(
                (o) =>
                  `Pesanan #${o.id}, ${o.name}, ${o.service}: ${labels[o.status]}. Biaya ${o.confirmed_cost == null ? "belum diajukan bengkel" : "Rp " + Number(o.confirmed_cost).toLocaleString("id-ID") + "; " + (o.cost_version > 0 && o.accepted_cost_version === o.cost_version ? "versi biaya disetujui pelanggan" : "belum disetujui pelanggan")}.`,
              )
              .join("\n")
          : "Pesanan yang dimaksud tidak ditemukan pada akun Anda. Aku tidak dapat membuka pesanan akun lain.";
        sources = [
          {
            title: "Data pesanan akun aktif",
            url:
              req.account.role === "partner"
                ? "/owner-orders.html"
                : "/orders.html",
          },
        ];
        method = "database_akun_sendiri";
      } else if (
        /(?:status|diterima|disetujui)/i.test(message) &&
        /(?:mitra|pengajuan|pendaftaran|bengkel saya)/i.test(message)
      ) {
        const [rows] = await database.execute(
          "SELECT name,status,review_note FROM partner_workshops WHERE owner_user_id=? ORDER BY id DESC LIMIT 3",
          [req.account.id],
        );
        answer = rows.length
          ? rows
              .map(
                (w) =>
                  w.name +
                  ": " +
                  {
                    pending: "menunggu persetujuan admin",
                    approved: "disetujui",
                    rejected: "ditolak",
                  }[w.status] +
                  (w.review_note ? ". Catatan admin: " + w.review_note : ""),
              )
              .join("\n")
          : "Belum ada pengajuan bengkel milik akun Anda.";
        sources = [{ title: "Pengajuan mitra akun aktif", url: "/dashboard" }];
        method = "database_akun_sendiri";
      } else if (
        /(?:jam|buka|tutup|telepon|telp|kontak|layanan)/i.test(message) &&
        /bengkel/i.test(message)
      ) {
        const found = message.match(/bengkel\s*(?:#|id|nomor|no\.)?\s*(\d+)/i);
        if (!found) {
          answer =
            "Bengkel mana yang ingin Anda periksa? Buka detail mitra dari pencarian atau sebut ID bengkel. Aku tidak akan menebak jam buka atau nomor telepon.";
          sources = [{ title: "Cari dan pilih bengkel", url: "/search.html" }];
        } else {
          const [rows] = await database.execute(
            "SELECT p.name,p.phone,p.services,p.open24,d.details FROM partner_workshops p LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.id=? AND p.status='approved'",
            [Number(found[1])],
          );
          if (!rows[0])
            answer = "Bengkel tidak ditemukan atau belum disetujui.";
          else {
            const w = rows[0],
              d =
                typeof w.details === "string"
                  ? JSON.parse(w.details)
                  : w.details || {},
              services =
                typeof w.services === "string"
                  ? JSON.parse(w.services)
                  : w.services;
            const days = [
              "Minggu",
              "Senin",
              "Selasa",
              "Rabu",
              "Kamis",
              "Jumat",
              "Sabtu",
            ];
            answer =
              w.name +
              ". Kontak: " +
              w.phone +
              ". Layanan: " +
              services.join(", ") +
              ". Jam: " +
              (d.hours
                ? d.hours.days.map((day) => days[day]).join(", ") +
                  ", " +
                  (w.open24 ? "24 jam" : d.hours.open + "–" + d.hours.close) +
                  " WIB"
                : "belum dilengkapi; hubungi bengkel untuk konfirmasi") +
              ".";
          }
          sources = [
            {
              title: "Profil mitra approved",
              url: "/partner-detail.html?id=" + Number(found[1]),
            },
          ];
        }
        method = "database_profil_mitra";
      } else {
        const quickMap = { 1: "account", 2: "booking", 3: "cost", 4: "admin" };
        let ranked = retrieve(message);
        if (!ranked[0].score && history.length) {
          const last = history.filter((m) => m.role === "user").at(-1);
          if (last && /(bagaimana|kenapa|lalu|terus|itu|berapa)/i.test(message))
            ranked = retrieve(last.content + " " + message);
        }
        let selected = quickMap[text.trim()]
          ? knowledge.find((k) => k.id === quickMap[text.trim()])
          : ranked[0].score
            ? ranked[0]
            : unknown;
        answer = selected.answer;
        if (process.env.CS_AI_USE_MODEL !== "false") {
          try {
            const allIds = [...knowledge.map((k) => k.id), "unknown"];
            const payload = await generateStructured({
              systemInstruction: CS_SYSTEM_PROMPT,
              history: history
                .slice(-6)
                .map((h) => ({ role: h.role, content: h.content })),
              userMessage: message.trim(),
              responseSchema: {
                type: "OBJECT",
                properties: {
                  topic_id: { type: "STRING", enum: allIds },
                  answer: {
                    type: "STRING",
                    description:
                      "Jawaban lengkap, ramah, dan akurat dari AI Customer Service Bengkelin dalam Bahasa Indonesia.",
                  },
                },
                required: ["topic_id", "answer"],
              },
              temperature: 0.2,
              maxOutputTokens: 1024,
              timeoutMs: 30000,
              fetchImpl,
            });
            const id = payload?.topic_id;
            if (allIds.includes(id)) {
              selected = knowledge.find((k) => k.id === id) || unknown;
              if (typeof payload.answer === "string" && payload.answer.trim()) {
                answer = payload.answer.trim();
              } else {
                answer = selected.answer;
              }
              method = "gemini_ai_dengan_panduan";
            }
          } catch {
            method = "panduan_fallback_model_tidak_tersedia";
          }
        }
        sources = [{ title: selected.title, url: selected.url }];
      }
      const safe =
        /password|token|api.?key/i.test(message) && /[:=]/.test(message)
          ? "[Pesan mengandung kemungkinan rahasia; tidak disimpan]"
          : message.trim();
      history = [
        ...history,
        { role: "user", content: safe },
        { role: "assistant", content: answer, sources },
      ].slice(-20);
      await database.execute(
        "INSERT INTO support_conversations(user_id,messages) VALUES (?,?) ON DUPLICATE KEY UPDATE messages=VALUES(messages),updated_at=CURRENT_TIMESTAMP",
        [req.account.id, JSON.stringify(history)],
      );
      res.json({ answer, sources, method });
    } catch (e) {
      next(e);
    } finally {
      active.delete(req.account.id);
    }
  });
  const customerTickets = "/api/support/tickets";
  const adminTickets = "/api/admin/support-tickets";
  r.use(adminTickets, (req, res, next) => {
    if (req.account.role !== "admin")
      throw bad("Hanya admin yang dapat mengelola tiket.", 403);
    next();
  });
  const ticketId = (value) => {
    const id = Number(value);
    if (
      typeof value !== "string" ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(id) ||
      id < 1
    ) {
      throw bad("ID tiket tidak valid.");
    }
    return id;
  };
  const ticketMessage = (value) => {
    if (typeof value !== "string" || !value.trim() || value.length > 2000) {
      throw bad("Pesan wajib diisi, maksimal 2000 karakter.");
    }
    return value.trim();
  };
  r.post(customerTickets, async (req, res) => {
    const id = await tickets.createTicket(
      database,
      req.account.id,
      ticketMessage(req.body?.message),
    );
    res.status(201).json({ id, message: "Pesan dikirim ke admin." });
  });
  for (const base of [customerTickets, adminTickets]) {
    const ownerId = (req) =>
      base === customerTickets ? req.account.id : undefined;
    r.get(base, async (req, res) => {
      const { status, before } = req.query;
      if (status !== undefined && !["open", "closed"].includes(status))
        throw bad("Status tiket tidak valid.");
      res.json(
        await tickets.listTickets(database, {
          ownerId: ownerId(req),
          status,
          before: before === undefined ? undefined : ticketId(before),
        }),
      );
    });
    r.get(base + "/:id", async (req, res) => {
      res.json(
        await tickets.getTicket(
          database,
          ticketId(req.params.id),
          ownerId(req),
        ),
      );
    });
    r.post(base + "/:id/messages", async (req, res) => {
      await tickets.updateTicket(database, ticketId(req.params.id), {
        ownerId: ownerId(req),
        message: ticketMessage(req.body?.message),
      });
      res.status(201).json({ message: "Pesan dikirim." });
    });
  }
  r.patch(adminTickets + "/:id", async (req, res) => {
    const { reply, status } = req.body || {};
    if (
      (status !== undefined && status !== "closed") ||
      (reply === undefined && status !== "closed")
    ) {
      throw bad("Keputusan tiket tidak valid.");
    }
    await tickets.updateTicket(database, ticketId(req.params.id), {
      close: true,
      message: reply === undefined ? undefined : ticketMessage(reply),
    });
    res.json({
      message:
        reply === undefined ? "Tiket ditutup." : "Tiket dibalas dan ditutup.",
    });
  });
  return r;
}
module.exports = { createSupportRouter, knowledge, retrieve };
