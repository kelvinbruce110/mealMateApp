import express from "express";

import { ApiError } from "./clients.js";
import { discoverMeals, filterMeals, filterProducts, normaliseMeal } from "./services.js";
import {
  SORT_MEALS,
  SORT_PRODUCTS,
  ValidationError,
  barcode,
  choice,
  cleanQuery,
  flag,
  grade,
  integer,
  mealId,
} from "./validation.js";

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function createApiRouter({ mealDb, off, config }) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      app: "MealMate",
      version: "1.0.0",
      served_by: config.serverName || "local",
    });
  });

  router.get(
    "/meta",
    asyncRoute(async (_req, res) => {
      const reference = {};
      const warnings = [];
      for (const [kind, key] of [
        ["a", "areas"],
        ["c", "categories"],
        ["i", "ingredients"],
      ]) {
        try {
          reference[key] = await mealDb.reference(kind);
        } catch (error) {
          reference[key] = [];
          warnings.push(`Could not load ${key}: ${error.message}`);
        }
      }
      res.json({
        ...reference,
        warnings,
        local_area: config.localArea || "Kenyan",
        local_ingredients: config.localIngredients || [],
        note:
          "TheMealDB currently has no Rwandan recipes, so the local preset combines " +
          "Kenyan regional dishes with meals built from staples common in Rwanda.",
      });
    })
  );

  router.get(
    "/status",
    asyncRoute(async (_req, res) => {
      const result = {};
      try {
        await mealDb.reference("a");
        result.TheMealDB = { ok: true };
      } catch (error) {
        result.TheMealDB = { ok: false, message: error.message };
      }
      try {
        await off.search("milk", 1);
        result["Open Food Facts"] = { ok: true };
      } catch (error) {
        result["Open Food Facts"] = { ok: false, message: error.message };
      }
      res.json(result);
    })
  );

  router.get(
    "/meals",
    asyncRoute(async (req, res) => {
      const query = cleanQuery(req.query.q, "search term");
      const area = cleanQuery(req.query.area, "region");
      const category = cleanQuery(req.query.category, "category");
      const ingredient = cleanQuery(req.query.ingredient, "ingredient");
      const sort = choice(req.query.sort, SORT_MEALS, "relevance");
      const proteinOnly = flag(req.query.protein_only);

      const { meals, label } = await discoverMeals(mealDb, config, { query, area, category, ingredient });
      const items = filterMeals(meals, { proteinOnly, sort });
      res.json({ items, count: items.length, label, sort });
    })
  );

  router.get(
    "/meals/:mealId",
    asyncRoute(async (req, res) => {
      const id = mealId(req.params.mealId);
      const meal = await mealDb.lookup(id);
      if (!meal) {
        res.status(404).json({
          error: { code: "not_found", message: "That meal is no longer available.", retryable: false },
        });
        return;
      }
      res.json(normaliseMeal(meal));
    })
  );

  router.get(
    "/products",
    asyncRoute(async (req, res) => {
      const query = cleanQuery(req.query.q, "search term");
      if (!query) throw new ValidationError("Enter a food name or scan a barcode.", "missing_input");

      const sort = choice(req.query.sort, SORT_PRODUCTS, "relevance");
      const minProtein = integer(req.query.min_protein, "minimum protein", 0, 100, 0);
      const maxSugar = req.query.max_sugar
        ? integer(req.query.max_sugar, "maximum sugar", 0, 100, undefined)
        : null;
      const maxGrade = grade(req.query.max_grade);
      const maxNova = req.query.max_nova
        ? integer(req.query.max_nova, "maximum NOVA group", 1, 4, undefined)
        : null;

      const found = await off.search(query, 24);
      const items = filterProducts(found, { minProtein, maxSugar, maxGrade, maxNova, sort });
      res.json({ items, count: items.length, label: `Label search: "${query}"`, sort });
    })
  );

  router.get(
    "/products/barcode/:code",
    asyncRoute(async (req, res) => {
      const product = await off.byBarcode(barcode(req.params.code));
      res.json({
        items: [product],
        count: 1,
        label: `Barcode: ${product.code}`,
        sort: "relevance",
      });
    })
  );

  router.use((_req, res) => {
    res.status(404).json({
      error: { code: "not_found", message: "Endpoint not found.", retryable: false },
    });
  });

  return router;
}

export { ApiError };
