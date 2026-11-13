const express = require("express"),
  path = require("node:path");
const accounts = require("../repositories/accounts"),
  partners = require("../repositories/partners");
function createDashboardRouter({
  accountRepository = accounts,
  partnerRepository = partners,
} = {}) {
  const router = express.Router();
  router.use(["/dashboard", "/api/dashboard"], (req, res, next) =>
    req.account
      ? next()
      : res.status(401).json({ message: "Silakan login terlebih dahulu" }),
  );
  function roleOnly(role) {
    return (req, res, next) => {
      if (!req.account)
        return res
          .status(401)
          .json({ message: "Silakan login terlebih dahulu" });
      if (req.account.role !== role) {
        if (req.originalUrl.startsWith("/api/"))
          return res.status(403).json({
            message: "Dashboard ini bukan untuk role akun Anda.",
            dashboardUrl: req.account.dashboardUrl,
          });
        return res
          .status(403)
          .send(
            "Anda tidak memiliki akses ke dashboard ini. Buka /dashboard untuk dashboard akun Anda.",
          );
      }
      next();
    };
  }
  router.get("/dashboard", (req, res) =>
    res.redirect(req.account.dashboardUrl),
  );
  for (const role of ["customer", "partner", "admin"]) {
    router.get(accounts.DASHBOARD_PATHS[role], roleOnly(role), (req, res) =>
      res.sendFile(
        role === "customer"
          ? path.join(__dirname, "..", "public", "index.html")
          : path.join(
              __dirname,
              "..",
              "..",
              "pages",
              "dashboard-" + role + ".html",
            ),
      ),
    );
    router.get("/api/dashboard/" + role, roleOnly(role), async (req, res) => {
      if (role === "admin")
        return res.json({
          user: req.account,
          summary: await accountRepository.adminSummary(),
        });
      const workshops = await partnerRepository.mine(req.account.id);
      const summary = {
        totalWorkshops: workshops.length,
        approvedWorkshops: workshops.filter((w) => w.status === "approved")
          .length,
        pendingWorkshops: workshops.filter((w) => w.status === "pending")
          .length,
        rejectedWorkshops: workshops.filter((w) => w.status === "rejected")
          .length,
      };
      res.json({ user: req.account, summary, workshops });
    });
  }
  return router;
}
module.exports = { createDashboardRouter };
