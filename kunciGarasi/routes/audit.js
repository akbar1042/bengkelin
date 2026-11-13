const express = require("express"),
  db = require("../../db");
const { bad } = require("../lib/workshop-utils");
const {
  upload,
  savePhotos,
  removePhotos,
} = require("../services/partner-media");
const { propose } = require("../services/revisions");
// Order ownership identifies the audience of existing notifications without rewriting history.
const ownerOrder = `EXISTS (
 SELECT 1 FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id
 WHERE o.id=n.order_id AND p.owner_user_id=n.user_id
)`;
const customerOrder =
  "EXISTS (SELECT 1 FROM service_orders o WHERE o.id=n.order_id AND o.customer_id=n.user_id)";
const validNoticeId = (value) =>
  typeof value === "string" && /^\d{1,20}$/.test(value);

function notificationScope(role) {
  if (role === "admin") return "n.user_id=?";
  if (role === "partner") return `n.user_id=? AND ${ownerOrder}`;
  return `n.user_id=? AND (n.order_id IS NULL OR ${customerOrder})`;
}

function createAuditRouter() {
  const r = express.Router();
  r.get("/api/notifications", async (req, res) => {
    const { before } = req.query;
    if (before !== undefined && !validNoticeId(before))
      throw bad("Halaman notifikasi tidak valid.");
    const scope = notificationScope(req.account.role);
    const params = [req.account.id];
    const [rows] = await db.execute(
      `SELECT n.id,n.order_id,n.title,n.message,n.read_at,n.created_at,
           COALESCE(o.need_towing, 0) AS need_towing,
           CASE WHEN n.order_id IS NULL THEN 'support' WHEN ${ownerOrder} THEN 'partner' ELSE 'customer' END AS audience
    FROM user_notifications n LEFT JOIN service_orders o ON o.id=n.order_id WHERE ${scope}${before ? " AND n.id<?" : ""} ORDER BY (COALESCE(o.need_towing, 0) = 1 AND n.read_at IS NULL) DESC, COALESCE(o.need_towing, 0) DESC, n.id DESC LIMIT 101`,
      before ? [...params, before] : params,
    );
    const [counts] = await db.execute(
      `SELECT COUNT(*) AS unread FROM user_notifications n WHERE ${scope} AND n.read_at IS NULL`,
      params,
    );
    const data = rows.slice(0, 100);
    res.json({
      data,
      role: req.account.role,
      unreadCount: Number(counts[0].unread),
      nextBefore: rows.length > 100 ? String(data.at(-1).id) : null,
    });
  });
  r.patch("/api/notifications/read-all", async (req, res) => {
    await db.execute(
      `UPDATE user_notifications n SET read_at=UTC_TIMESTAMP() WHERE ${notificationScope(req.account.role)} AND n.read_at IS NULL`,
      [req.account.id],
    );
    res.json({ message: "Semua notifikasi ditandai dibaca." });
  });
  r.patch("/api/notifications/:id/read", async (req, res) => {
    if (!validNoticeId(req.params.id)) throw bad("ID notifikasi tidak valid.");
    const [result] = await db.execute(
      `UPDATE user_notifications n SET read_at=UTC_TIMESTAMP() WHERE ${notificationScope(req.account.role)} AND n.id=?`,
      [req.account.id, req.params.id],
    );
    if (!result.affectedRows) throw bad("Notifikasi tidak ditemukan.", 404);
    res.json({ message: "Ditandai dibaca." });
  });
  r.post("/api/customer/orders/:id/cost-approval", async (req, res) => {
    if (req.account.role === "partner")
      throw bad("Fitur ini untuk akun pelanggan.", 403);
    await require("../services/operations").ensureOrderWorkflowColumns(db);
    const orderId = Number(req.params.id);
    const version = req.body?.version;
    if (!Number.isSafeInteger(version) || version < 1)
      throw bad("Versi biaya tidak valid.");
    const paymentMethod = req.body?.paymentMethod === "qris" ? "qris" : "cod";
    const paymentStatus = paymentMethod === "qris" ? "paid" : "unpaid";
    const autoProgress = req.body?.paymentMethod === "qris";
    const [rows] = await db.execute(
      "SELECT o.id, o.status, o.cost_version, o.accepted_cost_version, o.confirmed_cost, o.payment_status, p.owner_user_id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE o.id=? AND o.customer_id=?",
      [orderId, req.account.id],
    );
    const order = rows[0];
    if (
      !order ||
      order.confirmed_cost == null ||
      order.cost_version !== version ||
      !["waiting", "accepted", "processing"].includes(order.status)
    ) {
      throw bad(
        "Biaya sudah disetujui, berubah, atau pesanan tidak tersedia. Muat ulang sebelum menyetujui.",
        409,
      );
    }
    const alreadyApproved = order.accepted_cost_version === order.cost_version;
    const isUpgradingToPaidQris =
      alreadyApproved &&
      paymentMethod === "qris" &&
      order.payment_status !== "paid";
    if (alreadyApproved && !isUpgradingToPaidQris) {
      throw bad(
        "Biaya sudah disetujui, berubah, atau pesanan tidak tersedia. Muat ulang sebelum menyetujui.",
        409,
      );
    }
    if (
      !alreadyApproved &&
      !["waiting", "accepted", "processing"].includes(order.status)
    ) {
      throw bad(
        "Biaya sudah disetujui, berubah, atau pesanan tidak tersedia. Muat ulang sebelum menyetujui.",
        409,
      );
    }
    // Ketika pembayaran QRIS selesai (paid), pesanan langsung lanjut ke tahap pengerjaan (processing) sehingga kedua pihak tinggal melakukan konfirmasi status selesai.
    const nextStatus =
      autoProgress && ["waiting", "accepted"].includes(order.status)
        ? "processing"
        : order.status;
    const [result] = await db.execute(
      "UPDATE service_orders SET accepted_cost_version=cost_version, cost_accepted_at=COALESCE(cost_accepted_at, UTC_TIMESTAMP()), payment_method=?, payment_status=?, status=? WHERE id=? AND customer_id=? AND cost_version=?",
      [
        paymentMethod,
        paymentStatus,
        nextStatus,
        orderId,
        req.account.id,
        version,
      ],
    );
    if (!result.affectedRows)
      throw bad(
        "Biaya sudah disetujui, berubah, atau pesanan tidak tersedia. Muat ulang sebelum menyetujui.",
        409,
      );
    if (paymentStatus === "paid") {
      await db.execute(
        "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
        [
          orderId,
          req.account.id,
          nextStatus,
          `Pelanggan telah melunasi pembayaran via QRIS (Rp ${Number(order.confirmed_cost).toLocaleString("id-ID")}).`,
        ],
      );
      await db.execute(
        "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
        [
          order.owner_user_id,
          orderId,
          "Pembayaran QRIS Lunas",
          `Pelanggan telah melunasi pembayaran QRIS untuk pesanan #${orderId}. Silakan konfirmasi pesanan selesai setelah pengerjaan beres.`,
        ],
      );
    } else if (!alreadyApproved && req.body?.paymentMethod === "cod") {
      await db.execute(
        "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
        [
          orderId,
          req.account.id,
          nextStatus,
          `Pelanggan menyetujui biaya Rp ${Number(order.confirmed_cost).toLocaleString("id-ID")} (Bayar di Lokasi / COD).`,
        ],
      );
      await db.execute(
        "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
        [
          order.owner_user_id,
          orderId,
          "Biaya Disetujui (COD)",
          `Pelanggan menyetujui biaya pesanan #${orderId} dengan metode Bayar di Lokasi (COD).`,
        ],
      );
    }
    res.json({
      message:
        paymentMethod === "qris"
          ? "Pembayaran QRIS berhasil dan lunas! Pesanan lanjut ke tahap pengerjaan."
          : "Versi biaya disetujui (Pembayaran di Lokasi / COD).",
      paymentMethod,
      paymentStatus,
      status: nextStatus,
    });
  });
  r.post(
    "/api/owner/workshops/:id/photos",
    (req, res, next) =>
      upload(req, res, (e) =>
        e
          ? res
              .status(400)
              .json({
                message: "Unggahan tidak valid; maksimal 3 MB per foto.",
              })
          : next(),
      ),
    async (req, res) => {
      let photos = [];
      try {
        const id = Number(req.params.id);
        const [rows] = await db.execute(
          "SELECT p.*,d.details FROM partner_workshops p LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.id=? AND p.owner_user_id=?",
          [id, req.account.id],
        );
        if (!rows[0]) throw bad("Bengkel tidak ditemukan.", 404);
        photos = await savePhotos(req.files, {
          pickup: Boolean(req.files?.towPhoto?.length),
        });
        await propose(db, id, req.account.id, { photos }, { photosOnly: true });
        res.json({
          message:
            "Foto baru menunggu peninjauan admin. Foto lama tetap tampil sampai disetujui.",
        });
      } catch (e) {
        await removePhotos(photos);
        if (e.status) return res.status(e.status).json({ message: e.message });
        throw e;
      }
    },
  );
  r.get("/api/admin/monitoring", async (req, res) => {
    if (req.account.role !== "admin")
      throw bad("Halaman dan data monitoring hanya untuk admin.", 403);
    await require("../services/operations").ensureOrderWorkflowColumns(db);
    await require("../services/operations").maintain(db);
    const toIso = (v) => (v ? new Date(v).toISOString() : null);
    const [statsRows] = await db.execute(
      `SELECT
                            COUNT(*) AS totalOrders,
                            COALESCE(SUM(status IN ('waiting','accepted','processing')), 0) AS activeOrders,
                            COALESCE(SUM(status = 'completed'), 0) AS completedOrders,
                            COALESCE(SUM(status = 'cancelled'), 0) AS cancelledOrders,
                            COALESCE(SUM(payment_status = 'paid'), 0) AS paidOrders,
                            COALESCE(SUM(CASE WHEN status = 'completed' OR payment_status = 'paid' THEN COALESCE(confirmed_cost, 0) ELSE 0 END), 0) AS totalRevenue,
                            COALESCE(SUM(payment_method = 'qris'), 0) AS qrisOrders,
                            COALESCE(SUM(payment_method = 'cod'), 0) AS codOrders
                         FROM service_orders`,
    );
    const [orderRows] = await db.execute(
      `SELECT o.*, p.name AS workshop_name, p.phone AS workshop_phone, p.owner_user_id,
                                u_cust.email AS customer_email, u_owner.email AS partner_email
                         FROM service_orders o
                         JOIN partner_workshops p ON p.id = o.workshop_id
                         JOIN users u_cust ON u_cust.id = o.customer_id
                         JOIN users u_owner ON u_owner.id = p.owner_user_id
                         ORDER BY o.updated_at DESC, o.id DESC
                         LIMIT 200`,
    );
    const [eventRows] = await db.execute(
      `SELECT e.id, e.order_id, e.actor_id, e.actor_type, e.status, e.note, e.created_at,
                                o.service, o.vehicle_type, o.confirmed_cost, o.payment_method, o.payment_status,
                                p.name AS workshop_name, p.owner_user_id,
                                u_cust.email AS customer_email,
                                u_owner.email AS partner_email,
                                u_actor.email AS actor_email
                         FROM service_order_events e
                         JOIN service_orders o ON o.id = e.order_id
                         JOIN partner_workshops p ON p.id = o.workshop_id
                         JOIN users u_cust ON u_cust.id = o.customer_id
                         JOIN users u_owner ON u_owner.id = p.owner_user_id
                         LEFT JOIN users u_actor ON u_actor.id = e.actor_id
                         ORDER BY e.id DESC
                         LIMIT 250`,
    );
    const summary = Object.fromEntries(
      Object.entries(statsRows[0] || {}).map(([k, v]) => [k, Number(v || 0)]),
    );
    const orders = orderRows.map((o) => ({
      ...o,
      confirmed_cost:
        o.confirmed_cost != null ? Number(o.confirmed_cost) : null,
      scheduled_at: toIso(o.scheduled_at),
      created_at: toIso(o.created_at),
      updated_at: toIso(o.updated_at),
      cost_accepted_at: toIso(o.cost_accepted_at),
      customer_completed_at: toIso(o.customer_completed_at),
      partner_completed_at: toIso(o.partner_completed_at),
    }));
    const logs = eventRows.map((e) => ({
      id: e.id,
      order_id: e.order_id,
      status: e.status,
      note: e.note || "",
      actor_type:
        e.actor_type ||
        (e.actor_id === e.owner_user_id ? "partner" : "customer"),
      actor_role:
        e.actor_type === "system"
          ? "system"
          : e.actor_id === e.owner_user_id
            ? "partner"
            : "customer",
      actor_email:
        e.actor_type === "system"
          ? "Sistem Otomatis"
          : e.actor_email || "Pengguna",
      customer_email: e.customer_email,
      partner_email: e.partner_email,
      workshop_name: e.workshop_name,
      service: e.service,
      vehicle_type: e.vehicle_type,
      confirmed_cost:
        e.confirmed_cost != null ? Number(e.confirmed_cost) : null,
      payment_method: e.payment_method,
      payment_status: e.payment_status,
      created_at: toIso(e.created_at),
    }));
    res.json({ summary, orders, logs });
  });
  const adminOnly = (req) => {
    if (req.account.role !== "admin")
      throw bad("Data ini hanya untuk admin.", 403);
  };
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  r.get("/api/admin/accounts", async (req, res) => {
    adminOnly(req);
    const [rows] = await db.execute(
      `SELECT u.*,
                            CASE WHEN u.role='admin' THEN 'admin'
                                 WHEN EXISTS (SELECT 1 FROM partner_workshops p WHERE p.owner_user_id=u.id AND p.status='approved') THEN 'partner'
                                 ELSE 'customer' END AS effective_role,
                            (SELECT COUNT(*) FROM partner_workshops p WHERE p.owner_user_id=u.id) AS workshop_count,
                            (SELECT COUNT(*) FROM service_orders o WHERE o.customer_id=u.id) AS order_count
                         FROM users u ORDER BY u.id DESC LIMIT 500`,
    );
    res.json({
      data: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.effective_role,
        registered_at: iso(u.tgl_daftar ?? u.created_at ?? null),
        deleted_at: iso(u.deleted_at ?? null),
        workshop_count: Number(u.workshop_count || 0),
        order_count: Number(u.order_count || 0),
      })),
    });
  });
  r.get("/api/admin/workshops", async (req, res) => {
    adminOnly(req);
    const [rows] = await db.execute(
      `SELECT p.id, p.name, p.address, p.phone, p.services, p.status, p.review_note, p.reviewed_at, p.created_at,
                                p.pickup, p.onsite, p.emergency, p.open24, u.email AS owner_email,
                                (SELECT COUNT(*) FROM service_orders o WHERE o.workshop_id=p.id AND o.status IN ('waiting','accepted','processing')) AS active_orders,
                                (SELECT COUNT(*) FROM service_orders o WHERE o.workshop_id=p.id AND o.status='completed') AS completed_orders,
                                EXISTS (SELECT 1 FROM workshop_revisions r WHERE r.workshop_id=p.id AND r.status='pending') AS has_pending_revision
                         FROM partner_workshops p JOIN users u ON u.id=p.owner_user_id
                         ORDER BY p.id DESC LIMIT 500`,
    );
    const parseList = (v) => {
      if (Array.isArray(v)) return v;
      try {
        const x = JSON.parse(v);
        return Array.isArray(x) ? x : [];
      } catch {
        return [];
      }
    };
    res.json({
      data: rows.map((w) => ({
        id: w.id,
        name: w.name,
        address: w.address,
        phone: w.phone,
        services: parseList(w.services),
        status: w.status,
        review_note: w.review_note,
        reviewed_at: iso(w.reviewed_at),
        created_at: iso(w.created_at),
        owner_email: w.owner_email,
        pickup: Boolean(w.pickup),
        onsite: Boolean(w.onsite),
        emergency: Boolean(w.emergency),
        open24: Boolean(w.open24),
        active_orders: Number(w.active_orders || 0),
        completed_orders: Number(w.completed_orders || 0),
        has_pending_revision: Boolean(Number(w.has_pending_revision)),
      })),
    });
  });
  return r;
}
module.exports = { createAuditRouter };
