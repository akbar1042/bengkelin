const testIP =
  "198.18." +
  Math.floor(Math.random() * 256) +
  "." +
  Math.floor(Math.random() * 256);
const assert = require("node:assert/strict"),
  app = require("../login"),
  db = require("../db"),
  bcrypt = require("bcrypt");
const { scheduledTime } = require("../kunciGarasi/routes/commerce");
(async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const ids = [],
    workshops = [];
  const password = "Commerce-test-9384!";
  const request = async (path, method = "GET", body, cookie) => {
    const r = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "X-Forwarded-For": testIP,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { cookie } : {}),
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
    const cookies = [];
    for (let i = 0; i < 4; i++) {
      const email = `commerce-${Date.now()}-${i}@example.test`;
      await db.execute(
        "INSERT INTO users(email,password_hash,role) VALUES (?,?,?)",
        [email, await bcrypt.hash(password, 4), i === 3 ? "admin" : "customer"],
      );
      const [rows] = await db.execute("SELECT id FROM users WHERE email=?", [
        email,
      ]);
      ids.push(rows[0].id);
      cookies.push(
        (await request("/api/login", "POST", { email, password })).cookie,
      );
    }
    const owner = ids[1],
      details = {
        vehicleTypes: ["motor"],
        hours: {
          days: [0, 1, 2, 3, 4, 5, 6],
          open: "00:00",
          close: "00:00",
          timeZone: "Asia/Jakarta",
        },
        photos: [],
        termsVersion: "2026-11-07",
      };
    const [created] = await db.execute(
      "INSERT INTO partner_workshops(owner_user_id,name,address,phone,lat,lng,services,open24,status) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        owner,
        "TEST commerce",
        "Alamat uji",
        "08123456789",
        -7.37,
        112.75,
        JSON.stringify(["Aki"]),
        true,
        "approved",
      ],
    );
    const wid = created.insertId;
    workshops.push(wid);
    await db.execute(
      "INSERT INTO partner_workshop_details(workshop_id,details,terms_version) VALUES (?,?,?)",
      [wid, JSON.stringify(details), "2026-11-07"],
    );
    assert.equal((await request("/api/customer/orders")).status, 401);
    assert.equal(
      (
        await request(
          "/api/customer/partners/" + wid,
          "GET",
          undefined,
          cookies[0],
        )
      ).status,
      200,
    );
    const scheduledAt = new Date(Date.now() + 86400000).toISOString(),
      body = {
        workshopId: wid,
        vehicleType: "motor",
        service: "Aki",
        scheduledAt,
        notes: "Uji",
      };
    const races = await Promise.all([
      request("/api/customer/orders", "POST", body, cookies[0]),
      request("/api/customer/orders", "POST", body, cookies[2]),
    ]);
    assert.deepEqual(races.map((x) => x.status).sort(), [201, 409]);
    const winner = races[0].status === 201 ? 0 : 2,
      loser = winner === 0 ? 2 : 0,
      order = races.find((x) => x.status === 201).data.id;
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "cancelled", note: "Mencoba akun lain" },
          cookies[loser],
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/owner/orders/" + order + "/cost",
          "PATCH",
          { amount: 100000, note: "Dikonfirmasi melalui kontak bengkel" },
          cookies[loser],
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "completed" },
          cookies[1],
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "accepted" },
          cookies[1],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/owner/orders/" + order + "/cost",
          "PATCH",
          { amount: 100000, note: "Jasa dan suku cadang dikonfirmasi" },
          cookies[1],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "processing" },
          cookies[1],
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
          cookies[winner],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "processing" },
          cookies[1],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "cancelled", note: "Tidak berhak saat diproses" },
          cookies[winner],
        )
      ).status,
      403,
    );
    await db.execute(
      "UPDATE service_orders SET scheduled_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 HOUR) WHERE id=?",
      [order],
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/status",
          "PATCH",
          { status: "completed" },
          cookies[1],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/customer/orders/" + order + "/events",
          "GET",
          undefined,
          cookies[winner],
        )
      ).data.data.length,
      4,
    );
    const edited = {
      name: "TEST commerce baru",
      address: "Alamat baru",
      phone: "08123456789",
      lat: -7.37,
      lng: 112.75,
      services: ["Aki"],
      vehicleTypes: ["motor"],
      hours: { days: [1, 2], open: "08:00", close: "17:00" },
      termsVersion: "2026-11-07",
      termsAccepted: true,
      privacyAccepted: true,
    };
    assert.equal(
      (await request("/api/owner/workshops/" + wid, "PUT", edited, cookies[0]))
        .status,
      404,
    );
    assert.equal(
      (await request("/api/owner/workshops/" + wid, "PUT", edited, cookies[1]))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/customer/partners/" + wid,
          "GET",
          undefined,
          cookies[0],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/account/password",
          "POST",
          { currentPassword: "salah", password: "Changed-9384!" },
          cookies[loser],
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/account/password",
          "POST",
          { currentPassword: password, password: "Changed-9384!" },
          cookies[loser],
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/me", "GET", undefined, cookies[loser])).status,
      401,
    );
    const [emailRows] = await db.execute("SELECT email FROM users WHERE id=?", [
      ids[loser],
    ]);
    const fresh = (
      await request("/api/login", "POST", {
        email: emailRows[0].email,
        password: "Changed-9384!",
      })
    ).cookie;
    assert.equal(
      (
        await request(
          "/api/account",
          "DELETE",
          { password: "Changed-9384!", confirmation: "HAPUS AKUN" },
          fresh,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/login", "POST", {
          email: emailRows[0].email,
          password: "Changed-9384!",
        })
      ).status,
      401,
    );
    assert.throws(() => scheduledTime("not-a-date", details.hours, true));
    console.log(
      "PASS commerce: isolasi data, konflik slot serentak, transisi status, biaya, edit milik sendiri, peninjauan ulang, ganti password dan penonaktifan akun.",
    );
  } finally {
    if (workshops.length) {
      const marks = workshops.map(() => "?").join(",");
      await db.execute(
        `DELETE e FROM service_order_events e JOIN service_orders o ON o.id=e.order_id WHERE o.workshop_id IN (${marks})`,
        workshops,
      );
      await db.execute(
        `DELETE FROM service_orders WHERE workshop_id IN (${marks})`,
        workshops,
      );
      await db.execute(
        `DELETE FROM partner_workshops WHERE id IN (${marks})`,
        workshops,
      );
    }
    for (const id of ids)
      await db.execute("DELETE FROM users WHERE id=?", [id]);
    await new Promise((r) => server.close(r));
    await db.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
