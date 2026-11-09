const db = require("../../db");
function parseServices(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function detailsOf(row) { try { return typeof row.details === "string" ? JSON.parse(row.details) : row.details || {}; } catch { return {}; } }
function enrich(row) { const d=detailsOf(row);return {...row,vehicleTypes:d.vehicleTypes||[],hours:d.hours||null,booking:d.booking||{capacity:1,durations:{}},photos:(d.photos||[]).map(p=>({...p,url:"/api/partner-media/"+p.id})),termsVersion:d.termsVersion}; }
function publicPartner(row) {
  row = enrich(row);
  return {
    id: `partner:${row.id}`,
    partnerId: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    lat: Number(row.lat),
    lng: Number(row.lng),
    services: parseServices(row.services),
    vehicleTypes: row.vehicleTypes,
    hours: row.hours,
    booking:row.booking,
    photos: row.photos,
    pickup: Boolean(row.pickup),
    onsite: Boolean(row.onsite),
    emergency: Boolean(row.emergency),
    open24: Boolean(row.open24),
    rating: row.local_rating==null?null:Number(row.local_rating),
    reviews: Number(row.local_reviews||0),
    emoji: "🔧",
    source: "bengkelin",
    classification: row.status === "approved" ? "partner" : "pending",
    isPartner: row.status === "approved",
    isDemo: false,
    membershipStatus: row.status,
    googlePlaceId: row.google_place_id || null,
  };
}
function createPartnerRepository(database = db) {
  async function createWithDetails(userId,input,guest){
    const connection=await database.getConnection();
    try{await connection.beginTransaction();
      if(guest){const [account]=await connection.execute('INSERT INTO users(email,password_hash) VALUES (?,?)',[guest.email,guest.passwordHash]);userId=account.insertId;}
      const [result]=await connection.execute('INSERT INTO partner_workshops(owner_user_id,name,address,phone,lat,lng,services,pickup,onsite,emergency,open24) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[userId,input.name,input.address,input.phone,input.lat,input.lng,JSON.stringify(input.services),input.pickup,input.onsite,input.emergency,input.open24]);
      const details={vehicleTypes:input.vehicleTypes,hours:input.hours,booking:input.booking,photos:input.photos,termsVersion:input.termsVersion,privacyAccepted:true,emergencyAccepted:input.emergencyAccepted};
      await connection.execute('INSERT INTO partner_workshop_details(workshop_id,details,terms_version) VALUES (?,?,?)',[result.insertId,JSON.stringify(details),input.termsVersion]);
      await connection.commit();return result.insertId;
    }catch(e){await connection.rollback();throw e;}finally{connection.release();}
  }

  return {
    async isAdmin(userId) {
      const [rows] = await database.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'admin'",
        [userId],
      );
      return rows.length > 0;
    },
    async listApproved() {
      const [rows] = await database.execute(
        "SELECT p.*,d.details,(SELECT AVG(r.rating) FROM service_reviews r WHERE r.workshop_id=p.id AND r.status='approved') AS local_rating,(SELECT COUNT(*) FROM service_reviews r WHERE r.workshop_id=p.id AND r.status='approved') AS local_reviews FROM partner_workshops p LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.status = 'approved' ORDER BY p.id",
      );
      return rows.map(publicPartner);
    },
    async getApproved(id) {
      const [rows] = await database.execute(
        "SELECT p.*,d.details,(SELECT AVG(r.rating) FROM service_reviews r WHERE r.workshop_id=p.id AND r.status='approved') AS local_rating,(SELECT COUNT(*) FROM service_reviews r WHERE r.workshop_id=p.id AND r.status='approved') AS local_reviews FROM partner_workshops p LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.id = ? AND p.status = 'approved'",
        [id],
      );
      return rows[0] ? publicPartner(rows[0]) : null;
    },
    async mine(userId) {
      const [rows] = await database.execute(
        "SELECT p.*,d.details,(SELECT AVG(r.rating) FROM service_reviews r WHERE r.workshop_id=p.id AND r.status='approved') AS local_rating,(SELECT COUNT(*) FROM service_reviews r WHERE r.workshop_id=p.id AND r.status='approved') AS local_reviews FROM partner_workshops p LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.owner_user_id = ? ORDER BY p.id DESC",
        [userId],
      );
      return rows.map((row) => ({
        ...enrich(row),
        lat: Number(row.lat),
        lng: Number(row.lng),
        services: parseServices(row.services),
      }));
    },
    async create(userId,input){return createWithDetails(userId,input);},
    async createGuest(email,passwordHash,input){return createWithDetails(null,input,{email,passwordHash});},
    async canReadMedia(id,userId,admin){
      const [rows]=await database.execute("SELECT p.owner_user_id,p.status,JSON_SEARCH(d.details,'one',?,NULL,'$.photos[*].id') AS current_photo FROM partner_workshops p JOIN partner_workshop_details d ON d.workshop_id=p.id LEFT JOIN workshop_revisions r ON r.workshop_id=p.id WHERE JSON_SEARCH(d.details,'one',?,NULL,'$.photos[*].id') IS NOT NULL OR (r.status='pending' AND JSON_SEARCH(r.proposal,'one',?,NULL,'$.photos[*].id') IS NOT NULL) LIMIT 1",[id,id,id]);
      return Boolean(rows[0]&&(admin||rows[0].owner_user_id===userId||(rows[0].status==='approved'&&rows[0].current_photo)));
    },
    async pending() {
      const [rows] = await database.execute(
        "SELECT p.*,u.email AS owner_email,d.details FROM partner_workshops p JOIN users u ON u.id=p.owner_user_id LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.status='pending' AND NOT EXISTS (SELECT 1 FROM workshop_revisions wr WHERE wr.workshop_id=p.id AND wr.status='pending') ORDER BY p.id",
      );
      return [...rows.map((row)=>({...enrich(row),reviewVersion:require('../services/revisions').reviewToken(row),services:parseServices(row.services)})),...await require('../services/revisions').pendingRevisions(database)];
    },
    async revoke(id,adminId,note){return require('../services/revisions').revokeWorkshop(database,id,adminId,note);},
    async review(id,adminId,decision){return require('../services/revisions').reviewRevision(database,id,adminId,decision);},
  };
}
module.exports = {
  ...createPartnerRepository(),
  createPartnerRepository,
  publicPartner,
};
