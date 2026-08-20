"use client";

/**
 * Cohort Station 2D v2 — Pokemon Gen3 (Rubis/Saphir) style top-down view of
 * the workspace, rendered on a Canvas. Bigger map (48x28), richer sprites
 * (24x32), A* pathfinding, work-in-place animations, daylight cycle,
 * particles (steam, dust), real-time scores, hover/click interactions, and
 * a golden crown on the leader bot.
 *
 * Design notes:
 * - One full-screen `requestAnimationFrame` loop ticks every bot, computes
 *   pathfinding, renders the world. We use the canvas as the only DOM
 *   surface — React just manages mount and hover label.
 * - Canvas is responsive: a ResizeObserver watches the parent and resizes
 *   the canvas (and the camera viewport) when the container changes width.
 * - Sprites are drawn procedurally; we avoid external assets so the bundle
 *   stays light and we can iterate freely.
 *
 * Coupling with live data:
 * - `agentStatuses` drives target zones, work animation intensity, bubble
 *   content, LED colour.
 * - `activeTaskCount` (per-agent) ranks bots to award the crown to the
 *   most-productive one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRuntimeStatus } from "../utils";

// ============================================================
// MAP — 48 cols x 28 rows = 1152 x 672 logical px @ TILE=24
// ============================================================

const MAP_COLS = 48;
const MAP_ROWS = 28;
const TILE_SIZE = 24;

type TileChar =
  | "."
  | "#"
  | "~"
  | "W"
  | "S"
  | "C"
  | "P"
  | "D"
  | "p"
  | "c"
  | "w"
  | "B"
  | "K" // kitchen counter (decor only, not stool)
  | "T" // toilets / door
  | "L"; // lounge low table

// Layout:
//  - Top wall (row 0) = wall
//  - Row 1 = BRAIKE sign (B)
//  - Row 2 = frosted-glass window (~)
//  - Row 3..4 = dock zone + open space behind workstations
//  - Row 5..16 = main work area (workstations + lounge + cafe)
//  - Row 17..22 = secondary work, plants, snacks
//  - Row 23..26 = ping pong + bottom plants
//  - Row 27 = bottom wall
const MAP_RAW_INPUT = [
  "################################################",
  "#BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB##",
  "#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#",
  "#.....DDD..DDD..DDD..DDD..DDD..DDD..DDD..DDD...#",
  "#..............................................#",
  "#......WWWW..WWWW..WWWW..WWWW..WWWW...........KK",
  "#......WWWW..WWWW..WWWW..WWWW..WWWW..........KKK",
  "#............................................CCC",
  "#............................................CCC",
  "#cccccccc..............................cccccCCC#",
  "#cSSSSSSc.............................ccccccccC#",
  "#cSSSSSSc..WWWW..WWWW..WWWW..WWWW..WWWW........#",
  "#cLLLLLLc..WWWW..WWWW..WWWW..WWWW..WWWW........#",
  "#cccccccc......................................#",
  "#..............................................#",
  "#..........w...................................#",
  "#..............................................#",
  "#......WWWW..WWWW..WWWW..WWWW..WWWW............#",
  "#......WWWW..WWWW..WWWW..WWWW..WWWW............#",
  "#..............................................#",
  "#p.............................................#",
  "#............................................p.#",
  "#..............................................#",
  "#..PPPPP.......................................#",
  "#..PPPPP....................p..................#",
  "#..PPPPP.......................................#",
  "#p............................................p#",
  "################################################",
];

// Normalise — pad / truncate every row so a typo doesn't crash anything.
const MAP_RAW: string[] = MAP_RAW_INPUT.map((r) => {
  if (r.length === MAP_COLS) return r;
  if (r.length > MAP_COLS) return r.slice(0, MAP_COLS);
  return r + ".".repeat(MAP_COLS - r.length);
});
while (MAP_RAW.length < MAP_ROWS) MAP_RAW.push(".".repeat(MAP_COLS));
if (MAP_RAW.length > MAP_ROWS) MAP_RAW.length = MAP_ROWS;

function tileAt(col: number, row: number): TileChar {
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return "#";
  const r = MAP_RAW[row];
  if (!r) return "#";
  return (r[col] as TileChar) ?? ".";
}

// Walkable tiles for the pathfinder — anything that's not a wall or
// solid furniture. Carpet / floor are passable, doors (T) too.
function isWalkable(col: number, row: number): boolean {
  const t = tileAt(col, row);
  return t === "." || t === "c" || t === "T";
}

// ============================================================
// ZONES — every place a bot can stand. Stand-tile is always walkable.
// ============================================================

type ZoneKind2D = "workstation" | "sofa" | "cafe" | "pingpong" | "dock";

interface Zone2D {
  id: string;
  kind: ZoneKind2D;
  col: number;
  row: number;
  facing: "down" | "up" | "left" | "right";
}

// 20 workstations split top/bottom of the two work rows
const WS_ZONES: Zone2D[] = [];
// Top row work area — bots stand at row=7 facing up into desks at row 5-6
[8, 13, 18, 23, 28].forEach((col, i) => {
  WS_ZONES.push({
    id: `ws-top-${i}`,
    kind: "workstation",
    col,
    row: 7,
    facing: "up",
  });
});
// Middle row work area — bots stand at row=14 facing up into desks at row 11-12
[11, 16, 21, 26, 31].forEach((col, i) => {
  WS_ZONES.push({
    id: `ws-mid-${i}`,
    kind: "workstation",
    col,
    row: 14,
    facing: "up",
  });
});
// Bottom work area — bots stand at row=19 facing up into desks at row 17-18
[8, 13, 18, 23, 28].forEach((col, i) => {
  WS_ZONES.push({
    id: `ws-bot-${i}`,
    kind: "workstation",
    col,
    row: 19,
    facing: "up",
  });
});

// Sofa lounge — 3 spots
const SOFA_ZONES: Zone2D[] = [
  { id: "sf-0", kind: "sofa", col: 8, row: 11, facing: "right" },
  { id: "sf-1", kind: "sofa", col: 8, row: 12, facing: "right" },
  { id: "sf-2", kind: "sofa", col: 4, row: 11, facing: "left" },
];

// Cafe counter — bot stands left of the counter facing right
const CAFE_ZONES: Zone2D[] = [
  { id: "cf-0", kind: "cafe", col: 43, row: 7, facing: "right" },
  { id: "cf-1", kind: "cafe", col: 43, row: 9, facing: "right" },
  { id: "cf-2", kind: "cafe", col: 43, row: 11, facing: "right" },
];

// Ping-pong — both ends of the table
const PINGPONG_ZONES: Zone2D[] = [
  { id: "pp-0", kind: "pingpong", col: 1, row: 24, facing: "right" },
  { id: "pp-1", kind: "pingpong", col: 8, row: 24, facing: "left" },
];

// Docks across the top — bots park here when offline
const DOCK_ZONES: Zone2D[] = [];
[6, 7, 8, 11, 12, 13, 16, 17, 18, 21, 22, 23, 26, 27, 28].forEach((col, i) => {
  DOCK_ZONES.push({
    id: `dk-${i}`,
    kind: "dock",
    col,
    row: 4,
    facing: "up",
  });
});

const ALL_ZONES: Zone2D[] = [
  ...WS_ZONES,
  ...SOFA_ZONES,
  ...CAFE_ZONES,
  ...PINGPONG_ZONES,
  ...DOCK_ZONES,
];

// ============================================================
// A* PATHFINDING — bots route around furniture & each other.
// Uses Manhattan distance heuristic on a 4-neighbour grid. Cheap
// enough for 15 bots on a 48x28 map running every few seconds.
// ============================================================

interface PathNode {
  col: number;
  row: number;
}

function aStar(
  start: PathNode,
  goal: PathNode,
): PathNode[] {
  // Quick exit
  if (start.col === goal.col && start.row === goal.row) return [];
  const key = (n: PathNode) => `${n.col},${n.row}`;
  const open: { node: PathNode; f: number; g: number }[] = [
    { node: start, f: 0, g: 0 },
  ];
  const cameFrom = new Map<string, PathNode>();
  const gScore = new Map<string, number>();
  gScore.set(key(start), 0);

  const MAX_ITER = 800; // safety cap
  let iter = 0;

  while (open.length > 0 && iter < MAX_ITER) {
    iter++;
    // Pop node with lowest f
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    if (cur.node.col === goal.col && cur.node.row === goal.row) {
      // Reconstruct path
      const path: PathNode[] = [];
      let c: PathNode | undefined = cur.node;
      while (c) {
        path.unshift(c);
        c = cameFrom.get(key(c));
      }
      // Drop start
      return path.slice(1);
    }
    const neighbours: PathNode[] = [
      { col: cur.node.col + 1, row: cur.node.row },
      { col: cur.node.col - 1, row: cur.node.row },
      { col: cur.node.col, row: cur.node.row + 1 },
      { col: cur.node.col, row: cur.node.row - 1 },
    ];
    for (const n of neighbours) {
      // Allow the goal even if it's not strictly walkable (it's a stand
      // tile which we declared walkable, but be defensive).
      const isGoal = n.col === goal.col && n.row === goal.row;
      if (!isGoal && !isWalkable(n.col, n.row)) continue;
      const tentativeG = (cur.g ?? 0) + 1;
      const k = key(n);
      if (tentativeG < (gScore.get(k) ?? Infinity)) {
        gScore.set(k, tentativeG);
        cameFrom.set(k, cur.node);
        const h = Math.abs(n.col - goal.col) + Math.abs(n.row - goal.row);
        open.push({ node: n, f: tentativeG + h, g: tentativeG });
      }
    }
  }
  // No path — return empty so the bot just teleports to target gracefully.
  return [];
}

// ============================================================
// BOT STATE
// ============================================================

type Direction = "down" | "up" | "left" | "right";
type BotMode = "walking" | "stationed";

interface BotState {
  agentId: string;
  name: string;
  status: AgentRuntimeStatus["status"];
  currentTaskTitle: string | null;
  activeTaskCount: number;
  // Pixel coords (logical, sub-pixel for smooth motion)
  x: number;
  y: number;
  // Current path being walked (in tile coords); first tile is the next
  // step, last tile is the destination.
  path: PathNode[];
  pathIndex: number; // current target waypoint in path
  facing: Direction;
  mode: BotMode;
  walkFrame: number;
  walkPhase: number;
  hue: number;
  bubbleUntil: number;
  occupiesZone: string | null;
  // Stationed-state animation extras
  workPhase: number;
  // Crown flag (most active bot)
  isLeader: boolean;
}

function tileToPx(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

function pxToTile(x: number, y: number): PathNode {
  return {
    col: Math.floor(x / TILE_SIZE),
    row: Math.floor(y / TILE_SIZE),
  };
}

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function pickZoneFor(bot: BotState, taken: Set<string>): Zone2D | null {
  const want: ZoneKind2D[] =
    bot.status === "active"
      ? ["workstation"]
      : bot.status === "idle"
        ? ["sofa", "cafe", "pingpong"]
        : ["dock"];
  const candidates = ALL_ZONES.filter(
    (z) => want.includes(z.kind) && !taken.has(z.id),
  );
  if (candidates.length === 0) return null;
  const seed = hashHue(bot.agentId + ":" + bot.status);
  return candidates[seed % candidates.length] ?? null;
}

// ============================================================
// PALETTE
// ============================================================

const C = {
  floorA: "#E8D3A8",
  floorB: "#DCC59A",
  carpetA: "#D5BFA0",
  carpetB: "#C4A881",
  wall: "#5A4B3A",
  wallTop: "#7A6850",
  glass: "#A8BFD8",
  glassEdge: "#7A8FAA",
  deskWood: "#9C7A4A",
  deskTop: "#C9A572",
  monitor: "#2A2F4A",
  monitorOn: "#5B7AD8",
  monitorCode: "#A8E6CF",
  sofa: "#D4C5A8",
  sofaShade: "#A89C7E",
  pillowA: "#FF6F61",
  pillowB: "#7C3AED",
  cafeBg: "#EDE5D2",
  cafeCounter: "#FFFFFF",
  cafeStool: "#FF6F61",
  pingTable: "#10B981",
  pingNet: "#FFFFFF",
  dockBase: "#3A3A4D",
  dockHalo: "#7C3AED",
  plantPot: "#D4823A",
  plantLeaves: "#10B981",
  plantLeavesDark: "#0E7A56",
  waterTank: "#A8D8FF",
  waterBody: "#FFFFFF",
  signBg: "#112D4A",
  signText: "#FF6F61",
  signAccent: "#7C3AED",
  shadow: "rgba(0,0,0,0.18)",
  heatActive: "rgba(255, 111, 97, 0.22)",
  heatIdle: "rgba(124, 58, 237, 0.14)",
  heatOffline: "rgba(148, 163, 184, 0.12)",
  lowTable: "#F5EFE2",
  lowTableShade: "#D8CDB4",
  crownGold: "#F7C03D",
  crownGoldDark: "#B8861E",
  ledActive: "#10B981",
  ledIdle: "#F59E0B",
  ledOffline: "#94A3B8",
};

// ============================================================
// TILE DRAW HELPERS
// ============================================================

function drawFloor(ctx: CanvasRenderingContext2D, col: number, row: number) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  ctx.fillStyle = (col + row) % 2 === 0 ? C.floorA : C.floorB;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(x, y + TILE_SIZE - 1, TILE_SIZE, 1);
  if (col % 4 === 0) {
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(x, y, 1, TILE_SIZE);
  }
}

function drawCarpet(ctx: CanvasRenderingContext2D, col: number, row: number) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  ctx.fillStyle = (col + row) % 2 === 0 ? C.carpetA : C.carpetB;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
}

function drawWall(ctx: CanvasRenderingContext2D, col: number, row: number) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  ctx.fillStyle = C.wall;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = C.wallTop;
  ctx.fillRect(x, y, TILE_SIZE, 4);
}

function drawGlass(ctx: CanvasRenderingContext2D, col: number, row: number) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  drawFloor(ctx, col, row);
  ctx.fillStyle = C.glass;
  ctx.globalAlpha = 0.65;
  ctx.fillRect(x, y + 2, TILE_SIZE, TILE_SIZE - 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.glassEdge;
  ctx.fillRect(x, y, TILE_SIZE, 2);
  ctx.fillRect(x, y + TILE_SIZE - 4, TILE_SIZE, 2);
}

function drawWorkstation(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  codeOffset: number,
) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  drawFloor(ctx, col, row);
  ctx.fillStyle = C.deskTop;
  ctx.fillRect(x + 2, y + 4, TILE_SIZE - 4, 16);
  ctx.fillStyle = C.deskWood;
  ctx.fillRect(x + 2, y + 18, TILE_SIZE - 4, 4);
  ctx.fillStyle = C.monitor;
  ctx.fillRect(x + 7, y + 2, 10, 8);
  ctx.fillStyle = C.monitorOn;
  ctx.fillRect(x + 8, y + 3, 8, 5);
  // Scrolling code lines on screen (offset animates)
  ctx.fillStyle = C.monitorCode;
  for (let i = 0; i < 3; i++) {
    const yLine = y + 4 + ((codeOffset + i * 2) % 4);
    const w = 2 + ((codeOffset + i * 3) % 5);
    ctx.fillRect(x + 9, yLine, w, 1);
  }
  ctx.fillStyle = C.monitor;
  ctx.fillRect(x + 11, y + 9, 2, 3);
  ctx.fillStyle = "#2C2C3A";
  ctx.fillRect(x + 6, y + 14, 12, 2);
  ctx.fillStyle = C.signText;
  ctx.fillRect(x + 20, y + 12, 3, 4);
}

function drawSofa(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  drawCarpet(ctx, col, row);
  ctx.fillStyle = C.sofaShade;
  ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, 5);
  ctx.fillStyle = C.sofa;
  ctx.fillRect(x + 2, y + 7, TILE_SIZE - 4, 13);
  // Alternate pillow position by row for variety
  if (row % 2 === 0) {
    ctx.fillStyle = C.pillowA;
    ctx.fillRect(x + 4, y + 10, 5, 5);
  } else {
    ctx.fillStyle = C.pillowB;
    ctx.fillRect(x + TILE_SIZE - 9, y + 10, 5, 5);
  }
}

function drawLowTable(ctx: CanvasRenderingContext2D, col: number, row: number) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  drawCarpet(ctx, col, row);
  ctx.fillStyle = C.lowTable;
  ctx.fillRect(x + 4, y + 8, TILE_SIZE - 8, 10);
  ctx.fillStyle = C.lowTableShade;
  ctx.fillRect(x + 4, y + 17, TILE_SIZE - 8, 2);
  // Magazine + mug
  ctx.fillStyle = C.signText;
  ctx.fillRect(x + 6, y + 10, 6, 3);
  ctx.fillStyle = C.signAccent;
  ctx.fillRect(x + 15, y + 11, 3, 4);
}

function drawCafeCounter(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  ctx.fillStyle = C.cafeBg;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = C.cafeCounter;
  ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  // Stool circle
  ctx.fillStyle = C.cafeStool;
  ctx.beginPath();
  ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.fillRect(x + 2, y + TILE_SIZE - 4, TILE_SIZE - 4, 1);
}

function drawKitchenCounter(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  ctx.fillStyle = C.cafeBg;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = C.cafeCounter;
  ctx.fillRect(x, y + 2, TILE_SIZE, TILE_SIZE - 4);
  // Mini coffee machine
  if ((col + row) % 3 === 0) {
    ctx.fillStyle = "#1C1C28";
    ctx.fillRect(x + 6, y + 6, 6, 10);
    ctx.fillStyle = C.ledActive;
    ctx.fillRect(x + 7, y + 7, 1, 1);
  }
  // Fruit bowl
  if ((col + row) % 3 === 1) {
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(x + 12, y + 13, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.signText;
    ctx.fillRect(x + 10, y + 9, 3, 3);
    ctx.fillStyle = "#FFA94D";
    ctx.fillRect(x + 13, y + 10, 3, 3);
  }
}

function drawPingPong(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  drawFloor(ctx, col, row);
  ctx.fillStyle = C.pingTable;
  ctx.fillRect(x + 2, y + 4, TILE_SIZE - 4, TILE_SIZE - 8);
  ctx.fillStyle = C.pingNet;
  ctx.fillRect(x + 2, y + TILE_SIZE / 2 - 1, TILE_SIZE - 4, 2);
  ctx.fillRect(x + TILE_SIZE / 2 - 1, y + 4, 2, TILE_SIZE - 8);
}

function drawDock(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  haloPhase: number,
) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  ctx.fillStyle = C.wall;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  const a = 0.25 + Math.sin(haloPhase + col * 0.7) * 0.1;
  ctx.fillStyle = `rgba(124, 58, 237, ${a.toFixed(3)})`;
  ctx.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
  ctx.fillStyle = C.dockBase;
  ctx.fillRect(x + 8, y + 16, 8, 4);
}

function drawPlant(ctx: CanvasRenderingContext2D, col: number, row: number) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  drawFloor(ctx, col, row);
  ctx.fillStyle = C.plantPot;
  ctx.fillRect(x + 8, y + 16, 8, 6);
  ctx.fillStyle = C.plantLeavesDark;
  ctx.beginPath();
  ctx.arc(x + 12, y + 10, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.plantLeaves;
  ctx.beginPath();
  ctx.arc(x + 9, y + 8, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 15, y + 9, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawWater(ctx: CanvasRenderingContext2D, col: number, row: number) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  drawFloor(ctx, col, row);
  ctx.fillStyle = C.waterBody;
  ctx.fillRect(x + 7, y + 8, 10, 13);
  ctx.fillStyle = C.waterTank;
  ctx.fillRect(x + 8, y + 2, 8, 7);
  ctx.fillStyle = C.dockBase;
  ctx.fillRect(x + 11, y + 13, 2, 2);
}

function drawSignBg(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  phase: number,
) {
  const x = col * TILE_SIZE;
  const y = row * TILE_SIZE;
  ctx.fillStyle = C.signBg;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  const a = 0.5 + Math.sin(phase + col * 0.4) * 0.3;
  ctx.fillStyle = `rgba(255, 111, 97, ${a.toFixed(3)})`;
  ctx.fillRect(x, y + TILE_SIZE - 5, TILE_SIZE, 3);
}

// ============================================================
// BOT SPRITE — 24x32 px (logical), top-down. Drawn procedurally.
// ============================================================

function drawBotSprite(
  ctx: CanvasRenderingContext2D,
  bot: BotState,
  elapsed: number,
) {
  const cx = Math.round(bot.x);
  const cy = Math.round(bot.y);
  const dir = bot.facing;
  const frame = Math.floor(bot.walkFrame) % 4;
  const stepping = frame === 1 || frame === 3;
  const stepOffset = stepping ? (frame === 1 ? -1 : 1) : 0;

  // Drop shadow (ellipse under feet)
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 11, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Antenna
  ctx.fillStyle = "#9AA0AC";
  ctx.fillRect(cx - 1, cy - 14, 2, 3);

  // LED status — pulses except when offline
  const ledColor =
    bot.status === "active"
      ? C.ledActive
      : bot.status === "idle"
        ? C.ledIdle
        : C.ledOffline;
  const pulse = bot.status === "offline" ? 1 : 1 + Math.sin(elapsed * 5 + bot.walkPhase) * 0.4;
  const ledSize = Math.max(2, Math.round(2 * pulse));
  ctx.fillStyle = ledColor;
  ctx.fillRect(cx - 1, cy - 17, ledSize, ledSize);
  // LED glow
  if (bot.status !== "offline") {
    ctx.fillStyle = `${ledColor}55`;
    ctx.fillRect(cx - 3, cy - 18, 5, 4);
  }

  // Body palette derived from agent hue
  const jumpsuit = `hsl(${bot.hue}, 55%, 60%)`;
  const jumpsuitDark = `hsl(${bot.hue}, 55%, 42%)`;
  const jumpsuitLight = `hsl(${bot.hue}, 55%, 72%)`;

  // Body / torso (taller than v1)
  ctx.fillStyle = jumpsuit;
  ctx.fillRect(cx - 6, cy - 5, 12, 10);
  // Shading right side
  ctx.fillStyle = jumpsuitDark;
  ctx.fillRect(cx + 4, cy - 5, 2, 10);
  // Bottom shadow
  ctx.fillRect(cx - 6, cy + 4, 12, 1);
  // Belt
  ctx.fillStyle = "#1C1C28";
  ctx.fillRect(cx - 6, cy + 2, 12, 1);
  // Two buttons (jumpsuit detail)
  ctx.fillStyle = jumpsuitLight;
  ctx.fillRect(cx - 1, cy - 3, 1, 1);
  ctx.fillRect(cx - 1, cy, 1, 1);

  // Head (rounded rectangle)
  ctx.fillStyle = "#E8EDF3";
  ctx.fillRect(cx - 5, cy - 12, 10, 7);
  ctx.fillStyle = "#C0C8D2";
  ctx.fillRect(cx + 4, cy - 12, 1, 7);
  ctx.fillRect(cx - 5, cy - 5, 10, 1);
  // Top of head highlight
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(cx - 4, cy - 12, 6, 1);

  // Visor (changes per direction)
  ctx.fillStyle = "#0B1126";
  if (dir === "down") {
    ctx.fillRect(cx - 4, cy - 10, 8, 3);
    ctx.fillStyle = ledColor;
    ctx.fillRect(cx - 3, cy - 9, 1, 1);
    ctx.fillRect(cx + 2, cy - 9, 1, 1);
  } else if (dir === "up") {
    ctx.fillRect(cx - 4, cy - 9, 8, 2);
  } else if (dir === "left") {
    ctx.fillRect(cx - 4, cy - 10, 5, 3);
    ctx.fillStyle = ledColor;
    ctx.fillRect(cx - 3, cy - 9, 1, 1);
  } else {
    ctx.fillRect(cx - 1, cy - 10, 5, 3);
    ctx.fillStyle = ledColor;
    ctx.fillRect(cx + 2, cy - 9, 1, 1);
  }

  // Cohort badge (small chip on chest)
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(cx - 5, cy - 2, 3, 2);
  ctx.fillStyle = C.signText;
  ctx.fillRect(cx - 4, cy - 1, 1, 1);

  // Legs (4 frames walk cycle)
  ctx.fillStyle = jumpsuitDark;
  if (dir === "left" || dir === "right") {
    ctx.fillRect(cx - 4, cy + 5, 3, 4 + stepOffset);
    ctx.fillRect(cx + 1, cy + 5, 3, 4 - stepOffset);
  } else {
    if (stepping && frame === 1) {
      ctx.fillRect(cx - 4, cy + 5, 3, 5);
      ctx.fillRect(cx + 1, cy + 5, 3, 4);
    } else if (stepping && frame === 3) {
      ctx.fillRect(cx - 4, cy + 5, 3, 4);
      ctx.fillRect(cx + 1, cy + 5, 3, 5);
    } else {
      ctx.fillRect(cx - 4, cy + 5, 3, 4);
      ctx.fillRect(cx + 1, cy + 5, 3, 4);
    }
  }
  // Feet (boots)
  ctx.fillStyle = "#1C1C28";
  if (dir === "left" || dir === "right") {
    ctx.fillRect(cx - 4, cy + 9, 3, 1);
    ctx.fillRect(cx + 1, cy + 9, 3, 1);
  } else {
    ctx.fillRect(cx - 4, cy + 9, 3, 1);
    ctx.fillRect(cx + 1, cy + 9, 3, 1);
  }

  // Arms — animated typing motion when stationed+active, otherwise walk
  ctx.fillStyle = "#E8EDF3";
  if (bot.mode === "stationed" && bot.status === "active") {
    // Typing arms — both arms forward, bobbing rapidly
    const typing = Math.sin(bot.workPhase * 8) > 0 ? 0 : 1;
    if (dir === "up") {
      ctx.fillRect(cx - 7, cy - 2 + typing, 2, 3);
      ctx.fillRect(cx + 5, cy - 2 + (1 - typing), 2, 3);
    } else {
      ctx.fillRect(cx - 7, cy - 2 + typing, 2, 3);
      ctx.fillRect(cx + 5, cy - 2 + (1 - typing), 2, 3);
    }
  } else if (bot.mode === "walking") {
    // Walking arms swing
    if (dir === "down" || dir === "up") {
      ctx.fillRect(cx - 7, cy - 2 + (stepping ? stepOffset : 0), 2, 3);
      ctx.fillRect(cx + 5, cy - 2 - (stepping ? stepOffset : 0), 2, 3);
    } else if (dir === "left") {
      ctx.fillRect(cx - 7, cy - 1, 2, 3);
    } else {
      ctx.fillRect(cx + 5, cy - 1, 2, 3);
    }
  } else {
    // Stationed idle — arms hanging
    ctx.fillRect(cx - 7, cy - 1, 2, 3);
    ctx.fillRect(cx + 5, cy - 1, 2, 3);
  }

  // Crown for the leader bot (above antenna, slightly bobs)
  if (bot.isLeader) {
    const cby = cy - 19 + Math.sin(elapsed * 3) * 0.5;
    ctx.fillStyle = C.crownGoldDark;
    ctx.fillRect(cx - 4, Math.round(cby) + 2, 8, 2);
    ctx.fillStyle = C.crownGold;
    ctx.fillRect(cx - 4, Math.round(cby), 2, 3);
    ctx.fillRect(cx - 1, Math.round(cby) - 1, 2, 4);
    ctx.fillRect(cx + 2, Math.round(cby), 2, 3);
    // Sparkle
    if (Math.floor(elapsed * 4) % 6 === 0) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(cx + 5, Math.round(cby) - 1, 1, 1);
    }
  }
}

// ============================================================
// SPEECH BUBBLE — pixel-art style, above bot
// ============================================================

function drawBubble(ctx: CanvasRenderingContext2D, bot: BotState, text: string) {
  const txt = text.length > 22 ? text.slice(0, 21) + "…" : text;
  ctx.font = "9px monospace";
  const padding = 4;
  const tw = ctx.measureText(txt).width;
  const bw = Math.max(50, tw + padding * 2);
  const bh = 16;
  const bx = Math.round(bot.x - bw / 2);
  const by = Math.round(bot.y - 34);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(bx + 1, by + 1, bw, bh);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#1C1C28";
  ctx.fillRect(bx, by, bw, 1);
  ctx.fillRect(bx, by + bh - 1, bw, 1);
  ctx.fillRect(bx, by, 1, bh);
  ctx.fillRect(bx + bw - 1, by, 1, bh);
  ctx.fillRect(bx + bw / 2 - 1, by + bh, 2, 2);
  ctx.fillRect(bx + bw / 2, by + bh + 2, 1, 1);
  ctx.fillStyle = "#1C1C28";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, bx + padding, by + bh / 2 + 1);
}

// ============================================================
// HEATMAP overlay
// ============================================================

function drawHeatmap(ctx: CanvasRenderingContext2D, bots: BotState[]) {
  const active = new Set(
    bots
      .filter((b) => b.status === "active" && b.mode === "stationed")
      .map((b) => b.occupiesZone)
      .filter((id): id is string => Boolean(id)),
  );
  const idle = new Set(
    bots
      .filter((b) => b.status === "idle" && b.mode === "stationed")
      .map((b) => b.occupiesZone)
      .filter((id): id is string => Boolean(id)),
  );
  const off = new Set(
    bots
      .filter((b) => b.status === "offline" && b.mode === "stationed")
      .map((b) => b.occupiesZone)
      .filter((id): id is string => Boolean(id)),
  );
  for (const z of ALL_ZONES) {
    let color: string | null = null;
    if (active.has(z.id)) color = C.heatActive;
    else if (idle.has(z.id)) color = C.heatIdle;
    else if (off.has(z.id)) color = C.heatOffline;
    if (!color) continue;
    ctx.fillStyle = color;
    ctx.fillRect(z.col * TILE_SIZE, z.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }
}

// ============================================================
// PARTICLES — coffee steam + ambient dust
// ============================================================

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  kind: "steam" | "dust" | "code";
  hue: number;
}

function spawnSteam(particles: Particle[], elapsed: number) {
  // Spawn from kitchen counter location every ~1.5s
  if (Math.floor(elapsed * 0.6) % 2 === 0 && Math.random() < 0.15) {
    for (let i = 0; i < 2; i++) {
      particles.push({
        x: 44 * TILE_SIZE + 6 + Math.random() * 8,
        y: 6 * TILE_SIZE + 4,
        vx: (Math.random() - 0.5) * 0.2,
        vy: -0.3 - Math.random() * 0.2,
        life: 0,
        maxLife: 1.6 + Math.random() * 0.5,
        kind: "steam",
        hue: 0,
      });
    }
  }
}

function spawnDust(particles: Particle[]) {
  if (Math.random() < 0.05 && particles.length < 60) {
    particles.push({
      x: Math.random() * MAP_COLS * TILE_SIZE,
      y: 4 + Math.random() * 60,
      vx: (Math.random() - 0.5) * 0.1,
      vy: 0.08 + Math.random() * 0.04,
      life: 0,
      maxLife: 6 + Math.random() * 4,
      kind: "dust",
      hue: 0,
    });
  }
}

function spawnCodeParticle(particles: Particle[], bot: BotState) {
  // Tiny coloured pixels fly from active bot toward the desk monitor
  if (Math.random() < 0.2) {
    particles.push({
      x: bot.x + (Math.random() - 0.5) * 4,
      y: bot.y - 8,
      vx: 0,
      vy: -0.6 - Math.random() * 0.3,
      life: 0,
      maxLife: 0.7,
      kind: "code",
      hue: bot.hue,
    });
  }
}

function tickParticles(particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (!p) continue;
    p.x += p.vx;
    p.y += p.vy;
    p.life += dt;
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    const t = p.life / p.maxLife;
    const alpha = (1 - t) * 0.7;
    if (p.kind === "steam") {
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      const r = 1 + t * 2;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.max(1, Math.round(r)), Math.max(1, Math.round(r)));
    } else if (p.kind === "dust") {
      ctx.fillStyle = `rgba(255, 246, 224, ${(alpha * 0.5).toFixed(3)})`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    } else {
      ctx.fillStyle = `hsla(${p.hue}, 80%, 60%, ${alpha.toFixed(3)})`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
  }
}

// ============================================================
// DAYLIGHT — soft overlay tint that cycles slowly (warmer noon,
// cooler evening). Adds atmosphere without changing rendered colours
// dramatically. Cycles every ~120s in dev so users see it change.
// ============================================================

function drawDaylightOverlay(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  width: number,
  height: number,
) {
  // 120s full cycle. 0 = noon (warm), 0.5 = sunset (orange), 1 = evening (cool blue)
  const cycle = (elapsed / 120) % 1;
  const r = Math.round(255 - cycle * 60);
  const g = Math.round(245 - cycle * 80);
  const b = Math.round(220 - cycle * 20 + Math.sin(cycle * Math.PI) * 30);
  const alpha = 0.08 + Math.abs(cycle - 0.5) * 0.04;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
}

// ============================================================
// BOT TICK
// ============================================================

const WALK_SPEED_PX_PER_SEC = 36;

function tickBot(bot: BotState, dt: number) {
  if (bot.mode === "stationed") {
    if (bot.status === "active") {
      bot.workPhase += dt * 4;
      bot.walkFrame = (Math.sin(bot.workPhase) + 1) * 1.5;
    } else {
      bot.walkFrame = 0;
    }
    return;
  }
  // Walking — follow path waypoints
  if (bot.path.length === 0 || bot.pathIndex >= bot.path.length) {
    bot.mode = "stationed";
    bot.walkFrame = 0;
    return;
  }
  const next = bot.path[bot.pathIndex];
  if (!next) {
    bot.mode = "stationed";
    return;
  }
  const target = tileToPx(next.col, next.row);
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1.5) {
    bot.x = target.x;
    bot.y = target.y;
    bot.pathIndex++;
    if (bot.pathIndex >= bot.path.length) {
      bot.mode = "stationed";
      bot.walkFrame = 0;
    }
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    bot.facing = dx > 0 ? "right" : "left";
    bot.x += Math.sign(dx) * Math.min(Math.abs(dx), WALK_SPEED_PX_PER_SEC * dt);
  } else {
    bot.facing = dy > 0 ? "down" : "up";
    bot.y += Math.sign(dy) * Math.min(Math.abs(dy), WALK_SPEED_PX_PER_SEC * dt);
  }
  bot.walkPhase += dt;
  bot.walkFrame = (bot.walkPhase * 6) % 4;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

interface CohortStation2DProps {
  agentStatuses: AgentRuntimeStatus[];
  onAgentClick?: (agentId: string) => void;
}

interface Scores {
  tasksReached: number;
  coffeeBreaks: number;
  pingMatches: number;
}

export function CohortStation2D({
  agentStatuses,
  onAgentClick,
}: CohortStation2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const botsRef = useRef<BotState[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const hoverRef = useRef<string | null>(null);
  const scoresRef = useRef<Scores>({
    tasksReached: 0,
    coffeeBreaks: 0,
    pingMatches: 0,
  });
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [scoresView, setScoresView] = useState<Scores>({
    tasksReached: 0,
    coffeeBreaks: 0,
    pingMatches: 0,
  });
  const [viewportSize, setViewportSize] = useState({
    width: MAP_COLS * TILE_SIZE,
    height: MAP_ROWS * TILE_SIZE,
  });

  // Stats (computed for the header)
  const stats = useMemo(() => {
    const active = agentStatuses.filter((a) => a.status === "active").length;
    const idle = agentStatuses.filter((a) => a.status === "idle").length;
    const offline = agentStatuses.filter((a) => a.status === "offline").length;
    return { active, idle, offline };
  }, [agentStatuses]);

  // Compute the leader bot (most active tasks). Memoised so we don't
  // re-rank every frame.
  const leaderId = useMemo(() => {
    let max = -1;
    let id: string | null = null;
    for (const a of agentStatuses) {
      if (a.activeTaskCount > max) {
        max = a.activeTaskCount;
        id = a.agentId;
      }
    }
    return max > 0 ? id : null;
  }, [agentStatuses]);

  // Init / sync bot pool. Existing bots reuse their position; new bots
  // start at the centre dock area and walk to their zone via A*.
  useEffect(() => {
    const existing = new Map(botsRef.current.map((b) => [b.agentId, b]));
    const slice = agentStatuses.slice(0, 15);
    const taken = new Set<string>();

    // First pass — reuse existing zone if status unchanged.
    const reuse: Map<string, BotState> = new Map();
    for (const agent of slice) {
      const prior = existing.get(agent.agentId);
      if (prior && prior.status === agent.status && prior.occupiesZone) {
        taken.add(prior.occupiesZone);
        reuse.set(agent.agentId, prior);
      }
    }

    // Second pass — build new bot list, reusing or repicking.
    const next: BotState[] = slice.map((agent) => {
      const r = reuse.get(agent.agentId);
      if (r) {
        return {
          ...r,
          status: agent.status,
          currentTaskTitle: agent.currentTaskTitle,
          activeTaskCount: agent.activeTaskCount,
          isLeader: leaderId === agent.agentId,
        };
      }
      const prior = existing.get(agent.agentId);
      const startX = prior?.x ?? 24 * TILE_SIZE;
      const startY = prior?.y ?? 4 * TILE_SIZE;
      const bot: BotState = {
        agentId: agent.agentId,
        name: agent.name,
        status: agent.status,
        currentTaskTitle: agent.currentTaskTitle,
        activeTaskCount: agent.activeTaskCount,
        x: startX,
        y: startY,
        path: [],
        pathIndex: 0,
        facing: "down",
        mode: "walking",
        walkFrame: 0,
        walkPhase: Math.random() * Math.PI * 2,
        hue: hashHue(agent.agentId),
        bubbleUntil: 0,
        occupiesZone: null,
        workPhase: Math.random() * Math.PI * 2,
        isLeader: leaderId === agent.agentId,
      };
      const zone = pickZoneFor(bot, taken);
      if (zone) {
        bot.occupiesZone = zone.id;
        bot.facing = zone.facing;
        taken.add(zone.id);
        // Compute path
        const start = pxToTile(bot.x, bot.y);
        bot.path = aStar(start, { col: zone.col, row: zone.row });
        if (bot.path.length === 0) {
          // No path found — snap to zone
          const target = tileToPx(zone.col, zone.row);
          bot.x = target.x;
          bot.y = target.y;
          bot.mode = "stationed";
        } else {
          bot.mode = "walking";
        }
      }
      return bot;
    });

    botsRef.current = next;
  }, [agentStatuses, leaderId]);

  // Resize observer for responsive canvas (CSS width drives logical width)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          // Maintain map aspect ratio; height derived from width
          const ratio = (MAP_ROWS * TILE_SIZE) / (MAP_COLS * TILE_SIZE);
          setViewportSize({
            width: Math.floor(w),
            height: Math.floor(w * ratio),
          });
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Render + tick loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastTs = performance.now();
    const startedAt = performance.now();

    const W_LOGICAL = MAP_COLS * TILE_SIZE;
    const H_LOGICAL = MAP_ROWS * TILE_SIZE;

    const tick = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const elapsed = (ts - startedAt) / 1000;

      // Update bots & particles
      for (const bot of botsRef.current) {
        tickBot(bot, dt);
        if (
          bot.status === "active" &&
          bot.mode === "stationed" &&
          bot.currentTaskTitle &&
          bot.bubbleUntil < ts &&
          Math.random() < 0.005
        ) {
          bot.bubbleUntil = ts + 3500;
        }
        // Spawn code particles for active stationed bots
        if (bot.mode === "stationed" && bot.status === "active") {
          spawnCodeParticle(particlesRef.current, bot);
        }
      }
      spawnSteam(particlesRef.current, elapsed);
      spawnDust(particlesRef.current);
      tickParticles(particlesRef.current, dt);

      // Update scoresView once per second (avoid React re-renders on every frame)
      if (Math.floor(elapsed) !== Math.floor(elapsed - dt)) {
        // Tick: count stationed bots per kind
        const sBots = botsRef.current.filter((b) => b.mode === "stationed");
        scoresRef.current.tasksReached = sBots.filter(
          (b) => b.status === "active" && b.occupiesZone?.startsWith("ws-"),
        ).length;
        scoresRef.current.coffeeBreaks = sBots.filter((b) =>
          b.occupiesZone?.startsWith("cf-"),
        ).length;
        scoresRef.current.pingMatches = Math.floor(
          sBots.filter((b) => b.occupiesZone?.startsWith("pp-")).length / 2,
        );
        setScoresView({ ...scoresRef.current });
      }

      // ===== RENDER =====
      ctx.imageSmoothingEnabled = false;

      // Clear with the wood-coloured outer background
      ctx.fillStyle = "#3C3221";
      ctx.fillRect(0, 0, W_LOGICAL, H_LOGICAL);

      // Pass 1 — base tiles
      const haloPhase = elapsed * 2;
      const codeOffset = Math.floor(elapsed * 5);
      for (let row = 0; row < MAP_ROWS; row++) {
        for (let col = 0; col < MAP_COLS; col++) {
          const t = tileAt(col, row);
          switch (t) {
            case ".":
              drawFloor(ctx, col, row);
              break;
            case "c":
              drawCarpet(ctx, col, row);
              break;
            case "#":
              drawWall(ctx, col, row);
              break;
            case "~":
              drawGlass(ctx, col, row);
              break;
            case "W":
              drawWorkstation(ctx, col, row, codeOffset);
              break;
            case "S":
              drawSofa(ctx, col, row);
              break;
            case "L":
              drawLowTable(ctx, col, row);
              break;
            case "C":
              drawCafeCounter(ctx, col, row);
              break;
            case "K":
              drawKitchenCounter(ctx, col, row);
              break;
            case "P":
              drawPingPong(ctx, col, row);
              break;
            case "D":
              drawDock(ctx, col, row, haloPhase);
              break;
            case "p":
              drawPlant(ctx, col, row);
              break;
            case "w":
              drawWater(ctx, col, row);
              break;
            case "B":
              drawSignBg(ctx, col, row, haloPhase);
              break;
          }
        }
      }

      // BRAIKE sign text
      ctx.fillStyle = C.signText;
      ctx.font = "bold 16px monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const signY = 1 * TILE_SIZE + TILE_SIZE / 2;
      ctx.fillText("COHORT  STATION  —  ", W_LOGICAL / 2 - 10, signY);
      ctx.fillStyle = C.signAccent;
      ctx.fillText("BRAIKE", W_LOGICAL / 2 + 110, signY);
      ctx.textAlign = "left";

      // Heatmap
      drawHeatmap(ctx, botsRef.current);

      // Bots (sorted by Y)
      const sorted = [...botsRef.current].sort((a, b) => a.y - b.y);
      for (const bot of sorted) {
        if (hoverRef.current === bot.agentId) {
          ctx.strokeStyle = C.signText;
          ctx.lineWidth = 1;
          ctx.strokeRect(
            Math.round(bot.x - 8),
            Math.round(bot.y - 14),
            16,
            26,
          );
        }
        drawBotSprite(ctx, bot, elapsed);
        if (bot.bubbleUntil > ts && bot.currentTaskTitle) {
          drawBubble(ctx, bot, bot.currentTaskTitle);
        }
      }

      // Particles last (over the world)
      drawParticles(ctx, particlesRef.current);

      // Daylight overlay
      drawDaylightOverlay(ctx, elapsed, W_LOGICAL, H_LOGICAL);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Mouse picking — bots and zones. Click on empty floor = send nearest
  // bot there (a brief detour). Click on bot = navigate to agent.
  const pickBot = useCallback(
    (lx: number, ly: number): BotState | null => {
      const sorted = [...botsRef.current].sort((a, b) => b.y - a.y);
      for (const bot of sorted) {
        if (Math.abs(lx - bot.x) <= 8 && ly >= bot.y - 14 && ly <= bot.y + 12) {
          return bot;
        }
      }
      return null;
    },
    [],
  );

  const clientToLogical = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return null;
      const x = ((clientX - rect.left) / rect.width) * (MAP_COLS * TILE_SIZE);
      const y = ((clientY - rect.top) / rect.height) * (MAP_ROWS * TILE_SIZE);
      return { x, y };
    },
    [],
  );

  function onCanvasMove(evt: React.MouseEvent<HTMLCanvasElement>) {
    const log = clientToLogical(evt.clientX, evt.clientY);
    if (!log) return;
    const bot = pickBot(log.x, log.y);
    const next = bot?.agentId ?? null;
    if (hoverRef.current !== next) {
      hoverRef.current = next;
      setHoverName(bot?.name ?? null);
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = bot ? "pointer" : "crosshair";
    }
  }

  function onCanvasClick(evt: React.MouseEvent<HTMLCanvasElement>) {
    const log = clientToLogical(evt.clientX, evt.clientY);
    if (!log) return;
    const bot = pickBot(log.x, log.y);
    if (bot && onAgentClick) {
      onAgentClick(bot.agentId);
      return;
    }
    // Empty floor click — send the nearest idle bot for a quick detour.
    const target = pxToTile(log.x, log.y);
    if (!isWalkable(target.col, target.row)) return;
    let nearest: BotState | null = null;
    let minDist = Infinity;
    for (const b of botsRef.current) {
      if (b.status === "offline") continue;
      const d = Math.hypot(b.x - log.x, b.y - log.y);
      if (d < minDist) {
        minDist = d;
        nearest = b;
      }
    }
    if (!nearest) return;
    const start = pxToTile(nearest.x, nearest.y);
    const path = aStar(start, target);
    if (path.length === 0) return;
    nearest.path = path;
    nearest.pathIndex = 0;
    nearest.mode = "walking";
    // After 8 seconds, send the bot back to its zone
    const back = nearest;
    const backZone = ALL_ZONES.find((z) => z.id === back.occupiesZone);
    if (backZone) {
      setTimeout(() => {
        const reBack = botsRef.current.find((b) => b.agentId === back.agentId);
        if (!reBack || reBack.mode !== "stationed") return;
        const s = pxToTile(reBack.x, reBack.y);
        const p = aStar(s, { col: backZone.col, row: backZone.row });
        if (p.length > 0) {
          reBack.path = p;
          reBack.pathIndex = 0;
          reBack.mode = "walking";
        }
      }, 8000);
    }
  }

  return (
    <div className="relative w-full">
      {/* Scores bar */}
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#10B981]" />
          {stats.active} working
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
          {stats.idle} idle
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#94A3B8]" />
          {stats.offline} offline
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-3 text-[11px]">
          <span>
            ⌨ <strong className="text-foreground tabular-nums">{scoresView.tasksReached}</strong> tasks at desks
          </span>
          <span>
            ☕ <strong className="text-foreground tabular-nums">{scoresView.coffeeBreaks}</strong> coffee breaks
          </span>
          <span>
            🏓 <strong className="text-foreground tabular-nums">{scoresView.pingMatches}</strong> ping matches
          </span>
        </span>
      </div>

      {/* Canvas wrapper — responsive aspect-ratio container */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden bg-[#3C3221]"
        style={{ aspectRatio: `${MAP_COLS} / ${MAP_ROWS}` }}
      >
        <canvas
          ref={canvasRef}
          width={MAP_COLS * TILE_SIZE}
          height={MAP_ROWS * TILE_SIZE}
          style={{
            position: "absolute",
            inset: 0,
            width: viewportSize.width,
            height: viewportSize.height,
            imageRendering: "pixelated",
          }}
          onMouseMove={onCanvasMove}
          onMouseLeave={() => {
            hoverRef.current = null;
            setHoverName(null);
            const c = canvasRef.current;
            if (c) c.style.cursor = "default";
          }}
          onClick={onCanvasClick}
        />
        {hoverName && (
          <div className="absolute bottom-2 left-2 rounded-md bg-card/95 px-2 py-1 text-[11px] font-medium text-foreground shadow ring-1 ring-foreground/10">
            {hoverName.replace(/^Agent\s*/i, "")}
          </div>
        )}
      </div>

      <p className="px-4 py-2 text-[10px] text-muted-foreground">
        Click a bot to open its agent page · Click empty floor to send the
        nearest bot there · Crown = most active agent · Heatmap shows zone
        activity
      </p>
    </div>
  );
}
