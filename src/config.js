import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function csv(name) {
  return (process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  rootDir,
  publicDir: path.join(rootDir, "public"),
  host: process.env.MEALMATE_HOST || "127.0.0.1",
  port: number("MEALMATE_PORT", number("PORT", 5000)),

  contactEmail: process.env.MEALMATE_CONTACT_EMAIL || "mealmatestudent@example.com",
  userAgent: `MealMate/1.0 (${process.env.MEALMATE_CONTACT_EMAIL || "mealmatestudent@example.com"})`,

  cacheTtlSeconds: number("MEALMATE_CACHE_TTL", 600),
  serverName: process.env.MEALMATE_SERVER_NAME || "local",
  requestTimeoutMs: number("MEALMATE_REQUEST_TIMEOUT_MS", 8000),
  maxRetries: number("MEALMATE_MAX_RETRIES", 2),
  retryBaseMs: number("MEALMATE_RETRY_BASE_MS", 250),
  corsOrigins: csv("MEALMATE_CORS_ORIGINS"),

  mealDbBase: "https://www.themealdb.com/api/json/v1/1",
  offSearchBase: "https://search.openfoodfacts.org/search",
  offProductBase: "https://world.openfoodfacts.org/api/v2/product",

  localArea: "Kenyan",
  localIngredients: ["Chicken Breast", "Plantain", "Cassava", "Peanut Butter"],
};
