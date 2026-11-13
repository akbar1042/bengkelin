# Dashboard tiga role dan prioritas pengembangan

## Perilaku yang sudah berjalan

| Role aplikasi | Dashboard | Fitur yang tersedia |
|---|---|---|
| Pelanggan (customer) | /dashboard/customer | Pencarian mitra dan Google dengan izin lokasi, konsultasi AI, ringkasan/status pengajuan kemitraan sendiri, daftar mitra, logout |
| Pemilik Bengkel (partner) | /dashboard/partner | Ringkasan bengkel approved/pending/rejected milik sendiri, alamat/layanan/catatan keputusan, pengajuan bengkel tambahan, logout |
| Admin (admin) | /dashboard/admin | Ringkasan total akun/bengkel dan status persetujuan, antrean pending, persetujuan/penolakan, catatan keputusan, penautan Google Place ID, logout |

Login mengembalikan redirect sesuai role. /dashboard memilih dashboard akun; /landing.html tetap kompatibel untuk pelanggan dan mengarahkan pemilik/admin ke dashboard mereka. Halaman/API dashboard role lain mengembalikan 403. Halaman HTML pelanggan tidak dapat diambil melalui jalur assets untuk melewati pemeriksaan role. Halaman utama sengaja berupa HTML tanpa penambahan CSS untuk tim frontend.

Role aplikasi ditentukan ulang dari database pada setiap request terlindungi: users.role=admin mendapat prioritas; selain admin, akun dengan minimal satu partner_workshops berstatus approved menjadi partner; sisanya customer. users.role tetap menyimpan customer/admin untuk kewenangan administrasi. Pemilik bukan pilihan yang dapat diberikan sendiri saat registrasi, dan role session lama tidak menjadi dasar otorisasi. Pending/rejected tidak memberi akses dashboard partner. Jika persetujuan terakhir dicabut, akses kembali customer tanpa harus logout. Tidak ada migrasi schema atau promosi akun asli dalam perubahan ini.

Semua API dashboard memakai identitas dari session yang diverifikasi, bukan userId/role dari query atau body. /api/dashboard/customer dan /api/dashboard/partner hanya membaca pengajuan milik akun tersebut. /api/dashboard/admin memuat statistik agregat; detail pending tetap pada API admin yang sudah ada. Endpoint pencarian, chat, dan pendaftaran mitra tetap merupakan fungsi untuk pengguna terautentikasi; pemisahan dashboard tidak menghapus API umum tersebut.

## Kekurangan per role

| Role | Prioritas | Kekurangan atau peningkatan | Kriteria selesai |
|---|---|---|---|
| Pelanggan | P1 | Detail bengkel dan kontak | Halaman detail dengan layanan terkonfirmasi, jam operasional dan kontak; data Google tetap terpisah |
| Pelanggan | P1 | Pemesanan servis | Pilih mitra/layanan/jadwal, isi keluhan, simpan pesanan milik pelanggan |
| Pelanggan | P1 | Status dan pembatalan | Lihat riwayat menunggu/diterima/diproses/selesai/batal dengan aturan perubahan status |
| Pelanggan | P1 | Pengaturan akun | Ganti password, verifikasi email, permintaan penghapusan akun |
| Pelanggan | P2 | Favorit dan ulasan | Favorit per akun; ulasan hanya dari pesanan selesai, dengan moderasi |
| Pelanggan | P2 | Rekomendasi chatbot menurut lokasi | Mitra approved sesuai layanan sekaligus radius 15 KM dari koordinat yang diizinkan; rekomendasi chat saat ini belum memakai lokasi |
| Pelanggan | P2 | Peta dan bantuan | Peta internal dan bantuan nyata; menu pesanan/favorit saat ini diberi label belum tersedia |
| Pemilik Bengkel | P1 | Edit profil dengan review perubahan | Ubah alamat/koordinat/layanan/kontak tanpa mengubah owner/status sendiri; perubahan penting ditinjau ulang |
| Pemilik Bengkel | P1 | Kelola pesanan | Terima/tolak pesanan milik bengkelnya saja, ubah status sesuai transisi yang dibolehkan |
| Pemilik Bengkel | P1 | Jadwal dan kapasitas | Jam buka, slot servis, kuota mekanik dan status menerima pesanan |
| Pemilik Bengkel | P1 | Katalog layanan dan estimasi | Layanan/harga/estimasi terkelola dan dinyatakan sebagai estimasi; belum ada transaksi/penawaran |
| Pemilik Bengkel | P2 | Notifikasi dan penjemputan | Notifikasi pesanan; alur pickup/derek nyata, bukan hanya flag layanan |
| Pemilik Bengkel | P2 | Riwayat dan laporan | Riwayat servis, ulasan pelanggan, laporan pendapatan setelah transaksi benar-benar tersedia |
| Admin | P1 | Verifikasi pemilik bengkel | Bukti kepemilikan, checklist peninjauan dan penanganan sengketa; approval sekarang masih keputusan manual |
| Admin | P1 | Daftar seluruh mitra | Pencarian/pagination/filter approved-pending-rejected; antrean saat ini berfokus pending |
| Admin | P1 | Audit keputusan | Riwayat append-only siapa mengubah apa/kapan; kolom reviewer saat ini hanya menyimpan keputusan terakhir |
| Admin | P1 | Pengelolaan akun dan suspend | UI pengaturan akses admin yang terkontrol, penangguhan bengkel/akun, alasan dan audit; pengaturan admin sekarang melalui query/CLI |
| Admin | P1 | Master layanan | Pisahkan katalog layanan ke data master terkelola; saat ini katalog diturunkan dari daftar layanan contoh |
| Admin | P2 | Moderasi dan pelaporan | Keluhan pelanggan/ulasan, laporan operasional, monitoring error/kuota Google dan kualitas jawaban AI |

P1 adalah kelanjutan inti agar alur pelanggan membuat pesanan, bengkel menanganinya, dan admin dapat mengawasi berjalan utuh. P2 mengikuti setelah alur transaksi dasar tersedia. Fitur di tabel kekurangan belum diimplementasikan oleh perubahan dashboard ini.

## Peningkatan bersama

- Session persisten (database/Redis); session saat ini berada dalam memori dan hilang saat backend dimulai ulang.
- Pembatasan percobaan login, proteksi request perubahan data, pemantauan akses dan pengujian otorisasi berkelanjutan.
- Pagination daftar, validasi ukuran permintaan dan penanganan error yang konsisten.
- Backup/pemulihan MySQL dan proses server otomatis; tunnel pengujian tetap bergantung pada laptop/proses aktif.
- Konfigurasi .env tidak masuk Git. Dashboard menggunakan data nyata dan tidak menampilkan angka pesanan/pendapatan buatan.

## Pengujian

npm test menjalankan tes dashboard dengan repository simulasi tanpa database. node --env-file=.env tests/dashboards.integration.cjs atau npm run test:dashboards (dengan env database yang sesuai) menguji MySQL nyata: routing login tiga role, pending, approve/revoke, matriks akses, isolasi pemilik, beberapa bengkel, prioritas admin, penolakan jalur HTML langsung, dan session akun yang dihapus. Fixture akun/bengkel dihapus setelah pengujian. Google dinonaktifkan dalam tes integrasi ini.
