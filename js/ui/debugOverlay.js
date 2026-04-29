/* ============================================================================
 * debugOverlay.js
 * ----------------------------------------------------------------------------
 * On-canvas debug rendering enabled by the 🔍 toolbar button.
 *
 * WHY THIS FILE EXISTS:
 *   When debugging traffic behaviour, the JSON snapshot in debugExport is
 *   accurate but slow to read. A live overlay makes the same information
 *   visible in real time:
 *     - per-car ring (red = denied by arbiter, blue = lane-state, green = internal)
 *     - per-car internal-path line color-coded by category (left/straight/right)
 *     - per-car label showing state, lane id, internal path key, speed
 *     - per-car forward sensor cone (60 px deep, 60° wide) used by the safety brake
 *     - per-junction label "O:N slot:X clr:M" showing occupants count, active
 *       slot, and clearFrames since last empty
 *
 *   Toggle with 🔍 toolbar button (or the keyboard shortcut wired in main.js).
 *
 * WHO CALLS THIS:
 *   - main.js render loop calls draw(ctx, simulation) each frame
 * ============================================================================ */

class DebugOverlay {
   constructor() {
      this.enabled = false;
   }

   toggle() { this.enabled = !this.enabled; }

   draw(ctx, simulation) {
      if (!this.enabled) return;
      if (!simulation) return;
      const arbiter = simulation.arbiter;
      const cars    = simulation.cars || [];

      for (const car of cars) {
         this.#drawCar(ctx, car, arbiter);
      }

      this.#drawJunctionStates(ctx, simulation);
   }

   #drawSensorCone(ctx, car) {
      const angle = car.angle + Math.PI / 2;
      const reach = 60;
      const halfFov = Math.PI * 0.30;

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(angle);

      ctx.fillStyle = 'rgba(120,200,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, reach, -Math.PI/2 - halfFov, -Math.PI/2 + halfFov);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(120,200,255,0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, reach, -Math.PI/2 - halfFov, -Math.PI/2 + halfFov);
      ctx.stroke();

      ctx.restore();
   }

   #drawCar(ctx, car, arbiter) {
      const granted   = arbiter ? arbiter.mayProceed(car) : true;
      const state     = car.state;
      const path      = car.internalPath;
      const speed     = car.speed.toFixed(2);
      const category  = path ? path.category : (car.nextLane ? this.#categoryOfNext(car) : '?');

      this.#drawSensorCone(ctx, car);

      if (path && state === 'internal') {
         ctx.save();
         ctx.strokeStyle = path.category === 'left'
            ? 'rgba(120,180,255,0.8)'
            : path.category === 'right'
               ? 'rgba(255,180,120,0.8)'
               : 'rgba(120,255,180,0.8)';
         ctx.lineWidth = 1.6;
         ctx.setLineDash([5, 4]);
         ctx.beginPath();
         const pts = path.waypoints;
         for (let i = 0; i < pts.length; i++) {
            if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
            else         ctx.lineTo(pts[i].x, pts[i].y);
         }
         ctx.stroke();
         ctx.setLineDash([]);
         ctx.restore();
      } else if (state === 'lane' && car.nextLane) {
         const conn = car.lane.direction === +1 ? car.lane.road.endConn : car.lane.road.startConn;
         if (conn) {
            const pathObj = conn.intersection.getInternalPath
                          ? conn.intersection.getInternalPath(car.lane, car.nextLane)
                          : null;
            if (pathObj) {
               ctx.save();
               ctx.strokeStyle = pathObj.category === 'left'
                  ? 'rgba(120,180,255,0.5)'
                  : pathObj.category === 'right'
                     ? 'rgba(255,180,120,0.5)'
                     : 'rgba(120,255,180,0.5)';
               ctx.lineWidth = 1.2;
               ctx.setLineDash([3, 5]);
               ctx.beginPath();
               for (let i = 0; i < pathObj.waypoints.length; i++) {
                  const p = pathObj.waypoints[i];
                  if (i === 0) ctx.moveTo(p.x, p.y);
                  else         ctx.lineTo(p.x, p.y);
               }
               ctx.stroke();
               ctx.setLineDash([]);
               ctx.restore();
            }
         }
      }

      ctx.save();
      const ringColour = !granted ? '#e53935'
                       : (state === 'internal' ? '#43a047' : '#1976d2');
      ctx.strokeStyle = ringColour;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      const labelLines = [
         `${state}${granted ? ' ✓' : ' ✗'}`,
         `${category} ${speed}`,
      ];
      if (car.merging) labelLines.push('merging');
      if (car.stuckFrames > 60) labelLines.push(`stuck ${car.stuckFrames}`);

      const fontSize = 9;
      ctx.font = `${fontSize}px monospace`;
      const labelW = Math.max(...labelLines.map(l => ctx.measureText(l).width)) + 4;
      const labelH = labelLines.length * (fontSize + 1) + 3;
      const lx = car.x + 16;
      const ly = car.y - labelH / 2;

      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(lx, ly, labelW, labelH);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'top';
      labelLines.forEach((line, i) => {
         ctx.fillText(line, lx + 2, ly + 2 + i * (fontSize + 1));
      });
      ctx.restore();
   }

   #categoryOfNext(car) {
      if (!car.nextLane) return '?';
      const inDir = car.lane.dir;
      const outDir = car.nextLane.dir;
      const d = inDir.x * outDir.x + inDir.y * outDir.y;
      const cross = inDir.x * outDir.y - inDir.y * outDir.x;
      if (d > 0.7) return 'straight';
      if (cross < 0) return 'left';
      return 'right';
   }


   #drawJunctionStates(ctx, sim) {
      if (!sim.arbiter || !sim.arbiter.junctionStates) return;
      for (const state of sim.arbiter.junctionStates.values()) {
         const j = state.junction;
         const occupants = state.occupants ? state.occupants.size : 0;
         const slot = state.occupantSlot !== null && state.occupantSlot !== undefined ? state.occupantSlot : '-';
         const clear = state.clearFrames || 0;

         ctx.save();
         ctx.font = '10px monospace';
         const txt = `O:${occupants} slot:${slot} clr:${clear}`;
         const w = ctx.measureText(txt).width + 6;
         ctx.fillStyle = 'rgba(0,0,0,0.7)';
         ctx.fillRect(j.point.x - w/2, j.point.y - 6, w, 13);
         ctx.fillStyle = '#ffcc00';
         ctx.textAlign = 'center';
         ctx.textBaseline = 'top';
         ctx.fillText(txt, j.point.x, j.point.y - 5);
         ctx.restore();
      }
   }
}
