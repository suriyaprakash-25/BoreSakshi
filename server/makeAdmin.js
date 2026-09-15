// makeAdmin.js — reviewed CLI promotion for an existing operator account.
// Usage: node makeAdmin.js <phone_number>
import "dotenv/config";
import { connectDB, db } from "./db.js";
import { authStore } from "./authStore.js";

async function main() {
  const phoneArg = process.argv[2];
  if (!phoneArg) {
    console.error("Usage: node makeAdmin.js <phone_number>");
    process.exit(1);
  }
  const cleanPhone = String(phoneArg).replace(/[^\d]/g, "");

  try {
    await connectDB();
    const operator = await db.getOperatorByPhone(cleanPhone);
    if (!operator) {
      console.error(`Operator with phone ${cleanPhone} not found.`);
      process.exit(1);
    }

    const alreadyReady = operator.role === "admin" && operator.verified === true;
    if (alreadyReady) {
      console.log(`Operator ${operator.name} is already a verified admin.`);
      process.exit(0);
    }

    const updated = await db.updateOperator(operator.id, {
      role: "admin",
      verified: true,
      adminPromotedAt: new Date().toISOString(),
      sessionVersion: Number(operator.sessionVersion || 0) + 1,
    });
    if (!updated) throw new Error("Failed to update operator role");
    const revoked = await authStore.revokeAllForOperator(operator.id, "admin_role_changed");
    console.log(`Successfully promoted and verified ${operator.name} (${cleanPhone}) as admin. Revoked ${revoked} older session(s); sign in again.`);
  } catch (err) {
    console.error("Error:", err.message || err);
    process.exit(1);
  }
  process.exit(0);
}

main();
