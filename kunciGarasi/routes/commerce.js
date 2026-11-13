const express = require("express"),
  bcrypt = require("bcrypt"),
  crypto = require("node:crypto");
const db = require("../../db"),
  partners = require("../repositories/partners");
const { bad } = require("../lib/workshop-utils"),
  { validateRegistration, TERMS_VERSION } = require("../lib/partner-input");
const object = (value) =>
  typeof value === "string" ? JSON.parse(value) : value || {};
const parseId = (value) => {
  const id = Number(String(value).replace(/^partner:/, ""));
  if (!Number.isSafeInteger(id) || id < 1) throw bad("ID tidak valid.");
  return id;
};
const transitions = {
  waiting: ["accepted", "cancelled"],
  accepted: ["processing", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
function scheduledTime(value, hours, open24, now = Date.now(), duration = 60) {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value))
    throw bad("Jadwal harus menyertakan zona waktu.");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getTime() < now + 15 * 60000 ||
    date.getTime() > now + 90 * 86400000
  )
    throw bad("Jadwal minimal 15 menit dari sekarang dan maksimal 90 hari.");
  if (!hours?.days?.length)
    throw bad("Bengkel belum melengkapi jam operasional. Hubungi bengkel.");
  const local = new Date(date.getTime() + 7 * 3600000),
    day = local.getUTCDay(),
    minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const start = minutes(hours.open),
    end = minutes(hours.close);
  const inside = open24
    ? hours.days.includes(day)
    : start < end
      ? hours.days.includes(day) && minute >= start && minute + duration <= end
      : (hours.days.includes(day) &&
          minute >= start &&
          minute + duration <= 1440 + end) ||
        (hours.days.includes((day + 6) % 7) && minute + duration <= end);
  if (!inside)
    throw bad(
      "Slot servis sesuai durasi layanan berada di luar jam operasional bengkel (WIB).",
    );
  return date.toISOString().slice(0, 19).replace("T", " ");
}
function createCommerceRouter({ database = db } = {}) {
  const r = express.Router();
  r.use(
    ["/api/customer/orders", "/api/owner/orders"],
    async (req, res, next) => {
      try {
        await require("../services/operations").maintain(database);
        next();
      } catch (e) {
        next(e);
      }
    },
  );
  r.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const customer = (req, res, next) =>
    req.account.role === "customer"
      ? next()
      : res.status(403).json({ message: "Fitur ini untuk akun pelanggan." });
  const transaction = (action) =>
    require("../services/transaction").withTransaction(database, action);
  async function workshop(c, id, lock = false) {
    const [rows] = await c.execute(
      "SELECT p.*,d.details FROM partner_workshops p LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.id=?" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    );
    if (!rows[0]) throw bad("Bengkel tidak ditemukan.", 404);
    return rows[0];
  }
  r.get("/api/customer/partners/:id", async (req, res) => {
    if (req.account.role === "partner")
      throw bad("Fitur ini untuk akun pelanggan.", 403);
    const id = parseId(req.params.id),
      p = await partners.getApproved(id);
    if (!p)
      return res
        .status(404)
        .json({ message: "Mitra tidak ditemukan atau belum disetujui." });
    res.json({ workshop: p });
  });
  r.post("/api/customer/orders", customer, async (req, res) => {
    const body = req.body || {},
      id = parseId(body.workshopId);
    const paymentMethod = body.paymentMethod === "qris" ? "qris" : "cod";
    const needTowing = Boolean(body.needTowing);
    const towingStatus = needTowing ? "requested" : "none";
    if (
      !["motor", "mobil"].includes(body.vehicleType) ||
      typeof body.service !== "string" ||
      typeof (body.notes ?? "") !== "string" ||
      (body.notes || "").length > 1500
    )
      throw bad("Kategori kendaraan, layanan atau catatan tidak valid.");
    const orderId = await transaction(async (c) => {
      const [customers] = await c.execute(
        "SELECT id FROM users WHERE id=? AND deleted_at IS NULL FOR UPDATE",
        [req.account.id],
      );
      if (!customers.length) throw bad("Akun tidak tersedia.", 401);
      const w = await workshop(c, id, true),
        d = object(w.details);
      if (w.status !== "approved" || w.owner_user_id === req.account.id)
        throw bad("Bengkel tidak menerima pemesanan ini.");
      if (
        !d.vehicleTypes?.includes(body.vehicleType) ||
        !object(w.services).includes(body.service)
      )
        throw bad("Kategori kendaraan atau layanan tidak ditangani bengkel.");
      const duration = d.booking?.durations?.[body.service] || 60,
        capacity = d.booking?.capacity || 1;
      const time = scheduledTime(
        body.scheduledAt,
        d.hours,
        w.open24,
        Date.now(),
        duration,
      );
      const [conflicts] = await c.execute(
        "SELECT scheduled_at,duration_minutes FROM service_orders WHERE workshop_id=? AND status IN ('waiting','accepted','processing') AND scheduled_at<DATE_ADD(?,INTERVAL ? MINUTE) AND DATE_ADD(scheduled_at,INTERVAL duration_minutes MINUTE)>?",
        [id, time, duration, time],
      );
      const start = Date.parse(time.replace(" ", "T") + "Z"),
        end = start + duration * 60000;
      const edges = [
        [start, 1],
        [end, -1],
      ];
      for (const other of conflicts) {
        const begin = new Date(other.scheduled_at).getTime();
        edges.push(
          [Math.max(start, begin), 1],
          [Math.min(end, begin + other.duration_minutes * 60000), -1],
        );
      }
      edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let simultaneous = 0;
      for (const [, delta] of edges) {
        simultaneous += delta;
        if (simultaneous > capacity)
          throw bad(
            "Kapasitas bengkel pada jadwal ini sudah penuh. Pilih waktu lain.",
            409,
          );
      }
      const [created] = await c.execute(
        "INSERT INTO service_orders(customer_id,workshop_id,vehicle_type,service,scheduled_at,notes,duration_minutes,payment_method,need_towing,towing_status) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
          req.account.id,
          id,
          body.vehicleType,
          body.service,
          time,
          (body.notes || "").trim(),
          duration,
          paymentMethod,
          needTowing ? 1 : 0,
          towingStatus,
        ],
      );
      await c.execute(
        "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,'waiting',?)",
        [
          created.insertId,
          req.account.id,
          needTowing
            ? "SOS Derek: Pelanggan membutuhkan layanan derek/penjemputan."
            : "",
        ],
      );
      if (needTowing) {
        await c.execute(
          "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
          [
            w.owner_user_id,
            created.insertId,
            "🚨 [SOS DEREK] Pesanan Darurat Baru",
            `Pesanan #${created.insertId} membutuhkan layanan derek (SOS) untuk ${body.vehicleType} (${body.service}). Wajib diterima.`,
          ],
        );
      }
      return created.insertId;
    });
    res
      .status(201)
      .json({
        id: orderId,
        message: needTowing
          ? "Pesanan SOS Derek dikirim! Mitra wajib menerima pesanan ini."
          : "Pesanan menunggu konfirmasi bengkel. Silakan pantau status pesanan dan konfirmasi biaya.",
      });
  });
  const toIsoOrNull = (v) => (v ? new Date(v).toISOString() : null);
  const listOrders = (owner) => async (req, res) => {
    const orderBy = owner
      ? "ORDER BY o.need_towing DESC, o.id DESC"
      : "ORDER BY o.id DESC";
    const [rows] = await database.execute(
      "SELECT o.*,p.name AS workshop_name,p.phone AS workshop_phone,u.email AS customer_email FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id JOIN users u ON u.id=o.customer_id WHERE " +
        (owner ? "p.owner_user_id" : "o.customer_id") +
        "=? " +
        orderBy +
        " LIMIT 300",
      [req.account.id],
    );
    res.json({
      data: rows.map((o) => ({
        ...o,
        need_towing: Boolean(o.need_towing),
        towing_status: o.towing_status || "none",
        scheduled_at: new Date(o.scheduled_at).toISOString(),
        created_at: toIsoOrNull(o.created_at),
        updated_at: toIsoOrNull(o.updated_at),
        cost_accepted_at: toIsoOrNull(o.cost_accepted_at),
        customer_completed_at: toIsoOrNull(o.customer_completed_at),
        partner_completed_at: toIsoOrNull(o.partner_completed_at),
      })),
    });
  };
  r.get("/api/customer/orders", customer, listOrders(false));
  r.get("/api/owner/orders", listOrders(true));
  const canAccessOrder = (order, account) =>
    order &&
    (order.owner_user_id === account.id ||
      (account.role !== "partner" && order.customer_id === account.id));
  r.get("/api/customer/orders/:id/events", async (req, res) => {
    const id = parseId(req.params.id);
    const [orders] = await database.execute(
      "SELECT o.customer_id,p.owner_user_id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE o.id=?",
      [id],
    );
    if (!canAccessOrder(orders[0], req.account))
      throw bad("Pesanan tidak ditemukan.", 404);
    const [events] = await database.execute(
      "SELECT status,note,created_at FROM service_order_events WHERE order_id=? ORDER BY id",
      [id],
    );
    res.json({ data: events });
  });
  const activeOrderMutations = new Set();
  const withOrderLock = (orderId, action) => async (req, res, next) => {
    const key = `${orderId}`;
    if (activeOrderMutations.has(key)) {
      return res
        .status(409)
        .json({
          message: "Pesanan ini sedang diproses. Mohon tunggu sebentar.",
        });
    }
    activeOrderMutations.add(key);
    try {
      await action(req, res, next);
    } catch (e) {
      next(e);
    } finally {
      activeOrderMutations.delete(key);
    }
  };
  r.patch("/api/customer/orders/:id/status", (req, res, next) => {
    const id = parseId(req.params.id);
    return withOrderLock(id, async () => {
      const body = req.body || {};
      let responseMessage = "Status pesanan diperbarui.";
      await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT o.*,p.owner_user_id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE o.id=? FOR UPDATE",
          [id],
        );
        const order = rows[0];
        if (!canAccessOrder(order, req.account))
          throw bad("Pesanan tidak ditemukan.", 404);
        const owner = order.owner_user_id === req.account.id;
        const isCustomerDualComplete =
          !owner &&
          order.status === "processing" &&
          body.status === "completed" &&
          body.dualConfirm === true;
        if (
          !owner &&
          !isCustomerDualComplete &&
          (body.status !== "cancelled" ||
            !["waiting", "accepted"].includes(order.status))
        )
          throw bad(
            "Pelanggan hanya dapat membatalkan pesanan sebelum diproses.",
            403,
          );
        if (!transitions[order.status].includes(body.status))
          throw bad("Perubahan status tidak diperbolehkan.", 409);
        if (owner && order.need_towing && body.status === "rejected") {
          throw bad(
            "Pesanan layanan derek (SOS) wajib diterima oleh mitra.",
            400,
          );
        }
        const customerHasConfirmedPayment =
          order.payment_status === "paid" ||
          (order.cost_version > 0 &&
            order.accepted_cost_version === order.cost_version);
        if (
          owner &&
          body.status === "cancelled" &&
          customerHasConfirmedPayment
        ) {
          throw bad(
            "Pesanan tidak dapat dibatalkan karena pelanggan sudah mengonfirmasi pembayaran.",
            409,
          );
        }
        const note = body.note ?? "";
        if (
          typeof note !== "string" ||
          note.length > 500 ||
          (body.status === "cancelled" && !note.trim())
        )
          throw bad(
            "Catatan maksimal 500 karakter; alasan pembatalan wajib diisi.",
          );
        let effectiveEventNote = note.trim();
        if (
          owner &&
          ["accepted", "processing"].includes(body.status) &&
          body.amount !== undefined &&
          order.cost_version < 1
        ) {
          const rawAmount =
            typeof body.amount === "string"
              ? body.amount.replace(/\D/g, "")
              : body.amount;
          const amount = Number(rawAmount);
          const costNote =
            typeof body.costNote === "string" && body.costNote.trim()
              ? body.costNote.trim()
              : typeof body.note === "string" && body.note.trim()
                ? body.note.trim()
                : "Biaya servis";
          if (
            !Number.isSafeInteger(amount) ||
            amount < 1 ||
            amount > 1e9 ||
            costNote.length > 500
          ) {
            throw bad(
              "Wajib mengisi biaya servis (Rp) berupa angka bulat dan rincian biaya yang valid (maksimal 500 karakter).",
            );
          }
          await c.execute(
            "UPDATE service_orders SET confirmed_cost=?, cost_note=?, cost_version=1, accepted_cost_version=0, cost_accepted_at=NULL, payment_status='unpaid' WHERE id=?",
            [amount, costNote, id],
          );
          order.confirmed_cost = amount;
          order.cost_note = costNote;
          order.cost_version = 1;
          order.justRecordedInitialCost = true;
          effectiveEventNote = `Biaya servis Rp ${amount.toLocaleString("id-ID")} (${costNote})${effectiveEventNote ? " — " + effectiveEventNote : ""}`;
          responseMessage =
            "Status diperbarui menjadi Diproses dan rincian biaya telah dikirim ke pelanggan.";
        }
        if (body.status === "processing") {
          if (order.confirmed_cost == null || order.cost_version < 1) {
            throw bad(
              "Wajib mengisi harga servis terlebih dahulu sebelum mengubah status menjadi diproses.",
              409,
            );
          }
          if (
            !order.justRecordedInitialCost &&
            !body.withCost &&
            order.accepted_cost_version !== order.cost_version
          ) {
            throw bad(
              "Biaya versi terbaru harus disetujui pelanggan sebelum servis diproses.",
              409,
            );
          }
        }
        if (
          body.status === "completed" &&
          !body.dualConfirm &&
          new Date(order.scheduled_at).getTime() > Date.now()
        )
          throw bad("Servis tidak dapat diselesaikan sebelum jadwal.", 409);

        if (body.status === "completed" && body.dualConfirm === true) {
          if (order.need_towing && order.towing_status !== "arrived") {
            throw bad(
              "Untuk layanan derek, pelanggan harus mengonfirmasi bahwa mitra sudah sampai di lokasi terlebih dahulu.",
              409,
            );
          }
          if (order.need_towing && order.payment_status !== "paid") {
            throw bad(
              "Untuk layanan derek, mitra harus mengonfirmasi pembayaran terlebih dahulu sebelum menyelesaikan pesanan.",
              409,
            );
          }
          if (!customerHasConfirmedPayment) {
            throw bad(
              "Pelanggan harus menyelesaikan konfirmasi pembayaran terlebih dahulu sebelum pesanan dapat dikonfirmasi selesai.",
              409,
            );
          }
          const isCodUnpaid =
            order.payment_method === "cod" && order.payment_status !== "paid";
          if (owner) {
            if (order.partner_completed_at)
              throw bad(
                "Anda sudah mengonfirmasi penyelesaian pesanan ini.",
                409,
              );
            const bothDone = Boolean(order.customer_completed_at);
            const nextStatus = bothDone ? "completed" : "processing";
            const paymentStatus =
              bothDone || isCodUnpaid ? "paid" : order.payment_status;
            await c.execute(
              "UPDATE service_orders SET partner_completed_at=UTC_TIMESTAMP(), status=?, payment_status=? WHERE id=?",
              [nextStatus, paymentStatus, id],
            );
            const eventNote =
              (note.trim() ? note.trim() + " — " : "") +
              (bothDone
                ? "Mitra mengonfirmasi selesai (Kedua pihak telah mengonfirmasi)."
                : "Mitra mengonfirmasi selesai (Menunggu konfirmasi pelanggan maksimal 24 jam).");
            await c.execute(
              "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
              [id, req.account.id, nextStatus, eventNote],
            );
            if (!bothDone) {
              await c.execute(
                "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
                [
                  order.customer_id,
                  id,
                  "Konfirmasi Pesanan Selesai",
                  `Mitra telah mengonfirmasi pesanan #${id} selesai. Mohon konfirmasi penyelesaian dari akun Anda (otomatis selesai dalam 24 jam).`,
                ],
              );
            }
            responseMessage = bothDone
              ? "Pesanan selesai! Kedua pihak telah mengonfirmasi penyelesaian."
              : "Konfirmasi selesai dari mitra tercatat. Menunggu konfirmasi pelanggan (otomatis selesai dalam 24 jam).";
          } else {
            if (
              (isCodUnpaid || order.need_towing) &&
              !order.partner_completed_at
            ) {
              throw bad(
                "Mohon tunggu mitra bengkel melakukan konfirmasi selesai terlebih dahulu.",
                409,
              );
            }
            if (order.customer_completed_at)
              throw bad(
                "Anda sudah mengonfirmasi penyelesaian pesanan ini.",
                409,
              );
            const bothDone = Boolean(order.partner_completed_at);
            const nextStatus = bothDone ? "completed" : "processing";
            const paymentStatus = bothDone ? "paid" : order.payment_status;
            await c.execute(
              "UPDATE service_orders SET customer_completed_at=UTC_TIMESTAMP(), status=?, payment_status=? WHERE id=?",
              [nextStatus, paymentStatus, id],
            );
            const eventNote =
              (note.trim() ? note.trim() + " — " : "") +
              (bothDone
                ? "Pelanggan mengonfirmasi selesai (Kedua pihak telah mengonfirmasi)."
                : "Pelanggan mengonfirmasi selesai (Menunggu konfirmasi mitra maksimal 24 jam).");
            await c.execute(
              "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
              [id, req.account.id, nextStatus, eventNote],
            );
            if (!bothDone) {
              await c.execute(
                "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
                [
                  order.owner_user_id,
                  id,
                  "Konfirmasi Pesanan Selesai",
                  `Pelanggan telah mengonfirmasi pesanan #${id} selesai. Mohon konfirmasi penyelesaian dari akun mitra (otomatis selesai dalam 24 jam).`,
                ],
              );
            }
            responseMessage = bothDone
              ? "Pesanan selesai! Kedua pihak telah mengonfirmasi penyelesaian."
              : "Konfirmasi selesai dari pelanggan tercatat. Menunggu konfirmasi mitra (otomatis selesai dalam 24 jam).";
          }
          return;
        }

        await c.execute(
          'UPDATE service_orders SET status=?,cancellation_reason=?,customer_completed_at=IF(?="completed",COALESCE(customer_completed_at,UTC_TIMESTAMP()),customer_completed_at),partner_completed_at=IF(?="completed",COALESCE(partner_completed_at,UTC_TIMESTAMP()),partner_completed_at) WHERE id=?',
          [
            body.status,
            body.status === "cancelled"
              ? note.trim()
              : order.cancellation_reason,
            body.status,
            body.status,
            id,
          ],
        );
        await c.execute(
          "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
          [id, req.account.id, body.status, effectiveEventNote],
        );
      });
      res.json({ message: responseMessage });
    })(req, res, next);
  });
  r.patch("/api/orders/:id/towing", (req, res, next) => {
    const id = parseId(req.params.id);
    return withOrderLock(id, async () => {
      const action = req.body?.action;
      if (!["on_the_way", "arrived"].includes(action))
        throw bad("Aksi derek tidak valid.");
      let message = "Status derek diperbarui.";
      await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT o.*,p.owner_user_id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE o.id=? FOR UPDATE",
          [id],
        );
        const order = rows[0];
        if (!canAccessOrder(order, req.account))
          throw bad("Pesanan tidak ditemukan.", 404);
        if (!order.need_towing)
          throw bad("Pesanan ini tidak menggunakan layanan derek.", 400);
        const owner = order.owner_user_id === req.account.id;
        if (action === "on_the_way") {
          if (!owner)
            throw bad(
              "Hanya mitra yang dapat mengonfirmasi sedang menuju lokasi.",
              403,
            );
          if (!["accepted", "processing"].includes(order.status))
            throw bad("Pesanan harus diterima terlebih dahulu.", 409);
          if (order.towing_status !== "requested")
            throw bad("Status derek sudah diperbarui sebelumnya.", 409);
          await c.execute(
            "UPDATE service_orders SET towing_status='on_the_way' WHERE id=?",
            [id],
          );
          await c.execute(
            "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
            [
              id,
              req.account.id,
              order.status,
              "Mitra sedang menuju lokasi pelanggan (layanan derek).",
            ],
          );
          await c.execute(
            "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
            [
              order.customer_id,
              id,
              "Mitra Menuju Lokasi",
              `Mitra sedang menuju lokasi Anda untuk pesanan derek #${id}.`,
            ],
          );
          message =
            "Konfirmasi menuju lokasi tercatat. Pelanggan telah diberi tahu.";
        } else {
          if (owner)
            throw bad(
              "Hanya pelanggan yang dapat mengonfirmasi mitra sudah sampai di lokasi.",
              403,
            );
          if (order.towing_status !== "on_the_way")
            throw bad(
              "Mitra harus mengonfirmasi sedang menuju lokasi terlebih dahulu.",
              409,
            );
          const nextStatus =
            order.status === "accepted" ? "processing" : order.status;
          await c.execute(
            "UPDATE service_orders SET towing_status='arrived', status=? WHERE id=?",
            [nextStatus, id],
          );
          await c.execute(
            "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
            [
              id,
              req.account.id,
              nextStatus,
              "Pelanggan mengonfirmasi mitra sudah sampai di lokasi dan sedang menangani layanan.",
            ],
          );
          await c.execute(
            "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
            [
              order.owner_user_id,
              id,
              "Mitra Sudah Sampai",
              `Pelanggan mengonfirmasi Anda sudah sampai di lokasi untuk pesanan derek #${id}.`,
            ],
          );
          message =
            "Konfirmasi kedatangan mitra tercatat. Layanan sedang ditangani.";
        }
      });
      res.json({ message });
    })(req, res, next);
  });
  r.patch("/api/owner/orders/:id/confirm-payment", (req, res, next) => {
    const id = parseId(req.params.id);
    return withOrderLock(id, async () => {
      await transaction(async (c) => {
        const [rows] = await c.execute(
          "SELECT o.*,p.owner_user_id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE o.id=? FOR UPDATE",
          [id],
        );
        const order = rows[0];
        if (!order || order.owner_user_id !== req.account.id)
          throw bad("Pesanan tidak ditemukan.", 404);
        if (!["accepted", "processing"].includes(order.status))
          throw bad("Pesanan tidak berada pada tahap pembayaran.", 409);
        const customerApprovedCost =
          order.cost_version > 0 &&
          order.accepted_cost_version === order.cost_version;
        if (!customerApprovedCost)
          throw bad(
            "Pelanggan belum menyetujui biaya atau memilih metode pembayaran.",
            409,
          );
        if (order.payment_status === "paid")
          throw bad("Pembayaran pesanan ini sudah dikonfirmasi.", 409);
        await c.execute(
          "UPDATE service_orders SET payment_status='paid' WHERE id=?",
          [id],
        );
        await c.execute(
          "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)",
          [
            id,
            req.account.id,
            order.status,
            "Mitra mengonfirmasi pembayaran telah diterima.",
          ],
        );
        await c.execute(
          "INSERT INTO user_notifications(user_id,order_id,title,message) VALUES (?,?,?,?)",
          [
            order.customer_id,
            id,
            "Pembayaran Dikonfirmasi",
            `Mitra telah mengonfirmasi pembayaran untuk pesanan #${id}.`,
          ],
        );
      });
      res.json({
        message:
          "Pembayaran berhasil dikonfirmasi. Sekarang Anda dapat mengonfirmasi penyelesaian order.",
      });
    })(req, res, next);
  });
  r.patch("/api/owner/orders/:id/cost", (req, res, next) => {
    const id = parseId(req.params.id);
    return withOrderLock(id, async () => {
      const { amount, note } = req.body || {};
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        amount > 1e9 ||
        typeof note !== "string" ||
        !note.trim() ||
        note.length > 500
      )
        throw bad(
          "Isi biaya rupiah dan catatan konfirmasi (maksimal 500 karakter).",
        );
      const [result] = await database.execute(
        "UPDATE service_orders o JOIN partner_workshops p ON p.id=o.workshop_id SET o.confirmed_cost=?,o.cost_note=?,o.cost_version=o.cost_version+1,o.accepted_cost_version=0,o.cost_accepted_at=NULL,o.payment_status='unpaid' WHERE o.id=? AND p.owner_user_id=? AND (o.status IN ('waiting','accepted') OR (o.need_towing=1 AND o.status='processing'))",
        [amount, note.trim(), id, req.account.id],
      );
      if (!result.affectedRows)
        throw bad("Pesanan tidak tersedia untuk perubahan biaya.", 404);
      res.json({
        message:
          "Biaya dicatat. Konfirmasikan kepada pelanggan sebelum pengerjaan.",
      });
    })(req, res, next);
  });
  r.get("/api/owner/workshops", async (req, res) =>
    res.json({ data: await partners.mine(req.account.id) }),
  );
  r.put("/api/owner/workshops/:id", async (req, res) => {
    const id = parseId(req.params.id),
      input = validateRegistration(req.body);
    const w = await workshop(database, id);
    if (w.owner_user_id !== req.account.id)
      throw bad("Bengkel tidak ditemukan.", 404);
    const details = object(w.details);

    await require("../services/revisions").propose(
      database,
      id,
      req.account.id,
      input,
    );
    res.json({
      message:
        "Perubahan profil menunggu peninjauan admin. Profil approved sebelumnya tetap tampil.",
    });
  });
  r.post("/api/account/password", async (req, res) => {
    const { currentPassword, password } = req.body || {};
    if (
      typeof currentPassword !== "string" ||
      typeof password !== "string" ||
      password.length < 8 ||
      Buffer.byteLength(password) > 72
    )
      throw bad("Password baru minimal 8 karakter dan maksimal 72 byte.");
    const [users] = await database.execute(
      "SELECT password_hash FROM users WHERE id=?",
      [req.account.id],
    );
    if (!(await bcrypt.compare(currentPassword, users[0].password_hash)))
      throw bad("Password saat ini salah.", 403);
    const hash = await bcrypt.hash(password, 12);
    const [updated] = await database.execute(
      "UPDATE users SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND password_hash=?",
      [hash, req.account.id, users[0].password_hash],
    );
    if (!updated.affectedRows) throw bad("Akun berubah. Login kembali.", 409);
    req.session.destroy(() =>
      res.json({
        message:
          "Password diganti. Silakan login kembali pada seluruh perangkat.",
      }),
    );
  });
  r.delete("/api/account", async (req, res) => {
    const { password, confirmation } = req.body || {};
    if (confirmation !== "HAPUS AKUN" || typeof password !== "string")
      throw bad("Password dan konfirmasi HAPUS AKUN wajib diisi.");
    if (req.account.role === "admin")
      throw bad("Admin harus mencabut role admin sebelum menghapus akun.", 409);
    const [users] = await database.execute(
      "SELECT password_hash FROM users WHERE id=?",
      [req.account.id],
    );
    if (!(await bcrypt.compare(password, users[0].password_hash)))
      throw bad("Password salah.", 403);
    await transaction(async (c) => {
      await c.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [
        req.account.id,
      ]);
      const [active] = await c.execute(
        "SELECT o.id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE (o.customer_id=? OR p.owner_user_id=?) AND o.status IN ('accepted','processing') LIMIT 1",
        [req.account.id, req.account.id],
      );
      if (active.length)
        throw bad(
          "Selesaikan atau batalkan pesanan aktif sebelum menghapus akun.",
          409,
        );
      await c.execute(
        "INSERT INTO service_order_events(order_id,actor_id,status,note,actor_type) SELECT o.id,?,'cancelled','Akun dinonaktifkan','system' FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE (o.customer_id=? OR p.owner_user_id=?) AND o.status='waiting'",
        [req.account.id, req.account.id, req.account.id],
      );
      await c.execute(
        "UPDATE service_orders o JOIN partner_workshops p ON p.id=o.workshop_id SET o.status='cancelled',o.cancellation_reason='Akun dinonaktifkan' WHERE (o.customer_id=? OR p.owner_user_id=?) AND o.status='waiting'",
        [req.account.id, req.account.id],
      );
      await c.execute(
        "SELECT id FROM partner_workshops WHERE owner_user_id=? ORDER BY id FOR UPDATE",
        [req.account.id],
      );
      await c.execute(
        "UPDATE workshop_revisions r JOIN partner_workshops p ON p.id=r.workshop_id SET r.status='rejected',r.note='Akun pemilik dinonaktifkan',r.reviewed_by=NULL WHERE p.owner_user_id=? AND r.status='pending'",
        [req.account.id],
      );
      await c.execute(
        "UPDATE partner_workshops SET status='rejected',review_note='Akun pemilik dinonaktifkan' WHERE owner_user_id=?",
        [req.account.id],
      );
      await c.execute(
        "UPDATE users SET email=?,password_hash=?,auth_version=auth_version+1,deleted_at=UTC_TIMESTAMP() WHERE id=?",
        [
          `deleted-${req.account.id}-${crypto.randomBytes(8).toString("hex")}@invalid.local`,
          crypto.randomBytes(32).toString("hex"),
          req.account.id,
        ],
      );
    });
    req.session.destroy(() =>
      res.json({
        message:
          "Akun dinonaktifkan dan email login dianonimkan. Riwayat pesanan disimpan untuk integritas catatan layanan.",
      }),
    );
  });
  r.get("/api/map-config", (req, res) =>
    res.json({ browserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || null }),
  );
  r.use((error, req, res, next) => {
    if (error.status)
      return res.status(error.status).json({ message: error.message });
    next(error);
  });
  return r;
}
module.exports = { createCommerceRouter, scheduledTime, transitions };
