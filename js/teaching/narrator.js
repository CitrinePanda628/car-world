/* ============================================================================
 * narrator.js
 * ----------------------------------------------------------------------------
 * Driving instructor voice — speech-bubble messages shown at the top of the
 * canvas as the user's car encounters teachable situations.
 *
 * WHY THIS FILE EXISTS:
 *   The simulator is intended to teach UK driving rules. As the main car
 *   approaches a stop sign, traffic light, roundabout, etc., the narrator
 *   pops up brief explanations ("approaching stop — full stop is required
 *   even when clear"). Cooldowns prevent the same message firing repeatedly.
 *
 * MECHANICS:
 *   - tick() called each frame with allCars and network
 *   - inspects mainCar's surroundings (#markingAhead, junction approach, etc.)
 *   - eligible messages are queued; one shows at a time with a cooldown
 *
 * WHO CALLS THIS:
 *   - Simulation.narrator.tick() called once per sim frame
 *   - Simulation.narrator.setMainCar(c) when sim starts
 * ============================================================================ */

class Narrator {
   constructor() {
      this.messageEl    = document.getElementById('narrator');
      this.queue        = [];
      this.current      = null;
      this.cooldowns    = new Map();
      this.eventHistory = new Set();
      this.frame        = 0;
      this.gapFrames    = 0;   
   }

   setMainCar(car) { this.mainCar = car; }

   
   tick(allCars, network) {
      this.frame++;
      for (const [k, v] of this.cooldowns) {
         if (v <= 0) this.cooldowns.delete(k); else this.cooldowns.set(k, v - 1);
      }

      if (!this.mainCar) return;
      this.#detect(allCars, network);
      this.#advanceDisplay();
   }

   #emit(key, text, { priority = 1, cooldown = 240, duration = 180, oneShot = false } = {}) {
      if (this.cooldowns.has(key)) return;
      if (oneShot && this.eventHistory.has(key)) return;
      this.cooldowns.set(key, cooldown);
      if (oneShot) this.eventHistory.add(key);
      this.queue.push({ key, text, priority, duration, queuedAt: this.frame });
   }

   #advanceDisplay() {
      const now = this.frame;
      if (this.gapFrames > 0) this.gapFrames--;

      let best = null, bestPri = -Infinity;
      for (const q of this.queue) if (q.priority > bestPri) { best = q; bestPri = q.priority; }

      if (this.current && this.current.expires > now) {
         
         if (best && best.priority > this.current.priority + 1.5) {
            this.#show(best);
         }
      } else {
         
         if (this.gapFrames <= 0 && best) {
            this.#show(best);
         } else {
            this.#hide();
         }
      }

      if (this.current) {
         this.queue = this.queue.filter(q => q !== this.current.source);
      }
      
      this.queue = this.queue.filter(q => !q.queuedAt || (now - q.queuedAt) < 300);
   }

   #show(msg) {
      this.current = { text: msg.text, expires: this.frame + msg.duration,
                       priority: msg.priority, source: msg };
      this.messageEl.textContent = msg.text;
      this.messageEl.classList.add('visible');
      this.gapFrames = 60;   
   }

   #hide() {
      this.current = null;
      this.messageEl.classList.remove('visible');
   }

   
   #detect(allCars, network) {
      const me = this.mainCar;
      const myDir = new Point(Math.cos(me.angle), Math.sin(me.angle));

      
      let ahead = null,  aheadD  = Infinity;
      let behind = null, behindD = Infinity;
      for (const c of allCars) {
         if (c === me) continue;
         const otherDir = new Point(Math.cos(c.angle), Math.sin(c.angle));
         if (dot(myDir, otherDir) < 0.4) continue;   

         const toO = subtract(new Point(c.x, c.y), new Point(me.x, me.y));
         const d   = magnitude(toO);
         if (d < 1) continue;
         const forward = dot(toO, myDir);
         if (forward > 0 && d < aheadD)  { aheadD  = d; ahead  = c; }
         if (forward < 0 && d < behindD) { behindD = d; behind = c; }
      }

      
      if (ahead && aheadD < SAFETY_DANGER_DIST + 4) {
         this.#emit('tailgating',
            "Too close — maintain a safe following distance.",
            { priority: 3, cooldown: 180, duration: 140 });
      }

      
      if (behind && behindD < 30) {
         this.#emit('beingTailgated',
            "The car behind is very close. Stay calm and let them pass if safe.",
            { priority: 2, cooldown: 260, duration: 180 });
      }

      
      const nextMarking = this.#markingAhead(me, network, 100);
      if (nextMarking) {
         const { marking, dist } = nextMarking;
         if (marking.type === 'stop' && dist < 80) {
            this.#emit('stopSignApproach',
               "Stop sign ahead — slowing to a complete stop.",
               { priority: 2, cooldown: 360, duration: 140 });
         }
         if (marking.type === 'light' && marking.state === 'red' && dist < 80) {
            this.#emit('redLight',
               "Red light ahead — stopping and waiting for green.",
               { priority: 2, cooldown: 360, duration: 140 });
         }
         if (marking.type === 'light' && marking.state === 'yellow' && dist < 60) {
            this.#emit('yellowLight',
               "Yellow light — stopping if it's safe to do so.",
               { priority: 2, cooldown: 300, duration: 120 });
         }
      }

      
      if (me.nextLane && me.nextLane.road.closed) {
         const d = me.lane.length - me.distAlong;
         if (d < 120) {
            this.#emit('roadClosed',
               "Road ahead is closed — slowing down and looking for another route.",
               { priority: 4, cooldown: 300, duration: 180 });
         }
      }

      
      for (const c of allCars) {
         if (c === me || c.personality !== 'aggressive') continue;
         const d = distance(new Point(me.x, me.y), new Point(c.x, c.y));
         if (d < 80) {
            this.#emit('aggressiveNearby',
               "An aggressive driver is nearby. Keep your distance and don't match their behaviour.",
               { priority: 1, cooldown: 480, duration: 220 });
            break;
         }
      }

      
      if (ahead && ahead.personality === 'passive' && aheadD < 70) {
         this.#emit('slowDriverAhead',
            "Slow driver ahead. Overtake only if there's a clear, safe gap.",
            { priority: 1, cooldown: 420, duration: 200 });
      }

      
      if (me.targetLane) {
         const side = me.lateralSign > 0 ? 'right' : 'left';
         this.#emit('changingLane_' + side,
            side === 'right'
               ? "Changing to the right lane — signalling and checking for a safe gap."
               : "Returning to the left lane — it's good practice to keep left when not overtaking.",
            { priority: 2, cooldown: 200, duration: 150 });
      }

      
      const limit = me.lane.road.speedLimit;
      if (me.speed > limit * 1.05) {
         this.#emit('overSpeed',
            "Over the speed limit — ease off the accelerator.",
            { priority: 2, cooldown: 300, duration: 140 });
      }

      
      if (this.frame === 60) {
         this.#emit('start',
            "Simulation running. I'll point out anything important that happens.",
            { priority: 1, duration: 160, cooldown: 60 * 60, oneShot: true });
      }

      
      if (me.arbiter && !me.arbiter.mayProceed(me) && me.speed < 0.1) {
         this.#emit('junctionWait',
            "Waiting at the junction — giving way to other traffic.",
            { priority: 2, cooldown: 300, duration: 160 });
      }
   }

   #markingAhead(car, network, range) {
      const onLane = network.markingsOnLane(car.lane).filter(m => m.distance > car.distAlong);
      if (onLane.length) return { marking: onLane[0], dist: onLane[0].distance - car.distAlong };
      if (car.nextLane && (car.lane.length - car.distAlong) < range) {
         const onNext = network.markingsOnLane(car.nextLane);
         if (onNext.length) {
            return { marking: onNext[0], dist: (car.lane.length - car.distAlong) + onNext[0].distance };
         }
      }
      return null;
   }
}
