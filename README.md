# Bengkelin

Aplikasi Express: registrasi MySQL, login dengan bcrypt, sesi cookie, dan pencarian bengkel.

## Menjalankan lokal

1. Nyalakan MySQL, lalu jalankan database.sql untuk instalasi baru.
2. Dari folder utama, jalankan npm install.
3. Jika MySQL memakai password, atur DB_PASSWORD di environment terminal.
4. Jalankan npm start dan buka http://localhost:3000.
5. Daftarkan akun, login, lalu gunakan pencarian dan filter bengkel.

Konfigurasi: DB_PASSWORD, SESSION_SECRET, PORT. Database default: bengkel, user: root, host: localhost. Jangan commit password atau file .env.

Login menuju dashboard sesuai role: /dashboard/customer, /dashboard/partner, atau /dashboard/admin. /landing.html menjadi alias kompatibilitas untuk pelanggan. Profil berasal dari sesi; tombol Keluar menghapus sesi. /api/workshops dilindungi login. Pencarian dibagi menjadi mitra approved dan bengkel umum Google Maps; data fiktif lama hanya pada group=demo.

Server lama bengkelin/server.js meneruskan ke aplikasi utama; cukup jalankan satu server. Halaman pages/landing.html adalah halaman sambutan lama yang tidak lagi digunakan.

Untuk deployment publik, gunakan penyimpanan sesi persisten, SESSION_SECRET tetap, HTTPS, dan pembatasan percobaan login. Sesi pengembangan saat ini berada di memori dan hilang ketika backend dimulai ulang.

## Asisten keluhan AI lokal

Runtime: Ollama, model default qwen3:4b-instruct. Pasang runtime resmi dari https://ollama.com/download/windows atau gunakan paket portable resmi. File runtime dan model tidak disimpan di repository.

Pada laptop pengembangan ini runtime berada di D:\Kuliah\AI\Ollama dan model di D:\Kuliah\AI\models. Jalankan dari root proyek:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-ai.ps1
npm start
```

Script mengunduh model jika diperlukan; internet diperlukan untuk unduhan awal. Sesudah model tersedia, inferensi dilakukan lokal. Ollama hanya mendengarkan di 127.0.0.1:11434. Script menonaktifkan fitur cloud pada runtime yang dimulainya. Jika Ollama sudah berjalan, konfigurasi proses yang sudah ada tetap berlaku.

Konfigurasi backend opsional: OLLAMA_URL (hanya loopback), OLLAMA_MODEL. Default http://127.0.0.1:11434 dan qwen3:4b-instruct. Bila mengubah model, sesuaikan parameter -Model pada script dan OLLAMA_MODEL backend. Pengguna membuka form konsultasi pada landing page setelah login.

### Kontrak chat

- GET /api/chat: riwayat sesi dan nama model.
- POST /api/chat dengan JSON {"message":"Motor sulit distarter"}: jawaban, kemungkinan_penyebab, kategori_layanan, tingkat_urgensi, perlu_pertanyaan_lanjutan, bengkel, catatan.
- DELETE /api/chat: mulai percakapan baru.
- Semua endpoint memerlukan sesi login. Input maksimal 1500 karakter; satu inferensi aktif per server; timeout 180 detik. Request lain mendapat 429, runtime tidak tersedia 503, output tidak valid 502, timeout 504.
- Riwayat sementara disimpan dalam memori per sesi (maksimal 10 pesan, kedaluwarsa 30 menit), tidak masuk MySQL. Restart server menghapus riwayat. Rekomendasi bengkel berasal dari mitra approved dan dicocokkan berdasarkan layanan. Tidak ada fallback ke data fiktif.
- Penilaian awal perlu dikonfirmasi mekanik. Model kecil dapat keliru; tidak melakukan booking atau tindakan otomatis.

Jalankan npm test untuk pemeriksaan kontrak chat dengan runtime simulasi, tanpa memerlukan model atau database. Pengujian ini memeriksa input, format, isolasi sesi, konkurensi, reset, urgensi, dan rekomendasi.
Keluhan darurat yang dikenali (misalnya rem blong atau bensin bocor) mendapat peringatan langsung dari backend tanpa menunggu model. Aturan ini belum mencakup seluruh variasi bahasa dan bukan pengganti pemeriksaan profesional.
Uji nyata opsional: npm run test:ai. MySQL dan model Ollama harus aktif. Tes membuat akun sementara, memeriksa login dan keluhan starter, lalu menghapus akun uji.

### Data training dan referensi

Classifier keluhan lokal kini dilatih dari 1.500 contoh sintetis untuk 22 kategori, dengan set pengembangan dan uji yang terpisah. Classifier dan aturan memilih referensi yang kuat, sedangkan Qwen membantu kasus lainnya; respons mekanis dirakit dari ringkasan terkurasi yang menampilkan tautan sumber. Bobot Qwen tidak di-fine-tune. Lihat ai/README.md untuk sumber, laporan, keterbatasan, dan perintah train/eval.

Respons POST /api/chat juga memuat referensi, referensi_id, dan mode_identifikasi. Peringatan bahaya tetap berlaku dalam sesi konsultasi sampai Percakapan baru dipilih. Pemrosesan tetap lokal sesudah runtime dan model tersedia.

Dataset aktif v6 berisi 1.500 contoh sintetis, 22 kategori, dan 15 referensi primer. Audit memeriksa normalisasi, kemiripan Jaccard >=0,85, sumber, hash, dan pemisahan set uji. Contoh bukan kasus nyata yang telah dikonfirmasi mekanik. Rincian provenance dan riwayat eksperimen tetap tersedia di ai/README.md, ai/data/v4/, ai/data/v5/, dan ai/data/v6/.

Pada set baru v5, classifier tetap 44/46 sebelum dan sesudah tambahan 200 contoh; pada regresi v4 naik dari 42/44 menjadi 44/44. Pipeline setelah perbaikan aturan lulus 46/46 v5 dan 44/44 v4 pada pengujian ulang; ini regresi setelah kasus dibaca, bukan akurasi diagnosis lapangan atau bukti peningkatan Qwen. Lihat ai/experiments/training1200-summary.json.

Respons POST /api/chat menampilkan sumber. Data keluhan brebet dan konteks lanjutan tetap tersedia; dataset tidak digunakan untuk memberi kepastian komponen rusak. Jalankan npm run audit:ai, npm run train:ai, dan npm run eval:v5.

Lihat WORKSHOPS.md untuk migrasi role, persetujuan mitra, konfigurasi Google Places, endpoint, dan pengujian; HTTPS-TESTING.md menjelaskan akses tunnel sementara. Google nonaktif secara default pada template konfigurasi dan perlu konfigurasi server lengkap untuk digunakan.

Putaran v6 menambahkan 300 contoh sehingga total aktif 1.500, dengan set uji baru dibekukan sebelum training. Hasil dan provenance disimpan di ai/data/v6/ dan ai/experiments/. Ini data sintetis bersumber, bukan kasus nyata yang disahkan mekanik.

Dashboard tiga role dan daftar prioritas fitur per role tersedia di DASHBOARDS.md. Akses pemilik mengikuti kepemilikan minimal satu bengkel approved dan langsung dicabut jika tidak ada lagi bengkel approved.
