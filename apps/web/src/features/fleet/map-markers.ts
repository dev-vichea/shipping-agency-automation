function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Centers a top-down model directly on [lat, lng] when used with L.divIcon({ iconSize: [0, 0], iconAnchor: [0, 0] }),
 * keeping the optional label horizontal and readable above the rotated vehicle/building.
 */
function wrapTopDownCentered(options: {
  modelHtml: string;
  labelHtml?: string;
  labelOffsetY?: number;
  beaconColor?: string;
}): string {
  const { modelHtml, labelHtml, labelOffsetY = -34, beaconColor } = options;
  return `
    <div style="position: relative; width: 0; height: 0; pointer-events: auto;" class="cursor-pointer select-none">
      ${
        beaconColor
          ? `<span style="position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);" class="flex h-10 w-10 items-center justify-center pointer-events-none">
               <span class="animate-ping inline-flex h-8 w-8 rounded-full opacity-45" style="background-color: ${beaconColor};"></span>
             </span>`
          : ""
      }
      <div style="position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);">
        ${modelHtml}
      </div>
      ${
        labelHtml
          ? `<div style="position: absolute; left: 0; top: ${labelOffsetY}px; transform: translate(-50%, -100%); width: max-content;">
               ${labelHtml}
             </div>`
          : ""
      }
    </div>
  `;
}

/**
 * Top-down bird's-eye view articulated container truck (cab + 40ft container trailer),
 * drawn facing UP (North = 0 deg) and rotated cleanly to the road's compass bearing.
 */
export function buildTruckPointerHtml(options: {
  plate: string;
  is3PL: boolean;
  milestone: string;
  bearingDeg?: number;
  compact?: boolean;
}): string {
  const { plate, is3PL, milestone, bearingDeg = 0, compact = false } = options;

  let containerFill = "#1d4ed8"; // In-house Royal Blue (high contrast on sky-blue road)
  let containerRib = "#1e3a8a";
  let cabFill = "#f8fafc";
  let badgeBorder = "border-sky-400/70";
  let beaconColor = "#0ea5e9";

  if (milestone === "at_factory" || milestone === "empty_returned") {
    containerFill = "#059669"; // Emerald arrived
    containerRib = "#047857";
    badgeBorder = "border-emerald-400/70";
    beaconColor = "#10b981";
  } else if (is3PL) {
    containerFill = "#f59e0b"; // 3PL Warm Amber-Orange
    containerRib = "#d97706";
    cabFill = "#fef3c7";
    badgeBorder = "border-amber-400/70";
    beaconColor = "#f59e0b";
  }

  const width = compact ? 26 : 32;
  const height = compact ? 52 : 64;

  const modelHtml = `
    <svg width="${width}" height="${height}" viewBox="0 0 40 80" style="display: block; transform: rotate(${bearingDeg.toFixed(1)}deg); filter: drop-shadow(0 3px 5px rgba(15,23,42,0.5));" xmlns="http://www.w3.org/2000/svg">
      <!-- Top-Down Road Contact Shadow -->
      <rect x="7" y="4" width="26" height="73" rx="4" fill="rgba(15,23,42,0.28)" />

      <!-- Side Wing Mirrors (top-down camera view) -->
      <path d="M9 12.5L4.5 14v2.5L9 15.5Z" fill="#0f172a" stroke="#ffffff" stroke-width="0.6" />
      <path d="M31 12.5L35.5 14v2.5L31 15.5Z" fill="#0f172a" stroke="#ffffff" stroke-width="0.6" />

      <!-- Front Tires & Rear Dual Tires peeking slightly -->
      <rect x="7" y="9" width="2.2" height="7" rx="1" fill="#0f172a" />
      <rect x="30.8" y="9" width="2.2" height="7" rx="1" fill="#0f172a" />
      <rect x="7" y="55" width="2.2" height="14" rx="1" fill="#0f172a" />
      <rect x="30.8" y="55" width="2.2" height="14" rx="1" fill="#0f172a" />

      <!-- Tractor Prime Mover Cab (facing top / North) -->
      <path d="M10 8c0-2.2 2-3.8 10-3.8s10 1.6 10 3.8v15.5c0 1.2-.8 2-2 2H12c-1.2 0-2-.8-2-2V8Z" fill="${cabFill}" stroke="#0f172a" stroke-width="1.3" />
      <!-- Cab Headlights -->
      <rect x="11" y="4.8" width="3.5" height="1.6" rx="0.7" fill="#fde047" />
      <rect x="25.5" y="4.8" width="3.5" height="1.6" rx="0.7" fill="#fde047" />
      <!-- Hood Accent & Center Grille -->
      <rect x="14.5" y="6.8" width="11" height="4.2" rx="1.2" fill="${containerFill}" opacity="0.9" />
      <!-- Curved Panoramic Windshield (top-down glass) -->
      <path d="M11.5 11.8c3.5-1.2 13.5-1.2 17 0l-1.5 4.2c-4-.7-10-.7-14 0l-1.5-4.2Z" fill="#38bdf8" stroke="#0f172a" stroke-width="0.9" />
      <!-- Side Cab Windows -->
      <path d="M10.8 13l1.5 2.5v4.5l-1.5-1.2Z" fill="#475569" />
      <path d="M29.2 13l-1.5 2.5v4.5l1.5-1.2Z" fill="#475569" />
      <!-- Cab Roof Deflector Hatch -->
      <rect x="14.5" y="17.5" width="11" height="4.5" rx="1" fill="${containerFill}" opacity="0.25" stroke="#64748b" stroke-width="0.6" />

      <!-- Fifth-Wheel Hitch Connector -->
      <rect x="16" y="24.5" width="8" height="3.5" rx="0.8" fill="#1e293b" />

      <!-- 40ft Corrugated Container Trailer Body -->
      <rect x="9" y="27" width="22" height="48.5" rx="2" fill="${containerFill}" stroke="#ffffff" stroke-width="1.7" />
      <!-- Container Top-Down Corrugated Roof Ribs -->
      <path d="M11 32h18M11 36.5h18M11 41h18M11 45.5h18M11 50h18M11 54.5h18M11 59h18M11 63.5h18M11 68h18" stroke="${containerRib}" stroke-width="1.6" opacity="0.7" />
      <!-- Container Longitudinal Side Rails -->
      <line x1="11.2" y1="28.5" x2="11.2" y2="73.5" stroke="#ffffff" stroke-width="0.8" opacity="0.45" />
      <line x1="28.8" y1="28.5" x2="28.8" y2="73.5" stroke="#ffffff" stroke-width="0.8" opacity="0.45" />
      <!-- Rear Container Lock Bars & Red Tail Lights -->
      <rect x="10.5" y="73.6" width="3.5" height="1.6" rx="0.5" fill="#ef4444" />
      <rect x="26" y="73.6" width="3.5" height="1.6" rx="0.5" fill="#ef4444" />
    </svg>
  `;

  const labelHtml = `
    <div class="px-1.5 py-0.5 rounded bg-slate-900/95 text-white ${
      compact ? "text-[9px]" : "text-[10px]"
    } font-mono font-bold tracking-wider whitespace-nowrap shadow-md border ${badgeBorder}">
      ${escapeHtml(plate)}
    </div>
  `;

  return wrapTopDownCentered({
    modelHtml,
    labelHtml,
    labelOffsetY: compact ? -28 : -34,
    beaconColor,
  });
}

/**
 * Top-down bird's-eye view ocean container vessel,
 * drawn facing UP (North = 0 deg) and rotated cleanly along the maritime lane bearing.
 */
export function buildVesselPointerHtml(options: {
  name: string;
  voyage?: string | null;
  bearingDeg?: number;
}): string {
  const { name, voyage, bearingDeg = 0 } = options;
  const label = voyage ? `${name} · ${voyage}` : name;

  const modelHtml = `
    <svg width="34" height="72" viewBox="0 0 46 96" style="display: block; transform: rotate(${bearingDeg.toFixed(1)}deg); filter: drop-shadow(0 3px 6px rgba(15,23,42,0.5));" xmlns="http://www.w3.org/2000/svg">
      <!-- Trailing V-Shaped Sea Wake behind Stern -->
      <path d="M16 82L8 94M30 82L38 94M23 84v10" stroke="#99f6e4" stroke-width="1.8" stroke-linecap="round" opacity="0.85" />

      <!-- Top-Down Vessel Hull (Pointed Bow at Top -> Stern at Bottom) -->
      <path d="M23 4C29.5 11 35 22 35.5 34v40c0 5-2.5 8.5-12.5 8.5S10.5 79 10.5 74V34C11 22 16.5 11 23 4Z" fill="#0f172a" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" />
      <!-- Anti-fouling Red Gunwale Rim at Bow -->
      <path d="M23 6c5 6 9.5 15 10.2 25H12.8C13.5 21 18 12 23 6Z" fill="#e11d48" opacity="0.35" />
      <!-- Deck Plating -->
      <path d="M23 9c5 5.5 9.2 14.5 9.8 25v38.5c0 3.5-2 6-9.8 6s-9.8-2.5-9.8-6V34C13.8 23.5 18 14.5 23 9Z" fill="#1e293b" />

      <!-- Forecastle Bow Anchor Winch -->
      <circle cx="23" cy="15" r="2.2" fill="#94a3b8" />
      <line x1="23" y1="7" x2="23" y2="12" stroke="#cbd5e1" stroke-width="1.2" />

      <!-- Top-Down Container Bays (3 rows wide x 4 bays long) -->
      <!-- Bay 1 -->
      <rect x="14.5" y="23" width="5.2" height="9" rx="0.5" fill="#0284c7" stroke="#0f172a" stroke-width="0.6" />
      <rect x="20.4" y="23" width="5.2" height="9" rx="0.5" fill="#14b8a6" stroke="#0f172a" stroke-width="0.6" />
      <rect x="26.3" y="23" width="5.2" height="9" rx="0.5" fill="#f59e0b" stroke="#0f172a" stroke-width="0.6" />
      <!-- Bay 2 -->
      <rect x="14.5" y="33" width="5.2" height="9" rx="0.5" fill="#e11d48" stroke="#0f172a" stroke-width="0.6" />
      <rect x="20.4" y="33" width="5.2" height="9" rx="0.5" fill="#0ea5e9" stroke="#0f172a" stroke-width="0.6" />
      <rect x="26.3" y="33" width="5.2" height="9" rx="0.5" fill="#14b8a6" stroke="#0f172a" stroke-width="0.6" />
      <!-- Bay 3 -->
      <rect x="14.5" y="43" width="5.2" height="9" rx="0.5" fill="#f97316" stroke="#0f172a" stroke-width="0.6" />
      <rect x="20.4" y="43" width="5.2" height="9" rx="0.5" fill="#0284c7" stroke="#0f172a" stroke-width="0.6" />
      <rect x="26.3" y="43" width="5.2" height="9" rx="0.5" fill="#f59e0b" stroke="#0f172a" stroke-width="0.6" />
      <!-- Bay 4 -->
      <rect x="14.5" y="53" width="5.2" height="8" rx="0.5" fill="#14b8a6" stroke="#0f172a" stroke-width="0.6" />
      <rect x="20.4" y="53" width="5.2" height="8" rx="0.5" fill="#0ea5e9" stroke="#0f172a" stroke-width="0.6" />
      <rect x="26.3" y="53" width="5.2" height="8" rx="0.5" fill="#e11d48" stroke="#0f172a" stroke-width="0.6" />

      <!-- Stern Navigation Bridge with Wide Port & Starboard Bridge Wings -->
      <path d="M8 64h30v3.5H34v5.5H12v-5.5H8V64Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1" />
      <rect x="15" y="64.5" width="16" height="2" fill="#38bdf8" />
      <!-- Funnel Top -->
      <rect x="19.5" y="71" width="7" height="4.5" rx="1" fill="#f97316" stroke="#0f172a" stroke-width="0.8" />
      <circle cx="23" cy="73.2" r="1.4" fill="#0f172a" />
    </svg>
  `;

  const labelHtml = `
    <div class="px-2 py-0.5 rounded bg-slate-900/95 text-white text-[10px] font-mono font-bold tracking-wider whitespace-nowrap shadow-md border border-teal-400/70">
      ${escapeHtml(label)}
    </div>
  `;

  return wrapTopDownCentered({
    modelHtml,
    labelHtml,
    labelOffsetY: -38,
    beaconColor: "#14b8a6",
  });
}

/**
 * Top-down bird's-eye architectural view of a manufacturing factory complex.
 */
export function buildFactoryPointerHtml(options: {
  label?: string;
  compact?: boolean;
}): string {
  const { label, compact = false } = options;
  const size = compact ? 42 : 52;

  const modelHtml = `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" style="display: block; filter: drop-shadow(0 3px 6px rgba(15,23,42,0.45));" xmlns="http://www.w3.org/2000/svg">
      <!-- Industrial Compound Yard Base -->
      <rect x="4" y="6" width="56" height="52" rx="5" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.5" />
      <!-- Truck Loading Apron & Dock Markings (Bottom) -->
      <rect x="7" y="42" width="50" height="13" rx="2" fill="#475569" />
      <line x1="17" y1="43" x2="17" y2="53" stroke="#facc15" stroke-width="1.2" stroke-dasharray="2,2" />
      <line x1="27" y1="43" x2="27" y2="53" stroke="#facc15" stroke-width="1.2" stroke-dasharray="2,2" />
      <line x1="37" y1="43" x2="37" y2="53" stroke="#facc15" stroke-width="1.2" stroke-dasharray="2,2" />
      <line x1="47" y1="43" x2="47" y2="53" stroke="#facc15" stroke-width="1.2" stroke-dasharray="2,2" />

      <!-- Main Warehouse Sawtooth Roof Viewed From Above -->
      <rect x="8" y="10" width="48" height="31" rx="2" fill="#e11d48" stroke="#ffffff" stroke-width="1.5" />
      <!-- Roof Ridge & Skylight Bays -->
      <rect x="11" y="13" width="19" height="11" rx="1" fill="#be123c" />
      <rect x="12.5" y="14.5" width="16" height="3.5" rx="0.6" fill="#fecdd3" />
      <rect x="34" y="13" width="19" height="11" rx="1" fill="#be123c" />
      <rect x="35.5" y="14.5" width="16" height="3.5" rx="0.6" fill="#fecdd3" />
      <rect x="11" y="27" width="19" height="11" rx="1" fill="#be123c" />
      <rect x="12.5" y="28.5" width="16" height="3.5" rx="0.6" fill="#fecdd3" />
      <rect x="34" y="27" width="19" height="11" rx="1" fill="#be123c" />
      <rect x="35.5" y="28.5" width="16" height="3.5" rx="0.6" fill="#fecdd3" />
      <!-- Rooftop Ventilation / Solar Units -->
      <circle cx="51" cy="39" r="3.5" fill="#64748b" stroke="#ffffff" stroke-width="1" />
      <circle cx="13" cy="39" r="2.2" fill="#94a3b8" stroke="#ffffff" stroke-width="0.8" />
      <!-- Center GPS Pin Target -->
      <circle cx="32" cy="32" r="3" fill="#ffffff" stroke="#e11d48" stroke-width="1.5" />
    </svg>
  `;

  const labelHtml = label
    ? `<div class="px-2 py-0.5 rounded bg-white/95 text-slate-900 ${
        compact ? "text-[9px]" : "text-[10px]"
      } font-semibold whitespace-nowrap shadow-md border border-rose-300">
         ${escapeHtml(label)}
       </div>`
    : undefined;

  return wrapTopDownCentered({
    modelHtml,
    labelHtml,
    labelOffsetY: compact ? -25 : -30,
  });
}

/**
 * Top-down bird's-eye view container port terminal (concrete quay, STS gantry cranes, container stacks).
 */
export function buildPortPointerHtml(options: {
  label?: string;
  variant?: "cambodia" | "overseas";
  compact?: boolean;
}): string {
  const { label, variant = "cambodia", compact = false } = options;
  const size = compact ? 42 : 52;

  const isOverseas = variant === "overseas";
  const berthColor = isOverseas ? "#0f766e" : "#1d4ed8";
  const craneColor = isOverseas ? "#14b8a6" : "#f97316";
  const borderClass = isOverseas ? "border-teal-300" : "border-blue-300";

  const modelHtml = `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" style="display: block; filter: drop-shadow(0 3px 6px rgba(15,23,42,0.45));" xmlns="http://www.w3.org/2000/svg">
      <!-- Berth Water / Pier Basin Rim -->
      <rect x="4" y="6" width="56" height="52" rx="5" fill="#bae6fd" stroke="${berthColor}" stroke-width="1.5" />
      <!-- Concrete Terminal Wharf Platform -->
      <rect x="6" y="18" width="52" height="38" rx="3" fill="#cbd5e1" stroke="#334155" stroke-width="1.2" />
      <!-- Quay Crane Track Rails -->
      <line x1="8" y1="22" x2="56" y2="22" stroke="#475569" stroke-width="1.2" />
      <line x1="8" y1="28" x2="56" y2="28" stroke="#475569" stroke-width="1.2" />

      <!-- Top-Down Ship-to-Shore (STS) Gantry Cranes overhanging Water -->
      <rect x="13" y="8" width="5" height="24" rx="1" fill="${craneColor}" stroke="#ffffff" stroke-width="1" />
      <rect x="12" y="18" width="7" height="5" rx="0.8" fill="#0f172a" />
      <rect x="43" y="8" width="5" height="24" rx="1" fill="${craneColor}" stroke="#ffffff" stroke-width="1" />
      <rect x="42" y="18" width="7" height="5" rx="0.8" fill="#0f172a" />

      <!-- Container Yard (CY) Top-Down Stacks -->
      <rect x="10" y="34" width="12" height="5" rx="0.6" fill="#0284c7" stroke="#ffffff" stroke-width="0.7" />
      <rect x="24" y="34" width="12" height="5" rx="0.6" fill="#f59e0b" stroke="#ffffff" stroke-width="0.7" />
      <rect x="38" y="34" width="15" height="5" rx="0.6" fill="#10b981" stroke="#ffffff" stroke-width="0.7" />

      <rect x="10" y="41" width="15" height="5" rx="0.6" fill="#e11d48" stroke="#ffffff" stroke-width="0.7" />
      <rect x="27" y="41" width="12" height="5" rx="0.6" fill="#0ea5e9" stroke="#ffffff" stroke-width="0.7" />
      <rect x="41" y="41" width="12" height="5" rx="0.6" fill="#f97316" stroke="#ffffff" stroke-width="0.7" />

      <rect x="10" y="48" width="12" height="5" rx="0.6" fill="#0d9488" stroke="#ffffff" stroke-width="0.7" />
      <rect x="24" y="48" width="15" height="5" rx="0.6" fill="#0284c7" stroke="#ffffff" stroke-width="0.7" />
      <rect x="41" y="48" width="12" height="5" rx="0.6" fill="#f59e0b" stroke="#ffffff" stroke-width="0.7" />

      <!-- Center Berth Anchor Target -->
      <circle cx="32" cy="25" r="2.8" fill="#ffffff" stroke="${berthColor}" stroke-width="1.5" />
    </svg>
  `;

  const labelHtml = label
    ? `<div class="px-2 py-0.5 rounded bg-white/95 text-slate-900 ${
        compact ? "text-[9px]" : "text-[10px]"
      } font-semibold whitespace-nowrap shadow-md border ${borderClass}">
         ${escapeHtml(label)}
       </div>`
    : undefined;

  return wrapTopDownCentered({
    modelHtml,
    labelHtml,
    labelOffsetY: compact ? -25 : -30,
  });
}

/**
 * Top-down bird's-eye view customs border checkpoint plaza spanning across highway lanes.
 */
export function buildBorderGatePointerHtml(options: {
  label?: string;
}): string {
  const { label } = options;

  const modelHtml = `
    <svg width="46" height="46" viewBox="0 0 60 60" style="display: block; filter: drop-shadow(0 3px 6px rgba(15,23,42,0.45));" xmlns="http://www.w3.org/2000/svg">
      <!-- Road Lanes Underneath -->
      <rect x="18" y="6" width="24" height="48" rx="3" fill="#334155" stroke="#ffffff" stroke-width="1" />
      <line x1="30" y1="8" x2="30" y2="52" stroke="#f8fafc" stroke-width="1.2" stroke-dasharray="3,3" />
      <!-- Customs Checkpoint Canopy Roof From Above -->
      <rect x="8" y="21" width="44" height="18" rx="3" fill="#4f46e5" stroke="#ffffff" stroke-width="1.5" />
      <rect x="13" y="25" width="34" height="10" rx="1.5" fill="#6366f1" />
      <!-- Boom Barrier Stripes -->
      <line x1="20" y1="16" x2="40" y2="16" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" />
      <line x1="24" y1="16" x2="28" y2="16" stroke="#ffffff" stroke-width="2.5" />
      <line x1="32" y1="16" x2="36" y2="16" stroke="#ffffff" stroke-width="2.5" />
      <circle cx="30" cy="30" r="2.8" fill="#ffffff" stroke="#4f46e5" stroke-width="1.5" />
    </svg>
  `;

  const labelHtml = label
    ? `<div class="px-2 py-0.5 rounded bg-white/95 text-slate-900 text-[10px] font-semibold whitespace-nowrap shadow-md border border-indigo-300">
         ${escapeHtml(label)}
       </div>`
    : undefined;

  return wrapTopDownCentered({
    modelHtml,
    labelHtml,
    labelOffsetY: -27,
  });
}
