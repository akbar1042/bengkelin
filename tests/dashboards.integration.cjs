process.env.NODE_ENV = "test";
process.env.GOOGLE_PLACES_ENABLED = "false";
process.env.SESSION_COOKIE_SECURE = "false";
const assert = require("node:assert/strict"),
  app = require("../login"),
  db = require("../db");
const {removePhotos}=require('../bengkelin/services/partner-media');
const {TERMS_VERSION}=require('../bengkelin/lib/partner-input');
const testIP='198.18.'+Math.floor(Math.random()*256)+'.'+Math.floor(Math.random()*256);
function partnerForm(fields){
  const body=new FormData();
  body.append('data',JSON.stringify({vehicleTypes:['mobil'],hours:{days:[1,2,3,4,5,6],open:'08:00',close:'17:00'},termsAccepted:true,privacyAccepted:true,termsVersion:TERMS_VERSION,...fields}));
  const photo=new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwCU1zCU1jgFAAG2oD/ST9ke8AAAAASUVORK5CYII=','base64')],{type:'image/png'});
  body.append('workshopPhotos',photo,'bengkel.png');
  if(fields.pickup)body.append('towPhoto',photo,'derek.png');
  return body;
}
async function cleanPhotos(ids){
  const placeholders=ids.map(()=>'?').join(',');
  const [rows]=await db.execute(`SELECT d.details FROM partner_workshop_details d JOIN partner_workshops p ON p.id=d.workshop_id WHERE p.owner_user_id IN (${placeholders})`,ids);
  for(const {details} of rows){const data=typeof details==='string'?JSON.parse(details):details;await removePhotos(data?.photos||[]);}
  for(const id of ids)await db.execute("DELETE FROM app_sessions WHERE JSON_EXTRACT(data,'$.user.id')=?",[id]);
}

(async () => {
  const stamp = Date.now(),
    emails = [
      "owner-dashboard-" + stamp + "@example.com",
      "customer-dashboard-" + stamp + "@example.com",
      "admin-dashboard-" + stamp + "@example.com",
    ],
    password = "Temporary-Dashboard-9384!",
    ids = [],
    cookies = [];
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (route, body, cookie) =>
    fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        "X-Forwarded-For": testIP,
        ...(body instanceof FormData ? {} : {"Content-Type": "application/json"}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      redirect: "manual",
    });
  const login = async (index) => {
    const r = await request("/api/login", {
      email: emails[index],
      password,
      role: "admin",
    });
    assert.equal(r.status, 200);
    cookies[index] = r.headers.get("set-cookie").split(";")[0];
    return r.json();
  };
  const me = async (index) =>
    (await request("/api/me", null, cookies[index])).json();
  const page = async (route, index, status) =>
    assert.equal(
      (await request(route, null, cookies[index])).status,
      status,
      route,
    );
  const makeWorkshop = async (index, suffix) => {
    const r = await request(
      "/api/partners",
      partnerForm({
        name: "TEST ONLY dashboard " + stamp + suffix,
        address: "Alamat uji sementara",
        phone: "08123456789",
        lat: -7.9666,
        lng: 112.6326,
        services: ["Aki"],
      }),
      cookies[index],
    );
    assert.equal(r.status, 201);
    return (await r.json()).id;
  };
  const review = async (id, status) => {
    const queue=await (await request('/api/admin/partners',null,cookies[2])).json();
    const reviewVersion=queue.data.find(w=>w.id===id).reviewVersion;
    const r=await request('/api/admin/partners/'+id+'/review',{status,note:'TEST ONLY review',reviewVersion},cookies[2]);
    assert.equal(r.status,200);
  };
  const revoke=async id=>{
    const r=await request('/api/admin/partners/'+id+'/revoke',{note:'TEST ONLY revoke'},cookies[2]);
    assert.equal(r.status,200);
  };
  try {
    assert.equal((await request("/dashboard")).status, 302);
    assert.equal((await request("/api/dashboard/customer")).status, 401);
    for (let i = 0; i < emails.length; i++) {
      let r = await request("/api/registrasi", {
        email: emails[i],
        password,
        role: "admin",
      });
      assert.equal(r.status, 201);
      const [rows] = await db.execute(
        "SELECT id,role FROM users WHERE email=?",
        [emails[i]],
      );
      ids.push(rows[0].id);
      assert.equal(rows[0].role, "customer");
      assert.equal((await login(i)).redirect, "/landing.html");
    }
    const first = await makeWorkshop(0, " one");
    assert.equal((await me(0)).user.role, "customer");
    await page("/dashboard/partner", 0, 403);
    await db.execute("UPDATE users SET role='admin' WHERE id=?", [ids[2]]);
    assert.equal((await me(2)).user.role, "admin");
    assert.equal((await login(2)).redirect, "/dashboard/admin");
    await review(first, "approved");
    assert.equal((await me(0)).user.role, "partner");
    assert.equal((await login(0)).redirect, "/dashboard/partner");
    const roles = ["partner", "customer", "admin"];
    for (let i = 0; i < roles.length; i++)
      for (const role of roles) {
        await page("/dashboard/" + role, i, roles[i] === role ? 200 : 403);
        await page("/api/dashboard/" + role, i, roles[i] === role ? 200 : 403);
      }
    let r = await request("/dashboard", null, cookies[0]);
    assert.equal(r.headers.get("location"), "/dashboard/partner");
    r = await request("/landing.html", null, cookies[0]);
    assert.equal(r.headers.get("location"), "/dashboard/partner");
    await page("/assets/bengkelin/index.html", 0, 403);
    await page("/assets/bengkelin/index%2ehtml", 0, 403);
    await page("/assets/bengkelin/INDEX.HTML", 0, 403);
    r = await request(
      "/api/dashboard/partner?userId=" + ids[1],
      null,
      cookies[0],
    );
    let data = await r.json();
    assert.equal(data.user.id, ids[0]);
    assert.deepEqual(
      data.workshops.map((w) => w.id),
      [first],
    );
    assert.equal(data.summary.approvedWorkshops, 1);
    assert(!JSON.stringify(data).includes("password_hash"));
    const other = await request(
      "/api/dashboard/customer?userId=" + ids[0],
      null,
      cookies[1],
    );
    assert.equal((await other.json()).workshops.length, 0);
    const second = await makeWorkshop(0, " two");
    await review(second, "approved");
    await revoke(first);
    assert.equal((await me(0)).user.role, "partner");
    await revoke(second);
    assert.equal((await me(0)).user.role, "customer");
    await page("/api/dashboard/partner", 0, 403);
    await page("/dashboard/customer", 0, 200);
    const adminWorkshop = await makeWorkshop(2, " admin");
    await review(adminWorkshop, "approved");
    assert.equal((await me(2)).user.role, "admin");
    r = await request("/api/dashboard/admin", null, cookies[2]);
    data = await r.json();
    assert(data.summary.totalAccounts >= 3);
    assert(data.summary.approvedWorkshops >= 1);
    await db.execute("UPDATE users SET role='customer' WHERE id=?", [ids[2]]);
    assert.equal((await me(2)).user.role, "partner");
    await page("/api/dashboard/admin", 2, 403);
    await db.execute("DELETE FROM users WHERE id=?", [ids[1]]);
    await page("/api/me", 1, 401);
    console.log(
      "PASS: login routing 3 roles, pending customer, immediate approval/revocation, role access matrix, owner isolation, HTML bypass protection, admin precedence, multi-workshop ownership, deleted account session.",
    );
  } finally {
    if (ids.length) {
      await cleanPhotos(ids);
      const marks = ids.map(() => "?").join(",");
      await db.execute(
        "DELETE FROM partner_workshops WHERE owner_user_id IN (" + marks + ")",
        ids,
      );
      await db.execute("DELETE FROM users WHERE id IN (" + marks + ")", ids);
    }
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.end();
    console.log("Temporary dashboard accounts/workshops cleaned");
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
