import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, BaseClient, MealDbClient, OpenFoodFactsClient } from "../src/clients.js";

const CONFIG = {
  userAgent: "MealMate/1.0 (test@example.com)",
  requestTimeoutMs: 50,
  maxRetries: 2,
  retryBaseMs: 0,
  cacheTtlSeconds: 60,
  mealDbBase: "https://example.test/api/json/v1/1",
  offSearchBase: "https://search.test/search",
  offProductBase: "https://products.test/api/v2/product",
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 400,
    status,
    json: async () => {
      if (payload === undefined) throw new Error("not json");
      return payload;
    },
  };
}

function sequenced(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("retries server errors then succeeds", async () => {
  const fetchImpl = sequenced([response(503), response(200, { ok: true })]);
  const client = new BaseClient(CONFIG, fetchImpl);
  assert.deepEqual(await client.getJson("https://example.test/x"), { ok: true });
  assert.equal(fetchImpl.calls.length, 2);
});

test("normalises repeated timeouts", async () => {
  const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
  const fetchImpl = sequenced([timeout, timeout, timeout]);
  const client = new BaseClient(CONFIG, fetchImpl);
  await assert.rejects(
    () => client.getJson("https://example.test/x"),
    (error) => error instanceof ApiError && error.status === 504 && error.retryable === true
  );
  assert.equal(fetchImpl.calls.length, 3);
});

test("cache avoids duplicate upstream calls", async () => {
  const fetchImpl = sequenced([response(200, { meals: [] })]);
  const client = new MealDbClient(CONFIG, fetchImpl);
  assert.deepEqual(await client.search("rice"), []);
  assert.deepEqual(await client.search("rice"), []);
  assert.equal(fetchImpl.calls.length, 1);
});

test("client errors are not retried", async () => {
  const fetchImpl = sequenced([response(400, {})]);
  const client = new MealDbClient(CONFIG, fetchImpl);
  await assert.rejects(
    () => client.search("bad"),
    (error) => error instanceof ApiError && error.retryable === false
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test("MealDB reference extracts area names", async () => {
  const fetchImpl = sequenced([response(200, { meals: [{ strArea: "Kenyan" }, { strArea: null }] })]);
  assert.deepEqual(await new MealDbClient(CONFIG, fetchImpl).reference("a"), ["Kenyan", ""]);
});

test("Open Food Facts normalise handles both response shapes", () => {
  const client = new OpenFoodFactsClient(CONFIG, async () => response(200, {}));
  const search = client.normalise(
    {
      code: "123",
      product_name: "Beans",
      brands: ["xx:Brand"],
      nutrition_grades: "a",
      nova_group: "2",
      nutriments: { proteins_100g: "8.123", sugars_100g: "bad" },
    },
    true
  );
  assert.equal(search.brand, "Brand");
  assert.equal(search.protein, 8.12);
  assert.equal(search.sugar, null);
  assert.equal(search.nova, 2);

  const detail = client.normalise({ code: "999", nutrition_grades: ["e"] }, false);
  assert.equal(detail.grade, "e");
  assert.equal(detail.name, "Unnamed product");
});

test("unexpected Open Food Facts payload raises a useful error", async () => {
  const fetchImpl = sequenced([response(200, { unexpected: true })]);
  const client = new OpenFoodFactsClient(CONFIG, fetchImpl);
  await assert.rejects(
    () => client.search("milk"),
    (error) => error instanceof ApiError && error.retryable === false
  );
});
