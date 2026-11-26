import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import { ApiError } from "../src/clients.js";

class MealStub {
  async reference(kind) {
    return { a: ["Kenyan"], c: ["Chicken"], i: ["Eggs"] }[kind];
  }

  async search(query) {
    return [
      {
        idMeal: "1",
        strMeal: `Chicken ${query}`,
        strCategory: "Chicken",
        strArea: "Kenyan",
        strIngredient1: "Chicken Breast",
      },
      { idMeal: "2", strMeal: "Plain Rice", strCategory: "Rice", strArea: "Kenyan" },
    ];
  }

  async filterBy() {
    return [{ idMeal: "1", strMeal: "Kenyan Beef Curry", strCategory: "Beef", strArea: "Kenyan" }];
  }

  async lookup(id) {
    if (id === "404") return null;
    return { idMeal: id, strMeal: "Details", strIngredient1: "Eggs" };
  }
}

class OffStub {
  async search() {
    return [
      {
        code: "1",
        name: "High protein",
        brand: "A",
        grade: "a",
        nova: 1,
        protein: 25,
        sugar: 2,
        calories: 120,
        fat: 1,
        salt: 0.1,
        image: null,
      },
      {
        code: "2",
        name: "Sugary drink",
        brand: "B",
        grade: "e",
        nova: 4,
        protein: 0,
        sugar: 45,
        calories: 300,
        fat: 0,
        salt: 0,
        image: null,
      },
    ];
  }

  async byBarcode() {
    return (await this.search())[0];
  }
}

function buildApp(overrides = {}) {
  return createApp({
    config: { cacheTtlSeconds: 0, serverName: "web-01", corsOrigins: [], ...overrides.config },
    mealDb: overrides.mealDb ?? new MealStub(),
    off: overrides.off ?? new OffStub(),
  });
}

test("health reports the serving node", async () => {
  const response = await request(buildApp()).get("/api/health").expect(200);
  assert.equal(response.body.served_by, "web-01");
});

test("security headers are present", async () => {
  const response = await request(buildApp()).get("/api/health").expect(200);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("meta returns reference lists", async () => {
  const response = await request(buildApp()).get("/api/meta").expect(200);
  assert.deepEqual(response.body.areas, ["Kenyan"]);
  assert.deepEqual(response.body.ingredients, ["Eggs"]);
});

test("meals endpoint sorts and filters", async () => {
  const sorted = await request(buildApp()).get("/api/meals?q=stew&sort=protein").expect(200);
  assert.equal(sorted.body.count, 2);
  assert.equal(sorted.body.items[0].name, "Chicken stew");
  assert.ok(sorted.body.items[0].protein_score > 0);

  const filtered = await request(buildApp()).get("/api/meals?q=stew&protein_only=1").expect(200);
  assert.deepEqual(filtered.body.items.map((item) => item.name), ["Chicken stew"]);
});

test("meals endpoint rejects unsafe query", async () => {
  const response = await request(buildApp()).get("/api/meals?q=%3Cscript%3E").expect(400);
  assert.equal(response.body.error.code, "invalid_input");
});

test("meal detail returns 404 when missing", async () => {
  const response = await request(buildApp()).get("/api/meals/404").expect(404);
  assert.equal(response.body.error.code, "not_found");
});

test("products endpoint filters and sorts", async () => {
  const response = await request(buildApp())
    .get("/api/products?q=beans&min_protein=10&max_sugar=10&sort=protein")
    .expect(200);
  assert.deepEqual(response.body.items.map((item) => item.name), ["High protein"]);
  assert.equal(response.body.count, 1);
});

test("products endpoint requires a query", async () => {
  const response = await request(buildApp()).get("/api/products").expect(400);
  assert.equal(response.body.error.code, "missing_input");
});

test("barcode route validates input", async () => {
  await request(buildApp()).get("/api/products/barcode/abc").expect(400);
  const response = await request(buildApp()).get("/api/products/barcode/3017620422003").expect(200);
  assert.equal(response.body.count, 1);
});

test("upstream failure returns clear JSON", async () => {
  const off = new OffStub();
  off.search = async () => {
    throw new ApiError("Label service is down.", { source: "Open Food Facts", status: 503 });
  };
  const response = await request(buildApp({ off })).get("/api/products?q=beans").expect(503);
  assert.equal(response.body.error.retryable, true);
  assert.equal(response.body.error.source, "Open Food Facts");
});

test("unknown API route is JSON", async () => {
  const response = await request(buildApp()).get("/api/does-not-exist").expect(404);
  assert.equal(response.body.error.code, "not_found");
});

test("home page is served", async () => {
  const response = await request(buildApp()).get("/").expect(200);
  assert.match(response.headers["content-type"], /text\/html/);
});
