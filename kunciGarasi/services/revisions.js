const { bad } = require("../lib/workshop-utils");
const { withTransaction } = require("./transaction");
const crypto = require("node:crypto");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v || {});
function reviewToken(row, revision) {
  if (revision?.status === "pending") return "revision:" + revision.version;
  const snapshot = {
    id: row.id,
    owner: row.owner_user_id,
    status: row.status,
    name: row.name,
    address: row.address,
    phone: row.phone,
    lat: Number(row.lat),
    lng: Number(row.lng),
    services: parse(row.services),
    details: parse(row.details),
    pickup: Boolean(row.pickup),
    onsite: Boolean(row.onsite),
    emergency: Boolean(row.emergency),
    open24: Boolean(row.open24),
  };
  return (
    "registration:" +
    crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
  );
}
// All revision writers lock in the same order: owner -> workshop -> details -> revision.
async function lockWorkshop(c, id, expectedOwner) {
  const [lookup] = await c.execute(
    "SELECT owner_user_id FROM partner_workshops WHERE id=?",
    [id],
  );
  if (
    !lookup[0] ||
    (expectedOwner !== undefined && lookup[0].owner_user_id !== expectedOwner)
  )
    throw bad("Bengkel tidak ditemukan.", 404);
  const [owners] = await c.execute(
    "SELECT id,deleted_at FROM users WHERE id=? FOR UPDATE",
    [lookup[0].owner_user_id],
  );
  if (!owners[0] || owners[0].deleted_at)
    throw bad(
      "Akun pemilik sudah dinonaktifkan; perubahan tidak dapat diteruskan.",
      409,
    );
  const [rows] = await c.execute(
    "SELECT * FROM partner_workshops WHERE id=? FOR UPDATE",
    [id],
  );
  const row = rows[0];
  if (!row || row.owner_user_id !== owners[0].id)
    throw bad("Pemilik bengkel berubah. Muat ulang.", 409);
  const [details] = await c.execute(
    "SELECT details FROM partner_workshop_details WHERE workshop_id=? FOR UPDATE",
    [id],
  );
  row.details = details[0]?.details;
  const [revisions] = await c.execute(
    "SELECT * FROM workshop_revisions WHERE workshop_id=? FOR UPDATE",
    [id],
  );
  return { row, revision: revisions[0] };
}
async function propose(
  database,
  id,
  owner,
  input,
  { photosOnly = false } = {},
) {
  return withTransaction(database, async (c) => {
    const { row, revision } = await lockWorkshop(c, id, owner),
      old = parse(row.details),
      pending =
        revision?.status === "pending" ? parse(revision.proposal) : null;
    const current = {
      name: row.name,
      address: row.address,
      phone: row.phone,
      lat: Number(row.lat),
      lng: Number(row.lng),
      services: parse(row.services),
      vehicleTypes: old.vehicleTypes,
      hours: old.hours,
      booking: old.booking,
      pickup: Boolean(row.pickup),
      onsite: Boolean(row.onsite),
      emergency: Boolean(row.emergency),
      open24: Boolean(row.open24),
      termsVersion: old.termsVersion,
      emergencyAccepted: old.emergencyAccepted,
    };
    const base = pending || current;
    const mergedPhotos = photosOnly
      ? [
          ...input.photos.filter((f) => f.kind === "workshop"),
          ...(input.photos.some((f) => f.kind === "tow")
            ? input.photos.filter((f) => f.kind === "tow")
            : (base.photos || old.photos || []).filter(
                (f) => f.kind === "tow",
              )),
        ]
      : pending?.photos || old.photos || [];
    if (
      photosOnly &&
      (!base.termsVersion || !base.hours || !base.vehicleTypes?.length)
    )
      throw bad("Lengkapi dan simpan revisi profil sebelum mengunggah foto.");
    const proposal = photosOnly
      ? { ...base, photos: mergedPhotos }
      : { ...input, photos: mergedPhotos };
    if (proposal.pickup && !proposal.photos?.some((p) => p.kind === "tow"))
      throw bad(
        "Unggah foto derek sebelum mengaktifkan layanan penjemputan/derek.",
      );
    await c.execute(
      "INSERT INTO workshop_revisions(workshop_id,proposal,status) VALUES (?,?,'pending') ON DUPLICATE KEY UPDATE proposal=VALUES(proposal),status='pending',note=NULL,reviewed_by=NULL,version=version+1",
      [id, JSON.stringify(proposal)],
    );
    return row.status;
  });
}
async function pendingRevisions(database) {
  const [rows] = await database.query(
    "SELECT p.*,u.email AS owner_email,r.proposal,r.version AS revision_version,r.note AS revision_note FROM workshop_revisions r JOIN partner_workshops p ON p.id=r.workshop_id JOIN users u ON u.id=p.owner_user_id WHERE r.status='pending' AND u.deleted_at IS NULL",
  );
  return rows.map((row) => {
    const p = parse(row.proposal);
    return {
      ...row,
      ...p,
      id: row.id,
      owner_email: row.owner_email,
      services: p.services,
      reviewVersion: "revision:" + row.revision_version,
      isRevision: true,
      status: "pending",
      vehicleTypes: p.vehicleTypes,
      hours: p.hours,
      photos: (p.photos || []).map((f) => ({
        ...f,
        url: "/api/partner-media/" + f.id,
      })),
    };
  });
}
async function reviewRevision(
  database,
  id,
  admin,
  { status, note, googlePlaceId, reviewVersion },
) {
  return withTransaction(database, async (c) => {
    let locked;
    try {
      locked = await lockWorkshop(c, id);
    } catch (e) {
      if (e.status === 404) return false;
      throw e;
    }
    const { row, revision } = locked;
    if (
      (revision?.status !== "pending" && row.status !== "pending") ||
      typeof reviewVersion !== "string" ||
      reviewVersion !== reviewToken(row, revision)
    )
      throw bad(
        "Pengajuan berubah atau sudah diproses. Muat ulang dan periksa versi terbaru sebelum memutuskan.",
        409,
      );
    if (revision?.status === "pending") {
      const p = parse(revision.proposal);
      if (status === "approved") {
        if (p.pickup && !p.photos?.some((f) => f.kind === "tow"))
          throw bad("Foto kendaraan derek wajib sebelum persetujuan.");
        await c.execute(
          "UPDATE partner_workshops SET name=?,address=?,phone=?,lat=?,lng=?,services=?,pickup=?,onsite=?,emergency=?,open24=?,status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=?,google_place_id=? WHERE id=?",
          [
            p.name,
            p.address,
            p.phone,
            p.lat,
            p.lng,
            JSON.stringify(p.services),
            p.pickup,
            p.onsite,
            p.emergency,
            p.open24,
            "approved",
            admin,
            note,
            googlePlaceId ?? null,
            id,
          ],
        );
        await c.execute(
          "INSERT INTO partner_workshop_details(workshop_id,details,terms_version) VALUES (?,?,?) ON DUPLICATE KEY UPDATE details=VALUES(details),terms_version=VALUES(terms_version),accepted_at=CURRENT_TIMESTAMP",
          [
            id,
            JSON.stringify({
              vehicleTypes: p.vehicleTypes,
              hours: p.hours,
              booking: p.booking,
              photos: p.photos,
              termsVersion: p.termsVersion,
              privacyAccepted: true,
              emergencyAccepted: p.emergencyAccepted,
            }),
            p.termsVersion,
          ],
        );
      }
      await c.execute(
        "UPDATE workshop_revisions SET status=?,note=?,reviewed_by=? WHERE workshop_id=?",
        [status, note, admin, id],
      );
      return true;
    }
    await c.execute(
      "UPDATE partner_workshops SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=?,google_place_id=? WHERE id=?",
      [status, admin, note, googlePlaceId ?? null, row.id],
    );
    return true;
  });
}
async function revokeWorkshop(database, id, admin, note) {
  return withTransaction(database, async (c) => {
    const { row } = await lockWorkshop(c, id);
    if (row.status !== "approved") throw bad("Mitra sudah tidak aktif.", 409);
    await c.execute(
      "UPDATE workshop_revisions SET status='rejected',note=?,reviewed_by=? WHERE workshop_id=? AND status='pending'",
      [note, admin, id],
    );
    await c.execute(
      "UPDATE partner_workshops SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=?,google_place_id=NULL WHERE id=?",
      [admin, note, id],
    );
    const [waiting] = await c.execute(
      "SELECT id FROM service_orders WHERE workshop_id=? AND status='waiting' FOR UPDATE",
      [id],
    );
    for (const order of waiting) {
      await c.execute(
        "UPDATE service_orders SET status='cancelled',cancellation_reason='Status mitra dicabut' WHERE id=?",
        [order.id],
      );
      await c.execute(
        "INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,'cancelled','Status mitra dicabut oleh admin')",
        [order.id, admin],
      );
    }
  });
}
module.exports = {
  revokeWorkshop,
  propose,
  pendingRevisions,
  reviewRevision,
  lockWorkshop,
  reviewToken,
};
