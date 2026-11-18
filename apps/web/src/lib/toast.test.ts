import test from "node:test";
import assert from "node:assert/strict";
import { toast, subscribeToasts, dismissToast, type ToastItem } from "./toast";

test("toast triggers notifications with correct defaults", () => {
  let received: ToastItem[] = [];
  const unsubscribe = subscribeToasts((toasts) => {
    received = toasts;
  });

  // Test toast.saved with default title
  const id1 = toast.saved();
  assert.equal(received.length, 1);
  assert.equal(received[0].id, id1);
  assert.equal(received[0].type, "saved");
  assert.equal(received[0].title, "Saved!");

  // Test toast.saved with custom title
  const id2 = toast.saved("Draft saved!");
  assert.equal(received[0].id, id2);
  assert.equal(received[0].title, "Draft saved!");
  assert.equal(received[0].type, "saved");

  // Test toast.updated with default title
  const id3 = toast.updated();
  assert.equal(received[0].id, id3);
  assert.equal(received[0].type, "updated");
  assert.equal(received[0].title, "Updated!");

  // Test toast.updated with custom options
  const id4 = toast.updated({ title: "Company updated!", description: "Changes persisted." });
  assert.equal(received[0].id, id4);
  assert.equal(received[0].type, "updated");
  assert.equal(received[0].title, "Company updated!");
  assert.equal(received[0].description, "Changes persisted.");

  // Test other variants: error, info, warning, success
  toast.error("Validation failed");
  assert.equal(received[0].type, "error");
  assert.equal(received[0].title, "Validation failed");

  // Test dismiss
  dismissToast(received[0].id);
  assert.ok(!received.some((t) => t.type === "error"));

  // Clean all
  dismissToast();
  assert.equal(received.length, 0);

  unsubscribe();
});
