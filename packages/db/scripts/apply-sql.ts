/** Applies migrations/sql/*.sql in filename order against DATABASE_URL. */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, "..", "migrations", "sql");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  try {
    const files = readdirSync(sqlDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const text = readFileSync(join(sqlDir, file), "utf8");
      process.stdout.write(`applying ${file}... `);
      await sql.unsafe(text);
      process.stdout.write("ok\n");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
