const testIP =
  "198.18." +
  Math.floor(Math.random() * 256) +
  "." +
  Math.floor(Math.random() * 256);
process.env.CS_AI_USE_MODEL = "false";
const assert = require("node:assert/strict"),
  db = require("../db"),
  app = require("../login"),
  bcrypt = require("bcrypt");
const { maintain } = require("../kunciGarasi/services/operations");
const { createQueue } = require("../kunciGarasi/services/model-queue");
const { MysqlSessionStore } = require("../kunciGarasi/services/session-store");
(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port,
    ids = [],
    emails = [],
    cookies = [],
    password = "Audit-test-9384!";
  let wid;
  const request = async (path, method = "GET", body, index = 0) => {
    if (path.endsWith("/review") && body && !body.reviewVersion) {
      const response = await fetch(base + "/api/admin/partners", {
        headers: { cookie: cookies[index] },
      });
      const pending = await response.json();
      body = {
        ...body,
        reviewVersion:
          pending.data?.find((w) => w.id === Number(path.split("/").at(-2)))
            ?.reviewVersion || "stale",
      };
    }
    const r = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": testIP,
        "Content-Type": "application/json",
        ...(cookies[index] ? { cookie: cookies[index] } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
    return {
      status: r.status,
      data,
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    for (let i = 0; i < 5; i++) {
      const email = "audit-" + Date.now() + "-" + i + "@example.test";
      emails.push(email);
      const [u] = await db.execute(
        "INSERT INTO users(email,password_hash,role) VALUES (?,?,?)",
        [email, await bcrypt.hash(password, 4), i === 4 ? "admin" : "customer"],
      );
      ids.push(u.insertId);
      const response = await request(
        "/api/login",
        "POST",
        { email, password },
        i,
      );
      assert.equal(response.status, 200);
      cookies.push(response.cookie);
    }
    const [w] = await db.execute(
      "INSERT INTO partner_workshops(owner_user_id,name,address,phone,lat,lng,services,open24,status) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        ids[3],
        "TEST audit original",
        "Alamat uji",
        "08123456789",
        -7.37,
        112.75,
        JSON.stringify(["Aki"]),
        true,
        "approved",
      ],
    );
    wid = w.insertId;
    const details = {
      vehicleTypes: ["motor"],
      hours: { days: [0, 1, 2, 3, 4, 5, 6], open: "00:00", close: "00:00" },
      booking: { capacity: 2, durations: { Aki: 30 } },
      photos: [],
      termsVersion: "2026-11-07",
    };
    await db.execute(
      "INSERT INTO partner_workshop_details(workshop_id,details,terms_version) VALUES (?,?,?)",
      [wid, JSON.stringify(details), "2026-11-07"],
    );
    const body = {
      workshopId: wid,
      vehicleType: "motor",
      service: "Aki",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const booked = await Promise.all([
      request("/api/customer/orders", "POST", body, 0),
      request("/api/customer/orders", "POST", body, 1),
    ]);
    assert(
      booked.every((r) => r.status === 201),
      JSON.stringify(booked),
    );
    const order = booked[0].data.id,
      second = booked[1].data.id;
    assert.equal(
      (await request("/api/customer/orders", "POST", body, 2)).status,
      409,
    );
    assert.equal(
      (await request("/api/customer/orders", "GET")).data.data.find(
        (o) => o.id === order,
      ).duration_minutes,
      30,
    );
    assert(
      (await request("/api/notifications", "GET", undefined, 3)).data.data.some(
        (n) => n.order_id === order,
      ),
    );
    await request(
      "/api/customer/orders/" + order + "/status",
      "PATCH",
      { status: "accepted" },
      3,
    );
    await request(
      "/api/owner/orders/" + order + "/cost",
      "PATCH",
      { amount: 150000, note: "Jasa dan suku cadang" },
      3,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "processing" },
          3,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/cost-approval",
          "POST",
          { version: 1 },
          1,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/cost-approval",
          "POST",
          { version: 1 },
        )
      ).status,
      200,
    );
    await request(
      "/api/owner/orders/" + order + "/cost",
      "PATCH",
      { amount: 160000, note: "Revisi sebelum pengerjaan" },
      3,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/cost-approval",
          "POST",
          { version: 1 },
        )
      ).status,
      409,
    );
    await request("/api/customer/orders/" + order + "/cost-approval", "POST", {
      version: 2,
    });
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "processing" },
          3,
        )
      ).status,
      200,
    );
    await db.execute(
      "UPDATE service_orders SET created_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 25 HOUR) WHERE id=?",
      [second],
    );
    await maintain();
    const [expired] = await db.execute(
      "SELECT status FROM service_orders WHERE id=?",
      [second],
    );
    assert.equal(expired[0].status, "cancelled");
    const [events] = await db.execute(
      "SELECT actor_type FROM service_order_events WHERE order_id=? AND status='cancelled'",
      [second],
    );
    assert.equal(events[0].actor_type, "system");
    const profile = {
      name: "TEST audit revised",
      address: "Alamat baru",
      phone: "08123456789",
      lat: -7.37,
      lng: 112.75,
      services: ["Aki"],
      vehicleTypes: ["motor"],
      hours: { days: [1, 2], open: "08:00", close: "17:00" },
      booking: { capacity: 3, durations: { Aki: 45 } },
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: "2026-11-07",
    };
    assert.equal(
      (await request("/api/owner/workshops/" + wid, "PUT", profile, 3)).status,
      200,
    );
    assert.equal(
      (await request("/api/customer/partners/" + wid)).data.workshop.name,
      "TEST audit original",
    );
    assert(
      (
        await request("/api/admin/partners", "GET", undefined, 4)
      ).data.data.some((w) => w.id === wid && w.isRevision),
    );
    assert.equal(
      (
        await request(
          "/api/admin/partners/" + wid + "/review",
          "POST",
          { status: "approved", note: "Data diperiksa" },
          4,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/customer/partners/" + wid)).data.workshop.name,
      "TEST audit revised",
    );
    let support = await request("/api/support/chat", "POST", {
      message: "Bagaimana cara membatalkan pesanan?",
    });
    assert.equal(support.status, 200);
    assert(
      support.data.answer.includes("sebelum") ||
        support.data.answer.includes("diproses"),
    );
    assert(support.data.sources.length);
    support = await request("/api/support/chat", "POST", {
      message: "Status pesanan #" + order,
    });
    assert(support.data.answer.includes("diproses"));
    support = await request(
      "/api/support/chat",
      "POST",
      { message: "Status pesanan #" + order },
      1,
    );
    assert(support.data.answer.includes("tidak ditemukan"));
    assert.equal(
      (await request("/api/support/messages")).data.messages.length,
      4,
    );
    const ticket = await request("/api/support/tickets", "POST", {
      message: "Butuh bantuan untuk pengujian",
    });
    assert.equal(ticket.status, 201);
    assert.equal(
      (
        await request(
          "/api/admin/support-tickets/" + ticket.data.id,
          "PATCH",
          { reply: "Sudah diperiksa" },
          1,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/admin/support-tickets/" + ticket.data.id,
          "PATCH",
          { reply: "Sudah diperiksa" },
          4,
        )
      ).status,
      200,
    );
    const [sessions] = await db.execute(
      "SELECT sid FROM app_sessions WHERE JSON_EXTRACT(data,'$.user.id')=?",
      [ids[0]],
    );
    assert(sessions.length);
    const restored = await new Promise((resolve, reject) =>
      new MysqlSessionStore(db).get(sessions[0].sid, (e, data) =>
        e ? reject(e) : resolve(data),
      ),
    );
    assert.equal(restored.user.id, ids[0]);
    const q = createQueue();
    let busy = 0,
      max = 0;
    await Promise.all(
      [1, 2, 3].map(() =>
        q.run(async () => {
          busy++;
          max = Math.max(max, busy);
          await new Promise((r) => setTimeout(r, 10));
          busy--;
        }),
      ),
    );
    assert.equal(max, 1);
    const attempted = "rate-" + Date.now() + "@example.test";
    let response;
    for (let i = 0; i < 11; i++)
      response = await request(
        "/api/login",
        "POST",
        { email: attempted, password: "wrong" },
        2,
      );
    assert.equal(response.status, 429);
    console.log(
      "PASS audit: sesi persisten, batas login, kapasitas/durasi, persetujuan biaya berversi, notifikasi, expiry/audit, revisi profil, CS bersumber/data sendiri, tiket admin dan antrean AI.",
    );
  } finally {
    if (wid) {
      await db.execute(
        "DELETE e FROM service_order_events e JOIN service_orders o ON o.id=e.order_id WHERE o.workshop_id=?",
        [wid],
      );
      await db.execute("DELETE FROM service_orders WHERE workshop_id=?", [wid]);
      await db.execute("DELETE FROM partner_workshops WHERE id=?", [wid]);
    }
    for (const id of ids) {
      await db.execute("DELETE FROM support_tickets WHERE user_id=?", [id]);
      await db.execute("DELETE FROM users WHERE id=?", [id]);
    }
    await new Promise((r) => server.close(r));
    await db.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
