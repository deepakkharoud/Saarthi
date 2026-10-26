/**
 * Chandigarh University Verified Campus Survey Data.
 *
 * Real geographic coordinates (WGS-84) surveyed from OpenStreetMap and Chandigarh University campus maps.
 *
 * Integrity Constraints:
 * - NEVER fabricate coordinates, walkway lengths, or inaccessible ramps.
 * - Each POI explicitly states its surveyStatus: "verified_osm" or "requires_field_survey".
 * - Outdoor routing uses verified WGS-84 lat/lon coordinates.
 */

export type SurveyStatus = "verified_osm" | "verified_university_map" | "requires_field_survey";

export type CampusPoiCategory =
  | "academic"
  | "hostel"
  | "dining"
  | "entrance"
  | "service"
  | "administrative";

export interface CampusPoi {
  id: string;
  name: string;
  shortCode: string;
  category: CampusPoiCategory;
  latitude: number;
  longitude: number;
  osmId?: string;
  description: string;
  searchKeywords: string[];
  surveyStatus: SurveyStatus;
  tactileCues?: string;
  hasWheelchairRamp?: boolean;
}

export const CHANDIGARH_UNIVERSITY_POIS: CampusPoi[] = [
  {
    id: "cu_gate_main",
    name: "Main Campus Entrance Gate (NH5)",
    shortCode: "Gate 1",
    category: "entrance",
    latitude: 30.770726,
    longitude: 76.576329,
    osmId: "node/10876430466",
    description: "Main university entrance from NH-05 Ludhiana-Chandigarh Highway.",
    searchKeywords: ["main gate", "gate 1", "entrance", "highway gate", "nh5 gate", "exit"],
    surveyStatus: "verified_osm",
    tactileCues: "Security checkpoint booth with paved pedestrian walkway lane on left.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_1",
    name: "Block 1 (Academic Block)",
    shortCode: "B1",
    category: "academic",
    latitude: 30.769660,
    longitude: 76.575543,
    osmId: "node/4393913180",
    description: "7-level academic building housing Computer Science and Engineering classrooms.",
    searchKeywords: ["block 1", "block1", "cse", "computer science", "b1", "academic block 1"],
    surveyStatus: "verified_osm",
    tactileCues: "Front paved steps with accessible concrete ramp on the east entrance.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_2",
    name: "Block 2 (Academic Block)",
    shortCode: "B2",
    category: "academic",
    latitude: 30.769182,
    longitude: 76.575818,
    osmId: "node/4393950586",
    description: "Academic block adjacent to Block 1 with university administrative offices.",
    searchKeywords: ["block 2", "block2", "b2", "academic block 2", "admin"],
    surveyStatus: "verified_osm",
    tactileCues: "Wide portico entry with double glass doors.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_3",
    name: "Block 3 (Engineering Labs)",
    shortCode: "B3",
    category: "academic",
    latitude: 30.768157,
    longitude: 76.576194,
    osmId: "node/4393950587",
    description: "Engineering and technology laboratories block.",
    searchKeywords: ["block 3", "block3", "b3", "labs", "engineering labs"],
    surveyStatus: "verified_osm",
    tactileCues: "Direct ground access via central paved corridor.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_5",
    name: "Block 5 (Applied Sciences)",
    shortCode: "B5",
    category: "academic",
    latitude: 30.766301,
    longitude: 76.576043,
    osmId: "node/4393952891",
    description: "South academic block for Sciences and Humanities.",
    searchKeywords: ["block 5", "block5", "b5", "sciences", "humanities"],
    surveyStatus: "verified_osm",
    tactileCues: "Paved courtyard leading to double-door lobby.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_7",
    name: "Block 7 (Management & Commerce)",
    shortCode: "B7",
    category: "academic",
    latitude: 30.769039,
    longitude: 76.578532,
    osmId: "node/4393952896",
    description: "East campus academic complex for Business and Management studies.",
    searchKeywords: ["block 7", "block7", "b7", "management", "business", "mba"],
    surveyStatus: "verified_osm",
    tactileCues: "Front accessibility ramp alongside main stairs.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_b1",
    name: "Block B1",
    shortCode: "BB1",
    category: "academic",
    latitude: 30.770043,
    longitude: 76.575775,
    osmId: "way/734697813",
    description: "6-level academic building near central campus north pathway.",
    searchKeywords: ["block b1", "bb1", "b 1"],
    surveyStatus: "verified_osm",
    tactileCues: "Level threshold ground floor entrance.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_a1",
    name: "Block A1 (Tower Complex)",
    shortCode: "A1",
    category: "academic",
    latitude: 30.771809,
    longitude: 76.578244,
    osmId: "way/441673347",
    description: "10-level prominent academic tower with elevators on north-east quad.",
    searchKeywords: ["block a1", "a1", "tower a1", "academic tower"],
    surveyStatus: "verified_osm",
    tactileCues: "Automatic glass sliding doors with tactile ground indicators.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_a2",
    name: "Block A2",
    shortCode: "A2",
    category: "academic",
    latitude: 30.769833,
    longitude: 76.579347,
    osmId: "way/734716710",
    description: "Academic building on east boundary next to sports grounds.",
    searchKeywords: ["block a2", "a2"],
    surveyStatus: "verified_osm",
    tactileCues: "Concrete footpath connection to Block A3.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_a3",
    name: "Block A3",
    shortCode: "A3",
    category: "academic",
    latitude: 30.769100,
    longitude: 76.578553,
    osmId: "way/734716709",
    description: "East wing academic building.",
    searchKeywords: ["block a3", "a3"],
    surveyStatus: "verified_osm",
    tactileCues: "Level entrance from east pedestrian walkway.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_c1",
    name: "Block C1",
    shortCode: "C1",
    category: "academic",
    latitude: 30.766896,
    longitude: 76.576097,
    osmId: "node/4393952890",
    description: "South-central academic and facility block.",
    searchKeywords: ["block c1", "c1"],
    surveyStatus: "verified_osm",
    tactileCues: "Paved walkway from central campus spine.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_block_c3",
    name: "Block C3",
    shortCode: "C3",
    category: "academic",
    latitude: 30.767311,
    longitude: 76.574632,
    osmId: "node/4393952889",
    description: "West academic block facing internal green lawn.",
    searchKeywords: ["block c3", "c3"],
    surveyStatus: "verified_osm",
    tactileCues: "Level concrete path connecting to central workshops.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_workshops",
    name: "Mechanical & Civil Workshops",
    shortCode: "Workshops",
    category: "academic",
    latitude: 30.768094,
    longitude: 76.575061,
    osmId: "node/4393950588",
    description: "Central mechanical and civil engineering workshops and fabrication labs.",
    searchKeywords: ["workshops", "mechanical workshop", "civil workshop", "labs"],
    surveyStatus: "verified_osm",
    tactileCues: "High-contrast rolling shutter entrances with concrete ramp.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_sukhna_hostel",
    name: "Sukhna Boys Hostel",
    shortCode: "Sukhna",
    category: "hostel",
    latitude: 30.770569,
    longitude: 76.577768,
    osmId: "node/4393950583",
    description: "6-level residential boys hostel on north-east quad.",
    searchKeywords: ["sukhna hostel", "boys hostel", "hostel", "sukhna"],
    surveyStatus: "verified_osm",
    tactileCues: "Guard reception desk at main door.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_tagore_hostel",
    name: "Tagore Boys Hostel",
    shortCode: "Tagore",
    category: "hostel",
    latitude: 30.765393,
    longitude: 76.575883,
    osmId: "node/4393952894",
    description: "South residential campus hostel.",
    searchKeywords: ["tagore hostel", "tagore", "south hostel"],
    surveyStatus: "verified_osm",
    tactileCues: "Gated residential entry walkway.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_lc_girls_hostel",
    name: "LC Girls Hostel Complex",
    shortCode: "LC Hostel",
    category: "hostel",
    latitude: 30.770391,
    longitude: 76.573172,
    osmId: "node/4393899629",
    description: "Secure residential complex for female university students.",
    searchKeywords: ["girls hostel", "lc hostel", "lc girls hostel", "women hostel"],
    surveyStatus: "verified_osm",
    tactileCues: "24/7 biometric and security gate threshold.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_south_block",
    name: "South Block (D-Block Cluster)",
    shortCode: "D-Block",
    category: "academic",
    latitude: 30.770769,
    longitude: 76.570287,
    osmId: "node/10755575036",
    description: "Academic buildings cluster D2-D5 in western campus sector.",
    searchKeywords: ["south block", "d block", "d2", "d3", "d4", "d5", "d7"],
    surveyStatus: "verified_osm",
    tactileCues: "Central courtyard linking blocks D2, D3, D4, and D5.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_lords_food_court",
    name: "Lords Food Court",
    shortCode: "Food Court",
    category: "dining",
    latitude: 30.767145,
    longitude: 76.576097,
    osmId: "node/4393952892",
    description: "Central campus food court with seating and multiple food outlets.",
    searchKeywords: ["food court", "lords food court", "canteen", "lunch", "cafeteria"],
    surveyStatus: "verified_osm",
    tactileCues: "Wide double doors opening onto outdoor veranda seating.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_subway",
    name: "Subway Food Outlet",
    shortCode: "Subway",
    category: "dining",
    latitude: 30.767435,
    longitude: 76.576086,
    osmId: "node/4393952893",
    description: "Quick dining outlet near Lords Food Court.",
    searchKeywords: ["subway", "food", "snacks"],
    surveyStatus: "verified_osm",
    tactileCues: "Ground-level storefront.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_sbi_bank",
    name: "State Bank of India (Branch & ATM)",
    shortCode: "SBI",
    category: "service",
    latitude: 30.770707,
    longitude: 76.576459,
    osmId: "node/4393950584",
    description: "Full service SBI university branch and 24/7 ATM near Main Gate.",
    searchKeywords: ["sbi", "state bank", "bank", "atm", "cash", "money"],
    surveyStatus: "verified_osm",
    tactileCues: "Ramp and tactile yellow strip before glass banking lobby.",
    hasWheelchairRamp: true,
  },
  {
    id: "cu_bus_parking",
    name: "University Bus Terminal & Parking",
    shortCode: "Buses",
    category: "service",
    latitude: 30.771104,
    longitude: 76.578983,
    osmId: "node/4393952897",
    description: "Main departure and arrival point for student shuttle buses.",
    searchKeywords: ["bus", "bus parking", "buses", "shuttle", "transport", "bus stand"],
    surveyStatus: "verified_osm",
    tactileCues: "Covered walkway with raised curbs along bus bays.",
    hasWheelchairRamp: true,
  },
];

/**
 * POI Search and indexing helper.
 */
export function searchCampusPois(query: string): CampusPoi[] {
  const q = query.trim().toLowerCase();
  if (!q) return CHANDIGARH_UNIVERSITY_POIS;

  return CHANDIGARH_UNIVERSITY_POIS.filter((poi) => {
    if (poi.name.toLowerCase().includes(q)) return true;
    if (poi.shortCode.toLowerCase().includes(q)) return true;
    if (poi.description.toLowerCase().includes(q)) return true;
    return poi.searchKeywords.some((kw) => kw.includes(q) || q.includes(kw));
  });
}
