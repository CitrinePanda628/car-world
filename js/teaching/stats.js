/* ============================================================================
 * stats.js
 * ----------------------------------------------------------------------------
 * Tracks driving stats for the user's main car. Used to compute the
 * end-of-trip summary shown in the goal banner.
 *
 * WHY THIS FILE EXISTS:
 *   When the main car reaches the goal, we display a brief summary:
 *   distance travelled, time taken, safety score (penalised for tailgating,
 *   speeding, and missed signs). StatsTracker accumulates the inputs each
 *   frame and produces a summary on demand.
 *
 *   The previous "Driver stats" side panel (now removed in user request) used
 *   to render this in real time. Only `getSummary()` is used now, by the
 *   goal banner in Simulation.#showGoalBanner().
 *
 * WHO CALLS THIS:
 *   - Simulation.tick() -> stats.tick(mainCar, cars, network) each frame
 *   - Simulation.#showGoalBanner() -> stats.getSummary()
 *   - Simulation.reset() -> stats.reset()
 * ============================================================================ */

class StatsTracker {
   constructor() {
      this.reset();
   }

   reset() {
      this.frames           = 0;
      this.distance         = 0;
      this.maxSpeed         = 0;
      this.laneChanges      = 0;
      this.fullStops        = 0;
      this.stopSignsServed  = 0;
      this.signsEncountered = new Set();
      this.signsRespected   = new Set();
      this.timeAtUnsafeDist = 0;
      this.timeOverLimit    = 0;
      this.timeBraking      = 0;
      this.framesActive     = 0;
      this.lastLane         = null;
      this.wasInTargetLane  = false;
      this.lastWasMoving    = false;
   }

   tick(mainCar, allCars, network) {
      if (!mainCar) return;
      this.frames++;
      this.framesActive++;

      this.distance += mainCar.speed;
      if (mainCar.speed > this.maxSpeed) this.maxSpeed = mainCar.speed;

      if (mainCar.targetLane && !this.wasInTargetLane) this.laneChanges++;
      this.wasInTargetLane = !!mainCar.targetLane;

      if (this.lastWasMoving && mainCar.speed < 0.05) this.fullStops++;
      this.lastWasMoving = mainCar.speed > 0.05;

      const limit = mainCar.lane.road.speedLimit;
      if (mainCar.speed > limit * 1.05) this.timeOverLimit++;
      if (mainCar.braking) this.timeBraking++;

      const myDir = new Point(Math.cos(mainCar.angle), Math.sin(mainCar.angle));
      let unsafe = false;
      for (const c of allCars) {
         if (c === mainCar) continue;
         const oDir = new Point(Math.cos(c.angle), Math.sin(c.angle));
         if (dot(myDir, oDir) < 0.4) continue;
         const d = distance(new Point(mainCar.x, mainCar.y), new Point(c.x, c.y));
         if (d < 32) { unsafe = true; break; }
      }
      if (unsafe) this.timeAtUnsafeDist++;

      for (const id of mainCar.servedStopIds) {
         if (!this.signsRespected.has(id)) {
            this.signsRespected.add(id);
            this.stopSignsServed++;
         }
      }

      const stopAhead = network.markingsOnLane(mainCar.lane).find(m =>
         m.type === 'stop' && Math.abs(m.distance - mainCar.distAlong) < 70
      );
      if (stopAhead) this.signsEncountered.add(stopAhead.id);
   }

   getSafetyScore() {
      if (this.framesActive === 0) return 100;
      const unsafePct = this.timeAtUnsafeDist / this.framesActive;
      const overLimitPct = this.timeOverLimit / this.framesActive;
      const stopMissPct = this.signsEncountered.size > 0
         ? 1 - (this.stopSignsServed / this.signsEncountered.size) : 0;
      const score = 100 - (unsafePct * 60 + overLimitPct * 25 + stopMissPct * 30);
      return Math.max(0, Math.round(score));
   }

   getSummary() {
      const seconds = Math.round(this.framesActive / 60);
      const meters  = Math.round(this.distance * 0.3);
      return {
         seconds,
         meters,
         maxSpeed: this.maxSpeed.toFixed(2),
         laneChanges: this.laneChanges,
         fullStops: this.fullStops,
         signsRespected: `${this.stopSignsServed}/${this.signsEncountered.size}`,
         timeOverLimit: Math.round(this.timeOverLimit / 60 * 10) / 10,
         safetyScore: this.getSafetyScore(),
      };
   }

   render(panel) {
      const s = this.getSummary();
      panel.innerHTML = `
         <div class="stat-row"><span>Distance</span><b>${s.meters} m</b></div>
         <div class="stat-row"><span>Time</span><b>${s.seconds} s</b></div>
         <div class="stat-row"><span>Top speed</span><b>${s.maxSpeed}</b></div>
         <div class="stat-row"><span>Lane changes</span><b>${s.laneChanges}</b></div>
         <div class="stat-row"><span>Full stops</span><b>${s.fullStops}</b></div>
         <div class="stat-row"><span>Stop signs respected</span><b>${s.signsRespected}</b></div>
         <div class="stat-row"><span>Time over limit</span><b>${s.timeOverLimit} s</b></div>
         <div class="stat-row score score-${s.safetyScore >= 80 ? 'good' : s.safetyScore >= 50 ? 'mid' : 'bad'}">
            <span>Safety score</span><b>${s.safetyScore}/100</b>
         </div>
      `;
   }
}
