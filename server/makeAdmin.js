// makeAdmin.js — CLI script to promote an existing operator to admin.
// Usage: node makeAdmin.js <phone_number>
import "dotenv/config";
import { connectDB, db } from "./db.js";

async function main() {
  const phoneArg = process.argv[2];
  if (!phoneArg) {
    console.error("Usage: node makeAdmin.js <phone_number>");
    process.exit(1);
  }

  // normalise phone to match the logic in auth.js
  const cleanPhone = String(phoneArg).replace(/[^\d]/g, "");

  try {
    await connectDB();
    const operator = await db.getOperatorByPhone(cleanPhone);
    if (!operator) {
      console.error(`Operator with phone ${cleanPhone} not found.`);
      process.exit(1);
    }

    if (operator.role === "admin") {
      console.log(`Operator ${operator.name} is already an admin.`);
      process.exit(0);
    }

    const updated = await db.updateOperator(operator.id, { role: "admin" });
    if (updated) {
      console.log(`Successfully promoted ${operator.name} (${cleanPhone}) to admin.`);
    } else {
      console.error(`Failed to update operator role.`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
  process.exit(0);
}

main();
