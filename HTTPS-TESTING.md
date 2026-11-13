# Uji HTTPS dari laptop Ubuntu

Server aplikasi, MySQL, dan Ollama tetap berjalan di Ubuntu. Halaman /terms.html dan /privacy.html tersedia tanpa login; halaman aplikasi tetap memerlukan login. Halaman kebijakan menjelaskan penggunaan saat pengujian, bukan sertifikasi kepatuhan atau dokumen final untuk peluncuran komersial.

Cloudflare Quick Tunnel dipasang pada ~/.local/bin/cloudflared. Jalankan dari terminal Ubuntu:

```bash
~/.local/bin/cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
```

Salin alamat HTTPS yang dicetak. Pada .env, gunakan alamat tersebut untuk APP_TERMS_URL (akhiran /terms.html), APP_PRIVACY_URL (akhiran /privacy.html), GOOGLE_PLACES_ENABLED=true, dan SESSION_COOKIE_SECURE=true. API key tetap hanya di .env. Lalu jalankan npm run start:env.

Aplikasi mempercayai header proxy hanya dari koneksi loopback. Secure cookie memerlukan akses HTTPS; bila menguji langsung lewat http://IP:3000, gunakan SESSION_COOKIE_SECURE=false dan restart. Jangan mengandalkan HTTP untuk mengambil lokasi browser dari perangkat lain.

Pada server uji saat ini, proses background menyimpan PID/log di ~/.local/state/bengkel/{app,tunnel}.{pid,log}. Tunnel dan aplikasi perlu dijalankan kembali setelah reboot. URL Quick Tunnel berubah saat proses tunnel dibuat ulang; perbarui kedua URL kebijakan di .env dan restart aplikasi. Cadangan konfigurasi sebelum perubahan berada di ~/.local/state/bengkel-backups/. File konfigurasi berisi rahasia: jangan diunggah.

Pengguna membuka alamat HTTPS, login, lalu memilih Bengkel Umum. Browser diminta mengambil lokasi; setelah diizinkan, Google Places dipanggil memakai titik perangkat. Jika izin ditolak/lokasi gagal, hasil tidak ditampilkan. Tombol Cari di Google Maps meminta lokasi terbaru untuk pencarian ulang; radius 15 km adalah jarak garis lurus. Panggilan Google mengikuti billing/kuota Google Cloud, bukan biaya Cloudflare. Jangan membuka port MySQL atau Ollama ke publik.

Pengujian 3 November 2026: halaman publik HTTPS, register/login dengan Secure HttpOnly cookie, session, chatbot, logout, dan satu pencarian Nearby Search nyata berhasil (20 hasil di sekitar Juanda). Izin lokasi perangkat perlu diverifikasi interaktif oleh pengguna. Akun uji dihapus. API key dan hostname sementara tidak dimasukkan ke Git.

Referensi: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ dan https://developers.google.com/maps/documentation/places/web-service/policies
