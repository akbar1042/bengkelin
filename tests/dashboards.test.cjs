const assert = require("node:assert/strict"),
  express = require("express");
const { createDashboardRouter } = require("../kunciGarasi/routes/dashboards");
(async () => {
  const users = {
    customer: {
      id: 11,
      email: "customer@example.com",
      role: "customer",
      dashboardUrl: "/dashboard/customer",
    },
    partner: {
      id: 22,
      email: "partner@example.com",
      role: "partner",
      dashboardUrl: "/dashboard/partner",
    },
    admin: {
      id: 33,
      email: "admin@example.com",
      role: "admin",
      dashboardUrl: "/dashboard/admin",
    },
  };
  const mineCalls = [];
  let summaryCalls = 0;
  const app = express();
  app.use((req, res, next) => {
    req.account = users[req.headers["x-test-role"]];
    next();
  });
  app.use(
    createDashboardRouter({
      accountRepository: {
        adminSummary: async () => {
          summaryCalls++;
          return { totalAccounts: 3 };
        },
      },
      partnerRepository: {
        mine: async (id) => {
          mineCalls.push(id);
          return [
            { id: 1, name: "Own workshop", status: "approved", owner: id },
          ];
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const get = (path, role) =>
    fetch(base + path, {
      headers: role ? { "x-test-role": role } : {},
      redirect: "manual",
    });
  try {
    assert.equal((await get("/api/dashboard/admin")).status, 401);
    assert.equal((await get("/dashboard")).status, 401);
    for (const role of Object.keys(users))
      for (const target of Object.keys(users)) {
        const r = await get("/api/dashboard/" + target + "?userId=999", role);
        assert.equal(r.status, role === target ? 200 : 403);
        if (role === target) {
          const data = await r.json();
          assert.equal(data.user.id, users[role].id);
          if (role !== "admin")
            assert.equal(data.workshops[0].owner, users[role].id);
        }
      }
    assert.deepEqual(mineCalls, [11, 22]);
    assert.equal(summaryCalls, 1);
    for (const role of Object.keys(users)) {
      const r = await get("/dashboard", role);
      assert.equal(r.status, 302);
      assert.equal(r.headers.get("location"), users[role].dashboardUrl);
    }
    console.log(
      "PASS dashboards: server role guards, role-specific redirects, own data only, forbidden calls do not query private repositories.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
