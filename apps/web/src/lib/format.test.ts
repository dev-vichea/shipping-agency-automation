import test from "node:test";
import assert from "node:assert/strict";
import { formatFieldValue, formatDecimal } from "./format";

test("packages formatting: strictly integer, never decimal", () => {
  assert.equal(formatFieldValue("531.0", "packages"), "531");
  assert.equal(formatFieldValue("531.00", "packages"), "531");
  assert.equal(formatFieldValue("531", "packages"), "531");
  assert.equal(formatFieldValue(531.0, "packages"), "531");
  assert.equal(formatFieldValue("531.4", "packages"), "531");
  assert.equal(formatFieldValue("120.0", "pkgs"), "120");
  assert.equal(formatFieldValue("50.0", "total_packages"), "50");
});

test("quantity formatting: integer when whole, up to 2 decimal places when fractional", () => {
  // Whole numbers have no decimal
  assert.equal(formatFieldValue("12724.0", "quantity"), "12724");
  assert.equal(formatFieldValue("12046.0", "quantity"), "12046");
  assert.equal(formatFieldValue("100.00", "quantity"), "100");
  assert.equal(formatFieldValue(500.0, "quantity"), "500");
  assert.equal(formatFieldValue("50", "qty"), "50");

  // Fractional numbers retain their fraction up to 2 decimal places
  assert.equal(formatFieldValue("1679.8", "quantity"), "1679.8");
  assert.equal(formatFieldValue("1679.85", "quantity"), "1679.85");
  // Floating point noise is cut
  assert.equal(formatFieldValue("1679.80000124", "quantity"), "1679.8");
  assert.equal(formatFieldValue("10.1000012414", "quantity"), "10.1");
});

test("weights and measurement formatting: integer when whole, up to 2 decimal places when fractional", () => {
  assert.equal(formatFieldValue("25117.0", "gross_weight"), "25117");
  assert.equal(formatFieldValue("24955.0", "net_weight"), "24955");
  assert.equal(formatFieldValue("12806.0", "gross_weight"), "12806");
  assert.equal(formatFieldValue("189.0", "gross_weight"), "189");
  assert.equal(formatFieldValue("45.50", "gross_weight"), "45.5");
  assert.equal(formatFieldValue("45.55", "net_weight"), "45.55");
});

test("currency / money formatting: always 2 decimal places with .00", () => {
  assert.equal(formatFieldValue("3.5", "unit_price"), "3.50");
  assert.equal(formatFieldValue("0.25", "unit_price"), "0.25");
  assert.equal(formatFieldValue("44534.0", "amount"), "44534.00");
  assert.equal(formatFieldValue("42161.0", "amount"), "42161.00");
  assert.equal(formatFieldValue("419.95", "amount"), "419.95");
  assert.equal(formatFieldValue("87114.95", "total"), "87114.95");
  assert.equal(formatFieldValue("100", "unit_price"), "100.00");
  assert.equal(formatFieldValue("100.1000012414", "amount"), "100.10");
  assert.equal(formatFieldValue(".1000012414", "amount"), "0.10");
});

test("formatDecimal backward-compatibility alias", () => {
  assert.equal(formatDecimal("531.0", "packages"), "531");
  assert.equal(formatDecimal("12724.0", "quantity"), "12724");
  assert.equal(formatDecimal("3.5", "unit_price"), "3.50");
  assert.equal(formatDecimal("44534.0", "amount"), "44534.00");
  assert.equal(formatDecimal(null), "");
  assert.equal(formatDecimal(""), "");
});
