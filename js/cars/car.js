/* ============================================================================
 * car.js
 * ----------------------------------------------------------------------------
 * The two car classes.
 *
 *   CarSpawn — a placeholder placed by the editor that says "create a Car
 *              of personality X on lane Y at progress Z when sim starts".
 *              Stored in network.cars. Has .toJSON / fromJSON for save/load.
 *
 *   Car      — the live car. Has position, speed, state machine, decision-
 *              making logic. Its update() is called once per sim frame.
 *
 * WHY THIS FILE EXISTS:
 *   The car drives itself. Given the network and the list of all cars, the
 *   Car decides each frame what its desired speed should be, whether to
 *   change lane, whether to brake for a junction, etc. This is the largest
 *   file in the codebase because it contains every driving rule.
 *
 * STATE MACHINE:
 *   'lane'       on a Lane, driving in the lane.direction. distAlong tracks
 *                position along the lane.
 *   'internal'   inside an Intersection traversing an InternalPath. internalDist
 *                tracks position along path.waypoints. Falls back to 'lane'
 *                state on the exit lane when internalDist >= internalLength.
 *
 * UPDATE LOOP (per frame, in this order):
 *   1. Choose nextLane if missing (one-step lookahead)
 *   2. Speed control: compute `desired` speed from carAhead, markings, lights,
 *      arbiter mayProceed, corner factor, closures, override
 *   3. Apply accel/brake to converge actual speed toward desired
 *   4. Move forward along current lane or internal path
 *   5. Maybe trigger lane change, U-turn, respawn
 *
 * LANE CHANGE:
 *   Lateral motion is done by interpolating the car's render position
 *   between the source and target lane positions. Animation runs over
 *   ~28 frames. During the change, blink set to 'left' or 'right' so the
 *   indicator renders.
 *
 * U-TURN AND RESPAWN:
 *   When a car reaches a lane that dead-ends with no exits, it tries to
 *   U-turn to an opposite-direction lane on the same road. After 3 such
 *   U-turns in succession, it respawns at a fresh lane to avoid pathological
 *   loops on dead-end-heavy networks.
 *
 * ACTION LOG:
 *   For debug snapshots, every Car keeps a rolling actionLog of its recent
 *   decisions ('U-turn at dead end', 'STUCK at lane end', etc.). This is
 *   what the debug-export 'Action History' tab dumps.
 *
 * WHO CALLS THIS:
 *   - Simulation.tick() iterates `for (const c of cars) c.update(allCars)`
 *   - Simulation.draw(ctx) iterates `c.draw(ctx)`
 *   - JunctionArbiter reads car.state, car.lane, car.distAlong, car.internalDist
 *   - debugExport reads everything for snapshot dumps
 * ============================================================================ */

class CarSpawn {
   /**
    * Editor-time placeholder. Becomes a live Car at sim start.
    * @param progress  0..1 along the lane to start at
    * @param personality 'good'|'aggressive'|'passive'|'distracted'
    * @param isMain  if true, this is the user's car (highlighted, narrated)
    */
   constructor({ id, lane, progress, personality, isMain }) {
      this.id = id ?? CarSpawn.nextId++;
      this.lane = lane;
      this.progress = progress;
      this.personality = personality ?? 'good';
      this.isMain = !!isMain;
   }
   static nextId = 1;

   get position() { return this.lane.pointAt(this.progress); }
   get angle()    { return angleOf(this.lane.dir); }

   toJSON() {
      return {
         id: this.id, laneId: this.lane.id,
         progress: this.progress,
         personality: this.personality,
         isMain: this.isMain,
      };
   }

   static fromJSON(data, laneLookup) {
      const lane = laneLookup(data.laneId);
      if (!lane) return null;
      const c = new CarSpawn({
         id: data.id, lane, progress: data.progress,
         personality: data.personality, isMain: data.isMain,
      });
      CarSpawn.nextId = Math.max(CarSpawn.nextId, (data.id ?? 0) + 1);
      return c;
   }

   draw(ctx) {
      const pos = this.position;
      const ang = this.angle;
      const pers = getPersonality(this.personality);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = this.isMain ? '#66ccff' : pers.colour;
      ctx.strokeStyle = this.isMain ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = this.isMain ? 2 : 1;
      ctx.fillRect(-8, -13, 16, 26);
      ctx.strokeRect(-8, -13, 16, 26);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(-6, -11, 12, 5);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(pos.x - 28, pos.y - 30, 56, 12);
      ctx.fillStyle = '#fff';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.isMain ? 'MAIN' : pers.label.split(' ')[0].toUpperCase(),
                   pos.x, pos.y - 21);
      ctx.restore();
   }
}

const MIN_SAFETY_GAP = 38;

/**
 * Car — a live vehicle in the simulation.
 *
 * Construction takes the parent network and a CarSpawn (which is the
 * editor-time placeholder defining starting position and personality).
 * After construction, the car is ready to be ticked via `update(allCars)`
 * each frame.
 *
 * Key fields the rest of the codebase reads:
 *   x, y, angle           render position and heading
 *   state                 'lane' | 'internal'
 *   lane                  the current Lane (always set, even in internal state)
 *   distAlong             progress along current lane (px)
 *   internalPath          the InternalPath being traversed (when state==='internal')
 *   internalDist          progress along internalPath (px)
 *   nextLane              the Lane the car will join after the next junction
 *   targetLane            during a lane change, the Lane being merged into
 *   speed                 current scalar speed (px per frame)
 *   params                personality parameters from PERSONALITIES
 *   isMain                true if this is the user's car (highlighted)
 *   actionLog             rolling array of recent decisions for debug snapshots
 */
class Car {
   constructor({ network, spawn }) {
      this.network = network;
      this.spawn = spawn;

      // Position state machine.
      this.state     = 'lane';
      this.lane      = spawn.lane;
      this.distAlong = spawn.progress * this.lane.length;

      // Junction transit state. Filled when state === 'internal'.
      this.internalPath    = null;
      this.internalIdx     = 0;          // current waypoint index
      this.internalLength  = 0;          // total path length
      this.internalDist    = 0;          // distance walked along path
      this.internalSegments= [];         // cumulative segment lengths cache

      const pos = this.lane.pointAtDistance(this.distAlong);
      this.x = pos.x;
      this.y = pos.y;
      this.angle = angleOf(this.lane.dir);

      this.speed = 0;
      this.personality = spawn.personality;
      this.isMain = spawn.isMain;
      this.params = getPersonality(this.personality);

      // Reaction-delay smoothing buffer for desired-speed.
      this.desiredBuffer = [];

      // Stop-sign and signage bookkeeping.
      this.stopHoldFrames = 0;
      this.stopCooldown   = 0;
      this.servedStopIds  = new Set();
      this.headCheck      = 0;
      this.laneChangeIndicator = null;
      this.braking        = false;

      // Lane-change animation state.
      this.lateralT       = 0;            // 0..1 progress through the change
      this.targetLane     = null;
      this.lateralSign    = 0;            // -1 left, +1 right
      this.laneChangeCool = 0;            // cooldown frames between changes
      this.reverseFrames  = 0;            // for single-track reversing logic
      this.stuckFrames    = 0;            // diagnostic counter

      // Per-decision-quiz override ('speed-up'|'tailgate'|'ignore-closure'|...).
      this.override       = null;
      this.overrideFrames = 0;

      // Slip-road merge state (for highway scenarios).
      this.merging         = null;

      // Rolling decision log surfaced by debug-export Action History tab.
      this.actionLog       = [];

      // Routing.
      this.targetRoad = null;
      this.#assignNewTarget();

      this.nextLane = null;
      this.#chooseNextLane();
   }

   /** Append a decision entry to actionLog (capped at 30). */
   logAction(reason, extra = {}) {
      const t = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      this.actionLog.push({ t: Math.round(t), reason, ...extra });
      if (this.actionLog.length > 30) this.actionLog.shift();
   }

   /**
    * Attempt a U-turn at a dead-end. Switches the car to an opposite-direction
    * lane on the same road, resets internal-path state, and picks a new target.
    * Returns true on success. Increments recentUTurns so #respawnAtStart can
    * step in if the car keeps loop-trapping.
    */
   #tryUTurn() {
      const oppLanes = this.lane.road.lanes.filter(l => l.direction !== this.lane.direction);
      if (oppLanes.length === 0) return false;
      const newLane = oppLanes[0];
      this.lane = newLane;
      this.distAlong = 4;
      this.speed = 0;
      const p = newLane.pointAtDistance(this.distAlong);
      this.x = p.x;
      this.y = p.y;
      this.angle = Math.atan2(newLane.dir.y, newLane.dir.x);
      this.internalPath = null;
      this.internalDist = 0;
      this.internalLength = 0;
      this.nextLane = null;
      this.targetLane = null;
      this.lateralT = 0;
      this.recentUTurns = (this.recentUTurns || 0) + 1;
      this.lastUTurnFrame = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.#assignNewTarget();
      this.#chooseNextLane();
      this.logAction('U-turn at dead end', { laneId: newLane.id, recentUTurns: this.recentUTurns });
      return true;
   }

   /**
    * Last-resort: teleport the car to a random well-connected lane elsewhere
    * in the network. Used when a U-turn cycle keeps re-trapping the car.
    */
   #respawnAtStart() {
      const candidates = [];
      for (const r of this.network.roads) {
         for (const lane of r.lanes) {
            const exits = this.network.getExits(lane);
            if (exits.length === 0) continue;
            candidates.push(lane);
         }
      }
      if (candidates.length === 0) return;
      const lane = candidates[Math.floor(Math.random() * candidates.length)];
      this.lane = lane;
      this.distAlong = 10;
      this.state = 'lane';
      this.internalPath = null;
      this.internalDist = 0;
      this.internalLength = 0;
      this.targetLane = null;
      this.lateralT = 0;
      this.speed = 0;
      this.stuckFrames = 0;
      this.#assignNewTarget();
      this.#chooseNextLane();
      const p = lane.pointAtDistance(this.distAlong);
      this.x = p.x;
      this.y = p.y;
      this.angle = Math.atan2(lane.dir.y, lane.dir.x);
      this.logAction('RESPAWN at start', { laneId: lane.id });
   }

   #assignNewTarget() {
      const allRoads = this.network.roads.filter(r => r !== this.lane.road);
      if (allRoads.length === 0) { this.targetRoad = null; return; }

      const wellConnected = allRoads.filter(r => r.startConn && r.endConn);
      const candidates = wellConnected.length > 0 ? wellConnected : allRoads;
      this.targetRoad = candidates[Math.floor(Math.random() * candidates.length)];
   }

   #roadDistanceTo(fromRoad, target, maxDepth = 6) {
      if (!target || fromRoad === target) return 0;
      const visited = new Set([fromRoad.id]);
      let frontier = [{ road: fromRoad, depth: 0 }];
      while (frontier.length) {
         const next = [];
         for (const { road, depth } of frontier) {
            if (road === target) return depth;
            if (depth >= maxDepth) continue;
            for (const conn of [road.startConn, road.endConn]) {
               if (!conn) continue;
               for (const otherSlot of conn.intersection.slots) {
                  const r = otherSlot.road;
                  if (!r || visited.has(r.id)) continue;
                  visited.add(r.id);
                  next.push({ road: r, depth: depth + 1 });
               }
            }
         }
         frontier = next;
      }
      return Infinity;
   }

   
   #chooseNextLane() {
      const exits = this.network.getExits(this.lane);
      if (!exits.length) {
         this.nextLane = null;
         this.logAction('nextLane=null', { why: 'no exits from lane', laneId: this.lane.id });
         return;
      }

      const candidates = exits.filter(ex => dot(this.lane.dir, ex.dir) > -0.7 || exits.length === 1);
      if (candidates.length === 0) { this.nextLane = exits[0]; this.logAction('nextLane chosen (fallback)', { lane: exits[0].id }); return; }

      let distances = null;
      if (this.targetRoad) {
         distances = candidates.map(ex => this.#roadDistanceTo(ex.road, this.targetRoad));
         const minD = Math.min(...distances);
         if (minD === Infinity) distances = null;
      }

      const weighted = candidates.map((ex, i) => {
         const alignment = dot(this.lane.dir, ex.dir);
         let weight = Math.pow(Math.max(0, alignment + 1.0), 1.4) + 0.4;
         if (distances) {
            const d = distances[i];
            if (d === 0)             weight *= 6.0;
            else if (d === Infinity) weight *= 0.4;
            else                     weight *= 1 + 1.5 / (1 + d);
         }
         return { ex, weight };
      });
      const total = weighted.reduce((s, w) => s + w.weight, 0);
      let r = Math.random() * total;
      let chosen = weighted[0].ex;
      for (const w of weighted) {
         r -= w.weight;
         if (r <= 0) { chosen = w.ex; break; }
      }
      this.nextLane = chosen;
      this.logAction('nextLane chosen', { lane: chosen.id, road: chosen.road.id });

      if (this.nextLane.road !== this.lane.road) {
         this.#prepareInternalPath();
      } else {
         this.internalPath = null;
      }
   }

   #prepareInternalPath() {
      const exitEnd = this.lane.direction === +1 ? 'end' : 'start';
      const conn    = exitEnd === 'end' ? this.lane.road.endConn : this.lane.road.startConn;
      if (!conn) {
         this.internalPath = null;
         this.logAction('prepareInternalPath FAILED', { why: 'no conn at lane end', laneId: this.lane.id });
         return;
      }

      const it = conn.intersection;
      const path = it.getInternalPath(this.lane, this.nextLane);
      if (!path) {
         this.internalPath = null;
         this.logAction('prepareInternalPath FAILED', {
            why: 'no path lane->nextLane',
            laneId: this.lane.id, nextLaneId: this.nextLane ? this.nextLane.id : null,
         });
         return;
      }

      const pts = path.waypoints;
      const segLens = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
         const d = distance(pts[i - 1], pts[i]);
         segLens.push(d);
         total += d;
      }
      this.internalPath     = path;
      this.internalSegments = segLens;
      this.internalLength   = total;
      this.logAction('prepareInternalPath OK', { pathKey: path.key, len: Math.round(total) });
   }

   #distToLaneEnd() {
      if (this.state === 'lane') return this.lane.length - this.distAlong;
      if (this.state === 'internal') return this.internalLength - this.internalDist;
      return 0;
   }

   
   #maybeStartLaneChange(allCars) {
      if (this.targetLane) return;
      if (this.laneChangeCool > 0) return;
      if (this.state !== 'lane') return;
      if (this.lane.road.closed) return;

      if (this.arbiter && !this.arbiter.mayProceed(this) && this.#distToLaneEnd() < 90) return;

      const sameDir = this.network.sameDirectionLanes(this.lane);
      if (!sameDir.length) return;

      const distToEnd = this.#distToLaneEnd();

      if (this.targetRoad && distToEnd < 350 && distToEnd > 30 && this.lane.direction === +1) {
         const conn = this.lane.road.endConn;
         if (conn && conn.intersection.kind === 'roundabout' && this.nextLane) {
            const it = conn.intersection;
            const exitRoad = this.nextLane.road;
            const recommended = this.network.roundaboutLaneForExit(
               this.lane.road, this.lane.direction, it, exitRoad
            );
            if (recommended !== null && recommended !== this.lane.index) {
               const dir = recommended > this.lane.index ? +1 : -1;
               const target = sameDir.find(l => l.index === this.lane.index + dir);
               if (target && this.#laneIsClear(target, allCars)) {
                  this.#beginChange(target, dir > 0 ? 'right' : 'left');
                  return;
               }
            }
         }
      }

      if (this.targetRoad && distToEnd < 350 && distToEnd > 30 && this.lane.direction === +1) {
         const conn = this.lane.road.endConn;
         if (conn && conn.intersection.kind !== 'roundabout') {
            const it = conn.intersection;
            const reachableExits = this.network.getExits(this.lane);
            const canReachTarget = reachableExits.some(ex => {
               return ex.road === this.targetRoad
                   || this.#roadDistanceTo(ex.road, this.targetRoad) < 5;
            });

            if (!canReachTarget) {
               for (const cand of sameDir) {
                  const candExits = this.network.getExits(cand);
                  const candReaches = candExits.some(ex => {
                     return ex.road === this.targetRoad
                         || this.#roadDistanceTo(ex.road, this.targetRoad) < 5;
                  });
                  if (candReaches && this.#laneIsClear(cand, allCars)) {
                     const dir = cand.index > this.lane.index ? +1 : -1;
                     this.#beginChange(cand, dir > 0 ? 'right' : 'left');
                     return;
                  }
               }
            }
         }
      }

      if (distToEnd < 350 && distToEnd > 30 && this.nextLane && this.lane.direction === +1) {
         const category = this.network.classifyExit(this.lane.dir, this.nextLane.dir);
         const recommended = this.network.recommendedLaneIndex(this.lane.road, this.lane.direction, category);
         if (recommended !== null && recommended !== this.lane.index) {
            const dir = recommended > this.lane.index ? +1 : -1;
            const target = sameDir.find(l => l.index === this.lane.index + dir);
            if (target && this.#laneIsClear(target, allCars)) {
               this.#beginChange(target, dir > 0 ? 'right' : 'left');
               return;
            }
         }
      }

      if (distToEnd < 60) return;

      const leftNeighbour  = sameDir.find(l => l.index === this.lane.index - 1);
      const rightNeighbour = sameDir.find(l => l.index === this.lane.index + 1);

      const ahead = this.#carAhead(allCars, 90, this.lane);
      const aheadTooSlow = ahead && (ahead.car.speed < this.#preferredSpeed() * 0.75);

      if (this.stuckFrames > 180) {
         const candidates = [leftNeighbour, rightNeighbour].filter(Boolean);
         for (const cand of candidates) {
            if (this.#laneIsClear(cand, allCars)) {
               const side = cand === leftNeighbour ? 'left' : 'right';
               this.#beginChange(cand, side);
               return;
            }
         }
      }

      if (aheadTooSlow && rightNeighbour && Math.random() < this.params.overtakeUrge * 0.06) {
         if (this.#laneIsClear(rightNeighbour, allCars)) {
            this.#beginChange(rightNeighbour, 'right');
            return;
         }
      }

      if (leftNeighbour && !aheadTooSlow) {
         const probs = this.params.lanePref === 'left' ? 0.04 : 0.005;
         if (Math.random() < probs && this.#laneIsClear(leftNeighbour, allCars)) {
            this.#beginChange(leftNeighbour, 'left');
            return;
         }
      }
   }

   #beginChange(targetLane, side) {
      
      if (targetLane.road !== this.lane.road) return;
      if (targetLane.direction !== this.lane.direction) return;
      if (Math.abs(targetLane.index - this.lane.index) !== 1) return;
      this.targetLane = targetLane;
      this.lateralSign = targetLane.index > this.lane.index ? +1 : -1;
      this.laneChangeIndicator = side;
   }

   #laneIsClear(lane, allCars) {
      
      if (lane.road !== this.lane.road) return false;
      if (lane.direction !== this.lane.direction) return false;

      const fwdClear = this.params.followDist * 1.4;
      const revClear = this.params.followDist * 0.7;
      for (const c of allCars) {
         if (c === this) continue;
         if (c.lane !== lane) continue;
         if (c.state !== 'lane') continue;
         const gap = c.distAlong - this.distAlong;
         if (gap > 0 && gap < fwdClear) return false;
         if (gap < 0 && -gap < revClear) return false;
      }

      
      if (this.network.closures) {
         for (const cl of this.network.closuresOnLane(lane)) {
            
            if (cl.distStart > this.distAlong - 10 && cl.distStart < this.distAlong + 140) return false;
            
            if (this.distAlong + 20 >= cl.distStart && this.distAlong <= cl.distEnd + 20) return false;
         }
      }
      return true;
   }

   #preferredSpeed() {
      let limit = this.lane.road.speedLimit;
      const onLane = this.network.markingsOnLane(this.lane);
      let mostRecent = null;
      for (const m of onLane) {
         if (m.type !== 'speedlimit') continue;
         if (m.distance <= this.distAlong && (!mostRecent || m.distance > mostRecent.distance)) {
            mostRecent = m;
         }
      }
      if (mostRecent) limit = mostRecent.limit;
      return limit * this.params.speedMul;
   }

   activeIndicator() {
      if (this.laneChangeIndicator) return this.laneChangeIndicator;
      if (!this.params.usesIndicators) return null;

      if (this.state === 'internal' && this.internalPath) {
         if (this.internalPath.category === 'left')  return 'left';
         if (this.internalPath.category === 'right') return 'right';
         return null;
      }

      if (this.state === 'lane' && this.nextLane && this.lane.direction === +1) {
         const distToEnd = this.lane.length - this.distAlong;
         if (distToEnd > 220) return null;

         const inDir = this.lane.dir;
         const outDir = this.nextLane.dir;
         const dot = inDir.x * outDir.x + inDir.y * outDir.y;
         const cross = inDir.x * outDir.y - inDir.y * outDir.x;
         if (dot > 0.7) return null;
         if (cross < 0) return 'left';
         return 'right';
      }
      return null;
   }


   /**
    * Geometric safety brake — the last line of defense. Looks at every car
    * within SAFETY_RADIUS. For any that's roughly in front (forward dot > 0.5)
    * and roughly heading the same way (heading dot > 0.4), measures the
    * projected forward gap. If gap < HARD_STOP_DIST, force speed to 0
    * (emergency). If gap < SOFT_BRAKE_DIST, ramp speed down toward 0.
    *
    * Returns null if safe, or { desired, emergency } describing the brake
    * the caller should apply on top of its other speed constraints.
    *
    * IMPORTANT: This brake exists because the higher-level decisions (arbiter
    * admission, carAhead, lane-change targeting) are not perfectly correct
    * 100% of the time. When something slips through, this catches it. With
    * single-occupancy junctions the brake almost never fires for normal
    * traffic flow.
    */
   #safetyCheck(allCars) {
      const myDir = new Point(Math.cos(this.angle), Math.sin(this.angle));
      const SAFETY_RADIUS = 60;
      const HARD_STOP_DIST = 22;
      const SOFT_BRAKE_DIST = 38;

      let worst = null;

      for (const c of allCars) {
         if (c === this) continue;

         const dx = c.x - this.x;
         const dy = c.y - this.y;
         const d  = Math.hypot(dx, dy);
         if (d > SAFETY_RADIUS) continue;
         if (d < 0.5) continue;

         const forwardComp = (dx * myDir.x + dy * myDir.y) / d;
         if (forwardComp < 0.2) continue;

         const otherDir = new Point(Math.cos(c.angle), Math.sin(c.angle));
         const sameish = (myDir.x * otherDir.x + myDir.y * otherDir.y) > 0.4;
         if (!sameish && c.speed > 0.3) continue;

         const lateralOff = Math.abs(dx * myDir.y - dy * myDir.x);
         if (lateralOff > 22) continue;

         if (!worst || d < worst.d) worst = { car: c, d };
      }

      if (!worst) return null;

      const d = worst.d;
      if (d < HARD_STOP_DIST) {
         return { desired: 0, emergency: true };
      }
      if (d < SOFT_BRAKE_DIST) {
         const ramp = (d - HARD_STOP_DIST) / (SOFT_BRAKE_DIST - HARD_STOP_DIST);
         return { desired: this.#preferredSpeed() * ramp * 0.4, emergency: false };
      }
      return null;
   }

   
   #carAhead(allCars, range = 100, specificLane = null) {
      
      
      const checkLane = specificLane || this.lane;
      let best = null, bestD = range;

      for (const c of allCars) {
         if (c === this) continue;
         if (this.state === 'lane' && c.state === 'lane' && c.lane === checkLane) {
            const gap = c.distAlong - this.distAlong;
            if (gap > 0 && gap < bestD) { bestD = gap; best = c; }
         }
         // Look-ahead through the upcoming junction onto the exit lane.
         // We only do this when in `lane` state — adding `internalLength`
         // makes sense only when distToEnd is the lane-end distance.
         // Doing it in `internal` state would double-count the path length.
         if (!specificLane && this.state === 'lane') {
            const distToEnd = this.#distToLaneEnd();
            if (distToEnd < range) {
               if (c.state === 'internal' && this.internalPath
                   && c.internalPath === this.internalPath) {
                  const gap = distToEnd + c.internalDist;
                  if (gap > 0 && gap < bestD) { bestD = gap; best = c; }
               }
               if (this.nextLane && c.state === 'lane' && c.lane === this.nextLane) {
                  const gap = distToEnd + (this.internalLength || 0) + c.distAlong;
                  if (gap > 0 && gap < bestD) { bestD = gap; best = c; }
               }
            }
         }
      }

      // While inside the junction (internal state):
      // - look at cars further along the SAME internal path (already handled)
      // - look at cars on our exit lane that we will join after the junction
      if (!specificLane && this.state === 'internal') {
         const distToInternalEnd = this.internalLength - this.internalDist;
         for (const c of allCars) {
            if (c === this) continue;
            if (c.state === 'internal' && c.internalPath === this.internalPath) {
               const gap = c.internalDist - this.internalDist;
               if (gap > 0 && gap < bestD) { bestD = gap; best = c; }
            }
            if (this.nextLane && c.state === 'lane' && c.lane === this.nextLane) {
               const gap = distToInternalEnd + c.distAlong;
               if (gap > 0 && gap < bestD) { bestD = gap; best = c; }
            }
         }
      }

      return best ? { car: best, dist: bestD } : null;
   }

   #markingAhead(range = 120, controlOnly = false) {
      if (this.state !== 'lane') return null;
      const isControl = m => m.type === 'stop' || m.type === 'yield' || m.type === 'light' || m.type === 'crossing';
      const filter = m => m.distance > this.distAlong && (!controlOnly || isControl(m));
      const onLane = this.network.markingsOnLane(this.lane).filter(filter);
      if (onLane.length) {
         const m = onLane[0];
         return { marking: m, dist: m.distance - this.distAlong };
      }
      if (this.nextLane && this.#distToLaneEnd() < range) {
         const onNext = this.network.markingsOnLane(this.nextLane).filter(m => !controlOnly || isControl(m));
         if (onNext.length) {
            const m = onNext[0];
            return { marking: m, dist: this.#distToLaneEnd() + (this.internalLength || 0) + m.distance };
         }
      }
      return null;
   }

   
   #closureAhead() {
      if (this.state !== 'lane' || !this.network.closures) return null;
      const closures = this.network.closuresOnLane(this.lane);
      for (const c of closures) {
         if (c.distStart > this.distAlong) {
            return { closure: c, dist: c.distStart - this.distAlong };
         }
         
         if (this.distAlong >= c.distStart && this.distAlong <= c.distEnd) {
            return { closure: c, dist: 0 };
         }
      }
      return null;
   }

   
   #laneHasClosureAt(lane, dist) {
      if (!this.network.closures) return false;
      return this.network.closuresOnLane(lane).some(c =>
         dist >= c.distStart - 30 && dist <= c.distEnd + 30
      );
   }

   #oncomingOnSingleTrack(allCars) {
      if (!this.lane.road.singleTrack) return null;
      const myDir = this.lane.dir;
      let best = null, bestD = 200;
      for (const c of allCars) {
         if (c === this) continue;
         if (c.state !== 'lane') continue;
         if (c.lane.road !== this.lane.road) continue;
         if (dot(c.lane.dir, myDir) > 0) continue;
         const d = distance(new Point(this.x, this.y), new Point(c.x, c.y));
         if (d < bestD) { bestD = d; best = c; }
      }
      return best ? { car: best, dist: bestD } : null;
   }

   #nearestLayByForward() {
      const onLane = this.network.markingsOnLane(this.lane);
      let best = null, bestD = Infinity;
      for (const m of onLane) {
         if (m.type !== 'layby') continue;
         const d = m.distance - this.distAlong;
         if (d > 0 && d < bestD) { bestD = d; best = m; }
      }
      return best ? { marking: best, dist: bestD } : null;
   }

   #nearestLayByBehind() {
      const onLane = this.network.markingsOnLane(this.lane);
      let best = null, bestD = Infinity;
      for (const m of onLane) {
         if (m.type !== 'layby') continue;
         const d = this.distAlong - m.distance;
         if (d > 0 && d < bestD) { bestD = d; best = m; }
      }
      return best ? { marking: best, dist: bestD } : null;
   }

   
   
   
   
   
   
   
   
   
   
   
   
   setOverride(action) {
      this.override = action;
      this.overrideFrames = {
         'force-overtake': 240,
         'tailgate':       360,
         'ignore-stop':    600,
         'ignore-light':   360,
         'ignore-closure': 480,
         'speed-up':       240,
      }[action] || 240;

      
      
      if (action === 'ignore-stop') {
         const m = this.#markingAhead(200, true);
         if (m && m.marking.type === 'stop') {
            this.servedStopIds.add(m.marking.id);
         }
      }

      
      
      if (action === 'force-overtake') {
         const sameDir = this.network.sameDirectionLanes(this.lane);
         const rightNeighbour = sameDir.find(l => l.index === this.lane.index + 1);
         if (rightNeighbour && !this.targetLane) {
            this.#beginChange(rightNeighbour, 'right');
         }
      }
   }

   /**
    * Per-frame entry point. Called from Simulation.tick() once per sim step
    * for every car in the simulation.
    *
    * Order of operations:
    *   1. Decay timers (stopCooldown, laneChangeCool, overrideFrames)
    *   2. Maybe start a lane change based on heuristics
    *   3. Compute desired speed from ALL active constraints (signs, lights,
    *      arbiter mayProceed, carAhead, corner factor, closures, etc.)
    *      The MOST RESTRICTIVE constraint wins because each clause uses
    *      `Math.min(desired, ...)`.
    *   4. Apply safety-brake check that overrides everything if a hard-stop
    *      is needed
    *   5. Smoothly accelerate/brake actual speed toward desired
    *   6. Move forward (advance distAlong / internalDist)
    *   7. Handle lane-end, internal-path-end, U-turns, respawn
    *   8. Update render position (x, y, angle) — including lane-change
    *      lateral interpolation
    *
    * @param allCars  the full list of cars in the simulation, used for
    *                 carAhead detection, oncoming checks, etc.
    */
   update(allCars) {
      if (this.stopCooldown > 0)   this.stopCooldown--;
      if (this.laneChangeCool > 0) this.laneChangeCool--;
      if (this.overrideFrames > 0) {
         this.overrideFrames--;
         if (this.overrideFrames === 0) this.override = null;
      }

      this.#maybeStartLaneChange(allCars);

      const limit = this.#preferredSpeed();
      let desired = limit;
      let emergency = false;

      
      if (this.stopHoldFrames > 0) {
         this.stopHoldFrames--;
         desired = 0;
         this.headCheck += 0.06;
      } else {
         this.headCheck = Math.max(0, this.headCheck - 0.05);

         
         const m = this.#markingAhead(120, true);
         const isServedStop = m && m.marking.type === 'stop' && this.servedStopIds.has(m.marking.id);
         const ignoringLight = this.override === 'ignore-light' && m && m.marking.type === 'light';
         if (m && this.params.obeysSigns && !isServedStop && !ignoringLight) {
            const dir = m.marking.directive(m.dist);
            if (dir === 'stop') {
               desired = 0;
               if (this.speed < 0.08 && m.dist < 30 && this.stopCooldown === 0
                                     && m.marking.type === 'stop') {
                  this.stopHoldFrames = 90;
                  this.stopCooldown   = 240;
                  this.servedStopIds.add(m.marking.id);
               }
            } else if (dir === 'slow') {
               desired = Math.min(desired, limit * 0.4);
            }
         }

         
         let effectiveFollowDist = this.params.followDist;
         let effectiveMinGap     = this.params.minGap;
         if (this.override === 'tailgate') {
            effectiveFollowDist = 16;
            effectiveMinGap     = 12;   
         }

         
         if (this.lane.road.singleTrack && this.state === 'lane') {
            const oncoming = this.#oncomingOnSingleTrack(allCars);
            if (oncoming) {
               const myLayBy   = this.#nearestLayByForward();
               const myEnd     = this.#distToLaneEnd();
               const myYieldDist = Math.min(myLayBy?.dist ?? Infinity, myEnd);

               const oCar = oncoming.car;
               const oLane = oCar.lane;
               const oToHead = distance(new Point(oCar.x, oCar.y), new Point(this.x, this.y));
               const oLayBy = oCar.network.markingsOnLane(oLane).filter(m => m.type === 'layby')
                  .map(m => ({ m, d: m.distance - oCar.distAlong }))
                  .filter(x => x.d > 0)
                  .sort((a, b) => a.d - b.d)[0];
               const oEnd = oLane.length - oCar.distAlong;
               const oYieldDist = Math.min(oLayBy?.d ?? Infinity, oEnd);

               const iShouldYield = myYieldDist <= oYieldDist;

               if (iShouldYield) {
                  if (myLayBy && myLayBy.dist < 80) {
                     const stopDist = Math.max(0, (myLayBy.dist - 8) / 30);
                     desired = Math.min(desired, limit * stopDist);
                  } else if (oToHead < 100) {
                     desired = 0;
                     emergency = oToHead < 50;

                     if (oToHead < 80 && this.speed < 0.05) {
                        const layByBehind = this.#nearestLayByBehind();
                        const safeRev = (layByBehind && layByBehind.dist < 60)
                                     || this.distAlong > 12;
                        if (safeRev) {
                           this.reverseFrames = 30;
                        }
                     }
                  }
               }
            }
         }

         if (this.reverseFrames > 0) {
            this.reverseFrames--;
            desired = -0.4;
            emergency = false;
         }

         const ahead = this.#carAhead(allCars, 180);
         if (ahead) {
            const gap = ahead.dist;
            const absoluteMin = this.override === 'tailgate'
                  ? effectiveMinGap
                  : Math.max(MIN_SAFETY_GAP, effectiveMinGap);
            if (gap < absoluteMin) {
               desired = 0;
               emergency = this.override !== 'tailgate';
            } else if (gap < absoluteMin + 12) {
               desired = Math.min(desired, ahead.car.speed * 0.4);
            } else {
               const target = Math.max(absoluteMin + 14, effectiveFollowDist);
               if (gap < target * 0.6) {
                  desired = Math.min(desired, ahead.car.speed * 0.65);
               } else if (gap < target * 2.2) {
                  const t = (gap - target * 0.6) / (target * 1.6);
                  desired = Math.min(desired, ahead.car.speed + t * (limit - ahead.car.speed));
               }
            }
         }

         
         if (this.nextLane && this.#distToLaneEnd() < 80 && !this.targetLane && this.state === 'lane') {
            const turn = Math.abs(angleDiff(angleOf(this.nextLane.dir), angleOf(this.lane.dir)));
            if (turn > 0.3) {
               const ramp = this.#distToLaneEnd() / 80;
               const tf   = 1 - (1 - this.params.cornerFactor) * (1 - ramp) * Math.min(1, turn / 1.5);
               desired = Math.min(desired, limit * tf);
            }
         }

         
         
         const closureAhead = this.override !== 'ignore-closure' ? this.#closureAhead() : null;
         if (closureAhead) {
            const { closure, dist } = closureAhead;
            if (dist < 220) {
               const sameDir = this.network.sameDirectionLanes(this.lane);
               const alt = sameDir.find(l => !this.#laneHasClosureAt(l, this.distAlong + dist));
               if (alt && !this.targetLane && this.laneChangeCool === 0) {
                  if (this.#laneIsClear(alt, allCars)) {
                     const side = alt.index > this.lane.index ? 'right' : 'left';
                     this.#beginChange(alt, side);
                  }
               }
               if (dist < 90) {
                  const brakeRamp = Math.max(0, (dist - 25) / 60);
                  desired = Math.min(desired, limit * brakeRamp);
               } else if (dist < 160) {
                  desired = Math.min(desired, limit * 0.55);
               }
            }
         }

         
         if (this.arbiter && this.state === 'lane' && !this.arbiter.mayProceed(this)) {
            const d = this.#distToLaneEnd();
            if (d < 130) {
               const stopAt = 8;
               if (d < stopAt) {
                  desired = 0;
                  emergency = true;
               } else if (d < 60) {
                  const ramp = (d - stopAt) / 52;
                  desired = Math.min(desired, limit * ramp * 0.35);
               } else {
                  const ramp = (d - 60) / 70;
                  desired = Math.min(desired, limit * (0.35 + ramp * 0.35));
               }
            }
         }

         
         if (this.nextLane && this.nextLane.road.closed) {
            desired = Math.min(desired, Math.max(0, (this.#distToLaneEnd() - 20) / 40));
         }

         if (this.targetLane) {
            desired = Math.min(desired, limit * 0.85);
         }

         // While inside an intersection, gently moderate speed.
         // Straight-through paths get a soft 90% cap (negligible).
         // Turning paths get a stronger cap based on how sharp the turn is.
         if (this.state === 'internal') {
            const cat = this.internalPath ? this.internalPath.category : 'straight';
            if (cat === 'left') {
               desired = Math.min(desired, limit * 0.70);
            } else if (cat === 'right') {
               desired = Math.min(desired, limit * 0.65);
            } else {
               desired = Math.min(desired, limit * 0.90);
            }
         }

         if (this.lane.road.mergeTarget && this.state === 'lane' && this.lane.direction === +1 && !this.merging) {
            const merge = this.lane.road.mergeTarget;
            const targetRoad = merge.intoRoad;
            const targetLane = targetRoad.lanes.find(l => l.direction === +1 && l.index === 0);
            if (targetLane) {
               const targetLimit = targetRoad.speedLimit * this.params.speedMul * 0.92;
               desired = Math.max(desired, targetLimit);

               const progress = this.distAlong / this.lane.length;
               if (progress > 0.35) {
                  let safe = true;
                  let projAlong = merge.projectFrom + (progress - 0.35) * (merge.projectTo - merge.projectFrom) / 0.65;
                  for (const c of allCars) {
                     if (c === this) continue;
                     if (c.lane !== targetLane) continue;
                     const gap = c.distAlong - projAlong;
                     if (Math.abs(gap) < 50) { safe = false; break; }
                  }
                  if (safe && this.speed > targetLimit * 0.7) {
                     this.merging = {
                        sourceLane: this.lane,
                        sourceDistStart: this.distAlong,
                        targetLane,
                        targetDistStart: projAlong,
                        framesTotal: 28,
                        framesElapsed: 0,
                     };
                  } else if (!safe) {
                     desired = Math.max(desired, targetLimit * 0.95);
                  }
               }
            }
         }

         if (this.nextLane
             && this.nextLane.road.roadClass === 'highway'
             && this.lane.road.roadClass !== 'highway'
             && this.#distToLaneEnd() < 80
             && this.state === 'lane') {
            const targetSpeed = this.nextLane.road.speedLimit * this.params.speedMul * 0.85;
            desired = Math.max(desired, targetSpeed);
         }

         if (this.override === 'speed-up') {
            desired = Math.max(desired, limit * 1.35);
         }
      }

      const safety = this.#safetyCheck(allCars);
      if (safety) {
         desired = Math.min(desired, safety.desired);
         if (safety.emergency) {
            emergency = true;
            if (!this.lastSafetyLogFrame || this.lastSafetyLogFrame < (this.actionLog.length - 5)) {
               this.logAction('SAFETY emergency-brake', {
                  desired: Math.round(safety.desired * 100) / 100,
               });
               this.lastSafetyLogFrame = this.actionLog.length;
            }
         }
      }

      this.desiredBuffer.push(desired);
      if (this.desiredBuffer.length > this.params.reactionFrames + 1) this.desiredBuffer.shift();
      const effDesired = emergency ? 0 : (this.desiredBuffer[0] ?? desired);

      
      this.braking = effDesired < this.speed - 0.05;
      const accel = 0.018 * this.params.accelMul;
      const brake = 0.055 * this.params.brakeMul;
      const friction = 0.006;
      if (this.speed < effDesired) {
         const gap = effDesired - this.speed;
         this.speed = Math.min(effDesired, this.speed + Math.min(accel, gap * 0.3));
      } else {
         this.speed = Math.max(effDesired, this.speed - (this.braking ? brake : friction));
      }
      if (this.reverseFrames > 0) {
         this.speed = Math.max(-0.5, Math.min(0, this.speed - 0.04));
      } else {
         this.speed = Math.max(0, this.speed);
      }

      const limitRoad = this.merging ? this.merging.targetLane.road : this.lane.road;
      const hardLimit = limitRoad.speedLimit * 1.05;
      if (this.speed > hardLimit) this.speed = hardLimit;

      if (Math.abs(this.speed) < 0.03 && this.stopHoldFrames === 0) this.stuckFrames++;
      else this.stuckFrames = 0;

      
      if (this.state === 'lane') {
         this.distAlong += this.speed;

         
         if (this.targetLane) {
            const step = this.params.laneChangeSpeed;
            this.lateralT += step * this.lateralSign;
            if (Math.abs(this.lateralT) >= 1) {
               this.lane = this.targetLane;
               this.targetLane = null;
               this.lateralT = 0;
               this.laneChangeCool = 90;
               this.laneChangeIndicator = null;
               this.#chooseNextLane();
            }
         }

         
         if (this.distAlong >= this.lane.length && !this.targetLane) {
            if (this.internalPath) {
               this.state = 'internal';
               this.internalIdx  = 0;
               this.internalDist = 0;
               this.logAction('-> internal', { pathKey: this.internalPath.key });
            } else if (this.nextLane && this.nextLane.road === this.lane.road) {
               const overflow = this.distAlong - this.lane.length;
               this.lane = this.nextLane;
               this.distAlong = overflow;
               this.logAction('-> next lane (same road)', { laneId: this.lane.id });
               this.#chooseNextLane();
            } else {
               this.distAlong = this.lane.length;
               this.speed = 0;
               this.logAction('STUCK at lane end', {
                  why: 'no internalPath and no same-road nextLane',
                  laneId: this.lane.id,
                  nextLaneId: this.nextLane ? this.nextLane.id : null,
               });
               this.deadEndFrames = (this.deadEndFrames || 0) + 1;
               if (this.deadEndFrames > 60) {
                  if ((this.recentUTurns || 0) >= 3) {
                     this.#respawnAtStart();
                     this.deadEndFrames = 0;
                     this.recentUTurns = 0;
                  } else if (this.#tryUTurn()) {
                     this.deadEndFrames = 0;
                  } else if (this.deadEndFrames > 180) {
                     this.#respawnAtStart();
                     this.deadEndFrames = 0;
                  }
               }
            }
         } else {
            this.deadEndFrames = 0;
         }
      } else if (this.state === 'internal') {
         this.internalDist += this.speed;
         if (this.internalDist >= this.internalLength) {
            const overflow = this.internalDist - this.internalLength;
            this.state = 'lane';
            this.lane  = this.nextLane;
            this.distAlong = overflow;
            this.internalPath = null;
            this.recentUTurns = Math.max(0, (this.recentUTurns || 0) - 1);
            this.logAction('-> lane (internal complete)', { laneId: this.lane.id });
            if (this.targetRoad === this.lane.road) this.#assignNewTarget();
            this.#chooseNextLane();
         }
      }

      
      if (this.merging) {
         this.merging.framesElapsed++;
         const t = this.merging.framesElapsed / this.merging.framesTotal;
         const tEase = t * t * (3 - 2 * t);

         const advance = this.speed * this.merging.framesElapsed;
         const sourceDist = Math.min(this.merging.sourceLane.length, this.merging.sourceDistStart + advance);
         const targetDist = Math.min(this.merging.targetLane.length, this.merging.targetDistStart + advance);
         const sp = this.merging.sourceLane.pointAtDistance(sourceDist);
         const tp = this.merging.targetLane.pointAtDistance(targetDist);
         this.x = sp.x + (tp.x - sp.x) * tEase;
         this.y = sp.y + (tp.y - sp.y) * tEase;

         const sa = angleOf(this.merging.sourceLane.dir);
         const ta = angleOf(this.merging.targetLane.dir);
         this.angle = sa + angleDiff(ta, sa) * tEase;

         if (this.merging.framesElapsed >= this.merging.framesTotal) {
            this.lane = this.merging.targetLane;
            this.distAlong = targetDist;
            this.targetLane = null;
            this.lateralT = 0;
            this.lateralSign = 0;
            this.nextLane = null;
            this.#chooseNextLane();
            this.merging = null;
         }
         return;
      }

      if (this.state === 'lane') {
         const base = this.lane.pointAtDistance(this.distAlong);

         const roadLeftPerp = this.lane.road.leftPerp;
         const tIdx = this.targetLane ? (this.targetLane.index - this.lane.index) : 0;
         const sign = Math.sign(tIdx);
         const perpShift = scale(roadLeftPerp, sign * LANE_WIDTH * Math.abs(this.lateralT));
         this.x = base.x + perpShift.x;
         this.y = base.y + perpShift.y;

         let targetAngle = angleOf(this.lane.dir);

         if (this.targetLane && Math.abs(this.lateralT) < 1) {
            const phase = this.lateralT * Math.PI;
            const turnAmount = Math.sin(phase) * sign * 0.22;
            const perpAngle = Math.atan2(roadLeftPerp.y, roadLeftPerp.x);
            const offset = perpAngle - angleOf(this.lane.dir);
            targetAngle += turnAmount * Math.sign(offset || 1);
         }

         if (this.stopHoldFrames > 0) {
            targetAngle += Math.sin(this.headCheck * 2) * 0.35;
         }
         this.angle += clamp(angleDiff(targetAngle, this.angle), -0.12, 0.12);
      } else if (this.state === 'internal') {
         
         const pts = this.internalPath.waypoints;
         let remaining = this.internalDist;
         for (let i = 0; i < this.internalSegments.length; i++) {
            const segLen = this.internalSegments[i];
            if (remaining <= segLen || i === this.internalSegments.length - 1) {
               const t = segLen > 0 ? remaining / segLen : 0;
               const p = lerp2D(pts[i], pts[i + 1], Math.min(1, t));
               this.x = p.x; this.y = p.y;
               const segDir = normalize(subtract(pts[i + 1], pts[i]));
               const targetAngle = angleOf(segDir);
               this.angle += clamp(angleDiff(targetAngle, this.angle), -0.14, 0.14);
               break;
            }
            remaining -= segLen;
         }
      }
   }

   
   draw(ctx) {
      const w = 16, h = 26;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle + Math.PI / 2);

      ctx.fillStyle = this.isMain ? '#66ccff' : this.params.colour;
      ctx.fillRect(-w/2, -h/2, w, h);

      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-w/2 + 2, -h/2 + 2, w - 4, h * 0.20);

      if (this.braking || this.speed < 0.05) {
         ctx.fillStyle = 'rgba(255,30,30,0.9)';
         ctx.fillRect(-w/2 + 1, h/2 - 4, w - 2, 3);
      }

      const indicator = this.activeIndicator();
      const blinkOn = indicator && Math.floor(performance.now() / 350) % 2 === 0;
      if (blinkOn) {
         const xLeft  = -w/2 - 1;
         const xRight =  w/2 - 2;
         const yFront = -h/2 + 1;
         const yRear  =  h/2 - 4;

         const drawLight = (x, y) => {
            ctx.save();
            ctx.shadowColor = '#ffaa00';
            ctx.shadowBlur = 6;
            ctx.fillStyle = '#ffcc00';
            ctx.fillRect(x, y, 4, 4);
            ctx.restore();
         };

         if (indicator === 'left') {
            drawLight(xLeft, yFront);
            drawLight(xLeft, yRear);
         } else if (indicator === 'right') {
            drawLight(xRight, yFront);
            drawLight(xRight, yRear);
         }
      }

      ctx.restore();

      
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.70)';
      ctx.fillRect(this.x - 28, this.y - 30, 56, 11);
      ctx.fillStyle = '#fff';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      const label = this.isMain ? 'MAIN' : this.params.label.split(' ')[0].toUpperCase();
      ctx.fillText(label, this.x, this.y - 22);
      ctx.restore();
   }
}
