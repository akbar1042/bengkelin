# KunciGarasi

Platform web perawatan kendaraan berbasis **Express + MySQL** untuk menghubungkan pelanggan dengan mitra bengkel terverifikasi. Mendukung pencarian bengkel berbasis lokasi, konsultasi AI teknis kendaraan, AI Customer Service, pemesanan servis (COD & QRIS), layanan darurat **SOS Derek**, serta dashboard terpisah untuk **Customer**, **Mitra Bengkel**, dan **Admin**.

---

## Struktur Direktori

```text
/
├── login.js              # Entry point server Express, session store MySQL, auth guard & HTML routing
├── db.js                 # Koneksi pool MySQL (mysql2/promise)
├── chat-routes.js        # Endpoint konsultasi AI Teknis (/api/chat) berbasis Gemini API
├── database.sql          # Skema awal tabel database MySQL
├── package.json          # Dependencies & npm scripts (start, migrate, test, admin CLI)
├── .env.example          # Template konfigurasi environment (.env tidak di-commit ke Git)
│
├── kunciGarasi/          # Core modul domain backend & aset terproteksi
│   ├── data/             # Data pendukung/referensi bengkel
│   ├── lib/              # Helper validasi input mitra & utilitas bengkel
│   ├── repositories/     # Query repository akun & bengkel mitra
│   ├── routes/           # Modular Express routers (audit, commerce, dashboards, location, partners, support)
│   ├── services/         # Business logic (operations, partner-media, revisions, rate-limit, gemini, google-places, session-store)
│   └── public/           # Aset terproteksi yang disajikan melalui /assets/kunciGarasi
│
├── pages/                # Halaman HTML terautentikasi (Customer, Mitra, Admin)
├── public/               # Halaman publik/guest, stylesheet (brand.css, frontend.css), script client & gambar
├── migrations/           # Skrip SQL migrasi bertahap (001 s.d. 005)
├── scripts/              # Utilitas CLI migrasi database & pengelolaan role admin
└── tests/                # Unit test (*.test.cjs) & integration test (*.integration.cjs)
```

---

## Cara Menjalankan di Lokal (Setelah `git clone`)

### 1. Prasyarat

- **Node.js** v20+ (mendukung `--env-file`)
- **MySQL Server** aktif di lokal (default host `localhost`, user `root`, database `bengkel`)

### 2. Instalasi & Konfigurasi `.env`

```powershell
git clone https://github.com/akbar1042/bengkelin.git
cd bengkelin
npm install
```

Salin `.env.example` menjadi `.env`, lalu isi nilainya:

```powershell
Copy-Item .env.example .env
```

Variabel penting pada `.env`:

- `DB_PASSWORD`: Password MySQL lokal (kosongkan jika tidak memakai password)
- `SESSION_SECRET`: String acak untuk enkripsi session cookie
- `AI_PROVIDER` / `GEMINI_API_KEY` / `GEMINI_MODEL`: Konfigurasi Gemini API untuk Konsultasi AI & AI CS
- `GOOGLE_PLACES_ENABLED`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_GEOCODING_API_KEY`, `GOOGLE_MAPS_BROWSER_KEY`: Opsional untuk pencarian & peta Google Maps
- `SESSION_COOKIE_SECURE`: Biarkan `false` untuk HTTP lokal (`http://localhost:3000`)

### 3. Setup Database & Migrasi

1. Buat database dan import skema awal dari `database.sql` ke MySQL.
2. Jalankan skrip migrasi secara berurutan:

```powershell
npm run migrate:partners
npm run migrate:features
npm run migrate:commerce
npm run migrate:audit
npm run migrate:support
npm run migrate:review-versions
```

3. _(Opsional)_ Menjadikan akun terdaftar sebagai **Admin**:

```powershell
npm run admin:grant email-admin@contoh.com
```

### 4. Menjalankan Server

```powershell
npm run start:env
```

Buka browser di **`http://localhost:3000/`**.

---

## Fitur Utama & Alur Aplikasi

### 1. Sistem Role & Proteksi Sesi

- **Guest (Tanpa Sesi)**: Hanya dapat mengakses beranda (`/`, `/home.html`), form login & registrasi (`/login.html`, `/login-mitra.html`, `/registrasi.html`, `/registrasi-mitra.html`), serta halaman syarat & privasi. Akses ke halaman terproteksi otomatis diarahkan ke `/login.html`.
- **Sudah Login (Sesi Aktif)**: Tidak dapat membuka halaman beranda guest maupun form login/registrasi sebelum logout; otomatis diarahkan ke dashboard sesuai role (`/landing.html` untuk Customer, `/dashboard/partner` untuk Mitra, `/dashboard/admin` untuk Admin).
- Sesi disimpan secara persisten di MySQL (`app_sessions`) dan otomatis dicabut ketika password diganti atau akun dinonaktifkan (`authVersion`).

### 2. Customer (`/landing.html`, `/search.html`, `/orders.html`)

- **Pencarian Bengkel & Peta**: Pencarian mitra terverifikasi maupun Google Places berbasis koordinat GPS perangkat dan filter layanan.
- **Konsultasi AI (`/ai.html`) & Customer Service AI (`/support.html`)**: Diagnosa gejala awal kendaraan dan panduan fitur aplikasi.
- **Pemesanan & Pembayaran**: Penjadwalan servis dengan pengecekan kapasitas & bentrok slot, konfirmasi biaya berversi oleh pelanggan, pilihan bayar **COD** atau **QRIS**, serta konfirmasi selesai 2 pihak (auto-complete dalam 24 jam).

### 3. Layanan Darurat SOS Derek (7 Tahap)

1. Pelanggan mencentang opsi **Butuh layanan derek / penjemputan darurat (SOS)** saat memesan.
2. Pesanan mendapat notifikasi `🚨 [SOS DEREK]`, tampil paling atas di **Dashboard Mitra**, dan **wajib diterima** oleh mitra (tombol tolak dinonaktifkan).
3. Mitra menekan **Konfirmasi Menuju Lokasi** (`PATCH /api/orders/:id/towing` dengan `action: 'on_the_way'`).
4. Pelanggan menekan **Mitra Sudah Sampai & Menangani** (`action: 'arrived'`), status berpindah menjadi `Diproses`.
5. Mitra mengirim rincian biaya dan pelanggan memilih pembayaran (**QRIS** / **COD**).
6. Mitra mengonfirmasi pembayaran diterima (`PATCH /api/owner/orders/:id/confirm-payment`).
7. Kedua pihak mengonfirmasi penyelesaian order (pelanggan baru dapat menyelesaikan setelah mitra mengonfirmasi selesai).

### 4. Mitra Bengkel (`/dashboard/partner`, `/owner-orders.html`, `/owner-workshops.html`)

- **Tracking History & Pendapatan**: Ringkasan **Total Order**, **Total Pendapatan**, distribusi metode bayar (**QRIS / COD**), serta histori pesanan dengan prioritas SOS Derek.
- **Kelola Pesanan & Profil Bengkel**: Penerimaan/penolakan order, input/revisi rincian biaya, pengajuan bengkel baru, serta revisi profil bengkel (menunggu persetujuan admin sebelum tayang).

### 5. Admin (`/dashboard/admin`, `/admin-accounts.html`, `/admin-monitoring.html`)

- **Ringkasan Platform**: Statistik akun & bengkel yang terhubung langsung ke halaman detail terfilter.
- **Kelola Akun (`/admin-accounts.html`)**: Daftar seluruh akun pengguna (`customer`, `partner`, `admin`) dan daftar bengkel beserta status moderasinya.
- **Log Monitoring Aktivitas & Transaksi (`/admin-monitoring.html`)**: Pemantauan seluruh transaksi QRIS/COD, total order, total transaksi, dan log event real-time antar pelanggan, mitra, dan sistem.
- **Moderasi Mitra**: Meninjau pengajuan bengkel baru, menyetujui/menolak revisi profil, dan mencabut status mitra.

---

## Pengujian Otomatis

```powershell
# Unit & UI contract tests (tanpa database)
npm test

# Integration tests (memerlukan MySQL aktif dan .env)
npm run test:dashboards
npm run test:features
npm run test:commerce
npm run test:audit
npm run test:partners
```

---
