/**
 * Strict validation for every query-string value before it reaches an upstream
 * API, a cache key or the browser.
 */

const QUERY_RE = /^[\w\s\-',.&()+\/\u00c0-\u024f]{1,80}$/u;
const BARCODE_RE = /^\d{8,18}$/;
const MEAL_ID_RE = /^\d{1,10}$/;

export const SORT_MEALS = ["relevance", "protein", "name"];
export const SORT_PRODUCTS = ["relevance", "protein", "sugar", "calories", "name"];
export const NUTRI_GRADES = ["a", "b", "c", "d", "e"];

export class ValidationError extends Error {
  constructor(message, code = "invalid_input") {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.status = 400;
   }
 }

export function cleanQuery(value, field = "query") {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (!QUERY_RE.test(raw)) {
    throw new ValidationError(
      `${field[0].toUpperCase()}${field.slice(1)} may only contain letters, numbers, spaces and basic punctuation (max 80 characters).`
     );
   }
  return raw.replace(/\s+/g, " ");
 }

export function requiredQuery(value, field = "query") {
  const cleaned = cleanQuery(value, field);
  if (!cleaned) throw new ValidationError(`Please enter a ${field}.`, "missing_input");
  return cleaned;
 }

export function choice(value, allowed, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value);
  if (!allowed.includes(text)) {
    throw new ValidationError("An unsupported filter option was supplied.", "invalid_filter");
   }
  return text;
 }

export function integer(value, field, minimum, maximum, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback === undefined) throw new ValidationError(`${field[0].toUpperCase()}${field.slice(1)} is required.`, "missing_input");
    return fallback;
   }
  if (!/^-?\d+$/.test(String(value))) {
    throw new ValidationError(`${field[0].toUpperCase()}${field.slice(1)} must be a whole number.`);
   }
  const parsed = Number.parseInt(String(value), 10);
  if (parsed < minimum || parsed > maximum) {
    throw new ValidationError(`${field[0].toUpperCase()}${field.slice(1)} must be between ${minimum} and ${maximum}.`);
   }
  return parsed;
}

export function grade(value, fallback = "") {
  return choice(value ? String(value).toLowerCase() : "", NUTRI_GRADES, fallback);
 }

export function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
 }

export function barcode(value) {
  const text = String(value ?? "").trim();
  if (!BARCODE_RE.test(text)) {
    throw new ValidationError("Enter a valid barcode (8–18 digits).", "invalid_barcode");
   }
  return text;
}

export function mealId(value) {
  const text = String(value ?? "").trim();
  if (!MEAL_ID_RE.test(text)) {
    throw new ValidationError("Invalid meal identifier.", "invalid_id");
   }
  return text;
 }
 