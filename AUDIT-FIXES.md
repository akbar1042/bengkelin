# Perbaikan audit dan Customer Service Bengkelin

## Yang diperbaiki

- Sesi login disimpan di MySQL (`app_sessions`), termasuk setelah restart. Production mewajibkan SESSION_SECRET; development tanpa secret memakai berkas privat `data/session-secret` yang diabaikan Git.
- Login dibatasi per akun (10 percobaan/15 menit) dan IP (50/15 menit). Batas disimpan di DB, tidak hilang saat proses restart. Request pengujian memakai alamat asal terpisah agar tidak membatasi pengguna lokal.
- Biaya memiliki versi. Pelanggan harus menyetujui versi terkini sebelum pemilik dapat memulai proses. Perubahan biaya membatalkan persetujuan lama; biaya tidak dapat diubah ketika pengerjaan sedang berlangsung.
- Notifikasi pesanan dan perubahan biaya disimpan per pengguna. Badge dipantau setiap 20 detik saat halaman aktif; ini notifikasi dalam aplikasi, bukan push OS/email.
- Kapasitas 1–20 dan durasi 15–480 menit per layanan dapat diatur pemilik. Slot diperiksa dengan transaksi, jam operasional dan jumlah pesanan yang benar-benar bertumpang tindih. Default untuk profil lama tetap kapasitas 1/durasi 60 menit sampai diubah.
- Pengajuan menunggu dibatalkan otomatis jika jadwal terlewati atau tidak dikonfirmasi 24 jam. Proses pemeliharaan berjalan tiap menit pada server utama dan saat API pesanan pelanggan diakses. Alasan dan actor_type=system dicatat.
- Perubahan profil/foto masuk revisi terpisah. Profil approved lama tetap ditampilkan sampai admin menyetujui revisi. Penolakan revisi tidak mencabut profil lama. Pemilik dapat melihat status/catatan revisinya.
- Foto pengganti dapat diunggah dari pengelolaan profil. Foto revisi hanya dapat dibaca pemilik/admin sebelum disetujui.
- Pembatalan akibat penonaktifan akun juga masuk riwayat status.

## Customer Service

Halaman `/support.html` tersedia untuk akun yang login. Berbeda dari konsultasi gejala kendaraan di `/ai.html`.

CS memakai panduan aplikasi terkurasi dan sumber data berikut:

- Kebijakan pemesanan, pembatalan, biaya, mitra, akun, lokasi, favorit dan ulasan.
- Status dan biaya pesanan milik akun aktif; backend menyaring pemilik sebelum data dipakai. Model tidak membuat query SQL atau mengubah pesanan.
- Status pengajuan bengkel milik akun aktif serta profil mitra approved.
- Riwayat percakapan tersimpan di MySQL, dapat dihapus dari halaman CS.

Qwen lokal digunakan untuk memilih topik panduan dengan keluaran JSON terbatas. Jawaban prosedur berasal dari panduan, dan jawaban transaksi berasal dari database. Jika model tidak tersedia, pencarian panduan tetap berjalan. Pertanyaan ambigu meminta klarifikasi; tidak ada klaim akurasi 100% atau angka evaluasi model nyata yang belum diukur.

Model dan konsultasi kendaraan memakai antrean bersama (maksimal 20 menunggu, batas antre 15 detik). Layanan lokal memiliki batas waktu; diagnosis tidak memerlukan akses ke pesanan.

Eskalasi tersedia melalui tiket. Admin membalas pada `/support-admin.html`; percakapan AI tidak otomatis dianggap tiket. Telepon admin masih nomor contoh sesuai permintaan, bukan kontak aktif.

Saat implementasi, Ollama tidak aktif dan tidak ditemukan di PATH/lokasi standar Windows. Integrasi model siap, tetapi jawaban dengan Qwen nyata belum diverifikasi pada laptop ini. Jalankan layanan Ollama dan model sesuai OLLAMA_MODEL untuk mengaktifkannya. `CS_AI_USE_MODEL=false` dapat dipakai untuk pengujian panduan tanpa model.

## Migrasi dan validasi

Sesudah migrasi 001–003, jalankan:

```powershell
npm run migrate:audit
npm test
npm run test:features
npm run test:commerce
npm run test:audit
```

Migrasi 004 menambah tabel sesi, batas login, revisi, notifikasi, tiket, percakapan CS serta kolom durasi dan persetujuan biaya. Trigger notifikasi dibuat oleh migrasi; akun DB deployment memerlukan hak CREATE TRIGGER saat migrasi. Jalankan migrasi sebelum memulai ulang server yang memakai kode baru.

Tes regresi, integrasi fitur/commerce/audit lulus. Pemeriksaan browser desktop/ponsel meliputi CS, tiket admin, notifikasi, persetujuan biaya, kapasitas/durasi dan penggantian foto. Data akun/foto uji dibersihkan setelah pengujian. Model nyata dan key Google browser nyata belum diuji.

## Biaya peta

Google Maps browser key tidak memiliki biaya pembuatan tersendiri, tetapi pemakaian API ditagih. Dynamic Maps memiliki kuota gratis 10.000 pemuatan per bulan; tier berikutnya sampai 100.000 bertarif USD 7 per 1.000 pemuatan. Maps JavaScript memerlukan billing aktif. Kuota Places, rating dan Geocoding terpisah; kuota map tidak berarti seluruh pencarian gratis. Terapkan pembatasan key browser berdasarkan HTTP referrer dan API, key server terpisah, kuota request serta pemantauan billing. Budget alert adalah pemberitahuan, bukan jaminan penghentian tagihan.

Sumber resmi yang diperiksa pada 7 November 2026:

- [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Maps JavaScript billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing)

Key Google masih menunggu konfigurasi akun pemilik.
