import assert from "node:assert/strict";
import test from "node:test";

import {
  ValidationError,
  barcode,
  choice,
  cleanQuery,
  flag,
  grade,
  integer,
  mealId,
  requiredQuery,
} from "../src/validation.js";

test("cleanQuery trims and collapses whitespace", () => {
  assert.equal(cleanQuery("  peanut   butter  "), "peanut butter");
});

test("cleanQuery rejects unsafe or oversized input", () => {
  for (const bad of ["<script>alert(1)</script>", "a".repeat(81), "??", "name;DROP TABLE"]) {
    assert.throws(() => cleanQuery(bad), ValidationError);
  }
});

test("requiredQuery requires text", () => {
  assert.throws(() => requiredQuery("   "), (error) => error.code === "missing_input");
});

test("choice only accepts whitelisted values", () => {
  assert.equal(choice("protein", ["protein", "name"], "relevance"), "protein");
  assert.equal(choice("", ["protein", "name"], "relevance"), "relevance");
  assert.throws(() => choice("drop_table", ["protein", "name"]), ValidationError);
});

test("barcodes are validated", () => {
  assert.equal(barcode("3017620422003"), "3017620422003");
  assert.equal(barcode(" 3017620422003 "), "3017620422003");
  for (const bad of ["abc", "1234567", "123".repeat(7), "3017620422003;"]) {
    assert.throws(() => barcode(bad), ValidationError);
  }
});

test("integer bounds and defaults", () => {
  assert.equal(integer(undefined, "minimum protein", 0, 100, 0), 0);
  assert.equal(integer("25", "minimum protein", 0, 100, 0), 25);
  assert.throws(() => integer("101", "minimum protein", 0, 100, 0), ValidationError);
  assert.throws(() => integer("abc", "maximum sugar", 0, 100, undefined), ValidationError);
});

test("flag, grade and mealId", () => {
  assert.equal(flag("1"), true);
  assert.equal(flag("true"), true);
  assert.equal(flag("no"), false);
  assert.equal(grade("A"), "a");
  assert.throws(() => grade("z"), ValidationError);
  assert.equal(mealId("52772"), "52772");
  assert.throws(() => mealId("abc"), ValidationError);
});
