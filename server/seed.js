// seed.js — fills the BoreSakshi database with sample drill logs so the map,
// predictions and ledger have data during a demo. Run: node seed.js
import "dotenv/config"; // respect MONGODB_URI/MONGODB_DB from server/.env
import { connectDB, db } from "./db.js";
import { nanoid } from "nanoid";

// sample verified borewell logs around the Namakkal / Tiruchengode belt
const base = [
  [11.360, 77.800, 240, "weathered rock", 210, 620, true],
  [11.372, 77.812, 410, "hard crystalline rock", 0, 0, false],
  [11.355, 77.795, 190, "weathered / fractured", 165, 700, true],
  [11.368, 77.804, 300, "fractured granite", 280, 350, true],
  [11.349, 77.821, 520, "compact granite", 0, 0, false],
  [11.381, 77.790, 220, "weathered rock", 195, 540, true],
  [11.362, 77.833, 360, "hard crystalline rock", 330, 300, true],
  [11.344, 77.808, 480, "compact granite", 0, 0, false],
  [11.377, 77.826, 260, "weathered / fractured", 230, 480, true],
  [11.358, 77.817, 200, "weathered rock", 180, 660, true],
  [11.389, 77.799, 340, "fractured granite", 300, 320, true],
  [11.351, 77.788, 560, "compact granite", 0, 0, false],
  [11.366, 77.845, 280, "weathered / fractured", 250, 430, true],
  [11.340, 77.830, 300, "hard crystalline rock", 275, 360, true],
  [11.384, 77.815, 210, "weathered rock", 185, 590, true],
];

async function run() {
  await connectDB();
  let n = 0;
  for (const [lat, lng, depthFt, strata, waterStrikeFt, yieldLpm, success] of base) {
    await db.addBorewell({
      id: nanoid(10),
      lat, lng, depthFt, strata, waterStrikeFt, yieldLpm, success,
      operatorName: "Sample Rig " + (++n),
      language: "ta",
      createdAt: new Date(Date.now() - n * 86400000).toISOString(),
    });
  }
  console.log(`Seeded ${n} borewell logs into BoreSakshi.`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
