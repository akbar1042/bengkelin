# Klasifikasi bengkel dan alur mitra

## Dua kelompok bisnis

- **Mitra Bengkelin**: data pendaftaran milik akun Bengkelin, status approved dari admin. Pending dan rejected tidak masuk pencarian publik atau rekomendasi AI.
- **Bengkel umum — Google Maps**: data hasil Places API yang belum cocok dengan Place ID mitra approved. Tidak diberi label mitra, tidak dianggap mendukung jemput/darurat, dan tidak diberi rating buatan.

Data 20 bengkel fiktif lama tetap tersedia lewat group=demo, terpisah dan diberi label Data contoh. Nama, jarak, atau rating tidak digunakan untuk menebak status kemitraan.

## Database dan migrasi

Untuk instalasi baru, jalankan database.sql. Untuk database lama:

```powershell
npm run migrate:partners
```

Migrasi menambahkan users.role (customer/admin, default customer) jika belum ada, lalu membuat partner_workshops. Tidak menghapus akun atau mengubah akun menjadi admin secara otomatis.

Admin bisa ditentukan dengan query langsung:

```sql
UPDATE users SET role = 'admin' WHERE email = 'email-akun-terdaftar';
-- Mencabut akses:
UPDATE users SET role = 'customer' WHERE email = 'email-akun-terdaftar';
```

Alternatif lokal: npm run admin:grant -- email-akun-terdaftar, atau admin:revoke. Backend memeriksa role di database pada setiap request admin; perubahan berlaku tanpa login ulang. Body request pendaftaran tidak dapat menentukan role, owner, atau status approved. Status mitra melekat pada bengkel; akun dengan minimal satu bengkel approved memperoleh role dashboard partner secara efektif. Persetujuan mitra tidak memberikan role admin kepada pemiliknya.

## Alur dan halaman

1. Pengguna login lalu membuka /partner-register.html.
2. POST /api/partners mencatat pendaftaran pending dengan owner dari sesi.
3. Pengguna melihat statusnya lewat GET /api/partners/mine; hanya pendaftaran sendiri yang ditampilkan.
4. Admin membuka /admin-partners.html, memeriksa informasi bengkel, lalu menyetujui atau menolak.
5. Bengkel approved tampil pada pencarian mitra dan menjadi kandidat rekomendasi AI berdasarkan layanan yang didaftarkan.

Tidak ada akun pengguna yang otomatis diberi role admin dalam implementasi ini. Persetujuan mengandalkan pemeriksaan admin, bukan verifikasi kepemilikan bisnis otomatis. Halaman HTML sengaja tanpa CSS untuk tim frontend.

## Kontrak endpoint

- GET /api/workshops?group=partner&lat=LAT&lng=LNG : hanya approved, radius 15 km dari lokasi perangkat; koordinat wajib.
- GET /api/workshops?group=general&sort=distance&lat=LAT&lng=LNG : pencarian Google dengan koordinat wajib; tanpa koordinat mengembalikan 400 LOCATION_REQUIRED.
- GET /api/workshops?group=demo&lat=LAT&lng=LNG : data contoh fiktif dengan koordinat wajib, isDemo=true dan isPartner=false.
- GET /api/workshops/sources : status konfigurasi (tidak berisi API key).
- GET /api/workshops/partner:ID : detail mitra approved.
- GET /api/partners/services : daftar nilai layanan yang diterima.
- GET /api/partners/mine : pendaftaran milik pengguna.
- POST /api/partners : name, address, phone, lat/lng angka, services array, pickup/onsite/emergency/open24 boolean.
- GET /api/admin/partners : pendaftaran pending, khusus admin.
- POST /api/admin/partners/ID/review : status approved/rejected, note opsional, googlePlaceId opsional.

Semua endpoint di atas memerlukan login. Endpoint admin mengembalikan 403 untuk customer. Koordinat tidak valid menghasilkan 400, bukan diam-diam dipindahkan. Rating mitra belum tersedia karena belum ada sistem ulasan, sehingga null. Rekomendasi mitra saat rating belum tersedia mempertimbangkan jarak; tidak dianggap bukti kualitas layanan.

## Integrasi Google yang disiapkan

Google belum diaktifkan dan tidak ada request API Google nyata yang dilakukan selama implementasi. Agar aktif, pasang konfigurasi pada server:

```powershell
$env:GOOGLE_PLACES_ENABLED = 'true'
$env:GOOGLE_PLACES_API_KEY = 'key-milikmu'
$env:APP_TERMS_URL = 'https://domain-aplikasimu/terms'
$env:APP_PRIVACY_URL = 'https://domain-aplikasimu/privacy'
npm start
```

Alternatif file: salin .env.example menjadi .env, isi nilainya, lalu npm run start:env. File .env tidak di-commit. Jika memakai .env saat migrasi, jalankan node --env-file=.env scripts/migrate-partners.cjs. Gunakan URL kebijakan aplikasi yang benar-benar dipublikasikan dan sesuaikan persyaratan layanan Google; URL HTTPS tidak otomatis membuktikan isi kebijakan sudah sesuai.

Konektor menggunakan Places API (New) Nearby Search, includedTypes=car_repair, radius 15.000 meter, maksimal 20 hasil sebelum filter, dan field mask dasar tanpa rating/review/foto. Ini cakupan awal kategori Google car_repair, bukan jaminan seluruh bengkel motor atau semua bengkel di area ditemukan. Kata kunci memfilter nama/alamat dari hasil yang didapat, bukan Text Search menyeluruh. General tidak menerima filter layanan khusus atau minimum rating karena data itu tidak dikonfirmasi.

Memilih Bengkel Umum meminta lokasi perangkat dan otomatis mencari setelah lokasi diizinkan. Tombol Cari di Google Maps atau tombol lokasi juga meminta titik terbaru lalu mencari. Jika izin ditolak, lokasi gagal, atau timeout, hasil dibersihkan dan Google tidak dipanggil; tidak ada fallback Juanda untuk kelompok umum. Pengetikan tidak otomatis memanggil Google. Batas aplikasi: jeda 10 detik, 20 pencarian per pengguna per jam, 60 per proses per jam. Batas ini disimpan di memori dan bukan pengganti kuota/batas biaya di Google Cloud. Request dapat dikenai biaya sesuai konfigurasi akun/SKU. Tidak ada penyiapan billing otomatis.

Hasil Google tidak dimasukkan ke MySQL atau cache konten. Data partner berasal dari pemilik/admin. Admin dapat menautkan Place ID setelah memastikan listing yang benar; Place ID approved dipakai untuk mengeluarkan listing duplikat dari kelompok umum. Tanpa penautan ID, sistem tidak bisa memastikan identitas hanya dari kemiripan nama; unmatched bukan bukti mutlak bahwa suatu usaha tidak bermitra.

Logo atribusi resmi disimpan tanpa modifikasi, attributions provider diteruskan, dan tampilan memisahkan hasil Google dari mitra. Sebelum publikasi, tim frontend perlu mempertahankan atribusi Google Maps dan tautan kebijakan. Informasi layanan, buka 24 jam, dan rating Google bernilai null jika tidak diminta/diketahui. Tanpa konfigurasi, aplikasi menampilkan tautan pencarian langsung Google Maps, bukan data Google palsu.

Referensi resmi:
- https://developers.google.com/maps/documentation/places/web-service/nearby-search
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/documentation/places/web-service/place-types

## Rekomendasi AI

Rekomendasi bengkel sekarang hanya berasal dari mitra approved dengan layanan sesuai. Model dan data training tidak diubah. Bila data mitra tidak tersedia, jawaban penilaian awal tetap diberikan dengan rekomendasi kosong dan status_rekomendasi=unavailable. Tidak ada fallback tersembunyi ke bengkel fiktif.

## Pengujian

npm test mencakup kontrak chat, triase, dan klasifikasi/provider Google dengan fetch simulasi. Tidak memerlukan key dan tidak melakukan request Google berbayar. npm run test:partners memeriksa MySQL nyata, pendaftaran pending, SQL role langsung, penolakan pelanggan pada API admin, persetujuan/pencabutan, dan rekomendasi AI; akun dan bengkel uji dihapus sesudahnya.

Tampilan pencarian kini menyebut kelompok dan sumber aktif secara eksplisit. Hasil lama dibersihkan saat mengganti kelompok atau memulai pencarian; respons yang terlambat tidak boleh menimpa kelompok baru. Frontend memeriksa envelope group/source dan penanda setiap baris (ID, isDemo, isPartner, status approved untuk mitra); data yang tidak sesuai ditolak tanpa fallback ke contoh fiktif. Data contoh tetap hanya pada kelompok demo yang dipilih secara eksplisit. Jumlah 20 hasil Google adalah batas request, bukan indikasi bahwa data tersebut contoh.


Izin lokasi mengikuti keputusan browser: pengguna yang sudah mengizinkan mungkin tidak melihat popup lagi, dan izin yang sebelumnya diblokir perlu diubah melalui pengaturan situs. Koordinat perangkat ditampilkan agar titik pencarian dapat diperiksa. Backend mewajibkan koordinat untuk general; keputusan izin diperiksa di browser. Mitra/demo juga memerlukan koordinat perangkat. Pengujian 6 November 2026 pada URL Dev Tunnels: penolakan izin native memblokir request Google; lokasi Malang simulasi (-7.9666,112.6326) otomatis menghasilkan 20 hasil Google dengan titik yang sesuai. Akun uji dibersihkan.

Lokasi default telah dihapus dari seluruh endpoint pencarian/detail dan tampilan. Tanpa koordinat, API mengembalikan 400 LOCATION_REQUIRED; tidak ada tautan Maps bertitik Juanda. Tombol Mitra/Cari mitra meminta lokasi. Jika izin ditolak, tampil “Izin lokasi tidak diberikan.” Jika lokasi berhasil didapat tetapi tidak ada mitra dalam radius 15 KM, tampil “Tidak ada mitra yang tersedia di lokasi Anda dengan jangkauan 15 KM.” Timeout/lokasi gagal memakai pesan kegagalan lokasi, bukan pesan mitra kosong.

Dashboard pelanggan, pemilik bengkel, dan admin dipisahkan; aturan role efektif, endpoint, serta daftar kekurangan per role ada di DASHBOARDS.md. users.role tetap customer/admin untuk kewenangan administrasi, sedangkan akses pemilik ditentukan kepemilikan approved yang diperiksa pada setiap request.
