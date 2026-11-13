process.env.GOOGLE_PLACES_ENABLED = "false";
const assert = require("node:assert/strict"),
  app = require("../login"),
  db = require("../db");
const { removePhotos } = require("../kunciGarasi/services/partner-media");
const { TERMS_VERSION } = require("../kunciGarasi/lib/partner-input");
const testIP =
  "198.18." +
  Math.floor(Math.random() * 256) +
  "." +
  Math.floor(Math.random() * 256);
function partnerForm(fields) {
  const body = new FormData();
  body.append(
    "data",
    JSON.stringify({
      vehicleTypes: ["mobil"],
      hours: { days: [1, 2, 3, 4, 5, 6], open: "08:00", close: "17:00" },
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: TERMS_VERSION,
      ...fields,
    }),
  );
  const photo = new Blob(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwCU1zCU1jgFAAG2oD/ST9ke8AAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    { type: "image/png" },
  );
  body.append("workshopPhotos", photo, "bengkel.png");
  if (fields.pickup) body.append("towPhoto", photo, "derek.png");
  return body;
}
async function cleanPhotos(ids) {
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db.execute(
    `SELECT d.details FROM partner_workshop_details d JOIN partner_workshops p ON p.id=d.workshop_id WHERE p.owner_user_id IN (${placeholders})`,
    ids,
  );
  for (const { details } of rows) {
    const data = typeof details === "string" ? JSON.parse(details) : details;
    await removePhotos(data?.photos || []);
  }
  for (const id of ids)
    await db.execute(
      "DELETE FROM app_sessions WHERE JSON_EXTRACT(data,'$.user.id')=?",
      [id],
    );
}

(async () => {
  const suffix = Date.now(),
    emails = [
      `partner-test-${suffix}@example.com`,
      `other-test-${suffix}@example.com`,
      `admin-test-${suffix}@example.com`,
    ],
    password = "Test-only-partner-9384!";
  const ids = [];
  let registration;
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, cookie, method = "POST") =>
    fetch(base + path, {
      method,
      headers: {
        "X-Forwarded-For": testIP,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
      redirect: "manual",
    });
  try {
    const cookies = [];
    for (const email of emails) {
      let response = await request("/api/registrasi", {
        email,
        password,
        role: "admin",
      });
      assert.equal(response.status, 201);
      const [rows] = await db.execute(
        "SELECT id,role FROM users WHERE email=?",
        [email],
      );
      assert.equal(rows[0].role, "customer");
      ids.push(rows[0].id);
      response = await request("/api/login", { email, password });
      assert.equal(response.status, 200);
      cookies.push(response.headers.get("set-cookie").split(";")[0]);
    }
    assert.equal(
      (await request("/api/admin/partners", null, cookies[2], "GET")).status,
      403,
    );
    await db.execute("UPDATE users SET role='admin' WHERE id=?", [ids[2]]);
    const input = {
      name: `TEST ONLY partner ${suffix}`,
      address: "Alamat uji sementara",
      phone: "08123456789",
      lat: -7.37364,
      lng: 112.75913,
      services: ["AC mobil"],
      pickup: true,
    };
    assert.equal(
      (
        await request(
          "/api/partners",
          partnerForm({ ...input, status: "approved" }),
          cookies[0],
        )
      ).status,
      400,
    );
    let response = await request(
      "/api/partners",
      partnerForm(input),
      cookies[0],
    );
    assert.equal(response.status, 201);
    let data = await response.json();
    registration = data.id;
    assert.equal(data.status, "pending");
    response = await request("/api/partners/mine", null, cookies[1], "GET");
    assert.equal((await response.json()).data.length, 0);
    response = await request(
      "/api/workshops?lat=-7.37364&lng=112.75913",
      null,
      cookies[0],
      "GET",
    );
    assert(
      !(await response.json()).data.some((w) => w.partnerId === registration),
    );
    assert.equal(
      (
        await request(
          `/api/admin/partners/${registration}/review`,
          { status: "approved" },
          cookies[0],
        )
      ).status,
      403,
    );
    const queue = await (
      await request("/api/admin/partners", null, cookies[2], "GET")
    ).json();
    const reviewVersion = queue.data.find(
      (w) => w.id === registration,
    ).reviewVersion;
    response = await request(
      `/api/admin/partners/${registration}/review`,
      {
        status: "approved",
        reviewVersion,
        note: "Test approval",
        googlePlaceId: "test_place_" + suffix,
      },
      cookies[2],
    );
    assert.equal(response.status, 200);
    response = await request(
      "/api/workshops?lat=-7.37364&lng=112.75913",
      null,
      cookies[1],
      "GET",
    );
    data = await response.json();
    const partner = data.data.find((w) => w.partnerId === registration);
    assert(partner && partner.isPartner && !partner.isDemo);
    assert.equal(partner.source, "bengkelin");
    assert.equal(partner.rating, null);
    assert.equal(
      (
        await request(
          "/api/workshops?group=general&sort=distance&lat=-7.37364&lng=112.75913",
          null,
          cookies[0],
          "GET",
        )
      ).status,
      503,
    );
    const [waiting] = await db.execute(
      "INSERT INTO service_orders(customer_id,workshop_id,vehicle_type,service,scheduled_at,status) VALUES (?,?,'mobil','AC mobil',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),'waiting')",
      [ids[1], registration],
    );
    const [accepted] = await db.execute(
      "INSERT INTO service_orders(customer_id,workshop_id,vehicle_type,service,scheduled_at,status) VALUES (?,?,'mobil','AC mobil',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 2 DAY),'accepted')",
      [ids[1], registration],
    );
    assert.equal(
      (
        await request(
          `/api/admin/partners/${registration}/revoke`,
          { note: "Tidak diizinkan" },
          cookies[1],
        )
      ).status,
      403,
    );
    response = await request(
      `/api/admin/partners/${registration}/revoke`,
      { note: "Test revoke" },
      cookies[2],
    );
    assert.equal(response.status, 200);
    const [orders] = await db.execute(
      "SELECT id,status FROM service_orders WHERE workshop_id=?",
      [registration],
    );
    assert.equal(
      orders.find((o) => o.id === waiting.insertId).status,
      "cancelled",
    );
    assert.equal(
      orders.find((o) => o.id === accepted.insertId).status,
      "accepted",
    );
    const [events] = await db.execute(
      "SELECT actor_id FROM service_order_events WHERE order_id=? AND status='cancelled'",
      [waiting.insertId],
    );
    assert.equal(events[0].actor_id, ids[2]);
    response = await request(
      "/api/workshops?lat=-7.37364&lng=112.75913",
      null,
      cookies[0],
      "GET",
    );
    assert(
      !(await response.json()).data.some((w) => w.partnerId === registration),
    );
    await db.execute("UPDATE users SET role='customer' WHERE id=?", [ids[2]]);
    assert.equal(
      (await request("/api/admin/partners", null, cookies[2], "GET")).status,
      403,
    );
    console.log(
      "PASS: MySQL nyata, role via query langsung berlaku, pelanggan tidak dapat approve, pending tersembunyi, approve/revoke, isolasi pemilik, Google nonaktif.",
    );
  } finally {
    if (ids.length) {
      await cleanPhotos(ids);
      if (registration)
        await db.execute("DELETE FROM service_orders WHERE workshop_id=?", [
          registration,
        ]);
      const placeholders = ids.map(() => "?").join(",");
      await db.execute(
        `DELETE FROM partner_workshops WHERE owner_user_id IN (${placeholders})`,
        ids,
      );
      await db.execute(`DELETE FROM users WHERE id IN (${placeholders})`, ids);
    }
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
