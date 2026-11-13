// mengambil lib dan modul
const fs = require("node:fs");
const path = require("node:path");
const envPath = path.join(__dirname, ".env");
if (typeof process.loadEnvFile === "function" && fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // ignore if already loaded or invalid
  }
}
const express = require("express");
const crypto = require("node:crypto");
const session = require("express-session");
const db = require("./db");
const accounts = require("./kunciGarasi/repositories/accounts");
const bcrypt = require("bcrypt");
const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", "loopback");
app.use(express.json());
app.use(
  session({
    secret: require("./kunciGarasi/services/session-store").sessionSecret(),
    store:
      new (require("./kunciGarasi/services/session-store").MysqlSessionStore)(
        db,
      ),
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
async function requireLogin(req, res, next) {
  if (!req.session.user) {
    if (req.originalUrl.startsWith("/api/"))
      return res.status(401).json({ message: "Silakan login terlebih dahulu" });
    return res.redirect("/login.html");
  }
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
function denyPartner(req, res, next) {
  if (req.account.role !== "partner") return next();
  const message = "Fitur ini untuk akun pelanggan. Buka dashboard mitra.";
  if (req.originalUrl.toLowerCase().startsWith("/api/")) {
    return res.status(403).json({ message });
  }
  return res.status(403).send(message);
}
async function redirectIfLoggedIn(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  if (!req.session?.user) return next();
  try {
    const account = await accounts.findById(req.session.user.id);
    if (
      !account ||
      (req.session.authVersion ?? 0) !== (account.authVersion ?? 0)
    ) {
      return req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie("connect.sid");
        next();
      });
    }
    return res.redirect(
      account.role === "customer" ? "/landing.html" : account.dashboardUrl,
    );
  } catch (error) {
    next(error);
  }
}
app.get("/", redirectIfLoggedIn, (req, res) =>
  res.sendFile(path.join(__dirname, "public", "home.html")),
);
for (const page of ["home", "login", "login-mitra", "registrasi"]) {
  app.get("/" + page + ".html", redirectIfLoggedIn, (req, res) =>
    res.sendFile(path.join(__dirname, "public", page + ".html")),
  );
}
app.get("/landing.html", requireLogin, (req, res) => {
  if (req.account.role !== "customer")
    return res.redirect(req.account.dashboardUrl);
  res.sendFile(path.join(__dirname, "pages", "customer-home.html"));
});
app.use("/dashboard", requireLogin);
app.use("/api/dashboard", requireLogin);
app.use(require("./kunciGarasi/routes/dashboards").createDashboardRouter());
app.get("/ai.html", requireLogin, denyPartner, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "ai.html")),
);
app.get("/search.html", requireLogin, denyPartner, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "search.html")),
);
app.get("/registrasi-mitra.html", redirectIfLoggedIn, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "partner-register.html")),
);
app.get("/dashboard-mitra.html", requireLogin, (req, res) =>
  res.redirect("/dashboard/partner"),
);
app.get("/dashboard-customer.html", requireLogin, (req, res) =>
  res.redirect("/dashboard/customer"),
);
app.use("/api/location-name", requireLogin);
app.use(require("./kunciGarasi/routes/location").createLocationRouter());
app.use("/api/partner-media", requireLogin);
app.get("/partner-register.html", requireLogin, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "partner-register.html")),
);
app.get("/admin-partners.html", requireLogin, async (req, res) => {
  if (
    !(await require("./kunciGarasi/repositories/partners").isAdmin(
      req.session.user.id,
    ))
  )
    return res.status(403).send("Halaman ini hanya untuk admin.");
  res.redirect("/dashboard/admin");
});
app.get("/index.html", requireLogin, (req, res) => res.redirect("/dashboard"));
app.use(
  "/assets/kunciGarasi",
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
  express.static(path.join(__dirname, "kunciGarasi", "public"), {
    index: false,
    extensions: false,
    setHeaders: (res, file) => {
      if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    },
  }),
);
app.use("/api/chat", requireLogin, denyPartner);
app.use(require("./chat-routes"));
app.use("/api/partners", requireLogin);
app.use("/api/admin/partners", requireLogin);
app.use(require("./kunciGarasi/routes/partners").createPartnerRouter());
app.use("/api/workshops", requireLogin, denyPartner);
app.use(require("./kunciGarasi/routes"));
app.get("/api/me", requireLogin, (req, res) => res.json({ user: req.account }));
app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    res.json({ message: "Logout berhasil" });
  });
});
function validInput(email, password) {
  return (
    typeof email === "string" &&
    typeof password === "string" &&
    email.trim() !== "" &&
    password.trim() !== "" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}
app.post(
  "/api/login",
  require("./kunciGarasi/services/rate-limit").loginLimit(),
  async (req, res, next) => {
    const { email, password } = req.body ?? {};
    if (!validInput(email, password))
      return res
        .status(400)
        .json({ message: "Email dan password tidak valid" });
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
app.post("/api/registrasi", async (req, res, next) => {
  const { email, password } = req.body ?? {};
  if (!validInput(email, password))
    return res.status(400).json({ message: "Email dan password tidak valid" });
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72)
    return res
      .status(400)
      .json({ message: "Password minimal 8 karakter dan maksimal 72 byte" });
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
for (const page of ["partner-detail", "orders", "support"]) {
  app.get("/" + page + ".html", requireLogin, denyPartner, (req, res) =>
    res.sendFile(path.join(__dirname, "pages", page + ".html")),
  );
}
for (const page of ["owner-workshops", "owner-orders", "account-settings"])
  app.get("/" + page + ".html", requireLogin, (req, res) =>
    res.sendFile(path.join(__dirname, "pages", page + ".html")),
  );
for (const prefix of [
  "/api/customer",
  "/api/owner",
  "/api/orders",
  "/api/account",
])
  app.use(prefix, requireLogin);
app.use("/api/map-config", requireLogin, denyPartner);
app.use("/api/support", requireLogin, denyPartner);
for (const prefix of [
  "/api/admin/support-tickets",
  "/api/admin/monitoring",
  "/api/admin/accounts",
  "/api/admin/workshops",
  "/api/notifications",
])
  app.use(prefix, requireLogin);
app.use(require("./kunciGarasi/routes/support").createSupportRouter());
app.use(require("./kunciGarasi/routes/audit").createAuditRouter());
app.use(require("./kunciGarasi/routes/commerce").createCommerceRouter());
app.get("/notifications.html", requireLogin, (req, res) =>
  res.sendFile(path.join(__dirname, "pages", "notifications.html")),
);

app.get("/admin-monitoring.html", requireLogin, (req, res) => {
  if (req.account.role !== "admin")
    return res.status(403).send("Halaman ini hanya untuk admin.");
  res.sendFile(path.join(__dirname, "pages", "admin-monitoring.html"));
});

app.get("/admin-accounts.html", requireLogin, (req, res) => {
  if (req.account.role !== "admin")
    return res.status(403).send("Halaman ini hanya untuk admin.");
  res.sendFile(path.join(__dirname, "pages", "admin-accounts.html"));
});

app.get("/support-admin.html", requireLogin, (req, res) => {
  if (req.account.role !== "admin")
    return res.status(403).send("Halaman ini hanya untuk admin.");
  res.sendFile(path.join(__dirname, "pages", "admin-monitoring.html"));
});

app.get("/help.html", requireLogin, (req, res) =>
  res.sendFile(path.join(__dirname, "public", "help.html")),
);
app.get(
  ["/estimate.html", "/forgot-password.html", "/reset-password.html"],
  (req, res) => res.status(404).send("Halaman tidak ditemukan."),
);
const staticAssetExt =
  /\.(css|js|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|map)$/i;
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  if (staticAssetExt.test(req.path)) return next();
  if (
    [
      "/",
      "/home.html",
      "/login.html",
      "/login-mitra.html",
      "/registrasi.html",
      "/registrasi-mitra.html",
      "/terms.html",
      "/privacy.html",
      "/partner-terms.html",
      "/partner-privacy.html",
    ].includes(req.path)
  ) {
    return next();
  }
  return requireLogin(req, res, next);
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (req, res) =>
  res.status(404).json({ message: "Endpoint tidak ditemukan" }),
);
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
if (require.main === module)
  app.listen(PORT, () => console.log(`Buka http://localhost:${PORT}/`));
if (require.main === module) {
  const timer = setInterval(
    () =>
      require("./kunciGarasi/services/operations")
        .maintain()
        .catch((e) => console.error("Pemeliharaan gagal:", e.code || e.name)),
    60000,
  );
  timer.unref();
}
module.exports = app;
