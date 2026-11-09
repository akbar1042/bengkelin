const db = require("../../db");
const DASHBOARD_PATHS = Object.freeze({
  customer: "/dashboard/customer",
  partner: "/dashboard/partner",
  admin: "/dashboard/admin",
});
function createAccountRepository(database = db) {
  return {
    async findById(id) {
      const [rows] = await database.execute(
        "SELECT u.id,u.email,u.auth_version,CASE WHEN u.role='admin' THEN 'admin' WHEN EXISTS (SELECT 1 FROM partner_workshops p WHERE p.owner_user_id=u.id AND p.status='approved') THEN 'partner' ELSE 'customer' END AS role FROM users u WHERE u.id=? AND u.deleted_at IS NULL",
        [id],
      );
      const row = rows[0];
      return row
        ? {
          id: row.id,
          email: row.email,
          authVersion: Number(row.auth_version ?? 0),
          role: row.role,
          dashboardUrl: DASHBOARD_PATHS[row.role],
        }
        : null;
    },
    async adminSummary() {
      const [rows] = await database.execute(
        "SELECT (SELECT COUNT(*) FROM users) AS totalAccounts,COUNT(*) AS totalWorkshops,COALESCE(SUM(status='approved'),0) AS approvedWorkshops,COALESCE(SUM(status='pending'),0) AS pendingWorkshops,COALESCE(SUM(status='rejected'),0) AS rejectedWorkshops FROM partner_workshops",
      );
      return Object.fromEntries(
        Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]),
      );
    },
  };
}
module.exports = {
  ...createAccountRepository(),
  createAccountRepository,
  DASHBOARD_PATHS,
};
