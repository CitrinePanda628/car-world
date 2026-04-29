/* ============================================================================
 * road.js
 * ----------------------------------------------------------------------------
 * Defines the Road and Lane classes — the spatial backbone of the simulation.
 *
 * WHY THIS FILE EXISTS:
 *   Cars don't drive on free 2D space; they drive on lanes. A Road is a pair
 *   of endpoints (start, end) plus metadata (forward/reverse lane counts,
 *   speed limit, closed state). When constructed, a Road generates one Lane
 *   object per lane the road has. Each Lane is a parametric line segment
 *   that knows its own length, direction unit vector, and lateral offset
 *   from the road centreline, so cars can ask `lane.pointAtDistance(d)` and
 *   get a world-coordinate point.
 *
 * KEY CONCEPTS:
 *   - Road has `lanesForward` lanes in the +1 direction and `lanesReverse`
 *     lanes in the -1 direction. Forward = start->end, reverse = end->start
 *   - Lane.index is 0-based from the centreline outward. Lane.id is
 *     "<roadId>:<direction>:<index>" — a stable identifier used in debug
 *     output, scenarios, and editor wiring
 *   - Road.startConn / endConn point at IntersectionConnection objects when
 *     the road end is wired into an intersection. null = dead-end
 *   - LANE_WIDTH = 30 px is the canonical lane width used everywhere for
 *     road rendering, intersection geometry, and lateral offset math
 *
 * UK CONVENTION:
 *   In this codebase lanes drive on the LEFT — but the user requested a
 *   flipped (right-driving) layout for visual clarity. The convention shows
 *   up in `Lane.allowedExits()` which decides which exits a lane may take
 *   from a junction (left-most lane gets to turn left, right-most gets to
 *   turn right, etc.).
 *
 * WHO CALLS THIS:
 *   - Scenarios construct Roads directly with `new Road(...)`
 *   - RoadEditor instantiates roads when the user clicks/drags
 *   - Cars hold references to Lane objects in this.lane
 *   - Intersection.connect(road, end) sets road.startConn/endConn
 * ============================================================================ */

const LANE_WIDTH = 30;   // Canonical lane width in world pixels.

class Road {
   /**
    * @param {Point} start  start endpoint in world coords
    * @param {Point} end    end endpoint in world coords
    * @param {object} opts  lanesForward, lanesReverse, roadClass, speedLimit,
    *                       closed, singleTrack, mergeTarget
    */
   constructor(start, end, opts = {}) {
      this.id           = Road.nextId++;
      this.start        = start;
      this.end          = end;
      this.lanesForward = opts.lanesForward ?? 1;
      this.lanesReverse = opts.lanesReverse ?? 1;
      this.roadClass    = opts.roadClass    ?? 'normal';
      this.speedLimit   = opts.speedLimit   ?? (this.roadClass === 'highway' ? 3.0 : 1.5);
      this.closed       = opts.closed       ?? false;
      this.singleTrack  = opts.singleTrack  ?? false;

      // For motorway slip roads: { intoRoad, projectFrom, projectTo }.
      // Tells the merge logic which mainline lane to merge into.
      this.mergeTarget = opts.mergeTarget ?? null;

      // Filled in by Intersection.connect() when this road's end is wired
      // into a junction. null = dead-end at that side.
      this.startConn = null;
      this.endConn   = null;

      this._rebuild();
   }

   static nextId = 1;

   /**
    * Recompute geometry: direction unit vector, leftward perpendicular
    * (used for lane offsets), and per-lane Lane objects. Called from
    * the constructor and again when the editor mutates start/end.
    */
   _rebuild() {
      const s = this.start, e = this.end;
      const len = distance(s, e);
      if (len < 1) { this.lanes = []; this.dir = new Point(1, 0); this.leftPerp = new Point(0, -1); return; }


      this.dir      = normalize(subtract(e, s));
      this.leftPerp = new Point(this.dir.y, -this.dir.x);
      this.length   = len;

      const totalLanes = this.lanesForward + this.lanesReverse;
      const rebuild = !this.lanes || this.lanes.length !== totalLanes;

      let staleLanes = null;
      if (rebuild && this.lanes && this.lanes.length > 0) {
         staleLanes = this.lanes;
      }

      if (rebuild) this.lanes = [];

      const revDir = scale(this.dir, -1);
      let idx = 0;

      for (let i = 0; i < this.lanesForward; i++) {
         const offset = (i + 0.5) * LANE_WIDTH;
         const shift  = scale(this.leftPerp, offset);
         const p1 = add(s, shift), p2 = add(e, shift);
         if (rebuild) {
            this.lanes.push(new Lane({
               road: this, direction: +1, index: i,
               p1, p2, dir: this.dir,
            }));
         } else {
            const lane = this.lanes[idx];
            lane.p1 = p1; lane.p2 = p2;
            lane.dir = this.dir;
            lane.length = distance(p1, p2);
            lane.direction = +1; lane.index = i;
         }
         idx++;
      }
      for (let i = 0; i < this.lanesReverse; i++) {
         const offset = (i + 0.5) * LANE_WIDTH;
         const shift  = scale(this.leftPerp, -offset);
         const p1 = add(e, shift), p2 = add(s, shift);
         if (rebuild) {
            this.lanes.push(new Lane({
               road: this, direction: -1, index: i,
               p1, p2, dir: revDir,
            }));
         } else {
            const lane = this.lanes[idx];
            lane.p1 = p1; lane.p2 = p2;
            lane.dir = revDir;
            lane.length = distance(p1, p2);
            lane.direction = -1; lane.index = i;
         }
         idx++;
      }

      if (staleLanes && this.onLanesReplaced) {
         this.onLanesReplaced(staleLanes, this.lanes);
      }
   }

   
   get halfWidth() {
      return Math.max(this.lanesForward, 1) * LANE_WIDTH
           + (this.lanesReverse > 0 ? this.lanesReverse * LANE_WIDTH : 0) / 2
           - (this.lanesReverse > 0 ? 0 : LANE_WIDTH / 2)
           + LANE_WIDTH / 2;
      
   }

   
   get leftKerb() {
      const off = this.lanesForward * LANE_WIDTH;
      const sh  = scale(this.leftPerp, off);
      return { p1: add(this.start, sh), p2: add(this.end, sh) };
   }
   get rightKerb() {
      const off = Math.max(this.lanesReverse, 1) * LANE_WIDTH;
      const sh  = scale(this.leftPerp, -off);
      return { p1: add(this.start, sh), p2: add(this.end, sh) };
   }

   
   update(opts) {
      if (opts.start        !== undefined) this.start = opts.start;
      if (opts.end          !== undefined) this.end   = opts.end;
      if (opts.lanesForward !== undefined) this.lanesForward = opts.lanesForward;
      if (opts.lanesReverse !== undefined) this.lanesReverse = opts.lanesReverse;
      if (opts.roadClass    !== undefined) this.roadClass    = opts.roadClass;
      if (opts.speedLimit   !== undefined) this.speedLimit   = opts.speedLimit;
      if (opts.closed       !== undefined) this.closed       = opts.closed;
      if (opts.singleTrack  !== undefined) this.singleTrack  = opts.singleTrack;
      this._rebuild();
      if (this.startConn) this.startConn.intersection.roadUpdated(this);
      if (this.endConn)   this.endConn.intersection.roadUpdated(this);
      if (this.onUpdated) this.onUpdated();
   }

   toJSON() {
      return {
         id: this.id,
         start: { x: this.start.x, y: this.start.y },
         end:   { x: this.end.x,   y: this.end.y   },
         lanesForward: this.lanesForward,
         lanesReverse: this.lanesReverse,
         roadClass:    this.roadClass,
         speedLimit:   this.speedLimit,
         closed:       this.closed,
         singleTrack:  this.singleTrack,
      };
   }

   static fromJSON(data) {
      const r = new Road(new Point(data.start.x, data.start.y),
                         new Point(data.end.x,   data.end.y), data);
      r.id = data.id;
      Road.nextId = Math.max(Road.nextId, data.id + 1);
      return r;
   }

   
   draw(ctx) {
      if (this.length < 1) return;

      const lk = this.leftKerb, rk = this.rightKerb;
      const isHighway = this.roadClass === 'highway';

      ctx.fillStyle = this.closed ? '#4a2a2a' : (isHighway ? '#2c2c30' : '#3a3a3a');
      ctx.beginPath();
      ctx.moveTo(lk.p1.x, lk.p1.y);
      ctx.lineTo(lk.p2.x, lk.p2.y);
      ctx.lineTo(rk.p2.x, rk.p2.y);
      ctx.lineTo(rk.p1.x, rk.p1.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isHighway ? '#fff' : '#e8e8e8';
      ctx.lineWidth = isHighway ? 3 : 2;
      if (this.singleTrack) ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(lk.p1.x, lk.p1.y); ctx.lineTo(lk.p2.x, lk.p2.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rk.p1.x, rk.p1.y); ctx.lineTo(rk.p2.x, rk.p2.y); ctx.stroke();
      ctx.setLineDash([]);

      if (isHighway && this.lanesForward > 0 && this.lanesReverse > 0) {
         const off = 1.5;
         const lp = this.leftPerp;
         const a1 = add(this.start, scale(lp,  off));
         const a2 = add(this.end,   scale(lp,  off));
         const b1 = add(this.start, scale(lp, -off));
         const b2 = add(this.end,   scale(lp, -off));
         ctx.fillStyle = '#cccccc';
         ctx.beginPath();
         ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y);
         ctx.lineTo(b2.x, b2.y); ctx.lineTo(b1.x, b1.y); ctx.closePath();
         ctx.fill();
      } else if (this.lanesReverse > 0 && !this.singleTrack) {
         ctx.strokeStyle = '#ffcc00';
         ctx.lineWidth = 2;
         ctx.setLineDash([]);
         ctx.beginPath();
         ctx.moveTo(this.start.x, this.start.y);
         ctx.lineTo(this.end.x,   this.end.y);
         ctx.stroke();
      }

      if (!this.singleTrack) {
         ctx.strokeStyle = '#dddddd';
         ctx.lineWidth = 1.5;
         ctx.setLineDash([14, 10]);
         for (let i = 1; i < this.lanesForward; i++) {
            const off = i * LANE_WIDTH;
            const sh = scale(this.leftPerp, off);
            const p1 = add(this.start, sh), p2 = add(this.end, sh);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
         }
         for (let i = 1; i < this.lanesReverse; i++) {
            const off = i * LANE_WIDTH;
            const sh = scale(this.leftPerp, -off);
            const p1 = add(this.start, sh), p2 = add(this.end, sh);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
         }
         ctx.setLineDash([]);
      } else {
         ctx.fillStyle = 'rgba(120, 90, 50, 0.18)';
         ctx.beginPath();
         ctx.moveTo(lk.p1.x, lk.p1.y);
         ctx.lineTo(lk.p2.x, lk.p2.y);
         ctx.lineTo(rk.p2.x, rk.p2.y);
         ctx.lineTo(rk.p1.x, rk.p1.y);
         ctx.closePath();
         ctx.fill();
      }

      
      if (this.closed) {
         ctx.save();
         ctx.strokeStyle = 'rgba(220, 50, 50, 0.6)';
         ctx.lineWidth = 3;
         ctx.setLineDash([8, 6]);
         ctx.beginPath();
         ctx.moveTo(lk.p1.x, lk.p1.y); ctx.lineTo(rk.p2.x, rk.p2.y);
         ctx.moveTo(rk.p1.x, rk.p1.y); ctx.lineTo(lk.p2.x, lk.p2.y);
         ctx.stroke();
         ctx.restore();
      }
   }

   drawEndpoints(ctx, selected = false) {
      for (const p of [this.start, this.end]) {
         ctx.beginPath();
         ctx.fillStyle = selected ? '#ffcc00' : '#66ccff';
         ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
         ctx.fill();
         ctx.strokeStyle = '#000';
         ctx.lineWidth = 1.5;
         ctx.stroke();
      }
   }
}

/**
 * Lane is a one-way line segment within a Road. Cars drive ONLY along
 * Lane objects, not Roads — a Road is just the conceptual container.
 *
 * Coordinates:
 *   - p1   start point of this lane (where cars in this direction enter)
 *   - p2   end   point (where cars in this direction leave)
 *   - dir  unit vector p1->p2
 *   - length  cached scalar distance(p1, p2)
 *
 * The lane id "<roadId>:<direction>:<index>" is stable across saves and
 * matches the IDs in the debug-export snapshots.
 */
class Lane {
   constructor({ road, direction, index, p1, p2, dir }) {
      this.road      = road;
      this.direction = direction;   // +1 (start->end) or -1 (end->start)
      this.index     = index;       // 0 = innermost, increasing outward
      this.p1        = p1;
      this.p2        = p2;
      this.dir       = dir;
      this.length    = distance(p1, p2);
   }

   get id() { return `${this.road.id}:${this.direction}:${this.index}`; }

   /**
    * Which exit categories may be taken from this lane at a junction?
    * UK convention (flipped right-driving here):
    *   - single lane: anything goes
    *   - innermost lane (index 0): straight or right
    *   - outermost lane (index N-1): left or straight
    *   - middle lanes: straight only
    */
   allowedExits() {
      const lanesInDir = this.direction === +1 ? this.road.lanesForward : this.road.lanesReverse;
      if (lanesInDir <= 1) return new Set(['left', 'straight', 'right']);
      if (this.index === 0) return new Set(['straight', 'right']);
      if (this.index === lanesInDir - 1) return new Set(['left', 'straight']);
      return new Set(['straight']);
   }

   /** Progress (0..1) along the lane for a given point projected onto the line. */
   progressOf(pos) {
      if (this.length < 1) return 0;
      const t = dot(subtract(pos, this.p1), this.dir) / this.length;
      return clamp(t, 0, 1);
   }

   /** Point at parametric position t∈[0,1]. */
   pointAt(t) {
      return lerp2D(this.p1, this.p2, clamp(t, 0, 1));
   }

   /** Point at scalar distance d from lane start (clamped to lane length). */
   pointAtDistance(d) {
      return this.pointAt(d / Math.max(this.length, 1));
   }

   drawExitArrows(ctx, network) {
      if (this.length < 60) return;
      const conn = this.direction === +1 ? this.road.endConn : this.road.startConn;
      if (!conn) return;
      if (conn.intersection.kind === 'roundabout') return;

      const lanesInDir = this.direction === +1 ? this.road.lanesForward : this.road.lanesReverse;
      if (lanesInDir < 2) return;

      const allowed = this.allowedExits();
      const dist = Math.max(0, this.length - 26);
      const pos = this.pointAtDistance(dist);
      const dir = this.dir;

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(Math.atan2(dir.y, dir.x));
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;

      const drawArrow = (kind, lateralOffset) => {
         ctx.save();
         ctx.translate(0, lateralOffset);
         ctx.beginPath();
         if (kind === 'straight') {
            ctx.moveTo(-9, 0); ctx.lineTo(7, 0); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(7, -4); ctx.lineTo(13, 0); ctx.lineTo(7, 4);
            ctx.closePath(); ctx.fill();
         } else if (kind === 'left') {
            ctx.moveTo(-9, 0); ctx.lineTo(2, 0); ctx.lineTo(2, -6); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-2, -6); ctx.lineTo(2, -12); ctx.lineTo(6, -6);
            ctx.closePath(); ctx.fill();
         } else if (kind === 'right') {
            ctx.moveTo(-9, 0); ctx.lineTo(2, 0); ctx.lineTo(2, 6); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-2, 6); ctx.lineTo(2, 12); ctx.lineTo(6, 6);
            ctx.closePath(); ctx.fill();
         }
         ctx.restore();
      };

      const categories = [];
      if (allowed.has('left'))     categories.push('left');
      if (allowed.has('straight')) categories.push('straight');
      if (allowed.has('right'))    categories.push('right');
      const spacing = 7;
      const startOff = -((categories.length - 1) * spacing) / 2;
      categories.forEach((cat, i) => drawArrow(cat, startOff + i * spacing));

      ctx.restore();
   }
}
