/* ============================================================================
 * roadNetwork.js
 * ----------------------------------------------------------------------------
 * The container that holds all roads, intersections, markings, cars, and
 * closures, and keeps them consistent.
 *
 * WHY THIS FILE EXISTS:
 *   Roads, intersections, and markings reference each other. When the user
 *   edits the network (drag a road endpoint, delete an intersection, change
 *   lane count), references can become stale. RoadNetwork owns the rebuild
 *   logic that:
 *     1. Re-derives every road's lane geometry
 *     2. Snaps road endpoints to intersection slot positions
 *     3. Asks each intersection to recompute its internal paths
 *     4. Re-maps marking lane references when lanes are recreated
 *     5. Spawns "junctions" (the abstract gateway point used by the arbiter)
 *
 *   Other code reads `network.junctions`, `network.roads`, `network.markings`
 *   and trusts that they're consistent.
 *
 * WHO CALLS THIS:
 *   - main.js: instantiates `network = new RoadNetwork()`, passes it to the
 *     simulation, the arbiter, the editors
 *   - Scenarios: build by calling `network.addRoad(...)`, etc.
 *   - Editors: call `network.addRoad`, `network.removeRoad`, etc.
 *   - Cars: call `network.markingsOnLane(lane)`, `network.classifyExit(...)`
 *   - JunctionArbiter: iterates `network.junctions`
 *
 * KEY METHODS:
 *   addRoad/removeRoad      add or remove a Road, with edge cleanup
 *   addIntersection         create a new Intersection at a point
 *   rebuild()               full network refresh after structural change
 *   markingsOnLane(lane)    list markings sorted by `distance` ascending
 *   classifyExit(in, out)   'left'|'straight'|'right' for a turn category
 *   getExits(lane)          list of exit lanes from a lane's far-end
 *                           junction, with dead-end-avoidance heuristics
 *   junctions               array of junction objects (one per useful
 *                           intersection point) for the arbiter
 *   tick()                  per-frame: ticks pelican crossings & light groups
 *
 * ATTACH_DIST = 24:
 *   When a road endpoint is dragged within 24 px of an intersection, it
 *   snaps to that intersection's nearest slot.
 * ============================================================================ */

const ATTACH_DIST = 24;   // px: distance below which road endpoints snap to intersections

class RoadNetwork {
   constructor() {
      this.roads         = [];
      this.intersections = [];
      this.markings      = [];
      this.cars          = [];   // CarSpawn definitions, not live Car instances
      this.closures      = [];
   }

   addRoad(road) {
      road.onLanesReplaced = (oldLanes, newLanes) => this.#remapLanes(oldLanes, newLanes);
      road.onUpdated = () => this.rebuild();
      this.roads.push(road);
      this.rebuild();
      return road;
   }

   #remapLanes(oldLanes, newLanes) {
      const findReplacement = (oldLane) => {
         return newLanes.find(l => l.direction === oldLane.direction && l.index === oldLane.index)
             || newLanes.find(l => l.direction === oldLane.direction)
             || null;
      };

      const remapItems = (arr) => {
         for (let i = arr.length - 1; i >= 0; i--) {
            const item = arr[i];
            if (!item.lane) continue;
            if (!oldLanes.includes(item.lane)) continue;
            const repl = findReplacement(item.lane);
            if (repl) item.lane = repl;
            else arr.splice(i, 1);
         }
      };
      remapItems(this.markings);
      remapItems(this.closures);
      remapItems(this.cars);
   }

   removeRoad(road) {
      const i = this.roads.indexOf(road);
      if (i >= 0) this.roads.splice(i, 1);
      
      if (road.startConn) road.startConn.intersection.disconnect(road);
      if (road.endConn)   road.endConn.intersection.disconnect(road);
      
      this.intersections = this.intersections.filter(it => it.slots.length > 0);
      
      this.markings = this.markings.filter(m => m.lane.road !== road);
      this.cars     = this.cars.filter(c => c.lane.road !== road);
      this.closures = this.closures.filter(c => c.lane.road !== road);
      this.rebuild();
   }

   addIntersection(center, opts = {}) {
      const it = new Intersection(center, opts);
      this.intersections.push(it);
      return it;
   }

   addMarking(m)    { this.markings.push(m); return m; }
   removeMarking(m) { const i = this.markings.indexOf(m); if (i >= 0) this.markings.splice(i, 1); }
   addCar(c)        { this.cars.push(c); return c; }
   removeCar(c)     { const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1); }
   addClosure(c)    { this.closures.push(c); return c; }
   removeClosure(c) { const i = this.closures.indexOf(c); if (i >= 0) this.closures.splice(i, 1); }

   
   closuresOnLane(lane) {
      return this.closures.filter(c => c.lane === lane)
                          .sort((a, b) => a.distStart - b.distStart);
   }

   
   
   attachRoadEndpoint(road, end) {
      const pt = end === 'start' ? road.start : road.end;
      let it = this.findIntersectionAt(pt, ATTACH_DIST);
      if (!it) {
         it = this.addIntersection(pt.clone());
      }
      it.connect(road, end);
      this.rebuild();
      return it;
   }

   splitRoadAt(road, splitPoint) {
      const projected = nearestOnSegment(road.start, road.end, splitPoint);
      const t = projected.t;
      if (t < 0.1 || t > 0.9) return null;
      const splitPos = projected.point;

      const originalEnd     = road.end.clone();
      const originalEndConn = road.endConn;

      road.update({ end: splitPos.clone() });
      if (originalEndConn) {
         const oit = originalEndConn.intersection;
         oit.disconnect(road);
         road.endConn = null;
      }

      const second = new Road(splitPos.clone(), originalEnd, {
         lanesForward: road.lanesForward,
         lanesReverse: road.lanesReverse,
         speedLimit:   road.speedLimit,
         closed:       road.closed,
      });
      this.roads.push(second);

      if (originalEndConn) {
         const oit = originalEndConn.intersection;
         oit.connect(second, 'end');
      }

      const it = this.addIntersection(splitPos.clone());
      it.connect(road, 'end');
      it.connect(second, 'start');

      this.markings = this.markings.filter(m => {
         if (m.lane.road !== road) return true;
         const fwd = m.lane.direction === +1;
         const distFromStart = fwd ? m.distance : (m.lane.length - m.distance);
         const splitDist = t * distance(road.start, originalEnd);
         if (distFromStart > splitDist) {
            const newLane = second.lanes.find(l => l.direction === m.lane.direction && l.index === m.lane.index);
            if (!newLane) return false;
            m.lane = newLane;
            m.distance = fwd ? (distFromStart - splitDist) : (newLane.length - (distFromStart - splitDist));
         }
         return true;
      });

      this.cars = this.cars.filter(c => {
         if (c.lane.road !== road) return true;
         const fwd = c.lane.direction === +1;
         const carDist = fwd ? c.progress * c.lane.length : (c.lane.length - c.progress * c.lane.length);
         const splitDist = t * distance(road.start, originalEnd);
         if (carDist > splitDist) {
            const newLane = second.lanes.find(l => l.direction === c.lane.direction && l.index === c.lane.index);
            if (!newLane) return false;
            c.lane = newLane;
            c.progress = fwd ? (carDist - splitDist) / newLane.length : 1 - (carDist - splitDist) / newLane.length;
         }
         return true;
      });

      this.closures = this.closures.filter(cl => {
         if (cl.lane.road !== road) return true;
         const fwd = cl.lane.direction === +1;
         const splitDist = t * distance(road.start, originalEnd);
         const startD = fwd ? cl.distStart : (cl.lane.length - cl.distEnd);
         const endD   = fwd ? cl.distEnd   : (cl.lane.length - cl.distStart);
         if (endD <= splitDist) return true;
         if (startD >= splitDist) {
            const newLane = second.lanes.find(l => l.direction === cl.lane.direction && l.index === cl.lane.index);
            if (!newLane) return false;
            cl.lane = newLane;
            if (fwd) { cl.distStart -= splitDist; cl.distEnd -= splitDist; }
            else     {
               const newStart = newLane.length - (cl.lane.length - cl.distEnd);
               const newEnd   = newLane.length - (cl.lane.length - cl.distStart);
               cl.distStart = Math.max(0, newStart);
               cl.distEnd   = Math.min(newLane.length, newEnd);
            }
         }
         return true;
      });

      this.rebuild();
      return it;
   }

   findRoadHit(pos, tolerance = 18) {
      for (const r of this.roads) {
         const { point, t } = nearestOnSegment(r.start, r.end, pos);
         if (t > 0.1 && t < 0.9 && distance(pos, point) < tolerance) {
            if (r.startConn && distance(pos, r.start) < 30) continue;
            if (r.endConn && distance(pos, r.end) < 30) continue;
            return { road: r, point, t };
         }
      }
      return null;
   }

   findIntersectionAt(pt, dist = ATTACH_DIST) {
      for (const it of this.intersections) {
         if (distance(pt, it.center) < dist + it.radius * 0.5) return it;
      }
      return null;
   }

   
   
   findNearbyRoadEndpoint(pt, ignoreRoad = null) {
      for (const r of this.roads) {
         if (r === ignoreRoad) continue;
         if (!r.startConn && distance(r.start, pt) < ATTACH_DIST) return { road: r, end: 'start' };
         if (!r.endConn   && distance(r.end,   pt) < ATTACH_DIST) return { road: r, end: 'end'   };
      }
      return null;
   }

   markingsOnLane(lane) {
      return this.markings.filter(m => m.lane === lane)
                          .sort((a, b) => a.distance - b.distance);
   }

   findLaneById(laneId) {
      for (const r of this.roads) for (const l of r.lanes) if (l.id === laneId) return l;
      return null;
   }

   clear() {
      this.roads.length = 0;
      this.intersections.length = 0;
      this.markings.length = 0;
      this.cars.length = 0;
      this.closures.length = 0;
   }

   
   get junctions() {
      return this.intersections.map(i => ({
         point: i.center,
         intersection: i,
         kind: i.kind,
         roads: i.slots.map(s => ({ road: s.road, endpoint: s.end })),
      }));
   }
   get endpoints() { return this.junctions; }

   
   
   getExits(lane) {
      const exitEnd = lane.direction === +1 ? 'end' : 'start';
      const conn    = exitEnd === 'end' ? lane.road.endConn : lane.road.startConn;
      if (!conn) return [];
      const slot = conn.intersection.slots[conn.slotIndex];
      if (!slot) return [];

      const results = [];
      for (const ob of conn.intersection.outboundsFrom(slot)) {
         for (const ol of ob.outLanes) results.push(ol.laneObj);
      }

      if (conn.intersection.kind === 'roundabout') return results;

      const filtered = [];
      for (const exitLane of results) {
         const path = conn.intersection.getInternalPath(lane, exitLane);
         if (!path) continue;

         const farEnd = exitLane.direction === +1 ? 'end' : 'start';
         const farConn = farEnd === 'end' ? exitLane.road.endConn : exitLane.road.startConn;
         if (!farConn) continue;

         filtered.push(exitLane);
      }

      if (filtered.length > 0) return filtered;

      const partial = [];
      for (const exitLane of results) {
         const path = conn.intersection.getInternalPath(lane, exitLane);
         if (path) partial.push(exitLane);
      }
      return partial.length > 0 ? partial : results;
   }

   classifyExit(inDir, outDir) {
      const a = inDir.x * outDir.x + inDir.y * outDir.y;
      const cross = inDir.x * outDir.y - inDir.y * outDir.x;
      if (a > 0.7) return 'straight';
      if (cross < 0) return 'left';
      return 'right';
   }

   recommendedLaneIndex(road, direction, category) {
      const fwd = road.lanesForward;
      if (direction !== +1 || fwd <= 1) return null;
      if (category === 'right')    return 0;
      if (category === 'left')     return fwd - 1;
      if (category === 'straight') return Math.floor(fwd / 2);
      return null;
   }

   roundaboutLaneForExit(road, direction, intersection, exitRoad) {
      const fwd = direction === +1 ? road.lanesForward : road.lanesReverse;
      if (fwd <= 1) return null;

      const inSlot  = intersection.slots.find(s => s.road === road);
      const outSlot = intersection.slots.find(s => s.road === exitRoad);
      if (!inSlot || !outSlot) return null;

      const inAng  = inSlot.angle;
      const outAng = outSlot.angle;
      let delta = outAng - inAng;
      while (delta <= 0) delta += 2 * Math.PI;
      while (delta > 2 * Math.PI) delta -= 2 * Math.PI;

      if (delta < Math.PI * 0.85) {
         return fwd - 1;
      }
      return 0;
   }

   sameDirectionLanes(lane) {
      return lane.road.lanes.filter(l => l.direction === lane.direction && l !== lane);
   }

   
   
   nearestLane(pos, maxDist = 100) {
      let best = null, bestD = maxDist;
      for (const r of this.roads) {
         for (const lane of r.lanes) {
            const { point } = nearestOnSegment(lane.p1, lane.p2, pos);
            const d = distance(pos, point);
            if (d < bestD) { bestD = d; best = lane; }
         }
      }
      return { lane: best, dist: bestD };
   }

   
   rebuild() {
      for (const m of this.markings) {
         if (!m.lane) continue;
         if (m.distance > m.lane.length - 2) m.distance = Math.max(0, m.lane.length - 2);
         if (m.distance < 0) m.distance = 0;
      }
      for (const c of this.closures) {
         if (!c.lane) continue;
         if (c.distEnd   > c.lane.length) c.distEnd   = c.lane.length;
         if (c.distStart > c.distEnd - 5) c.distStart = Math.max(0, c.distEnd - 5);
         if (c.distStart < 0) c.distStart = 0;
      }
   }

   tick() {
      
      if (typeof TrafficLight !== 'undefined') TrafficLight.tickGroups();
      for (const m of this.markings) if (m.tick) m.tick();
   }

   
   draw(ctx) {
      for (const it of this.intersections) it.draw(ctx);
      for (const r of this.roads) r.draw(ctx);
      for (const r of this.roads) {
         for (const lane of r.lanes) {
            lane.drawExitArrows(ctx, this);
         }
      }
      for (const c of this.closures) c.draw(ctx);
      for (const m of this.markings) m.draw(ctx);
   }

   drawEditorHandles(ctx, selectedRoad, hoveredPoint) {
      for (const r of this.roads) {
         for (const p of [r.start, r.end]) {
            const isHover   = hoveredPoint && distance(p, hoveredPoint) < 1;
            const isSelected= r === selectedRoad;
            ctx.beginPath();
            ctx.fillStyle = isHover ? '#ffcc00' : (isSelected ? '#ffcc00' : '#66ccff');
            ctx.arc(p.x, p.y, isHover ? 8 : 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1.5;
            ctx.stroke();
         }
      }
      for (const it of this.intersections) {
         const isHover = hoveredPoint && distance(it.center, hoveredPoint) < 1;
         it.drawHandle(ctx, isHover);
      }
   }

   
   toJSON() {
      return {
         roads:         this.roads.map(r => r.toJSON()),
         intersections: this.intersections.map(i => i.toJSON()),
         markings:      this.markings.map(m => m.toJSON()),
         cars:          this.cars.map(c => c.toJSON ? c.toJSON() : null).filter(Boolean),
         closures:      this.closures.map(c => c.toJSON()),
      };
   }

   loadJSON(data) {
      this.roads         = (data.roads || []).map(Road.fromJSON);
      for (const road of this.roads) {
         road.onLanesReplaced = (oldLanes, newLanes) => this.#remapLanes(oldLanes, newLanes);
         road.onUpdated = () => this.rebuild();
      }
      const roadLookup   = id => this.roads.find(r => r.id === id);
      this.intersections = (data.intersections || []).map(d => Intersection.fromJSON(d, roadLookup));
      const laneLookup   = id => this.findLaneById(id);
      this.markings      = (data.markings || [])
         .map(d => Marking.fromJSON(d, laneLookup))
         .filter(Boolean);
      this.cars          = (data.cars || [])
         .map(d => typeof CarSpawn !== 'undefined' ? CarSpawn.fromJSON(d, laneLookup) : null)
         .filter(Boolean);
      this.closures      = (data.closures || [])
         .map(d => RoadClosure.fromJSON(d, laneLookup))
         .filter(Boolean);
   }
}
