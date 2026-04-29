/* ============================================================================
 * intersection.js
 * ----------------------------------------------------------------------------
 * The Intersection class — where roads meet. Two flavours: 'plain' (a 4-way
 * crossroads, T-junction, etc.) and 'roundabout' (a circular ring).
 *
 * WHY THIS FILE EXISTS:
 *   When two roads meet, cars need to traverse the gap between them along a
 *   curve, not teleport. This class generates the "internal paths": one
 *   parametric polyline (`waypoints[]`) per (inLane, outLane) pair, computed
 *   at network rebuild time. Cars in the `internal` state walk these
 *   waypoints between leaving an entry lane and joining an exit lane.
 *
 *   For roundabouts the internal paths are arc segments around the
 *   intersection's centre. For plain junctions they're Bezier-like curves
 *   blending entry direction into exit direction.
 *
 * WHO CALLS THIS:
 *   - Scenarios construct Intersections via `new Intersection(...)` and
 *     wire them with `intersection.connect(road, end)`
 *   - RoadEditor / placeIntersection in main.js spawn Intersections when
 *     the user double-clicks a road join
 *   - RoadNetwork.rebuild() invokes Intersection.rebuild() to (re)generate
 *     all slot positions and internal paths after geometry changes
 *   - Cars look up paths via Intersection.getInternalPath(inLane, outLane)
 *   - JunctionArbiter reads `intersection.slots` and `intersection.center`
 *     for its admission logic
 *   - debugExport reads `intersection.internalLanes` for the snapshot dump
 *
 * KEY DATA:
 *   slots          — array of ConnectionSlot, one per arm. Each slot has
 *                    {road, end ('start'|'end'), angle, index, inLanes[],
 *                    outLanes[]}
 *   internalLanes  — Map<key,InternalPath>. Key is "inSlotIdx:inLaneIdx:
 *                    outSlotIdx:outLaneIdx". InternalPath has waypoints[],
 *                    inDir, outDir, category ('left'|'straight'|'right'),
 *                    length, intersection (back-pointer)
 *   ringCount()    — for roundabouts, how many concentric ring lanes
 *   radius         — perimeter radius (where lanes meet the intersection)
 *
 * UK ROUNDABOUT NOTE:
 *   Multi-lane roundabouts have inner and outer rings. Cars approaching in
 *   the inner approach lane use the inner ring (and may not take the
 *   nearest exit); cars in the outer approach lane use the outer ring.
 *   Inner-ring paths blend outward in the last 35% of their arc to merge
 *   onto the outer ring before exiting.
 * ============================================================================ */

const INTERSECTION_RADIUS_BASE = 65;

class Intersection {
   /**
    * @param {Point} center  centre point in world coords
    * @param {object} opts   { kind: 'plain'|'roundabout', radius?: number }
    */
   constructor(center, opts = {}) {
      this.id     = Intersection.nextId++;
      this.center = center;
      this.kind   = opts.kind   ?? 'plain';
      this.radius = opts.radius ?? (this.kind === 'roundabout' ? 78 : INTERSECTION_RADIUS_BASE);
      this.slots  = [];

      // key: "inSlotIdx:inLaneIdx:outSlotIdx:outLaneIdx" -> InternalPath
      this.internalLanes = new Map();
   }

   static nextId = 1;

   /**
    * Wire one road's end into this intersection. The slot is added to
    * `this.slots`, with `slot.road` and `slot.end` set, and the road's
    * startConn/endConn back-reference is also set so cars can ask
    * `road.endConn` when they reach the lane end.
    */
   connect(road, end, slotAngle = null) {
      const angle = slotAngle ?? this.#angleFromRoad(road, end);
      const slot = new ConnectionSlot(this, angle, this.slots.length);
      slot.road = road;
      slot.end  = end;
      this.slots.push(slot);


      if (end === 'start') road.startConn = { intersection: this, slotIndex: slot.index };
      else                 road.endConn   = { intersection: this, slotIndex: slot.index };

      this.#adjustRadius();
      this.#resnapAllRoads();
      this.#rebuildInternalLanes();
      return slot;
   }

   #resnapAllRoads() {
      for (const slot of this.slots) {
         if (!slot.road) continue;
         const slotPos = this.slotPosition(slot);
         if (slot.end === 'start') {
            if (distance(slot.road.start, slotPos) > 0.5) slot.road.update({ start: slotPos.clone() });
         } else {
            if (distance(slot.road.end, slotPos) > 0.5)   slot.road.update({ end:   slotPos.clone() });
         }
      }
   }

   refreshKind() {
      this.#adjustRadius();
      this.#resnapAllRoads();
      this.#rebuildInternalLanes();
   }

   ringCount() {
      let maxFwd = 1;
      for (const slot of this.slots) {
         if (slot.road) maxFwd = Math.max(maxFwd, slot.road.lanesForward);
      }
      const minByArms = this.slots.length >= 4 ? 2 : 1;
      return Math.min(3, Math.max(minByArms, maxFwd));
   }

   
   disconnect(road) {
      for (let i = this.slots.length - 1; i >= 0; i--) {
         if (this.slots[i].road === road) {
            this.slots.splice(i, 1);
         }
      }
      for (let i = 0; i < this.slots.length; i++) this.slots[i].index = i;
      this.#adjustRadius();
      this.#rebuildInternalLanes();
   }

   
   #angleFromRoad(road, end) {
      
      const other = end === 'start' ? road.end : road.start;
      const here  = end === 'start' ? road.start : road.end;
      const dir = normalize(subtract(other, here));
      
      return Math.atan2(dir.y, dir.x);
   }

   
   #adjustRadius() {
      let maxLanes = 1;
      for (const slot of this.slots) {
         if (!slot.road) continue;
         const total = slot.road.lanesForward + slot.road.lanesReverse;
         if (total > maxLanes) maxLanes = total;
      }
      const slotCount = this.slots.length;
      if (this.kind === 'roundabout') {
         const rings = this.ringCount();
         this.radius = Math.max(78, 55 + rings * LANE_WIDTH * 1.2 + maxLanes * LANE_WIDTH * 0.25);
         return;
      }
      if (slotCount === 2) {
         this.radius = 4;
         return;
      }
      const slotBoost = slotCount === 3 ? 1.25 : (slotCount === 4 ? 1.30 : 1.4);
      this.radius = Math.max(INTERSECTION_RADIUS_BASE, maxLanes * LANE_WIDTH * slotBoost);
   }

   
   slotPosition(slot) {
      return new Point(
         this.center.x + Math.cos(slot.angle) * this.radius,
         this.center.y + Math.sin(slot.angle) * this.radius
      );
   }

   
   slotInwardDir(slot) {
      return new Point(-Math.cos(slot.angle), -Math.sin(slot.angle));
   }

   
   #rebuildInternalLanes() {
      this.internalLanes.clear();

      for (let i = 0; i < this.slots.length; i++) {
         const inSlot = this.slots[i];
         if (!inSlot.road) continue;

         
         
         const inLanes = this.#laneEndingHere(inSlot);

         for (let j = 0; j < this.slots.length; j++) {
            if (i === j) continue;
            const outSlot = this.slots[j];
            if (!outSlot.road) continue;

            const outLanes = this.#laneStartingHere(outSlot);

            
            
            for (const inLane of inLanes) {
               
               let bestOut = null;
               let bestD = Infinity;
               for (const outLane of outLanes) {
                  const d = Math.abs(inLane.intersectionIndex - outLane.intersectionIndex);
                  if (d < bestD) { bestD = d; bestOut = outLane; }
               }
               if (!bestOut) continue;

               const key = `${i}:${inLane.laneObj.index}:${j}:${bestOut.laneObj.index}`;
               const path = this.#buildPath(inSlot, inLane, outSlot, bestOut);
               if (!path) continue;
               path.key = key;
               path.inSlotIdx = i;
               path.outSlotIdx = j;
               path.inDir  = inLane.laneObj.dir;
               path.outDir = bestOut.laneObj.dir;
               path.category = this.#classifyPath(path.inDir, path.outDir);

               if (this.kind !== 'roundabout') {
                  const allowed = inLane.laneObj.allowedExits();
                  if (!allowed.has(path.category)) continue;
               }

               this.internalLanes.set(key, path);
            }
         }
      }
   }

   #classifyPath(inDir, outDir) {
      const dot   = inDir.x * outDir.x + inDir.y * outDir.y;
      const cross = inDir.x * outDir.y - inDir.y * outDir.x;
      if (dot > 0.7) return 'straight';
      if (cross < 0) return 'left';
      return 'right';
   }

   
   
   #laneEndingHere(slot) {
      
      
      
      const out = [];
      const lanes = slot.road.lanes;
      for (const lane of lanes) {
         const endsHere = (slot.end === 'end'   && lane.direction === +1)
                       || (slot.end === 'start' && lane.direction === -1);
         if (!endsHere) continue;
         const entryPoint = lane.p2;   
         out.push({
            laneObj: lane,
            intersectionIndex: lane.index,   
            entryPoint,
         });
      }
      return out;
   }

   #laneStartingHere(slot) {
      const out = [];
      const lanes = slot.road.lanes;
      for (const lane of lanes) {
         const startsHere = (slot.end === 'start' && lane.direction === +1)
                         || (slot.end === 'end'   && lane.direction === -1);
         if (!startsHere) continue;
         const exitPoint = lane.p1;
         out.push({
            laneObj: lane,
            intersectionIndex: lane.index,
            exitPoint,
         });
      }
      return out;
   }

   
   
   #buildPath(inSlot, inLane, outSlot, outLane) {
      const p0 = inLane.entryPoint;
      const p2 = outLane.exitPoint;

      const N = 16;
      const pts = [];

      if (this.kind === 'roundabout') {
         const ringCount = this.ringCount();

         const inAng  = Math.atan2(p0.y - this.center.y, p0.x - this.center.x);
         let outAng = Math.atan2(p2.y - this.center.y, p2.x - this.center.x);
         let delta = outAng - inAng;
         while (delta <= 0) delta += 2 * Math.PI;
         while (delta > 2 * Math.PI) delta -= 2 * Math.PI;

         const inRoad = inSlot.road;
         const inLanesInDir = inLane.laneObj.direction === +1
                              ? inRoad.lanesForward
                              : inRoad.lanesReverse;

         let ringIndex;
         if (ringCount === 1) {
            ringIndex = 0;
         } else if (inLanesInDir <= 1) {
            if (ringCount === 2) {
               ringIndex = (delta < Math.PI * 0.85) ? 0 : 1;
            } else {
               if      (delta < Math.PI * 0.55) ringIndex = 0;
               else if (delta < Math.PI * 1.10) ringIndex = 1;
               else                              ringIndex = 2;
            }
         } else {
            const laneIdx = inLane.laneObj.index;
            const isOuterApproach = laneIdx === inLanesInDir - 1;
            const isInnerApproach = laneIdx === 0;

            if (isOuterApproach) {
               ringIndex = 0;
               if (delta > Math.PI * 1.25) return null;
            } else if (isInnerApproach) {
               ringIndex = ringCount - 1;
               if (delta < Math.PI * 0.50) return null;
            } else {
               if (ringCount === 2) {
                  ringIndex = (delta < Math.PI * 0.85) ? 0 : 1;
               } else {
                  ringIndex = 1;
               }
            }
         }

         const baseR = Math.max(this.radius * 0.78, 60);
         const ringR = baseR - ringIndex * LANE_WIDTH * 0.85;

         const ringEntry = new Point(
            this.center.x + Math.cos(inAng) * ringR,
            this.center.y + Math.sin(inAng) * ringR,
         );
         const ringExit  = new Point(
            this.center.x + Math.cos(outAng) * ringR,
            this.center.y + Math.sin(outAng) * ringR,
         );

         const entrySteps = 4;
         for (let i = 0; i <= entrySteps; i++) {
            const t = i / entrySteps;
            const tEase = t * t * (3 - 2 * t);
            pts.push(new Point(
               p0.x + (ringEntry.x - p0.x) * tEase,
               p0.y + (ringEntry.y - p0.y) * tEase,
            ));
         }

         const ringSteps = Math.max(5, Math.round(delta * 8));
         const baseR_outer = baseR;
         for (let i = 1; i < ringSteps; i++) {
            const t = i / ringSteps;
            const a = inAng + delta * t;
            let r = ringR;
            if (ringIndex > 0 && t > 0.65) {
               const blend = (t - 0.65) / 0.35;
               const tEase = blend * blend * (3 - 2 * blend);
               r = ringR + (baseR_outer - ringR) * tEase;
            }
            pts.push(new Point(
               this.center.x + Math.cos(a) * r,
               this.center.y + Math.sin(a) * r,
            ));
         }
         const exitR = ringIndex > 0 ? baseR_outer : ringR;
         const ringExitAdj = new Point(
            this.center.x + Math.cos(outAng) * exitR,
            this.center.y + Math.sin(outAng) * exitR,
         );
         pts.push(ringExitAdj);

         const exitSteps = 4;
         for (let i = 1; i <= exitSteps; i++) {
            const t = i / exitSteps;
            const tEase = t * t * (3 - 2 * t);
            pts.push(new Point(
               ringExitAdj.x + (p2.x - ringExitAdj.x) * tEase,
               ringExitAdj.y + (p2.y - ringExitAdj.y) * tEase,
            ));
         }

         return { waypoints: pts, fromSlotIdx: inSlot.index, toSlotIdx: outSlot.index, intersection: this, ringIndex };
      }

      const inDir  = inLane.laneObj.dir;
      const outDir = outLane.laneObj.dir;
      const alignment = inDir.x * outDir.x + inDir.y * outDir.y;

      if (alignment > 0.85) {
         for (let i = 0; i <= N; i++) {
            const t = i / N;
            const x = p0.x + (p2.x - p0.x) * t;
            const y = p0.y + (p2.y - p0.y) * t;
            pts.push(new Point(x, y));
         }
      } else {
         const mid = new Point((p0.x + p2.x) / 2, (p0.y + p2.y) / 2);
         const ctl = new Point(
            mid.x + (this.center.x - mid.x) * 0.5,
            mid.y + (this.center.y - mid.y) * 0.5,
         );
         for (let i = 0; i <= N; i++) {
            const t = i / N;
            const mt = 1 - t;
            const x = mt * mt * p0.x + 2 * mt * t * ctl.x + t * t * p2.x;
            const y = mt * mt * p0.y + 2 * mt * t * ctl.y + t * t * p2.y;
            pts.push(new Point(x, y));
         }
      }
      return { waypoints: pts, fromSlotIdx: inSlot.index, toSlotIdx: outSlot.index, intersection: this };
   }

   
   roadUpdated(road) {
      
      for (const slot of this.slots) {
         if (slot.road === road) {
            slot.angle = this.#angleFromRoad(road, slot.end);
            const slotPos = this.slotPosition(slot);
            if (slot.end === 'start') { road.start = slotPos; road._rebuild(); }
            else                      { road.end   = slotPos; road._rebuild(); }
         }
      }
      this.#adjustRadius();
      this.#rebuildInternalLanes();
   }

   
   
   
   /**
    * Look up a precomputed internal path between two lanes that meet here.
    * Used by Cars to fetch waypoints when transitioning from `lane` to
    * `internal` state.
    *
    * Falls back to ANY path between the same arms if the exact lane-to-lane
    * key isn't found (lane-to-lane preference is computed but not always
    * exhaustive — fall-back keeps cars moving).
    */
   getInternalPath(fromLane, toLane) {
      const fromSlot = this.slots.find(s => s.road === fromLane.road);
      const toSlot   = this.slots.find(s => s.road === toLane.road);
      if (!fromSlot || !toSlot) return null;

      // Exact match first.
      const key = `${fromSlot.index}:${fromLane.index}:${toSlot.index}:${toLane.index}`;
      let path = this.internalLanes.get(key);
      if (path) return path;

      // Fallback: any path connecting these two arms.
      for (const [k, v] of this.internalLanes) {
         if (v.fromSlotIdx === fromSlot.index && v.toSlotIdx === toSlot.index) return v;
      }
      return null;
   }

   /**
    * Returns possible exits from the given approach slot. Used when a car
    * has reached a junction and needs to pick which lane to leave on.
    * Returns [{ road, slot, outLanes:[{laneObj, ...}] }, ...].
    */
   outboundsFrom(slot) {
      const out = [];
      for (const s of this.slots) {
         if (s === slot || !s.road) continue;
         const lanes = this.#laneStartingHere(s);
         if (lanes.length) out.push({ road: s.road, slot: s, outLanes: lanes });
      }
      return out;
   }

   /** Render the intersection (asphalt, lane markings, ring island, etc). */
   draw(ctx) {
      if (this.slots.length === 0) {
         ctx.fillStyle = '#3a3a3a';
         ctx.fillRect(this.center.x - 30, this.center.y - 30, 60, 60);
         return;
      }

      if (this.kind === 'roundabout') {
         const ringCount = this.ringCount();

         const outerR = this.radius;
         const islandR = Math.max(20, this.radius * 0.45);

         ctx.fillStyle = '#3a3a3a';
         ctx.beginPath();
         ctx.arc(this.center.x, this.center.y, outerR, 0, Math.PI * 2);
         ctx.fill();

         ctx.fillStyle = '#446c3c';
         ctx.beginPath();
         ctx.arc(this.center.x, this.center.y, islandR, 0, Math.PI * 2);
         ctx.fill();
         ctx.strokeStyle = '#fff';
         ctx.lineWidth = 2.5;
         ctx.stroke();

         ctx.strokeStyle = '#fff';
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.arc(this.center.x, this.center.y, outerR, 0, Math.PI * 2);
         ctx.stroke();

         ctx.strokeStyle = '#bbb';
         ctx.lineWidth = 1.2;
         ctx.setLineDash([4, 6]);
         const baseR = Math.max(this.radius * 0.78, 60);
         for (let i = 0; i < ringCount - 1; i++) {
            const r = baseR - (i + 0.5) * LANE_WIDTH * 0.85;
            if (r > islandR + 5) {
               ctx.beginPath();
               ctx.arc(this.center.x, this.center.y, r, 0, Math.PI * 2);
               ctx.stroke();
            }
         }
         ctx.setLineDash([]);

         for (const slot of this.slots) {
            const slotPos = this.slotPosition(slot);
            const inDir = new Point(Math.cos(slot.angle), Math.sin(slot.angle));
            const perp  = new Point(-inDir.y, inDir.x);
            const r = slot.road;
            const halfW = (Math.max(r.lanesForward, 1) + Math.max(r.lanesReverse, 0)) * LANE_WIDTH / 2;
            const a = add(slotPos, scale(perp,  halfW));
            const b = add(slotPos, scale(perp, -halfW));
            ctx.strokeStyle = '#fff';
            ctx.setLineDash([6, 5]);
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
         }
         return;
      }

      if (this.slots.length === 2) {
         const sa = this.slots[0];
         const sb = this.slots[1];
         const ra = sa.road;
         const rb = sb.road;
         const halfA = (Math.max(ra.lanesForward, 1) + Math.max(ra.lanesReverse, 0)) * LANE_WIDTH / 2;
         const halfB = (Math.max(rb.lanesForward, 1) + Math.max(rb.lanesReverse, 0)) * LANE_WIDTH / 2;

         const aOut  = new Point(Math.cos(sa.angle), Math.sin(sa.angle));
         const aPerp = new Point(-aOut.y, aOut.x);
         const bOut  = new Point(Math.cos(sb.angle), Math.sin(sb.angle));
         const bPerp = new Point(-bOut.y, bOut.x);

         const aPos = this.slotPosition(sa);
         const bPos = this.slotPosition(sb);

         const aLeft  = add(aPos, scale(aPerp,  halfA));
         const aRight = add(aPos, scale(aPerp, -halfA));
         const bLeft  = add(bPos, scale(bPerp,  halfB));
         const bRight = add(bPos, scale(bPerp, -halfB));

         const angleBetween = Math.acos(Math.max(-1, Math.min(1, -aOut.x * bOut.x + -aOut.y * bOut.y)));
         const turnAmount = Math.PI - angleBetween;
         const bulge = Math.min(0.45, turnAmount * 0.4);

         const mid1 = new Point((aLeft.x + bRight.x) / 2, (aLeft.y + bRight.y) / 2);
         const v1 = subtract(mid1, this.center);
         const c1 = add(mid1, scale(v1, bulge));

         const mid2 = new Point((bLeft.x + aRight.x) / 2, (bLeft.y + aRight.y) / 2);
         const v2 = subtract(mid2, this.center);
         const c2 = add(mid2, scale(v2, bulge));

         ctx.fillStyle = '#3a3a3a';
         ctx.beginPath();
         ctx.moveTo(aLeft.x, aLeft.y);
         ctx.quadraticCurveTo(c1.x, c1.y, bRight.x, bRight.y);
         ctx.lineTo(bLeft.x, bLeft.y);
         ctx.quadraticCurveTo(c2.x, c2.y, aRight.x, aRight.y);
         ctx.closePath();
         ctx.fill();

         ctx.strokeStyle = '#e8e8e8';
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.moveTo(aLeft.x, aLeft.y);
         ctx.quadraticCurveTo(c1.x, c1.y, bRight.x, bRight.y);
         ctx.stroke();
         ctx.beginPath();
         ctx.moveTo(bLeft.x, bLeft.y);
         ctx.quadraticCurveTo(c2.x, c2.y, aRight.x, aRight.y);
         ctx.stroke();
         return;
      }

      const sorted = [...this.slots].sort((a, b) => a.angle - b.angle);

      const kerbs = sorted.map(slot => {
         const r = slot.road;
         const halfW = (Math.max(r.lanesForward, 1) + Math.max(r.lanesReverse, 0)) * LANE_WIDTH / 2;
         const outDir  = new Point(Math.cos(slot.angle), Math.sin(slot.angle));
         const perpDir = new Point(-outDir.y, outDir.x);
         const basePt  = this.slotPosition(slot);
         return {
            slot,
            left:  add(basePt, scale(perpDir,  halfW)),
            right: add(basePt, scale(perpDir, -halfW)),
            base:  basePt,
            angle: slot.angle,
         };
      });

      const n = kerbs.length;
      const poly = [];
      for (let i = 0; i < n; i++) {
         const a = kerbs[i];
         const b = kerbs[(i + 1) % n];
         poly.push(a.right);
         poly.push(a.left);
         poly.push(b.right);
      }

      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
         const a = kerbs[i];
         const b = kerbs[(i + 1) % n];
         ctx.beginPath();
         ctx.moveTo(a.left.x, a.left.y);
         ctx.lineTo(b.right.x, b.right.y);
         ctx.stroke();
      }

      for (const k of kerbs) {
         const r = k.slot.road;
         if (r.lanesReverse <= 0 || r.lanesForward <= 0) continue;
         const outDir  = new Point(Math.cos(k.angle), Math.sin(k.angle));
         const perpDir = new Point(-outDir.y, outDir.x);
         const innerPt = add(k.base, scale(outDir, -2));
         const halfW   = Math.max(r.lanesForward, 1) * LANE_WIDTH;
         const a = add(innerPt, scale(perpDir,  0));
         const b = add(innerPt, scale(perpDir,  halfW));
         ctx.strokeStyle = '#fff';
         ctx.lineWidth = 3;
         ctx.beginPath();
         ctx.moveTo(a.x, a.y);
         ctx.lineTo(b.x, b.y);
         ctx.stroke();
      }
   }

   drawHandle(ctx, hovered = false) {
      ctx.fillStyle = hovered ? '#ffcc00' : 'rgba(102, 204, 255, 0.6)';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.center.x, this.center.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
   }

   
   toJSON() {
      return {
         id: this.id,
         kind: this.kind,
         center: { x: this.center.x, y: this.center.y },
         radius: this.radius,
         slots: this.slots.map(s => ({
            angle: s.angle,
            roadId: s.road ? s.road.id : null,
            end: s.end,
         })),
      };
   }

   static fromJSON(data, roadLookup) {
      const i = new Intersection(new Point(data.center.x, data.center.y), { radius: data.radius, kind: data.kind });
      i.id = data.id;
      Intersection.nextId = Math.max(Intersection.nextId, data.id + 1);
      for (const sd of data.slots) {
         const slot = new ConnectionSlot(i, sd.angle, i.slots.length);
         if (sd.roadId) {
            slot.road = roadLookup(sd.roadId);
            slot.end = sd.end;
            if (slot.road) {
               if (sd.end === 'start') slot.road.startConn = { intersection: i, slotIndex: slot.index };
               else                    slot.road.endConn   = { intersection: i, slotIndex: slot.index };
            }
         }
         i.slots.push(slot);
      }
      i.#rebuildInternalLanes();
      return i;
   }
}

class ConnectionSlot {
   constructor(intersection, angle, index) {
      this.intersection = intersection;
      this.angle = angle;
      this.index = index;
      this.road  = null;
      this.end   = null;   
   }
   get position() { return this.intersection.slotPosition(this); }
}
