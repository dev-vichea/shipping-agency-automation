"use client";

import { useState } from "react";

export function useFormSubmission() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, submit };
}
