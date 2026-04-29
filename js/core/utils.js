/* ============================================================================
 * utils.js
 * ----------------------------------------------------------------------------
 * Foundational geometry primitives and small helpers used everywhere else.
 *
 * WHY THIS FILE EXISTS:
 *   The simulation is fundamentally a geometric system: roads are line
 *   segments, cars have positions and angles, intersections are circles.
 *   Centralising the vector math here means the rest of the codebase reads
 *   `add(a, b)` and `distance(p, q)` instead of inlining `Math.hypot(...)`
 *   everywhere.
 *
 * WHO CALLS THIS:
 *   Everything. This file is loaded first (see index.html) so its globals
 *   are available to all subsequent classes.
 *
 * KEY EXPORTS:
 *   Point                  — { x, y } with equals/clone
 *   add/subtract/scale     — vector arithmetic returning new Points
 *   dot/cross              — vector products (cross is the 2D scalar form)
 *   magnitude/normalize    — length and unit vector
 *   perpendicular          — 90° anticlockwise rotation, used for lane offsets
 *   distance               — Euclidean distance between Points
 *   lerp/lerp2D/clamp/smoothstep — interpolation helpers
 *   angleOf/angleDiff      — vector-to-angle and angular difference (-π..π)
 *   segmentIntersect /
 *     segmentsIntersect    — line-segment crossing tests (for road editing)
 * ============================================================================ */

class Point {
   constructor(x, y) { this.x = x; this.y = y; }
   equals(p) { return this.x === p.x && this.y === p.y; }
   clone()   { return new Point(this.x, this.y); }
}

function add(a, b)        { return new Point(a.x + b.x, a.y + b.y); }
function subtract(a, b)   { return new Point(a.x - b.x, a.y - b.y); }
function scale(p, s)      { return new Point(p.x * s, p.y * s); }
function dot(a, b)        { return a.x * b.x + a.y * b.y; }
function cross(a, b)      { return a.x * b.y - a.y * b.x; }
function magnitude(p)     { return Math.hypot(p.x, p.y); }
function normalize(p)     { const m = magnitude(p); return m < 1e-9 ? new Point(0, 0) : scale(p, 1 / m); }
function perpendicular(p) { return new Point(-p.y, p.x); }   // 90° anticlockwise
function distance(a, b)   { return Math.hypot(a.x - b.x, a.y - b.y); }
function average(a, b)    { return new Point((a.x + b.x) / 2, (a.y + b.y) / 2); }

function lerp(a, b, t)    { return a + (b - a) * t; }
function lerp2D(a, b, t)  { return new Point(lerp(a.x, b.x, t), lerp(a.y, b.y, t)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function smoothstep(t)    { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

/** Angle of vector p in radians, atan2-based (range -π..π). */
function angleOf(p) { return Math.atan2(p.y, p.x); }
/** Shortest signed angular distance from b to a, normalised to (-π..π). */
function angleDiff(a, b) {
   let d = a - b;
   while (d >  Math.PI) d -= 2 * Math.PI;
   while (d < -Math.PI) d += 2 * Math.PI;
   return d;
}

function segmentIntersect(A, B, C, D) {
   const dx1 = B.x - A.x, dy1 = B.y - A.y;
   const dx2 = D.x - C.x, dy2 = D.y - C.y;
   const denom = dx1 * dy2 - dy1 * dx2;
   if (Math.abs(denom) < 1e-9) return null;

   const t = ((C.x - A.x) * dy2 - (C.y - A.y) * dx2) / denom;
   const u = ((C.x - A.x) * dy1 - (C.y - A.y) * dx1) / denom;
   if (t < 0 || t > 1 || u < 0 || u > 1) return null;

   return { x: A.x + t * dx1, y: A.y + t * dy1, t, u };
}

function projectOnSegment(A, B, P) {
   const ab = subtract(B, A);
   const ap = subtract(P, A);
   const lenSq = dot(ab, ab);
   if (lenSq < 1e-9) return { point: A.clone(), t: 0 };
   const t = dot(ap, ab) / lenSq;
   return { point: add(A, scale(ab, t)), t };
}

function nearestOnSegment(A, B, P) {
   const { point, t } = projectOnSegment(A, B, P);
   if (t < 0) return { point: A.clone(), t: 0 };
   if (t > 1) return { point: B.clone(), t: 1 };
   return { point, t };
}

function nearestOf(items, distFn) {
   let best = null, bestD = Infinity;
   for (const item of items) {
      const d = distFn(item);
      if (d < bestD) { bestD = d; best = item; }
   }
   return { item: best, dist: bestD };
}

function segmentsIntersect(a, b, c, d) {
   const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
   const x3 = c.x, y3 = c.y, x4 = d.x, y4 = d.y;
   const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
   if (Math.abs(denom) < 1e-9) return false;
   const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
   const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom;
   return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
