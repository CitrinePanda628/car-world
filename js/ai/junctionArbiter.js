/* ============================================================================
 * junctionArbiter.js
 * ----------------------------------------------------------------------------
 * Decides WHO is allowed to be inside an intersection at any given moment.
 *
 * WHY THIS FILE EXISTS:
 *   Without an arbiter cars would collide at junctions because their internal
 *   paths cross geometrically. We could try to compute a path-conflict graph
 *   (does car A's path cross car B's path? who yields?) but every previous
 *   version of that approach had bugs. Instead this arbiter uses a far simpler
 *   model: SINGLE-OCCUPANCY per arm. Only one approach arm uses the junction
 *   at a time. Cars from the same arm may follow each other (they share
 *   geometric corridor), but a different arm has to wait for the junction
 *   to clear. For roundabouts the rule is relaxed: any arm can enter as long
 *   as its sector of the ring is clear, matching real UK roundabout etiquette.
 *
 * HOW IT WORKS:
 *   - Per-junction state record holds {occupants Set, occupantSlot, clearFrames}
 *   - Each frame: tick(cars) ->
 *        1. syncStates: ensure every road-network junction has a state record
 *        2. cleanup:    remove occupants that have left (geometrically or by
 *                       lane transition) or that have been frozen too long
 *                       (eviction safety net so the junction never deadlocks)
 *        3. admit:      look at every car approaching this junction, sort by
 *                       distance, then admit cars one by one according to the
 *                       junction's policy
 *   - Cars query mayProceed(car) every frame from their own update loop.
 *     If true: the car may continue. If false: the car brakes (at its own
 *     discretion in car.js — the arbiter does not directly modify speed).
 *
 * WHO CALLS THIS:
 *   - Simulation.tick() calls arbiter.tick(this.cars) once per sim-step
 *   - Car.update() calls this.arbiter.mayProceed(this) when in lane state
 *     near a junction, to decide whether to brake into the lane end
 *
 * KEY CONSTANTS:
 *   JUNCTION_CLAIM_DIST   how far before a junction a car starts asking to
 *                         be admitted (130 px ≈ 6.5 m at sim scale)
 *   STUCK_EVICT_FRAMES    if an occupant has speed≈0 for this many frames
 *                         while still inside the junction, force-evict it.
 *                         Prevents permanent deadlock if a car somehow gets
 *                         physically wedged.
 *   COURTESY_GAP_FRAMES   number of empty-junction frames required before
 *                         the next arm may enter. Currently 0 (no artificial
 *                         delay). Was 6 but felt sluggish.
 *   SAME_SLOT_LEADER_GAP  when admitting a follower from the same arm, the
 *                         leader must already be at least this far into the
 *                         junction (px). Prevents follower colliding with
 *                         leader at the entry mouth.
 * ============================================================================ */

const JUNCTION_CLAIM_DIST  = 130;
const STUCK_EVICT_FRAMES   = 120;
const COURTESY_GAP_FRAMES  = 0;
const SAME_SLOT_LEADER_GAP = 18;

class JunctionArbiter {
   /**
    * @param {RoadNetwork} network the same network shared by Simulation
    *        and the Cars; we read network.junctions and network.markingsOnLane
    */
   constructor(network) {
      this.network = network;
      // Map<junctionKey, stateObject>. Key is "x_y" of the junction's
      // representative point. State object shape:
      //   { junction, occupants:Set<Car>, occupantSlot:number|null,
      //     clearFrames:number }
      this.junctionStates = new Map();
   }

   /**
    * Per-frame entry point. Run after the network has been ticked but before
    * the cars update so that mayProceed() reflects the latest admission state.
    */
   tick(cars) {
      this.#syncStates();
      for (const state of this.junctionStates.values()) {
         this.#cleanup(state, cars);
         this.#admit(state, cars);
      }
   }

   /**
    * Public query used by each Car to decide whether to brake near a junction.
    * Returns true if the car is either (a) not approaching a junction, (b)
    * already an admitted occupant, or (c) the junction has no state record.
    * Returns false if the car is approaching but not yet admitted.
    */
   mayProceed(car) {
      const j = this.#approachingJunction(car);
      if (!j) return true;
      const state = this.junctionStates.get(this.#keyOf(j));
      if (!state) return true;
      return state.occupants.has(car);
   }

   // ---- internal helpers ----------------------------------------------------

   /** Stable string key for a junction by its position. */
   #keyOf(junction) {
      return `${Math.round(junction.point.x)}_${Math.round(junction.point.y)}`;
   }
   /**
    * Make sure every junction in the road network has a state record, and
    * that no stale state record points at a deleted junction. This keeps
    * the map in sync with editor changes (add/remove intersection).
    */
   #syncStates() {
      for (const j of this.network.junctions) {
         const key = this.#keyOf(j);
         if (!this.junctionStates.has(key)) {
            this.junctionStates.set(key, {
               junction: j,
               occupants: new Set(),
               occupantSlot: null,
               clearFrames: COURTESY_GAP_FRAMES,
            });
         }
      }
      for (const key of [...this.junctionStates.keys()]) {
         if (!this.network.junctions.some(j => this.#keyOf(j) === key)) {
            this.junctionStates.delete(key);
         }
      }
   }

   /**
    * Returns the junction the given car is approaching, or null. A car is
    * approaching when:
    *   - it is in `lane` state (not already inside or in transit elsewhere)
    *   - the remaining distance to its lane end is within JUNCTION_CLAIM_DIST
    *   - the lane's terminal point coincides with a junction's representative
    *     point (within (radius + 8) px tolerance — radius accounts for the
    *     fact that the lane end sits on the intersection's perimeter, not at
    *     the centre)
    */
   #approachingJunction(car) {
      if (car.state !== 'lane') return null;
      const distToEnd = car.lane.length - car.distAlong;
      if (distToEnd > JUNCTION_CLAIM_DIST) return null;
      const endPoint = car.lane.direction === +1 ? car.lane.road.end : car.lane.road.start;
      for (const j of this.network.junctions) {
         const it = j.intersection;
         const tolerance = it ? (it.radius || 12) + 8 : 12;
         if (distance(j.point, endPoint) < tolerance) return j;
      }
      return null;
   }

   /**
    * Maps a car to the slot index of the intersection it's approaching.
    * Slots are the discrete arms of an intersection. We look for a slot whose
    * road matches the car's lane and whose 'end' (start|end of road) matches
    * the direction the car is travelling (forward = 'end', reverse = 'start').
    */
   #slotIdxForApproach(car, intersection) {
      const wantEnd = car.lane.direction === +1 ? 'end' : 'start';
      for (const s of intersection.slots) {
         if (s.road === car.lane.road && s.end === wantEnd) return s.index;
      }
      return null;
   }

   /**
    * Returns the colour ('red'|'yellow'|'green') of the upcoming traffic
    * light, or null if there is none. Crucially, also checks SIBLING lanes
    * on the same road in the same direction — multi-lane roads typically
    * have a single light marking on lane 0 but it applies to all lanes.
    */
   #lightStateAhead(car) {
      const check = (lane) => {
         const ms = this.network.markingsOnLane(lane);
         for (const m of ms) {
            if (m.type !== 'light') continue;
            const ahead = m.distance - car.distAlong;
            if (ahead > -5 && ahead < JUNCTION_CLAIM_DIST + 30) return m.state;
         }
         return null;
      };
      const direct = check(car.lane);
      if (direct) return direct;
      for (const lane of car.lane.road.lanes) {
         if (lane === car.lane) continue;
         if (lane.direction !== car.lane.direction) continue;
         const sib = check(lane);
         if (sib) return sib;
      }
      return null;
   }

   /** True if there is a stop sign within the claim distance. */
   #isStopControlled(car) {
      const ms = this.network.markingsOnLane(car.lane);
      for (const m of ms) {
         if (m.type !== 'stop') continue;
         const ahead = m.distance - car.distAlong;
         if (ahead > 0 && ahead < JUNCTION_CLAIM_DIST + 30) return true;
      }
      return false;
   }


   

   /**
    * Remove occupants that have left the junction or are demonstrably stuck.
    *
    * An occupant is removed when:
    *   1. The car was deleted from the simulation (no longer in cars list)
    *   2. The car is now in `lane` state on a road OTHER than its entry road,
    *      meaning it has completed traversal and is on the exit lane
    *   3. The car is geometrically further from the junction centre than
    *      releaseRadius (intersection radius + 30 px buffer). Defensive: if
    *      the lane-tracking misses a transition, the position check still
    *      releases the car
    *   4. The car has been near-stationary (speed < 0.05) for
    *      STUCK_EVICT_FRAMES consecutive frames. This is a deadlock safety
    *      net — it should not fire under normal operation
    *
    * After processing all occupants, updates clearFrames (incrementing while
    * empty, resetting to 0 while occupied). This is consulted by #admit to
    * enforce COURTESY_GAP_FRAMES between arms.
    */
   #cleanup(state, cars) {
      const j = state.junction;
      const it = j.intersection;
      const releaseRadius = it ? it.radius + 30 : 100;
      const carSet = new Set(cars);

      for (const car of [...state.occupants]) {
         if (!carSet.has(car)) {
            state.occupants.delete(car);
            continue;
         }

         const dx = car.x - j.point.x;
         const dy = car.y - j.point.y;
         const distFromCenter = Math.hypot(dx, dy);

         if (car.state === 'lane') {
            const stillOnEntryLane = car.junctionEntryRoad === car.lane.road
                                  && car.junctionEntryDirection === car.lane.direction;
            if (!stillOnEntryLane || distFromCenter > releaseRadius) {
               state.occupants.delete(car);
               car.junctionStuckFrames = 0;
               continue;
            }
         }

         if (car.speed < 0.05) {
            car.junctionStuckFrames = (car.junctionStuckFrames || 0) + 1;
            if (car.junctionStuckFrames > STUCK_EVICT_FRAMES) {
               state.occupants.delete(car);
               car.junctionStuckFrames = 0;
            }
         } else {
            car.junctionStuckFrames = 0;
         }
      }

      if (state.occupants.size === 0) {
         state.occupantSlot = null;
         state.clearFrames++;
      } else {
         state.clearFrames = 0;
      }
   }

   /**
    * Decide which approaching cars to admit this frame.
    *
    * Algorithm:
    *   1. Build a "requesting" list of every car that is approaching THIS
    *      junction and is not already an occupant. Tag each with:
    *        - slotIdx (which arm)
    *        - distToEnd (how close to the entry, used as priority)
    *        - light state (red/yellow/green/null)
    *        - stop-sign presence
    *   2. Sort by distToEnd ascending — closest car is the natural next candidate
    *   3. For each candidate, apply gates in order:
    *        - red light  → deny
    *        - yellow & still far from line → deny (must stop)
    *        - stop sign and not stopped near line → deny
    *        - For roundabouts: deny if the entry sector of the ring has an
    *          internal-state car within ~99° ahead (#ringConflict). Same-arm
    *          followers also wait until the leader is past SAME_SLOT_LEADER_GAP
    *        - For plain junctions: empty junction admits any candidate
    *          (subject to clearFrames courtesy gap, currently 0). When
    *          occupied, only same-arm cars admitted, and only after the
    *          leader has progressed past SAME_SLOT_LEADER_GAP
    *   4. On admission, mark the car as occupant and tag it with its entry
    *      road/direction so #cleanup can detect when it leaves
    */
   #admit(state, cars) {
      const j = state.junction;
      const it = j.intersection;
      if (!it) return;

      // Build request list.
      const requesting = [];
      for (const car of cars) {
         if (state.occupants.has(car)) continue;
         const aj = this.#approachingJunction(car);
         if (!aj || this.#keyOf(aj) !== this.#keyOf(j)) continue;
         const slotIdx = this.#slotIdxForApproach(car, it);
         if (slotIdx === null) continue;
         requesting.push({
            car,
            slotIdx,
            distToEnd: car.lane.length - car.distAlong,
            light:     this.#lightStateAhead(car),
            stop:      this.#isStopControlled(car),
         });
      }
      if (requesting.length === 0) return;

      requesting.sort((a, b) => a.distToEnd - b.distToEnd);

      // Pre-compute "is there an occupant from the active arm still close to
      // the entry mouth?" — used by plain-junction same-arm admission gate.
      let leaderTooClose = false;
      for (const occ of state.occupants) {
         if (occ.state !== 'internal') continue;
         if (occ.internalDist < SAME_SLOT_LEADER_GAP) { leaderTooClose = true; break; }
      }

      let activeSlot = state.occupantSlot;
      const isRoundabout = j.kind === 'roundabout';

      for (const req of requesting) {
         // ---- Traffic-control gates (apply to both junction kinds) ----
         if (req.light === 'red') continue;
         if (req.light === 'yellow' && req.distToEnd > 18) continue;
         if (req.stop && (req.car.speed > 0.08 || req.distToEnd > 32)) continue;

         // ---- Admission policy ----
         if (isRoundabout) {
            // UK roundabout: enter when YOUR sector of the ring is clear,
            // regardless of which other arms are using the ring.
            if (this.#ringConflict(req.car, it, state)) continue;
            // Tail-gating into the ring from same arm: leader must be moving.
            const sameArmLeaderTooClose = this.#sameArmLeaderClose(state, req.slotIdx);
            if (sameArmLeaderTooClose) continue;
         } else {
            // Plain junction: one arm at a time, with brief courtesy gap.
            if (state.occupants.size === 0) {
               if (state.clearFrames < COURTESY_GAP_FRAMES) continue;
            } else {
               if (req.slotIdx !== activeSlot) continue;
               if (leaderTooClose) continue;
            }
         }

         // ---- Admit ----
         state.occupants.add(req.car);
         req.car.junctionEntryRoad = req.car.lane.road;
         req.car.junctionEntryDirection = req.car.lane.direction;
         activeSlot = req.slotIdx;
         state.occupantSlot = req.slotIdx;
      }
   }

   /**
    * For roundabouts: same-arm follower may NOT enter while the leader
    * (most recent same-arm car) hasn't yet committed onto the ring.
    * Prevents a follower colliding with the leader at the entry mouth.
    */
   #sameArmLeaderClose(state, slotIdx) {
      for (const occ of state.occupants) {
         if (occ.state !== 'internal') continue;
         // Did this occupant come in via this same slot?
         const occSlot = this.#slotIdxForApproachByEntry(occ);
         if (occSlot !== slotIdx) continue;
         if (occ.internalDist < SAME_SLOT_LEADER_GAP) return true;
      }
      return false;
   }

   #slotIdxForApproachByEntry(car) {
      if (!car.junctionEntryRoad) return null;
      // Find the slot that matches the car's entry road + direction-implied end.
      for (const j of this.network.junctions) {
         const it = j.intersection;
         if (!it) continue;
         for (const s of it.slots) {
            if (s.road !== car.junctionEntryRoad) continue;
            const wantEnd = car.junctionEntryDirection === +1 ? 'end' : 'start';
            if (s.end === wantEnd) return s.index;
         }
      }
      return null;
   }

   /**
    * Roundabout-specific check: is there an occupant on the ring within ~99°
    * (Math.PI * 0.55) ahead of where this car would enter?
    *
    * Geometry: we compute angles around the roundabout centre. The candidate's
    * entry angle is the angle from centre to where its approach lane meets
    * the ring. Each occupant has a current angular position on the ring. If
    * the difference (going around in the direction of travel) is less than
    * 99°, the candidate would be entering right in front of an oncoming car.
    *
    * 99° was chosen empirically — wider than 90° because a UK roundabout
    * driver expects roughly 1/4-circle of safe gap before entering.
    */
   #ringConflict(car, intersection, state) {
      const entry = car.lane.pointAtDistance(car.lane.length);
      const entryAngle = Math.atan2(entry.y - intersection.center.y, entry.x - intersection.center.x);

      for (const c of state.occupants) {
         if (c.state !== 'internal') continue;
         const cAngle = Math.atan2(c.y - intersection.center.y, c.x - intersection.center.x);
         let arc = entryAngle - cAngle;
         while (arc < 0)            arc += 2 * Math.PI;
         while (arc > 2 * Math.PI)  arc -= 2 * Math.PI;
         if (arc < Math.PI * 0.55) return true;
      }
      return false;
   }
}
