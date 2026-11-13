# Penyelesaian enam temuan audit

| Temuan | Perbaikan |
| --- | --- |
| Revisi dapat mengaktifkan bengkel pemilik nonaktif | Pengajuan dan keputusan admin mengunci serta memeriksa pemilik aktif. Penonaktifan akun membatalkan revisi pending. Antrean admin menyaring pemilik nonaktif. Pemeriksaan berlaku juga untuk persetujuan pendaftaran awal tanpa revisi. |
| Foto derek pending tidak dikenali | Validasi dilakukan di transaksi yang menggabungkan profil dengan foto revisi pending. Pemilik dapat mengunggah foto derek, lalu mengaktifkan layanan sebelum revisi disetujui; profil lama tetap tampil sampai keputusan admin. |
| Risiko deadlock revisi | Urutan lock disamakan: pemilik → bengkel → detail → revisi. Transaksi yang mengalami ER_LOCK_DEADLOCK/ER_LOCK_WAIT_TIMEOUT dicoba ulang maksimal tiga kali; koneksi selalu dilepas. |
| Balasan tiket tidak memberi notifikasi | Balasan, penutupan tiket dan satu notifikasi ke pemilik tiket disimpan dalam transaksi yang sama. Membalas tiket yang telah ditutup menghasilkan 409; tidak membuat notifikasi duplikat. Tautan notifikasi tiket menuju Customer Service. |
| Batas lima tiket dapat dilampaui request paralel | Pembuatan tiket mengunci baris pengguna, menghitung tiket terbuka dan menyimpan tiket dalam satu transaksi. Akun yang sudah dinonaktifkan juga ditolak. |
| Validasi foto hanya berdasarkan header | Foto harus berhasil didecode secara utuh oleh sharp. Hanya JPEG/PNG/WebP statis, input maksimal 3 MB/foto dan 24 megapiksel. Gambar dikoreksi orientasinya, dibatasi sisi maksimal 2400 piksel, dikonversi WebP dan metadata asli tidak diteruskan. Gambar rusak/terpotong ditolak sebelum disimpan. |

Tidak ada migrasi database baru. Sesudah mengambil kode, jalankan `npm ci` untuk memasang decoder gambar dan mulai ulang server. Persyaratan migrasi 001–004 sebelumnya tetap berlaku.

Pengujian:

```powershell
npm test
npm run test:features
npm run test:commerce
npm run test:audit
npm run test:six-fixes
```

Semua suite tersebut lulus saat implementasi. Tes khusus mencakup 10 tiket paralel (5 diterima, 5 ditolak), notifikasi balasan tunggal dan isolasi penerima, gambar terpotong/header palsu, konversi WebP, aktivasi derek dari foto pending, proposal/keputusan serentak, retry deadlock yang disimulasikan serta penolakan persetujuan setelah akun dinonaktifkan. Pengujian browser desktop/ponsel juga lulus untuk unggah foto, CS, pembuatan/balasan tiket, notifikasi dan persetujuan biaya.

Pengujian memakai akun/foto sementara yang dibersihkan setelah selesai. Key peta browser dan ketersediaan Ollama tidak diubah dalam pekerjaan ini.
