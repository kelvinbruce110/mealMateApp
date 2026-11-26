/**
 * Domain logic: meal discovery, transparent protein cues, filtering and sorting.
 *
 * Protein cues are intentionally labelled as estimates in the UI. TheMealDB
 * does not publish nutrition values; real gram values come from Open Food Facts.
 */

export const PROTEIN_ONLY_THRESHOLD = 20;

export const PROTEIN_HINTS = {
  chicken: ["chicken", 25],
  beef: ["beef", 25],
  lamb: ["lamb", 25],
  goat: ["goat", 25],
  turkey: ["turkey", 25],
  pork: ["pork", 25],
  fish: ["fish", 25],
  salmon: ["salmon", 25],
  tuna: ["tuna", 25],
  prawn: ["prawns", 25],
  shrimp: ["shrimp", 25],
  snapper: ["fish", 25],
  egg: ["eggs", 18],
  bean: ["beans", 15],
  lentil: ["lentils", 15],
  tofu: ["tofu", 15],
  yogurt: ["yogurt", 15],
  cheese: ["cheese", 15],
  milk: ["milk", 10],
  peanut: ["peanuts", 12],
  cassava: ["cassava", 3],
  plantain: ["plantain", 3],
 };

const text = (value) => String(value ?? "").trim();

export function extractIngredients(raw) {
  const items = [];
  for (let index = 1; index <= 20; index += 1) {
    const name = text(raw[`strIngredient${index}`]);
    if (!name) continue;
    items.push({ name, measure: text(raw[`strMeasure${index}`]) });
   }
  return items;
 }

export function proteinProfile(raw, ingredients) {
  const haystack = [
    text(raw.strMeal),
    text(raw.strCategory),
    ingredients.map((item) => item.name).join(" "),
   ]
    .join(" ")
    .toLowerCase();

  const found = new Map();
  for (const [needle, [label, points]] of Object.entries(PROTEIN_HINTS)) {
    if (haystack.includes(needle)) {
      found.set(label, Math.max(found.get(label) ?? 0, points));
     }
   }

  const score = Math.min(
    100,
    [...found.values()].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0)
   );
  return { score, cues: [...found.keys()].sort() };
 }

export function normaliseMeal(raw) {
  const ingredients = extractIngredients(raw);
  const profile = proteinProfile(raw, ingredients);
  const tags = text(raw.strTags)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    id: text(raw.idMeal),
    name: text(raw.strMeal) || "Untitled meal",
    category: text(raw.strCategory) || "Uncategorised",
    area: text(raw.strArea) || "Unknown",
    image: text(raw.strMealThumb) || null,
    tags,
    youtube: text(raw.strYoutube) || null,
    instructions: text(raw.strInstructions),
    ingredients,
    protein_score: profile.score,
    protein_cues: profile.cues,
    source_url: `https://www.themealdb.com/meal/${text(raw.idMeal)}`,
   };
 }

function unique(meals) {
  const seen = new Set();
  const result = [];
  for (const meal of meals) {
    const key = String(meal.idMeal ?? meal.id ?? meal.strMeal ?? meal.name ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(meal);
   }
  return result;
}

export async function discoverMeals(client, config, { query = "", area = "", category = "", ingredient = "" } = {}) {
  const preset = !query && !area && !category && !ingredient;
  const applied = preset
    ? "preset"
    : query
      ? "query"
      : area
        ? "area"
        : category
          ? "category"
          : "ingredient";

  let rawMeals;
  let label;

  if (preset) {
    const batches = await Promise.all([
      client.filterBy("a", config.localArea ?? "Kenyan"),
      ...(config.localIngredients ?? []).map((item) => client.filterBy("i", item)),
     ]);
    rawMeals = unique(batches.flat()).slice(0, 36);
    label = "Rwanda & East Africa staples";
   } else if (query) {
    rawMeals = await client.search(query);
    label = `Name search: "${query}"`;
    } else if (area) {
    rawMeals = await client.filterBy("a", area);
    label = `Region: ${area}`;
     } else if (category) {
    rawMeals = await client.filterBy("c", category);
    label = `Category: ${category}`;
      } else {
    rawMeals = await client.filterBy("i", ingredient);
    label = `Main ingredient: ${ingredient}`;
       }

  let meals = rawMeals.map(normaliseMeal);

  // Re-check locally only for filters the upstream endpoint did not apply.
  // filter.php responses are summaries without ingredients, so an extra
  // ingredient refinement is only possible after a full name search.
  if (area && !["preset", "area"].includes(applied)) {
    meals = meals.filter((meal) => meal.area.toLowerCase() === area.toLowerCase());
   }
  if (category && !["preset", "category"].includes(applied)) {
    meals = meals.filter((meal) => meal.category.toLowerCase() === category.toLowerCase());
   }
  if (ingredient && applied === "query") {
    meals = meals.filter((meal) =>
      meal.ingredients.some((item) => item.name.toLowerCase().includes(ingredient.toLowerCase()))
     );
  }

  return { meals, label };
}

export function filterMeals(meals, { proteinOnly = false, sort = "relevance" } = {}) {
  let result = proteinOnly ? meals.filter((meal) => meal.protein_score >= PROTEIN_ONLY_THRESHOLD) : [...meals];
  if (sort === "protein") {
    result.sort((a, b) => b.protein_score - a.protein_score || a.name.localeCompare(b.name));
   } else if (sort === "name") {
    result.sort((a, b) => a.name.localeCompare(b.name));
    }
  return result;
}

export const GRADE_ORDER = { a: 0, b: 1, c: 2, d: 3, e: 4 };

export function filterProducts(
  products,
  { minProtein = 0, maxSugar = null, maxGrade = "", maxNova = null, sort = "relevance" } = {}
 ) {
  const usable = (value, fallback) => (value === null || value === undefined ? fallback : value);

  const result = products.filter((product) => {
    if (usable(product.protein, 0) < minProtein) return false;
    if (maxSugar !== null && usable(product.sugar, 0) > maxSugar) return false;
    if (maxGrade && product.grade && (GRADE_ORDER[product.grade] ?? 9) > GRADE_ORDER[maxGrade]) return false;
    if (maxNova !== null && product.nova && product.nova > maxNova) return false;
    return true;
   });

  if (sort === "protein") {
    result.sort((a, b) => usable(b.protein, 0) - usable(a.protein, 0) || a.name.localeCompare(b.name));
   } else if (sort === "sugar") {
    result.sort((a, b) => usable(a.sugar, 0) - usable(b.sugar, 0) || a.name.localeCompare(b.name));
    } else if (sort === "calories") {
    result.sort((a, b) => usable(a.calories, 9999) - usable(b.calories, 9999) || a.name.localeCompare(b.name));
  } else if (sort === "name") {
    result.sort((a, b) => a.name.localeCompare(b.name));
   }

  return result;
}
