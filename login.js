// mengambil lib dan modul
const express = require("express");
const path = require("node:path");
const crypto = require("node:crypto");
const session = require("express-session");
const db = require("./db");
const accounts = require("./bengkelin/repositories/accounts");
const bcrypt = require("bcrypt");

// Preparasi Express, port, dan JSON.
const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", "loopback");
app.use(express.json());

// menyimpan sesi di MySQL dan mengatur cookie sesi.
app.use(
  session({
    secret: require("./bengkelin/services/session-store").sessionSecret(),
    store:
      new (require("./bengkelin/services/session-store").MysqlSessionStore)(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.SESSION_COOKIE_SECURE === "true" ||
        process.env.NODE_ENV === "production",
      maxAge: 86400000,
    },
  }),
);

// memastikan pengguna sudah login sebelum mengakses rute yang dilindungi.
async function requireLogin(req, res, next) {
  if (!req.session.user) {
    if (req.originalUrl.startsWith("/api/"))
      return res.status(401).json({ message: "Silakan login terlebih dahulu" });
    return res.redirect("/login.html");
  }
  // memuat akun dan menghapus sesi jika akun atau versi autentikasi tidak valid.
  try {
    req.account = await accounts.findById(req.session.user.id);
    if (
      !req.account ||
      (req.session.authVersion ?? 0) !== (req.account.authVersion ?? 0)
    )
      return req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie("connect.sid");
        if (req.originalUrl.startsWith("/api/"))
          return res.status(401).json({
            message: "Akun tidak lagi tersedia. Silakan login kembali.",
          });
        res.redirect("/login.html");
      });
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (error) {
    next(error);
  }
}

// membatasi akses akun mitra ke fitur cust.
function denyPartner(req, res, next) {
  if (req.account.role !== "partner") return next();
  const message = "Fitur ini untuk akun cust. Buka dashboard mitra.";
  if (req.originalUrl.toLowerCase().startsWith("/api/")) {
    return res.status(403).json({ message });
  }
  return res.status(403).send(message);
}

// menampilkan beranda umum atau mengarahkan cust yang sudah login.
app.get("/", (req, res, next) => {
  const showHome = () =>
    res.sendFile(path.join(__dirname, "public", "home.html"));
  if (!req.session.user) return showHome();
  return requireLogin(req, res, (error) => {
    if (error) return next(error);
    return req.account.role === "customer"
      ? res.redirect("/landing.html")
      : showHome();
  });
});

// menampilkan beranda cust atau mengarahkan pengguna ke dashboard akunnya.
app.get("/landing.html", requireLogin, (req, res) => {
  if (req.account.role !== "customer")
    return res.redirect(req.account.dashboardUrl);
  res.sendFile(path.join(__dirname, "pages", "customer-home.html"));
});

// melindungi dan memasang rute dashboard.
app.use("/dashboard", requireLogin);
app.use("/api/dashboard", requireLogin);
app.use(require("./bengkelin/routes/dashboards").createDashboardRouter());

// Menyediakan halaman pencarian dengan pembatasan akses mitra.
app.get("/search.html", requireLogin, denyPartner, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "search.html")),
);

// menampilkan halaman pendaftaran mitra melalui alamat publik.
app.get("/registrasi-mitra.html", (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "partner-register.html")),
);

// mengarahkan pengguna ke rute dashboard mitra atau cust.
app.get("/dashboard-mitra.html", requireLogin, (req, res) =>
  res.redirect("/dashboard/partner"),
);
app.get("/dashboard-customer.html", requireLogin, (req, res) =>
  res.redirect("/dashboard/customer"),
);

// memasang rute lokasi dan mewajibkan login untuk fitur lokasi.
app.use("/api/location-name", requireLogin);
app.use(require("./bengkelin/routes/location").createLocationRouter());

// Mewajibkan login untuk API media dan halaman pendaftaran mitra ini.
app.use("/api/partner-media", requireLogin);
app.get("/partner-register.html", requireLogin, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "partner-register.html")),
);

// menampilkan halaman pengelolaan mitra khusus admin.
app.get("/admin-partners.html", requireLogin, async (req, res) => {
  if (
    !(await require("./bengkelin/repositories/partners").isAdmin(
      req.session.user.id,
    ))
  )
    return res.status(403).send("Halaman ini hanya untuk admin.");
  res.sendFile(path.join(__dirname, "pages", "admin-partners.html"));
});

// mengarahkan pengguna dari halaman indeks ke dashboard.
app.get("/index.html", requireLogin, (req, res) => res.redirect("/dashboard"));

// melayani aset Bengkelin setelah login dan membatasi akses langsung ke HTML.
app.use(
  "/assets/bengkelin",
  requireLogin,
  (req, res, next) => {
    let requestPath;
    try {
      requestPath = decodeURIComponent(req.path).toLowerCase();
    } catch {
      return res.status(400).send("Alamat aset tidak valid.");
    }
    if (requestPath.endsWith(".html"))
      return res.status(403).send("Buka halaman melalui dashboard akun Anda.");
    next();
  },
  express.static(path.join(__dirname, "bengkelin", "public"), {
    index: false,
    extensions: false,
    setHeaders: (res, file) => {
      if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    },
  }),
);

// melindungi dan memasang rute API mitra.
app.use("/api/partners", requireLogin);
app.use("/api/admin/partners", requireLogin);
app.use(require("./bengkelin/routes/partners").createPartnerRouter());

// memasang rute Bengkelin dengan pembatasan akses pada API bengkel.
app.use("/api/workshops", requireLogin, denyPartner);
app.use(require("./bengkelin/routes"));

// mengembalikan informasi akun yang sedang login.
app.get("/api/me", requireLogin, (req, res) => res.json({ user: req.account }));

// mengakhiri sesi dan menghapus cookie saat logout.
app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    res.json({ message: "Logout berhasil" });
  });
});

// memeriksa tipe dan isi input serta format email.
function validInput(email, password) {
  return (
    typeof email === "string" &&
    typeof password === "string" &&
    email.trim() !== "" &&
    password.trim() !== "" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

// menangani login dan membatasi frekuensi percobaan.
app.post(
  "/api/login",
  require("./bengkelin/services/rate-limit").loginLimit(),
  async (req, res, next) => {
    const { email, password } = req.body ?? {};
    if (!validInput(email, password))
      return res
        .status(400)
        .json({ message: "Email dan password tidak valid" });

    // mencari pengguna aktif dan memverifikasi password.
    try {
      const [rows] = await db.execute(
        "SELECT id, email, password_hash FROM users WHERE email = ? AND deleted_at IS NULL",
        [email.trim()],
      );
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ message: "Email atau password salah" });
      const account = await accounts.findById(user.id);
      if (!account)
        return res.status(401).json({ message: "Akun tidak tersedia." });
    
      // membuat sesi baru dan mengirim tujuan setelah login sesuai peran.
      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.user = { id: user.id, email: user.email };
        req.session.authVersion = account.authVersion ?? 0;
        req.session.save((error) => {
          if (error) return next(error);
          res.json({
            message: "Login berhasil",
            redirect:
              account.role === "customer"
                ? "/landing.html"
                : account.dashboardUrl,
          });
        });
      });
    } catch (error) {
      next(error);
    }
  },
);

// memvalidasi input dan panjang password saat registrasi.
app.post("/api/registrasi", async (req, res, next) => {
  const { email, password } = req.body ?? {};
  if (!validInput(email, password))
    return res.status(400).json({ message: "Email dan password tidak valid" });
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72)
    return res
      .status(400)
      .json({ message: "Password minimal 8 karakter dan maksimal 72 byte" });
  
  // menyimpan akun baru dengan hash password dan menangani email duplikat.
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", [
      email.trim(),
      passwordHash,
    ]);
    res.status(201).json({ message: "Registrasi berhasil. Silakan login." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "Email telah digunakan" });
    next(error);
  }
});

// mendaftarkan halaman cust dan membatasi akses akun mitra.
for (const page of ["partner-detail", "orders", "favorites", "support"]) {
  app.get("/" + page + ".html", requireLogin, denyPartner, (req, res) =>
    res.sendFile(path.join(__dirname, "pages", page + ".html")),
  );
}

// mendaftarkan halaman pengelolaan yang memerlukan login.
for (const page of [
  "owner-workshops",
  "owner-orders",
  "account-settings",
  "review-moderation",
])
  app.get("/" + page + ".html", requireLogin, (req, res) =>
    res.sendFile(path.join(__dirname, "pages", page + ".html")),
  );

// mewajibkan login untuk kelompok API berikut.
for (const prefix of [
  "/api/customer",
  "/api/owner",
  "/api/account",
  "/api/admin/reviews",
])
  app.use(prefix, requireLogin);

// membatasi akses ke API peta dan bantuan serta melindungi API tiket dan notifikasi.
app.use("/api/map-config", requireLogin, denyPartner);
app.use("/api/support", requireLogin, denyPartner);
for (const prefix of ["/api/admin/support-tickets", "/api/notifications"])
  app.use(prefix, requireLogin);

// memasang rute bantuan, audit, dan transaksi.
app.use(require("./bengkelin/routes/support").createSupportRouter());
app.use(require("./bengkelin/routes/audit").createAuditRouter());
app.use(require("./bengkelin/routes/commerce").createCommerceRouter());

// menampilkan halaman notifikasi setelah pengguna login.
app.get("/notifications.html", requireLogin, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "notifications.html")),
);

// menampilkan halaman pengelolaan bantuan khusus admin.
app.get("/support-admin.html", requireLogin, (req, res) => {
  if (req.account.role !== "admin")
    return res.status(403).send("Halaman ini hanya untuk admin.");
  res.sendFile(path.join(__dirname, "pages", "support-admin.html"));
});

// melayani file publik dan mengembalikan 404 untuk endpoint API yang tidak ditemukan.
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (req, res) =>
  res.status(404).json({ message: "Endpoint tidak ditemukan" }),
);

// menangani error permintaan dan mencatat error server.
app.use((error, req, res, next) => {
  if (error.status && error.status !== 413)
    return res.status(error.status).json({ message: error.message });
  if (error.status === 413)
    return res.status(413).json({ message: "Data terlalu besar." });
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ message: "Body JSON tidak valid" });
  console.error("Request gagal:", error.code || error.message);
  res
    .status(500)
    .json({ message: "Terjadi kesalahan server. Periksa koneksi database." });
});

// menjalankan server jika file ini dijalankan langsung.
if (require.main === module)
  app.listen(PORT, () => console.log(`Buka http://localhost:${PORT}/`));

// menjadwalkan pemeliharaan setiap menit saat file dijalankan langsung.
if (require.main === module) {
  const timer = setInterval(
    () =>
      require("./bengkelin/services/operations")
        .maintain()
        .catch((e) => console.error("Pemeliharaan gagal:", e.code || e.name)),
    60000,
  );
  timer.unref();
}

// mengekspor aplikasi Express agar dapat digunakan dari modul lain.
module.exports = app;
