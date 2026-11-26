/**
 * Upstream API clients with timeouts, bounded retries and a TTL cache.
 *
 *  - TheMealDB — recipe discovery (https://www.themealdb.com/api.php)
 *  - Open Food Facts — nutrition labels
 *      - full-text search: https://search.openfoodfacts.org (Search-a-licious)
 *      - barcode lookup: https://world.openfoodfacts.org/api (v2 product endpoint)
 */

import { TTLCache } from "./cache.js";

export class ApiError extends Error {
  constructor(message, { source = "upstream", status = null, retryable = true } = {}) {
    super(message);
    this.name = "ApiError";
    this.source = source;
    this.status = status;
    this.retryable = retryable;
   }

  toJSON() {
    return {
      error: {
        code: "upstream_error",
        message: this.message,
        source: this.source,
        status: this.status,
        retryable: this.retryable,
       },
     };
   }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function asList(payload, key) {
  if (!payload || typeof payload !== "object") return [];
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object");
 }

export class BaseClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.source = "upstream";
    this.timeoutMs = Math.max(1, Number(config.requestTimeoutMs ?? 8000));
    this.maxRetries = Math.max(0, Number(config.maxRetries ?? 2));
    this.retryBaseMs = Math.max(0, Number(config.retryBaseMs ?? 250));
    this.cache = new TTLCache(Number(config.cacheTtlSeconds ?? 600) * 1000);
    this.userAgent = config.userAgent || "MealMate/1.0";
   }

  async getJson(url, params = {}) {
    const target = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
     }

    const cacheKey = target.toString();
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(target, {
          headers: { Accept: "application/json", "User-Agent": this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
         });

        if (response.status === 404) {
          throw new ApiError("That record was not found in the upstream database.", {
            source: this.source,
            status: 404,
            retryable: false,
           });
         }

        if (response.status === 429 || response.status >= 500) {
          lastError = new ApiError(
            `${this.source} is busy or temporarily unavailable (HTTP ${response.status}).`,
            { source: this.source, status: response.status }
           );
         } else if (!response.ok) {
          throw new ApiError(`${this.source} rejected the request (HTTP ${response.status}).`, {
            source: this.source,
            status: response.status,
            retryable: false,
           });
          } else {
          let payload;
          try {
            payload = await response.json();
           } catch {
            throw new ApiError(`${this.source} returned an unreadable response.`, {
              source: this.source,
              retryable: false,
             });
            }
          this.cache.set(cacheKey, payload);
          return payload;
           }
       } catch (error) {
        if (error instanceof ApiError) {
          if (!error.retryable) throw error;
          lastError = error;
         } else if (error?.name === "TimeoutError" || error?.name === "AbortError") {
          lastError = new ApiError(`${this.source} took too long to respond. Please try again.`, {
            source: this.source,
            status: 504,
           });
          } else {
          lastError = new ApiError(`Could not reach ${this.source}. Check your connection and retry.`, {
            source: this.source,
           });
           }
        }

      if (attempt < this.maxRetries) {
        await sleep(this.retryBaseMs * 2 ** attempt + Math.random() * 120);
       }
     }

    throw lastError ?? new ApiError(`Unknown ${this.source} failure.`, { source: this.source });
   }
}

export class MealDbClient extends BaseClient {
  constructor(config, fetchImpl) {
    super(config, fetchImpl);
    this.source = "TheMealDB";
    this.base = config.mealDbBase;
   }

  async search(query) {
    const payload = await this.getJson(`${this.base}/search.php`, { s: query });
    return asList(payload, "meals");
   }

  async filterBy(kind, value) {
    if (!["i", "c", "a"].includes(kind)) throw new Error("filter kind must be one of i, c, a");
    const payload = await this.getJson(`${this.base}/filter.php`, { [kind]: value });
    return asList(payload, "meals");
   }

  async lookup(mealId) {
    const payload = await this.getJson(`${this.base}/lookup.php`, { i: mealId });
    return asList(payload, "meals")[0] ?? null;
   }

  async reference(kind) {
    if (!["a", "c", "i"].includes(kind)) throw new Error("reference kind must be one of a, c, i");
    const field = { a: "strArea", c: "strCategory", i: "strIngredient" }[kind];
    const payload = await this.getJson(`${this.base}/list.php`, { [kind]: "list" });
    return asList(payload, "meals").map((row) => String(row[field] ?? ""));
   }
 }

export class OpenFoodFactsClient extends BaseClient {
  static SEARCH_FIELDS = [
    "code",
    "product_name",
    "brands",
    "nutrition_grades",
    "nova_group",
    "image_front_url",
    "nutriments",
   ].join(",");

  constructor(config, fetchImpl) {
    super(config, fetchImpl);
    this.source = "Open Food Facts";
    this.searchUrl = config.offSearchBase;
    this.productBase = config.offProductBase;
   }

  async search(query, pageSize = 24) {
    const payload = await this.getJson(this.searchUrl, {
      q: query,
      page_size: pageSize,
      fields: OpenFoodFactsClient.SEARCH_FIELDS,
     });

    const hits = payload?.hits;
    if (!Array.isArray(hits)) {
      throw new ApiError("Open Food Facts returned an unexpected search response.", {
        source: this.source,
        retryable: false,
       });
     }
    return hits.filter((hit) => hit && typeof hit === "object").map((hit) => this.normalise(hit, true));
   }

  async byBarcode(code) {
    const payload = await this.getJson(`${this.productBase}/${code}.json`, {
      fields: OpenFoodFactsClient.SEARCH_FIELDS,
     });
    const product = payload?.product;
    if (!product || typeof product !== "object") {
      throw new ApiError("No product was found for that barcode.", {
        source: this.source,
        status: 404,
        retryable: false,
       });
     }
    return this.normalise(product, false);
  }

  normalise(raw, fromSearch = true) {
    const nutriments = raw?.nutriments && typeof raw.nutriments === "object" ? raw.nutriments : {};

    const number = (field) => {
      const value = Number(nutriments[field]);
      return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
     };

    const brands = Array.isArray(raw?.brands)
      ? raw.brands.slice(0, 2).map((brand) => String(brand).replace(/^xx:/, "")).join(", ")
      : String(raw?.brands ?? "").replace(/^xx:/, "").trim();

    let grade = raw?.nutrition_grades;
    if (Array.isArray(grade)) grade = grade[0];
    const gradeText = String(grade ?? "").toLowerCase();

    const nova = Number(raw?.nova_group);
    const novaValue = [1, 2, 3, 4].includes(nova) ? nova : null;

    return {
      code: String(raw?.code ?? ""),
      name: String(raw?.product_name ?? "").trim() || "Unnamed product",
      brand: brands,
      image: String(raw?.image_front_url ?? "") || null,
      grade: ["a", "b", "c", "d", "e"].includes(gradeText) ? gradeText : null,
      nova: novaValue,
      protein: number("proteins_100g"),
      sugar: number("sugars_100g"),
      fat: number("fat_100g"),
      salt: number("salt_100g"),
      calories: number("energy-kcal_100g"),
      from_search: fromSearch,
     };
   }
 }
