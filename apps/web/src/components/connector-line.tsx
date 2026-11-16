"use client";

import { useEffect, useState, type RefObject } from "react";

function isPointVisible(element: HTMLElement, x: number, y: number, container: HTMLElement) {
  if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) return false;
  for (let parent = element.parentElement; parent && parent !== container; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    if (overflowX === "visible" && overflowY === "visible") continue;
    const bounds = parent.getBoundingClientRect();
    if (overflowX !== "visible" && (x < bounds.left || x > bounds.right)) return false;
    if (overflowY !== "visible" && (y < bounds.top || y > bounds.bottom)) return false;
  }
  return true;
}

export function ConnectorLine({
  containerRef,
  active,
}: {
  containerRef: RefObject<HTMLElement | null>;
  active: boolean;
}) {
  const [coords, setCoords] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const workspace = container;
    let rafId = 0;
    let observed: HTMLElement[] = [];
    const layout = new ResizeObserver(scheduleUpdate);

    function updateCoords() {
      rafId = 0;
      const source = workspace.querySelector<HTMLElement>("[data-connector-source]");
      const target = workspace.querySelector<HTMLElement>("[data-connector-target]");
      const viewport = workspace.querySelector<HTMLElement>("[data-connector-viewport]");
      const elements = [source, target, viewport].filter((node) => node !== null);
      if (elements.length !== observed.length || elements.some((node, index) => node !== observed[index])) {
        observed.forEach((node) => layout.unobserve(node));
        elements.forEach((node) => layout.observe(node));
        observed = elements;
      }

      if (!source || !target || !viewport) {
        setCoords(null);
        return;
      }

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const startX = source.closest(".panel")?.getBoundingClientRect().right ?? sourceRect.right;
      const startY = sourceRect.top + sourceRect.height / 2;
      const endX = targetRect.left;
      const endY = targetRect.top + targetRect.height / 2;
      if (viewport.getBoundingClientRect().left <= startX || endX <= startX
        || !isPointVisible(source, sourceRect.left + sourceRect.width / 2, startY, workspace)
        || !isPointVisible(target, endX, endY, workspace)) {
        setCoords(null);
        return;
      }

      const bounds = workspace.getBoundingClientRect();
      const current = {
        startX: startX - bounds.left, startY: startY - bounds.top,
        endX: endX - bounds.left, endY: endY - bounds.top,
      };
      setCoords((previous) => (
        previous?.startX === current.startX && previous.startY === current.startY
        && previous.endX === current.endX && previous.endY === current.endY ? previous : current
      ));
    }

    function scheduleUpdate() {
      if (!rafId) rafId = requestAnimationFrame(updateCoords);
    }

    // Highlights can arrive asynchronously or move to other elements with the same dimensions.
    const endpoints = new MutationObserver(scheduleUpdate);
    endpoints.observe(workspace, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["data-connector-source", "data-connector-target", "style"],
    });
    layout.observe(workspace);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
    scheduleUpdate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      layout.disconnect();
      endpoints.disconnect();
    };
  }, [containerRef, active]);

  if (!active || !coords) return null;

  const { startX, startY, endX, endY } = coords;
  // Natural S-curve bezier formula
  const dx = Math.max(30, (endX - startX) * 0.45);
  const pathD = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

  return (
    <svg
      aria-hidden="true"
      data-evidence-connector
      className="pointer-events-none absolute inset-0 z-30 hidden h-full w-full overflow-visible xl:block"
    >
      <defs>
        <linearGradient id="connector-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#047da5" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.85" />
        </linearGradient>
        <filter id="connector-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2.5" floodColor="#047da5" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Subtle background glow line */}
      <path
        d={pathD}
        fill="none"
        stroke="#047da5"
        strokeWidth={4.5}
        strokeOpacity={0.15}
        strokeLinecap="round"
      />

      {/* Main crisp connector curve */}
      <path
        d={pathD}
        fill="none"
        stroke="url(#connector-gradient)"
        strokeWidth={2}
        strokeLinecap="round"
        filter="url(#connector-glow)"
      />

      {/* Source Circular Node (pulse ring + solid core) */}
      <circle
        cx={startX}
        cy={startY}
        r={7}
        className="fill-primary/20 animate-pulse"
      />
      <circle
        cx={startX}
        cy={startY}
        r={4}
        className="fill-primary stroke-white dark:stroke-slate-900 stroke-2"
      />

      {/* Target Pin on Document */}
      <circle
        cx={endX}
        cy={endY}
        r={5}
        className="fill-primary/30"
      />
      <circle
        cx={endX}
        cy={endY}
        r={3}
        className="fill-primary stroke-white dark:stroke-slate-900 stroke-1.5"
      />
    </svg>
  );
}
