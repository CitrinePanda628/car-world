class Simulation {
   constructor(network) {
      this.network = network;
      this.running = false;
      this.cars    = [];

      this.narrator      = new Narrator();
      this.decisions     = new DecisionManager();
      this.safetyCircle  = null;
      this.mainCar       = null;
      this.mode          = 'teach';
      this.arbiter       = new JunctionArbiter(network);
      this.stats         = new StatsTracker();

      this.speedFactor   = 1;
      this.subFrameAccum = 0;
      this.frameCount    = 0;
   }

   setSpeed(f) { this.speedFactor = f; }

   setMode(mode) {
      this.mode = mode;
      this.decisions.setMode(mode);
   }

   start() {
      this.running = true;
      this.goalReached = false;
      const banner = document.getElementById('goalBanner');
      if (banner) banner.classList.remove('visible');
      if (typeof TrafficLight !== 'undefined') TrafficLight.resetGroups();
      this.cars = this.network.cars.map(spawn => new Car({ network: this.network, spawn }));
      this.mainCar = this.cars.find(c => c.isMain) || null;
      if (!this.mainCar) {
         const startMark = this.network.markings.find(m => m.type === 'start');
         if (startMark) {
            const spawn = new CarSpawn({
               lane: startMark.lane,
               progress: startMark.distance / Math.max(1, startMark.lane.length),
               personality: 'good',
               isMain: true,
            });
            const c = new Car({ network: this.network, spawn });
            this.cars.push(c);
            this.mainCar = c;
         }
      }
      this.safetyCircle = this.mainCar ? new SafetyCircle(this.mainCar) : null;
      this.narrator.setMainCar(this.mainCar);
      this.decisions.reset();
      this.arbiter = new JunctionArbiter(this.network);
      for (const c of this.cars) c.arbiter = this.arbiter;
      this.stats.reset();
   }

   restart() {
      if (!this.running) { this.start(); return; }
      this.stop();
      this.start();
   }

   stop() {
      this.running = false;
      this.cars = [];
      this.mainCar = null;
      this.safetyCircle = null;
      this.decisions.hide();
      this.decisions.paused = false;
      this.narrator.setMainCar(null);
      const nEl = document.getElementById('narrator');
      if (nEl) nEl.classList.remove('visible');
   }

   tick() {
      if (!this.running) return;

      this.decisions.evaluate(this.mainCar, this.cars, this.network);
      if (this.decisions.isPaused()) return;

      this.subFrameAccum += this.speedFactor;
      while (this.subFrameAccum >= 1) {
         this.subFrameAccum -= 1;
         this.frameCount++;
         this.network.tick();
         this.arbiter.tick(this.cars);
         for (const c of this.cars) c.update(this.cars);
         this.stats.tick(this.mainCar, this.cars, this.network);
         this.#checkGoal();
         this.#checkStuckCollisions();
      }

      if (this.safetyCircle) this.safetyCircle.update(this.cars);
      this.narrator.tick(this.cars, this.network);
   }

   #checkGoal() {
      if (!this.mainCar || this.goalReached) return;
      const ends = this.network.markings.filter(m => m.type === 'end');
      if (ends.length === 0) return;
      const myPos = new Point(this.mainCar.x, this.mainCar.y);
      for (const e of ends) {
         if (distance(myPos, e.position) < 25) {
            this.goalReached = true;
            this.#showGoalBanner();
            return;
         }
      }
   }

   #checkStuckCollisions() {
      const STUCK_THRESHOLD = 360;
      const OVERLAP_DIST = 28;
      for (let i = 0; i < this.cars.length; i++) {
         const a = this.cars[i];
         if (a.isMain) continue;
         if (a.stuckFrames < STUCK_THRESHOLD) continue;
         if (a.state !== 'lane') continue;
         for (let j = i + 1; j < this.cars.length; j++) {
            const b = this.cars[j];
            if (b.isMain) continue;
            if (b.stuckFrames < STUCK_THRESHOLD) continue;
            if (b.state !== 'lane') continue;
            const d = distance(new Point(a.x, a.y), new Point(b.x, b.y));
            if (d > OVERLAP_DIST) continue;

            const closure = new RoadClosure({
               lane: a.lane,
               distStart: Math.max(0, a.distAlong - 25),
               distEnd:   Math.min(a.lane.length, a.distAlong + 25),
            });
            this.network.addClosure(closure);

            this.cars.splice(j, 1);
            this.cars.splice(i, 1);
            return;
         }
      }
   }

   #showGoalBanner() {
      const el = document.getElementById('goalBanner');
      if (!el) return;
      const summary = this.stats.getSummary();
      el.innerHTML = `<div class="goal-title">Destination reached!</div>
         <div class="goal-stats">${summary.meters} m · ${summary.seconds} s · safety ${summary.safetyScore}/100</div>`;
      el.classList.add('visible');
   }

   draw(ctx) {
      if (!this.running) return;
      if (this.safetyCircle) this.safetyCircle.draw(ctx);
      for (const c of this.cars) c.draw(ctx);

      if (this.mainCar) {
         const speedDisplay = Math.round(this.mainCar.speed * 20);
         ctx.save();
         ctx.fillStyle = 'rgba(0,0,0,0.75)';
         ctx.fillRect(this.mainCar.x - 18, this.mainCar.y + 16, 36, 14);
         ctx.fillStyle = '#66ccff';
         ctx.font = 'bold 10px sans-serif';
         ctx.textAlign = 'center';
         ctx.fillText(`${speedDisplay} mph`, this.mainCar.x, this.mainCar.y + 26);
         ctx.restore();
      }
   }
}

