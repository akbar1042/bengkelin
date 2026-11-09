Perubahan terbaru mengenai biaya, kapasitas, revisi, notifikasi dan Customer Service ada di [AUDIT-FIXES.md](AUDIT-FIXES.md). Ketentuan terbaru tersebut menggantikan batasan tahap awal yang dijelaskan di bawah.

# Pemesanan dan pengelolaan Bengkelin

Pemesanan tahap ini tidak menggunakan pembayaran online. Biaya dicatat bengkel dan dikonfirmasi langsung kepada pelanggan sebelum pengerjaan; angka yang dicatat bukan bukti pembayaran.

## Halaman dan role

| Halaman | Akses dan fungsi |
| --- | --- |
| `/partner-detail.html?id=ID` | Pengguna login: layanan, kontak, jam operasional, foto, ulasan approved. Pelanggan dapat memesan dan menyimpan favorit. |
| `/orders.html` | Pelanggan: pesanan sendiri, biaya yang diinformasikan, riwayat status, pembatalan sebelum diproses, ulasan sesudah selesai. |
| `/favorites.html` | Pelanggan: simpan/hapus mitra favorit. Bengkel yang dicabut tidak dapat dipesan. |
| `/owner-workshops.html` | Pemilik: ubah nama, alamat, kontak, koordinat, kategori motor/mobil, layanan, hari/jam buka dan fasilitas. Perubahan memerlukan persetujuan admin kembali. Foto yang sudah ada dipertahankan. |
| `/owner-orders.html` | Pemilik: pesanan bengkel miliknya, penerimaan/penolakan, proses/selesai, biaya serta riwayat. |
| `/review-moderation.html` | Admin: menyetujui/menolak ulasan disertai alasan. |
| `/account-settings.html` | Semua akun login: ganti password dan penonaktifan akun. Admin harus melepas role admin sebelum penonaktifan. |
| `/help.html` | Publik: alur penggunaan dan kontak admin contoh `08xx-xxxx-xxxx — belum aktif`, tanpa tautan telepon/WhatsApp. |

Endpoint memeriksa identitas/ownership dari sesi, bukan menerima identitas pemilik dari formulir. Role pelanggan diperlukan untuk pesanan baru, favorit, dan ulasan. Pengelola yang profilnya kembali pending tetap dapat mengelola pesanan lama melalui endpoint kepemilikan.

## Jadwal dan status

Slot awal satu jam per bengkel, termasuk pesanan yang menunggu. Minimal 15 menit dari sekarang, maksimal 90 hari, dan harus berada dalam hari/jam buka WIB. Jam lintas tengah malam diperiksa terhadap hari pembukaan. Konflik ditolak menggunakan transaksi dan lock bengkel. Kapasitas lebih dari satu mekanik dan durasi berbeda per layanan belum disediakan.

Status: `waiting → accepted → processing → completed`. `cancelled` dapat digunakan oleh bengkel dari menunggu/diterima/diproses dengan alasan; pelanggan hanya dapat membatalkan sebelum diproses. Penyelesaian sebelum jadwal ditolak. Perubahan status tercatat dengan aktor dan waktu. Waktu database untuk koneksi aplikasi adalah UTC, tampilan memakai zona perangkat.

Ulasan hanya satu per pesanan milik pelanggan yang selesai. Status awal pending; hanya ulasan approved yang ditampilkan dan dihitung dalam rating mitra. Ulasan Google tetap berasal dari Google, tidak dicampur dengan rating lokal.

## Akun dan riwayat

Ganti password mencabut sesi lama. Penonaktifan memerlukan password dan teks `HAPUS AKUN`. Pesanan diterima/diproses harus diselesaikan atau dibatalkan dahulu. Email login dianonimkan, akun tidak dapat dipakai login, bengkel pemilik dinonaktifkan, pesanan menunggu dibatalkan dan favorit dibersihkan. Riwayat layanan serta relasi audit dipertahankan; tindakan ini bukan penghapusan fisik seluruh catatan historis.

## Konsultasi AI kendaraan

Pilih motor atau mobil sebelum mengirim keluhan. Konsultasi menggunakan gelembung percakapan dan tidak meminta lokasi. Untuk menemukan bengkel terdekat, buka `/search.html`.

## Peta

`GOOGLE_MAPS_BROWSER_KEY` mengaktifkan Google Maps JavaScript dengan titik pelanggan, semua hasil bengkel dan lingkaran radius 15 KM. Gunakan key browser tersendiri dengan pembatasan HTTP referrer ke domain aplikasi dan akses Maps JavaScript API. Key server Places/Geocoding tidak dipublikasikan sebagai key browser.

Jika key browser belum diisi, peta titik terpilih tetap digunakan dan aplikasi menjelaskan bahwa peta multi titik belum dikonfigurasi. Hasil Places hanya ditampilkan pada peta Google, sesuai [kebijakan Places](https://developers.google.com/maps/documentation/places/web-service/policies). Lihat [pemuatan Maps JavaScript](https://developers.google.com/maps/documentation/javascript/load-maps-js-api) untuk konfigurasi.

## Migrasi dan pengujian

Pada server setelah mengambil kode baru, jalankan dari folder proyek:

```powershell
npm ci
npm run migrate:partners
npm run migrate:features
npm run migrate:commerce
npm test
npm run test:features
npm run test:commerce
```

Migrasi menambahkan tabel tanpa menghapus data. Uji integrasi membuat akun/pesanan sementara dan membersihkannya setelah selesai. Tetap gunakan lingkungan uji untuk menjalankan tes integrasi.

Validasi saat implementasi: regresi AI/lokasi/role dan tes fitur sebelumnya lulus; pengujian commerce mencakup isolasi data, konflik slot paralel, status, biaya, moderasi/rating, edit profil, ganti password serta penonaktifan. Pemeriksaan browser mencakup tujuh halaman menurut role pada lebar 1366 dan 390 serta aksi favorit, pesan dan batal. Peta dengan key Google browser nyata belum diverifikasi karena konfigurasi belum tersedia.
