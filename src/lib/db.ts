import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

export function getDb(database: D1Database = env.DB) {
  return drizzle(database, { schema });
}

export { schema };
