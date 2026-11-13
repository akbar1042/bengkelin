process.env.NODE_ENV = "test";
process.env.SESSION_COOKIE_SECURE = "false";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcrypt");
const db = require("../db");
const app = require("../login");

// Keep background order maintenance out of this role and notification test.
require("../kunciGarasi/services/operations").maintain = async () => {};

async function run() {
  const server = app.listen(0, "127.0.0.1");
  const users = [];
  const workshops = [];
  const orders = [];
  const cookies = [];
  const stamp = randomUUID();
  const password = "Partner-scope-" + stamp;
  const ip =
    "198.18." +
    parseInt(stamp.slice(0, 2), 16) +
    "." +
    parseInt(stamp.slice(2, 4), 16);
  let base;

  async function request(path, user, method = "GET", body) {
    const response = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": ip,
        ...(user === undefined ? {} : { Cookie: cookies[user] }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : await response.text();
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }

  try {
    await once(server, "listening");
    base = "http://127.0.0.1:" + server.address().port;
    const hash = await bcrypt.hash(password, 4);
    for (let i = 0; i < 3; i++) {
      const email = stamp + "-" + i + "@example.test";
      const [user] = await db.execute(
        "INSERT INTO users(email,password_hash) VALUES (?,?)",
        [email, hash],
      );
      users.push(user.insertId);
      const login = await request("/api/login", undefined, "POST", {
        email,
        password,
      });
      assert.equal(login.status, 200);
      cookies.push(login.cookie);
    }
    for (const user of users.slice(0, 2)) {
      const [workshop] = await db.execute(
        "INSERT INTO partner_workshops(owner_user_id,name,address,phone,lat,lng,services,status) VALUES (?,'Bengkel uji','Alamat uji','08123456789',-7.37,112.75,'[]','approved')",
        [user],
      );
      workshops.push(workshop.insertId);
    }
    for (const [customer, workshop] of [
      [users[2], workshops[0]],
      [users[0], workshops[1]],
    ]) {
      const [order] = await db.execute(
        "INSERT INTO service_orders(customer_id,workshop_id,vehicle_type,service,scheduled_at) VALUES (?,?,'motor','Aki',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))",
        [customer, workshop],
      );
      orders.push(order.insertId);
      await db.execute(
        "UPDATE service_orders SET confirmed_cost=100000,cost_version=1 WHERE id=?",
        [order.insertId],
      );
    }
    const [inbound, legacy] = orders;
    const [shared] = await db.execute(
      "INSERT INTO user_notifications(user_id,title,message) VALUES (?,'Balasan tiket bantuan','Pesan admin')",
      [users[0]],
    );
    const [oldNotices] = await db.execute(
      "SELECT id FROM user_notifications WHERE user_id=? AND order_id=?",
      [users[0], legacy],
    );

    for (const path of [
      "/dashboard/customer",
      "/search.html",
      "/ai.html",
      "/orders.html",
      "/partner-detail.html",
      "/api/chat",
      "/api/workshops",
      "/api/workshops/sources",
      "/api/customer/orders",
      "/api/customer/partners/" + workshops[1],
      "/api/map-config",
    ])
      assert.equal((await request(path, 0)).status, 403, path);
    assert.equal((await request("/search.html", 2)).status, 200);
    assert.equal(
      (await request("/api/customer/partners/" + workshops[0], 2)).status,
      200,
    );
    assert.equal((await request("/owner-orders.html", 0)).status, 200);
    for (const path of [
      "/support.html",
      "/api/support/messages",
      "/api/support/tickets",
    ]) {
      assert.equal((await request(path, 0)).status, 403, path);
    }
    for (const path of ["/api/support/chat", "/api/support/tickets"]) {
      assert.equal(
        (await request(path, 0, "POST", { message: "Uji akses mitra" })).status,
        403,
        path,
      );
    }
    assert.equal((await request("/support.html", 2)).status, 200);
    const ownerOrders = await request("/api/owner/orders", 0);
    assert.deepEqual(
      ownerOrders.data.data.map((order) => order.id),
      [inbound],
    );
    assert.equal(
      (await request("/api/customer/orders/" + inbound + "/events", 0)).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + inbound + "/status",
          0,
          "PATCH",
          { status: "accepted" },
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/customer/orders/" + legacy + "/events", 0)).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + legacy + "/status",
          0,
          "PATCH",
          { status: "cancelled", note: "Uji" },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + legacy + "/cost-approval",
          0,
          "POST",
          { version: 1 },
        )
      ).status,
      403,
    );

    const { data: inbox } = await request("/api/notifications", 0);
    assert.equal(inbox.role, "partner");
    assert.equal(inbox.unreadCount, inbox.data.length);
    assert.ok(
      inbox.data.every(
        (notice) =>
          notice.order_id === inbound && notice.audience === "partner",
      ),
    );
    assert.ok(inbox.data.some((notice) => notice.order_id === inbound));
    assert.ok(oldNotices.length > 0);
    assert.equal(
      (
        await request(
          "/api/notifications/" + oldNotices[0].id + "/read",
          0,
          "PATCH",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/notifications/" + shared.insertId + "/read",
          0,
          "PATCH",
        )
      ).status,
      404,
    );
    assert.equal(
      (await request("/api/notifications/read-all", 0, "PATCH")).status,
      200,
    );
    assert.equal((await request("/api/notifications", 0)).data.unreadCount, 0);
    const [hiddenNotices] = await db.execute(
      "SELECT read_at FROM user_notifications WHERE user_id=? AND order_id=?",
      [users[0], legacy],
    );
    assert.ok(hiddenNotices.every((notice) => notice.read_at === null));
    const customerInbox = (await request("/api/notifications", 2)).data.data;
    assert.ok(
      customerInbox.every(
        (notice) =>
          notice.order_id === inbound && notice.audience === "customer",
      ),
    );
    assert.ok(customerInbox.length > 0);

    await db.execute(
      "UPDATE partner_workshops SET status='rejected' WHERE id=?",
      [workshops[0]],
    );
    const formerPartner = (await request("/api/notifications", 0)).data;
    assert.equal(formerPartner.role, "customer");
    assert.deepEqual(
      [...new Set(formerPartner.data.map((notice) => notice.audience))].sort(),
      ["customer", "support"],
    );
    assert.equal(formerPartner.unreadCount, oldNotices.length + 1);
    assert.equal(
      formerPartner.data.find((notice) => notice.id === shared.insertId)
        .read_at,
      null,
    );
    assert.equal((await request("/support.html", 0)).status, 200);
    console.log(
      "PASS role mitra: proteksi halaman dan API, pesanan milik bengkel, notifikasi terpisah, penandaan baca, pergantian role.",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const id of orders)
      await db.execute("DELETE FROM service_orders WHERE id=?", [id]);
    for (const id of workshops)
      await db.execute("DELETE FROM partner_workshops WHERE id=?", [id]);
    for (const id of users) {
      await db.execute(
        "DELETE FROM app_sessions WHERE JSON_EXTRACT(data,'$.user.id')=?",
        [id],
      );
      await db.execute("DELETE FROM users WHERE id=?", [id]);
    }
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
