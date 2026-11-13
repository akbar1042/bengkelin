// Mengimpor modul untuk pengujian, aplikasi Express, dan database
const assert = require("node:assert/strict");
const app = require("../login");
const db = require("../db");

// Menjalankan pengujian secara asynchronous
(async () => {
  // Membuat akun sementara untuk pengujian
  const email = `ai-test-${Date.now()}@example.com`,
    password = "Test-Only-AI-9384!";

  // Menjalankan server pada port yang tersedia secara otomatis
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));

  // Menentukan URL server pengujian
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";

  // Fungsi untuk mengirim request POST dengan format JSON
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(190000),
    });

  try {
    // Memastikan pengguna yang belum login tidak dapat mengakses chat AI
    assert.equal((await post("/api/chat", { message: "tes" })).status, 401);

    // Menguji registrasi akun baru (HTTP 201)
    assert.equal(
      (await post("/api/registrasi", { email, password })).status,
      201,
    );

    // Menguji login menggunakan akun yang telah didaftarkan
    let response = await post("/api/login", { email, password });
    assert.equal(response.status, 200);

    // Menyimpan cookie autentikasi untuk request berikutnya
    cookie = response.headers.get("set-cookie").split(";")[0];

    // Mencatat waktu mulai pengujian respons AI
    const start = Date.now();

    // Mengirim keluhan kendaraan kepada AI
    response = await post("/api/chat", {
      message:
        "Motor matic saya sulit distarter sejak pagi. Terdengar bunyi klik dan lampunya meredup. Apa kemungkinan masalahnya?",
    });

    // Mengubah respons JSON menjadi objek JavaScript
    const data = await response.json();

    // Memastikan API berhasil memberikan respons
    assert.equal(response.status, 200, JSON.stringify(data));

    // Memastikan AI memberikan jawaban yang tidak kosong
    assert(data.jawaban.length > 0);

    // Memastikan respons tidak menyertakan data bengkel
    assert.equal(data.bengkel, undefined);

    // Memastikan kategori layanan sesuai dengan keluhan kendaraan
    assert(
      data.kategori_layanan.some((s) =>
        ["Aki", "Kelistrikan", "Starter"].includes(s),
      ),
    );

    // Memastikan kategori Rem tidak muncul pada keluhan starter
    assert(!data.kategori_layanan.includes("Rem"));

    // Menampilkan durasi respons dan hasil analisis AI
    console.log(
      JSON.stringify(
        { seconds: (Date.now() - start) / 1000, ...data },
        null,
        2,
      ),
    );

    // Menguji percakapan lanjutan dengan kondisi rem blong
    response = await post("/api/chat", {
      message:
        "Sekarang remnya juga blong. Apakah boleh saya kendarai ke bengkel?",
    });

    // Mengambil respons AI untuk kondisi berbahaya
    const danger = await response.json();

    // Memastikan API tetap memberikan respons HTTP 200
    assert.equal(response.status, 200, JSON.stringify(danger));

    // Memastikan AI mengklasifikasikan rem blong sebagai kondisi darurat
    assert.equal(danger.tingkat_urgensi, "darurat");

    // Menampilkan pesan jika seluruh pengujian berhasil
    console.log(
      "PASS: model nyata menjawab bahasa Indonesia, percakapan lanjutan, dan urgensi rem darurat.",
    );
  } finally {
    // Menghapus akun sementara agar database tetap bersih
    await db.execute("DELETE FROM users WHERE email = ?", [email]);

    // Menutup seluruh koneksi aktif pada server
    server.closeAllConnections();

    // Menghentikan server setelah pengujian selesai
    await new Promise((r) => server.close(r));

    // Menutup koneksi database
    await db.end();
  }

  // Menangkap dan menampilkan error jika pengujian gagal
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
