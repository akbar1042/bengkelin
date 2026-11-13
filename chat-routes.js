const express = require("express");
const {
  getGeminiConfig,
  generateStructured,
} = require("./kunciGarasi/services/gemini");
const { serviceCatalog } = require("./kunciGarasi/lib/partner-input");

const URGENCY_LEVELS = ["darurat", "perlu_pemeriksaan", "rendah"];

const SYSTEM_PROMPT = `Kamu adalah AI Teknis Bengkelin, asisten konsultasi teknis otomotif resmi dari platform Bengkelin.
Peranmu sudah dipatenkan sebagai AI Teknis Bengkelin. Ruang lingkup (scope) kamu HANYA seputar konsultasi teknis sepeda motor dan mobil (gejala kerusakan, diagnosis awal, perawatan berkala, komponen/suku cadang, estimasi pemeriksaan bengkel, dan keselamatan berkendara).

Aturan mutlak:
1. Perkenalkan atau posisikan dirimu sebagai "AI Teknis Bengkelin" dan selalu jawab dalam Bahasa Indonesia yang jelas, ramah, dan mudah dipahami pemilik kendaraan.
2. BATASAN SCOPE — FITUR APLIKASI BENGKELIN: Jika pengguna bertanya tentang fitur, akun, atau layanan aplikasi Bengkelin (seperti cara booking/pesan servis, cek status pesanan, pembatalan pesanan, persetujuan biaya, cara login/ganti password/hapus akun, cara daftar mitra bengkel, peta/pencarian bengkel, atau komplain/tiket admin), JANGAN menjawab panduan fitur tersebut. Tolak dengan sopan sebagai AI Teknis Bengkelin dan arahkan pengguna untuk bertanya langsung di halaman **Customer Service Bengkelin** (menu Customer Service / /support.html), serta isi tingkat_urgensi = "rendah", kemungkinan_penyebab = [], kategori_layanan = [].
3. BATASAN SCOPE — TOPIK UMUM DI LUAR MOTOR/MOBIL: Jika pengguna bertanya hal di luar masalah teknis motor/mobil (misalnya resep masakan, politik, tugas sekolah, pemrograman, sepeda kayuh, pesawat, dll.), tolak dengan sopan dan jelaskan bahwa sebagai AI Teknis Bengkelin kamu hanya melayani konsultasi teknis seputar motor dan mobil, dengan tingkat_urgensi = "rendah", kemungkinan_penyebab = [], kategori_layanan = [].
4. KESELAMATAN DARURAT: Untuk gejala berbahaya pada motor/mobil (seperti rem blong/daya henti hilang, kebocoran bensin/bau bahan bakar menyengat, asap/api dari mesin, ban pecah/benjol parah, kemudi terkunci/macet, atau mesin overheat parah), tetapkan tingkat_urgensi = "darurat" dan peringatkan pengguna untuk TIDAK melanjutkan berkendara serta segera menepi di tempat aman / gunakan layanan derek.
5. Jika dalam riwayat percakapan sebelumnya sudah terdeteksi bahaya darurat yang belum diselesaikan, tetap pertahankan kewaspadaan darurat.
6. Jika pengguna hanya menyapa (halo, hai, selamat pagi, dll.), balas sapaan dengan ramah sebagai AI Teknis Bengkelin dan tanyakan apakah kendaraannya motor atau mobil beserta keluhan teknis yang dialami, dengan tingkat_urgensi = "rendah".
7. Pilih kategori_layanan yang paling relevan dari daftar enum yang tersedia (maksimal 4 kategori).
8. Jangan mengarang klaim bahwa kamu sudah memeriksa fisik kendaraan secara langsung; selalu ingatkan bahwa pemeriksaan fisik oleh mekanik bengkel tetap diperlukan untuk kepastian.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    jawaban: {
      type: "STRING",
      description:
        "Penjelasan pemeriksaan awal, analisis gejala, dan langkah yang disarankan kepada pemilik kendaraan.",
    },
    kemungkinan_penyebab: {
      type: "ARRAY",
      items: { type: "STRING" },
      description:
        "Daftar 1-5 poin kemungkinan penyebab teknis (kosongkan jika hanya sapaan atau di luar topik).",
    },
    kategori_layanan: {
      type: "ARRAY",
      items: { type: "STRING", enum: serviceCatalog },
      description:
        "Kategori layanan bengkel yang relevan dari katalog Bengkelin.",
    },
    tingkat_urgensi: {
      type: "STRING",
      enum: URGENCY_LEVELS,
      description: "darurat, perlu_pemeriksaan, atau rendah.",
    },
    catatan: {
      type: "STRING",
      description:
        "Catatan keselamatan singkat atau saran tindak lanjut ke bengkel.",
    },
  },
  required: [
    "jawaban",
    "kemungkinan_penyebab",
    "kategori_layanan",
    "tingkat_urgensi",
    "catatan",
  ],
};

function createChatRouter({ fetchImpl = fetch } = {}) {
  const router = express.Router();
  const conversations = new Map();
  const activeSessions = new Set();

  function conversation(req) {
    const now = Date.now();
    for (const [key, item] of conversations)
      if (now - item.updated > 1800000) conversations.delete(key);
    let item = conversations.get(req.sessionID);
    if (!item) {
      if (conversations.size >= 100)
        conversations.delete(conversations.keys().next().value);
      item = { messages: [], updated: now, hazard: false };
      conversations.set(req.sessionID, item);
    }
    item.updated = now;
    return item;
  }

  router.get("/api/chat", (req, res) => {
    const entry = conversation(req);
    const { model } = getGeminiConfig();
    res.json({
      messages: entry.messages,
      vehicleType: entry.vehicleType || null,
      model,
    });
  });

  router.delete("/api/chat", (req, res) => {
    if (activeSessions.has(req.sessionID))
      return res.status(429).json({
        message: "Tunggu jawaban selesai sebelum memulai percakapan baru.",
      });
    conversations.delete(req.sessionID);
    res.json({ message: "Percakapan dihapus" });
  });

  router.post("/api/chat", async (req, res) => {
    const vehicleType = req.body?.vehicleType;
    if (vehicleType !== undefined && !["motor", "mobil"].includes(vehicleType))
      return res.status(400).json({ message: "Pilih motor atau mobil." });
    const rawMessage = req.body?.message;
    if (
      typeof rawMessage !== "string" ||
      !rawMessage.trim() ||
      rawMessage.length > 1500
    )
      return res
        .status(400)
        .json({ message: "Isi keluhan maksimal 1500 karakter." });

    const entry = conversation(req);
    if (vehicleType && entry.vehicleType && entry.vehicleType !== vehicleType) {
      entry.messages = [];
      entry.hazard = false;
    }
    if (vehicleType) entry.vehicleType = vehicleType;

    if (activeSessions.has(req.sessionID))
      return res.status(429).json({
        message:
          "AI sedang memproses keluhan lain. Coba lagi setelah jawaban selesai.",
      });

    activeSessions.add(req.sessionID);
    try {
      const effectiveVehicle = entry.vehicleType || vehicleType;
      const userMessage = effectiveVehicle
        ? `Kendaraan ${effectiveVehicle}. ${rawMessage.trim()}`
        : rawMessage.trim();

      const parsed = await generateStructured({
        systemInstruction:
          SYSTEM_PROMPT +
          (entry.hazard
            ? "\nPERHATIAN: Pada pesan sebelumnya di sesi ini sudah terdeteksi kondisi DARURAT. Pastikan tingkat_urgensi tetap 'darurat' dan ingatkan pengguna agar tidak mengendarai kendaraan sebelum aman."
            : ""),
        history: entry.messages.slice(-6),
        userMessage,
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 2048,
        timeoutMs: 60000,
        fetchImpl,
      });

      if (
        !parsed ||
        typeof parsed.jawaban !== "string" ||
        !parsed.jawaban.trim() ||
        !URGENCY_LEVELS.includes(parsed.tingkat_urgensi)
      ) {
        return res
          .status(502)
          .json({ message: "Jawaban AI tidak lengkap. Coba lagi." });
      }

      const urgency = entry.hazard ? "darurat" : parsed.tingkat_urgensi;
      if (urgency === "darurat") entry.hazard = true;

      const causes = Array.isArray(parsed.kemungkinan_penyebab)
        ? parsed.kemungkinan_penyebab
            .filter((x) => typeof x === "string" && x.trim())
            .slice(0, 5)
        : [];
      const categories = Array.isArray(parsed.kategori_layanan)
        ? parsed.kategori_layanan
            .filter((x) => serviceCatalog.includes(x))
            .slice(0, 4)
        : [];

      const result = {
        jawaban: parsed.jawaban.trim(),
        kemungkinan_penyebab: causes,
        kategori_layanan: categories,
        tingkat_urgensi: urgency,
        catatan:
          typeof parsed.catatan === "string" && parsed.catatan.trim()
            ? parsed.catatan.trim()
            : "Pemeriksaan fisik oleh mekanik bengkel tetap diperlukan untuk memastikan kondisi kendaraan.",
        metode_pemilihan: "gemini_ai",
      };

      entry.messages.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: result.jawaban },
      );
      entry.messages = entry.messages.slice(-10);
      return res.json(result);
    } catch (error) {
      return res
        .status(error.status || 503)
        .json({ message: error.message || "Layanan Gemini AI belum siap." });
    } finally {
      activeSessions.delete(req.sessionID);
    }
  });

  return router;
}

module.exports = createChatRouter();
module.exports.createChatRouter = createChatRouter;
