import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverMeals,
  extractIngredients,
  filterMeals,
  filterProducts,
  normaliseMeal,
  proteinProfile,
} from "../src/services.js";

class FakeMealDb {
  constructor() {
    this.calls = [];
  }

  async search(query) {
    this.calls.push(["search", query]);
    return [
      {
        idMeal: "1",
        strMeal: "Chicken Stew",
        strCategory: "Chicken",
        strArea: "Kenyan",
        strIngredient1: "Chicken Breast",
        strMeasure1: "500g",
        strIngredient2: "Plantain",
        strMeasure2: "2",
      },
      {
        idMeal: "2",
        strMeal: "Plain Rice",
        strCategory: "Rice",
        strArea: "Kenyan",
        strIngredient1: "Rice",
      },
    ];
  }

  async filterBy(kind, value) {
    this.calls.push([kind, value]);
    if (kind === "a") {
      return [{ idMeal: "1", strMeal: "Chicken Stew", strArea: "Kenyan", strCategory: "Chicken" }];
    }
    return [{ idMeal: "3", strMeal: `Meal with ${value}`, strArea: "Kenyan" }];
  }
}

const CONFIG = { localArea: "Kenyan", localIngredients: ["Plantain", "Peanut Butter"] };

test("extractIngredients reads numbered fields", () => {
  assert.deepEqual(extractIngredients({ strIngredient1: "Eggs", strMeasure1: "2", strIngredient3: "Beans" }), [
    { name: "Eggs", measure: "2" },
    { name: "Beans", measure: "" },
  ]);
});

test("protein profile uses name and ingredients", () => {
  const profile = proteinProfile({ strMeal: "Beef Curry", strCategory: "Main" }, [
    { name: "beans", measure: "" },
  ]);
  assert.equal(profile.score, 40);
  assert.deepEqual(profile.cues, ["beans", "beef"]);
});

test("normaliseMeal returns a browser-safe shape", () => {
  const meal = normaliseMeal({
    idMeal: "7",
    strMeal: "Test",
    strTags: "Spicy, Quick",
    strIngredient1: "Eggs",
  });
  assert.deepEqual(meal.tags, ["Spicy", "Quick"]);
  assert.equal(meal.ingredients[0].name, "Eggs");
  assert.ok(meal.source_url.endsWith("/7"));
});

test("preset combines sources and deduplicates", async () => {
  const client = new FakeMealDb();
  const { meals, label } = await discoverMeals(client, CONFIG);
  assert.equal(label, "Rwanda & East Africa staples");
  assert.deepEqual(meals.map((meal) => meal.id), ["1", "3"]);
  assert.ok(client.calls.some(([kind, value]) => kind === "a" && value === "Kenyan"));
  assert.ok(client.calls.some(([kind, value]) => kind === "i" && value === "Plantain"));
});

test("query search refines with extra filters", async () => {
  const client = new FakeMealDb();
  const { meals } = await discoverMeals(client, CONFIG, {
    query: "chicken",
    area: "Kenyan",
    ingredient: "plantain",
  });
  assert.deepEqual(meals.map((meal) => meal.id), ["1"]);
});

test("filterMeals sorts and limits to protein cues", () => {
  const meals = [
    { name: "B", protein_score: 10 },
    { name: "A", protein_score: 60 },
    { name: "C", protein_score: 30 },
  ];
  assert.deepEqual(filterMeals(meals, { sort: "protein" }).map((m) => m.name), ["A", "C", "B"]);
  assert.deepEqual(filterMeals(meals, { sort: "name" }).map((m) => m.name), ["A", "B", "C"]);
  assert.deepEqual(filterMeals(meals, { proteinOnly: true }).map((m) => m.name), ["A", "C"]);
});

test("filterProducts applies nutrition and grade filters", () => {
  const products = [
    { name: "A", protein: 30, sugar: 5, calories: 200, grade: "b", nova: 2 },
    { name: "B", protein: 3, sugar: 40, calories: 500, grade: "e", nova: 4 },
    { name: "C", protein: 12, sugar: 20, calories: 300, grade: "c", nova: 3 },
  ];
  const result = filterProducts(products, {
    minProtein: 10,
    maxSugar: 25,
    maxGrade: "c",
    maxNova: 3,
    sort: "protein",
  });
  assert.deepEqual(result.map((p) => p.name), ["A", "C"]);
  assert.deepEqual(filterProducts(products, { sort: "sugar" }).map((p) => p.name), ["A", "C", "B"]);
});
