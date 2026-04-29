/* ============================================================================
 * safetyCircle.js
 * ----------------------------------------------------------------------------
 * Visual halo around the user's main car indicating proximity to other cars.
 *
 * WHY THIS FILE EXISTS:
 *   The educational simulator wants to draw the user's attention to dangerous
 *   following situations. A green/yellow/red circle around the main car gives
 *   immediate spatial feedback: green = clear, yellow = warning, red = danger.
 *
 * ALGORITHM:
 *   Each frame, find the closest other car within SAFETY_WARN_DIST that is
 *   facing roughly the same direction (heading-dot > 0.4 — same-direction
 *   traffic, not oncoming). Map distance to colour state. The red state
 *   pulses radially for emphasis.
 *
 * WHO CALLS THIS:
 *   - Simulation creates a SafetyCircle for this.mainCar at sim start
 *   - Simulation.tick() -> safetyCircle.update(this.cars)
 *   - Simulation.draw(ctx) -> safetyCircle.draw(ctx)
 * ============================================================================ */

const SAFETY_WARN_DIST   = 55;
const SAFETY_DANGER_DIST = 32;

class SafetyCircle {
   constructor(mainCar) {
      this.mainCar = mainCar;
      this.state   = 'green';
      this.closest = null;    
      this.pulsePhase = 0;
   }

   update(allCars) {
      if (!this.mainCar) return;
      const me = this.mainCar;
      const myDir = new Point(Math.cos(me.angle), Math.sin(me.angle));

      let closest = null, closestD = Infinity;
      for (const other of allCars) {
         if (other === me) continue;
         const toO = subtract(new Point(other.x, other.y), new Point(me.x, me.y));
         const d   = magnitude(toO);
         if (d > SAFETY_WARN_DIST + 12) continue;

         
         const otherDir = new Point(Math.cos(other.angle), Math.sin(other.angle));
         if (dot(myDir, otherDir) < 0.4) continue;

         if (d < closestD) { closestD = d; closest = other; }
      }

      this.closest = closest ? { car: closest, dist: closestD } : null;

      if (!closest)                      this.state = 'green';
      else if (closestD < SAFETY_DANGER_DIST) this.state = 'red';
      else if (closestD < SAFETY_WARN_DIST)   this.state = 'yellow';
      else                               this.state = 'green';

      this.pulsePhase = (this.pulsePhase + 1) % 60;
   }

   draw(ctx) {
      if (!this.mainCar) return;
      const me = this.mainCar;

      const baseR = 26;
      
      const pulse = this.state === 'red'
         ? Math.sin(this.pulsePhase / 60 * Math.PI * 2) * 3
         : 0;
      const r = baseR + pulse;

      const colours = {
         green:  { stroke: 'rgba(80,220,120,0.75)',  fill: 'rgba(80,220,120,0.10)' },
         yellow: { stroke: 'rgba(255,200,40,0.85)',  fill: 'rgba(255,200,40,0.12)' },
         red:    { stroke: 'rgba(240,60,60,0.95)',   fill: 'rgba(240,60,60,0.18)'  },
      };
      const col = colours[this.state];

      ctx.save();
      ctx.fillStyle   = col.fill;
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth   = this.state === 'red' ? 3 : 2;
      ctx.beginPath();
      ctx.arc(me.x, me.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      
      if (this.closest && this.state !== 'green') {
         const other = this.closest.car;
         ctx.strokeStyle = col.stroke;
         ctx.lineWidth = 1.5;
         ctx.setLineDash([4, 4]);
         ctx.beginPath();
         ctx.moveTo(me.x, me.y);
         ctx.lineTo(other.x, other.y);
         ctx.stroke();
         ctx.setLineDash([]);
      }
      ctx.restore();
   }
}
