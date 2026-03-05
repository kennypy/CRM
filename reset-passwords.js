/**
 * One-off script — reset dev user passwords.
 * Run from the CRM root: node reset-passwords.js
 *
 * Reads DATABASE_URL from environment or uses the default dev value.
 */
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://nexcrm:nexcrm_dev@localhost:5432/nexcrm";

const NEW_PASSWORD = "Admin@nexcrm1";

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log("Connected to database.");

  const hash = await bcrypt.hash(NEW_PASSWORD, 12);
  console.log("Password hash generated.");

  const res = await client.query(
    `UPDATE users
     SET password_hash = $1
     WHERE email IN ('admin@nexcrm.dev', 'rep@nexcrm.dev')
       AND deleted_at IS NULL
     RETURNING email, role`,
    [hash]
  );

  if (res.rows.length === 0) {
    console.error("ERROR: No users found. Has the seed been run?");
  } else {
    console.log("\nPasswords updated:");
    res.rows.forEach((r) => console.log(`  ${r.email} (${r.role})`));
    console.log(`\nNew password: ${NEW_PASSWORD}`);
    console.log("Workspace:    nexcrm-dev");
  }

  await client.end();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
