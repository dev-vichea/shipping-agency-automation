import type { ComboboxOption } from "@/components/ui/combobox";

export const COMMON_SHIPPING_UNITS: ComboboxOption[] = [
  { value: "KG", label: "KG · Kilograms", description: "Weight in kilograms", category: "Standard Units" },
  { value: "PCS", label: "PCS · Pieces", description: "Piece count", category: "Standard Units" },
  { value: "YDS", label: "YDS · Yards", description: "Length in yards", category: "Standard Units" },
  { value: "MTR", label: "MTR · Meters", description: "Length in meters", category: "Standard Units" },
  { value: "ROLLS", label: "ROLLS · Rolls", description: "Rolled materials / fabrics", category: "Standard Units" },
  { value: "BOX", label: "BOX · Boxes", description: "Box container unit", category: "Standard Units" },
  { value: "CTN", label: "CTN · Cartons", description: "Carton package unit", category: "Standard Units" },
  { value: "SETS", label: "SETS · Sets", description: "Sets of components", category: "Standard Units" },
  { value: "DOZ", label: "DOZ · Dozens", description: "12 units", category: "Standard Units" },
  { value: "BAGS", label: "BAGS · Bags", description: "Bag package unit", category: "Standard Units" },
  { value: "BALES", label: "BALES · Bales", description: "Compressed bales", category: "Standard Units" },
  { value: "PAIRS", label: "PAIRS · Pairs", description: "Pairs of items", category: "Standard Units" },
  { value: "CONE", label: "CONE · Cones", description: "Thread cones", category: "Standard Units" },
  { value: "PKG", label: "PKG · Packages", description: "Generic package unit", category: "Standard Units" },
  { value: "CBM", label: "CBM · Cubic Meters", description: "Volume in cubic meters", category: "Standard Units" },
];

export const COMMON_TRANSPORT_MODES: ComboboxOption[] = [
  { value: "BY SEA", label: "BY SEA", description: "Ocean freight", category: "Transport Modes" },
  { value: "BY TRUCK", label: "BY TRUCK", description: "Road freight / Cross-border", category: "Transport Modes" },
  { value: "BY AIR", label: "BY AIR", description: "Air freight", category: "Transport Modes" },
  { value: "SEA / TRUCK", label: "SEA / TRUCK", description: "Multimodal sea and truck transit", category: "Transport Modes" },
  { value: "AIR / TRUCK", label: "AIR / TRUCK", description: "Multimodal air and truck transit", category: "Transport Modes" },
];

export const COMMON_ORIGINS: ComboboxOption[] = [
  { value: "SHANGHAI, CHINA", label: "SHANGHAI, CHINA", description: "Shanghai Port, China", category: "Common Origins" },
  { value: "NINGBO, CHINA", label: "NINGBO, CHINA", description: "Ningbo-Zhoushan Port, China", category: "Common Origins" },
  { value: "SHENZHEN, CHINA", label: "SHENZHEN, CHINA", description: "Shenzhen Port, China", category: "Common Origins" },
  { value: "GUANGZHOU, CHINA", label: "GUANGZHOU, CHINA", description: "Guangzhou / Nansha Port, China", category: "Common Origins" },
  { value: "QINGDAO, CHINA", label: "QINGDAO, CHINA", description: "Qingdao Port, China", category: "Common Origins" },
  { value: "XIAMEN, CHINA", label: "XIAMEN, CHINA", description: "Xiamen Port, China", category: "Common Origins" },
  { value: "TIANJIN, CHINA", label: "TIANJIN, CHINA", description: "Tianjin Port, China", category: "Common Origins" },
  { value: "HO CHI MINH, VIETNAM", label: "HO CHI MINH, VIETNAM", description: "Cat Lai / Cai Mep, Vietnam", category: "Common Origins" },
  { value: "BANGKOK, THAILAND", label: "BANGKOK, THAILAND", description: "Laem Chabang / Bangkok, Thailand", category: "Common Origins" },
  { value: "SINGAPORE", label: "SINGAPORE", description: "Port of Singapore", category: "Common Origins" },
  { value: "HONG KONG", label: "HONG KONG", description: "Hong Kong Port", category: "Common Origins" },
];

export const COMMON_DESTINATIONS: ComboboxOption[] = [
  { value: "Phnom Penh, Cambodia", label: "Phnom Penh, Cambodia", description: "Phnom Penh City", category: "Common Destinations" },
  { value: "Sihanoukville, Cambodia", label: "Sihanoukville, Cambodia", description: "Preah Sihanouk Province", category: "Common Destinations" },
  { value: "Phnom Penh Autonomous Port (PPAP)", label: "Phnom Penh Autonomous Port (PPAP)", description: "River Port LM17 / Keo Phos", category: "Common Destinations" },
  { value: "Sihanoukville Autonomous Port (PAS)", label: "Sihanoukville Autonomous Port (PAS)", description: "Deep Sea Port", category: "Common Destinations" },
  { value: "Bavet, Cambodia", label: "Bavet, Cambodia", description: "Svay Rieng / Vietnam border", category: "Common Destinations" },
];

export const COMMON_PORTS: ComboboxOption[] = [
  { value: "Phnom Penh Autonomous Port (PPAP)", label: "Phnom Penh Autonomous Port (PPAP)", description: "River Container Terminal", category: "Common Ports" },
  { value: "Sihanoukville Autonomous Port (PAS)", label: "Sihanoukville Autonomous Port (PAS)", description: "Deep Sea Port", category: "Common Ports" },
  { value: "Phnom Penh International Airport (PNH)", label: "Phnom Penh International Airport (PNH)", description: "Air Cargo Terminal", category: "Common Ports" },
  { value: "Sihanoukville International Airport (KOS)", label: "Sihanoukville International Airport (KOS)", description: "Air Cargo Terminal", category: "Common Ports" },
  { value: "Bavet Border", label: "Bavet Border", description: "Land Border Checkpoint", category: "Common Ports" },
];

export const COMMON_COUNTRIES: ComboboxOption[] = [
  { value: "CHINA", label: "CHINA", category: "Countries" },
  { value: "VIETNAM", label: "VIETNAM", category: "Countries" },
  { value: "THAILAND", label: "THAILAND", category: "Countries" },
  { value: "TAIWAN", label: "TAIWAN", category: "Countries" },
  { value: "SINGAPORE", label: "SINGAPORE", category: "Countries" },
  { value: "JAPAN", label: "JAPAN", category: "Countries" },
  { value: "KOREA", label: "KOREA", category: "Countries" },
  { value: "MALAYSIA", label: "MALAYSIA", category: "Countries" },
  { value: "INDONESIA", label: "INDONESIA", category: "Countries" },
];
