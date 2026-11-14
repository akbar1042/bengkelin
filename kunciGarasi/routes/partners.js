const express = require("express");
const defaultRepository = require("../repositories/partners");
const { bad } = require("../lib/workshop-utils");
const {
  serviceCatalog,
  validateRegistration,
  TERMS_VERSION,
} = require("../lib/partner-input");
const {
  upload,
  savePhotos,
  removePhotos,
  readPhoto,
} = require("../services/partner-media");
const bcrypt = require("bcrypt");
function createPartnerRouter({ repository = defaultRepository } = {}) {
  const router = express.Router();
  router.get("/api/partners/services", (req, res) =>
    res.json({ services: serviceCatalog }),
  );
  router.get("/api/partners/mine", async (req, res) =>
    res.json({ data: await repository.mine(req.session.user.id) }),
  );
  const attempts = new Map();
  const registrationLimit = (req, res, next) => {
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const entry = attempts.get(req.ip) || { count: 0, until: now + 900000 };
    if (++entry.count > 12)
      return res
        .status(429)
        .json({ message: "Terlalu banyak pengajuan. Tunggu 15 menit." });
    attempts.set(req.ip, entry);
    next();
  };
  router.get("/api/mitra-services", (req, res) =>
    res.json({ services: serviceCatalog, termsVersion: TERMS_VERSION }),
  );
  const receive = (req, res, next) =>
    upload(req, res, (error) =>
      error
        ? res
            .status(400)
            .json({
              message:
                error.code === "LIMIT_FILE_SIZE"
                  ? "Maksimal ukuran foto 3 MB."
                  : "Unggahan tidak valid; maksimal 4 foto bengkel dan 1 foto derek.",
            })
        : next(),
    );
  const submit = (guest) => async (req, res, next) => {
    let photos = [];
    try {
      let body = req.body?.data;
      try {
        body = JSON.parse(body);
      } catch {
        throw bad("Form harus dikirim sebagai multipart dengan data JSON.");
      }
      const input = validateRegistration(body);
      let account;
      if (guest) {
        try {
          account = JSON.parse(req.body.account);
        } catch {
          throw bad("Data akun diperlukan.");
        }
        if (
          typeof account.email !== "string" ||
          account.email.length > 255 ||
          !/^\S+@\S+\.\S+$/.test(account.email) ||
          typeof account.password !== "string" ||
          account.password.length < 8 ||
          Buffer.byteLength(account.password) > 72
        )
          throw bad("Email dan password akun tidak valid.");
      }
      photos = await savePhotos(req.files, input);
      input.photos = photos;
      const id = guest
        ? await repository.createGuest(
            account.email.trim(),
            await bcrypt.hash(account.password, 12),
            input,
          )
        : await repository.create(req.session.user.id, input);
      res
        .status(201)
        .json({
          id,
          status: "pending",
          message:
            "Pendaftaran dan persetujuan diterima. Bengkel menunggu tinjauan admin.",
          redirect: guest ? "/login-mitra.html" : "/dashboard",
        });
    } catch (error) {
      await removePhotos(photos);
      if (error.code === "ER_DUP_ENTRY")
        return res
          .status(409)
          .json({
            message:
              "Email sudah terdaftar. Login terlebih dahulu untuk mengajukan bengkel.",
          });
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      next(error);
    }
  };
  router.post("/api/partners", registrationLimit, receive, submit(false));
  router.post("/api/mitra-register", registrationLimit, receive, submit(true));
  router.get("/api/partner-media/:id", async (req, res, next) => {
    const id = req.params.id;
    if (!/^[a-f0-9]{40}\.(jpg|png|webp)$/.test(id)) return res.sendStatus(404);
    try {
      if (
        !(await repository.canReadMedia(
          id,
          req.session.user.id,
          req.account.role === "admin",
        ))
      )
        return res.sendStatus(404);
      const media = await readPhoto(id);
      if (!media) return res.sendStatus(404);
      res.set("Content-Type", media.mimeType);
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "private, no-store");
      res.send(media.buffer);
    } catch (e) {
      next(e);
    }
  });
  const adminOnly = async (req, res, next) => {
    if (!(await repository.isAdmin(req.session.user.id)))
      return res
        .status(403)
        .json({ message: "Hanya admin yang dapat meninjau mitra." });
    next();
  };
  router.get("/api/admin/partners", adminOnly, async (req, res) =>
    res.json({ data: await repository.pending() }),
  );
  router.get("/api/admin/partners/active", adminOnly, async (req, res) =>
    res.json({ data: await repository.listApproved() }),
  );
  router.post("/api/admin/partners/:id/revoke", adminOnly, async (req, res) => {
    const id = Number(req.params.id),
      note = req.body?.note;
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      typeof note !== "string" ||
      !note.trim() ||
      note.length > 500
    )
      throw bad("ID mitra dan alasan pencabutan wajib valid.");
    await repository.revoke(id, req.account.id, note.trim());
    res.json({
      message: "Status mitra dicabut. Pesanan yang menunggu dibatalkan.",
    });
  });
  router.post("/api/admin/partners/:id/review", adminOnly, async (req, res) => {
    const id = Number(req.params.id),
      body = req.body ?? {};
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !["approved", "rejected"].includes(body.status) ||
      Object.keys(body).some(
        (k) =>
          !["status", "note", "googlePlaceId", "reviewVersion"].includes(k),
      ) ||
      typeof (body.note ?? "") !== "string" ||
      (body.note ?? "").length > 500
    )
      return res.status(400).json({ message: "Keputusan admin tidak valid." });
    const place = body.googlePlaceId ?? null;
    if (
      place !== null &&
      (typeof place !== "string" || !/^[A-Za-z0-9_-]{5,255}$/.test(place))
    )
      return res.status(400).json({ message: "Google Place ID tidak valid." });
    try {
      if (
        !(await repository.review(id, req.session.user.id, {
          status: body.status,
          note: (body.note ?? "").trim(),
          googlePlaceId: place,
          reviewVersion: body.reviewVersion,
        }))
      )
        return res
          .status(404)
          .json({ message: "Pendaftaran tidak ditemukan." });
      res.json({
        message:
          body.status === "approved"
            ? "Mitra disetujui."
            : "Pendaftaran ditolak.",
        status: body.status,
      });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY")
        return res.status(409).json({
          message: "Google Place ID sudah ditautkan ke bengkel lain.",
        });
      throw error;
    }
  });
  return router;
}
module.exports = { createPartnerRouter, validateRegistration, serviceCatalog };
