/* ============================================================================
 * markings_extra.js
 * ----------------------------------------------------------------------------
 * Animated/stateful Marking subclasses: PelicanCrossing (pedestrian crossing
 * with red/amber/green/flashing-amber cycle), SpeedLimitSign, StartMarker,
 * EndMarker.
 *
 * WHY THIS FILE EXISTS:
 *   The static markings (stop signs, yield) live in markings.js. The animated
 *   ones (those with internal state that ticks each frame) are split here so
 *   the static-marking file stays simple. PelicanCrossings tick a phase
 *   counter, expose a `state`, and tell the car what to do via `directive()`.
 *
 * WHO CALLS THIS:
 *   - PelicanCrossing.tick() called by RoadNetwork.tick() each sim step
 *   - Cars read crossing state via #markingAhead() and apply `directive()`
 *   - StartMarker / EndMarker read by scenarios.js to place spawn/goal points
 *
 * STATE CYCLE (PelicanCrossing, 720 frames ≈ 12 s @ 60 fps):
 *     0..540  green       — drivers may pass
 *   540..600  amber       — should stop if safe
 *   600..660  red         — must stop, pedestrians crossing
 *   660..720  flashing-amber — proceed with caution if clear
 * ============================================================================ */

class PelicanCrossing extends Marking {
   constructor(opts) {
      super({ ...opts, type: 'crossing' });
      this.cycleFrames = 720;
      this.phase = Math.floor(Math.random() * this.cycleFrames);
   }

   tick() { this.phase = (this.phase + 1) % this.cycleFrames; }

   get state() {
      if (this.phase < 540) return 'green';
      if (this.phase < 600) return 'amber';
      if (this.phase < 660) return 'red';
      return 'flashing-amber';
   }

   /**
    * What should an approaching car do?
    *   distAhead > 90 or already past   -> 'go'
    *   red                               -> 'stop'
    *   amber: stop unless very close
    *   flashing-amber: 'caution'
    *   green: 'go'
    */
   directive(distAhead) {
      if (distAhead > 90 || distAhead < -5) return 'go';
      const s = this.state;
      if (s === 'red')             return 'stop';
      if (s === 'amber')           return distAhead < 45 ? 'stop' : 'slow';
      if (s === 'flashing-amber')  return 'slow';
      return 'go';
   }

   draw(ctx) {
      const stopLine = this.position;
      const dir   = this.lane.dir;
      const perp  = perpendicular(dir);
      const halfW = LANE_WIDTH / 2;

      const dashCount = 5;
      const dashLen = 5;
      const gap = 4;
      ctx.save();
      ctx.fillStyle = '#fff';
      const startOff = -(dashCount * (dashLen + gap) - gap) / 2;
      for (let i = 0; i < dashCount; i++) {
         const off = startOff + i * (dashLen + gap);
         const sa = add(stopLine, scale(dir, off));
         const sb = add(stopLine, scale(dir, off + dashLen));
         const c1 = add(sa, scale(perp,  halfW));
         const c2 = add(sb, scale(perp,  halfW));
         const c3 = add(sb, scale(perp, -halfW));
         const c4 = add(sa, scale(perp, -halfW));
         ctx.beginPath();
         ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
         ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y);
         ctx.closePath();
         ctx.fill();
      }
      ctx.restore();

      const pos = this.iconPosition;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-5, -16, 10, 22);

      const s = this.state;
      let lampColour = '#332';
      if (s === 'red')             lampColour = '#ff3030';
      else if (s === 'amber')      lampColour = '#ffaa20';
      else if (s === 'flashing-amber') {
         lampColour = (Math.floor(this.phase / 12) % 2 === 0) ? '#ffaa20' : '#332';
      }
      ctx.fillStyle = lampColour;
      ctx.beginPath();
      ctx.arc(0, -6, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.restore();
   }
}

if (typeof MARKING_TYPES !== 'undefined') {
   MARKING_TYPES.crossing = PelicanCrossing;
}

class SpeedLimitSign extends Marking {
   constructor(opts) {
      super({ ...opts, type: 'speedlimit' });
      this.limit = opts.limit ?? 1.5;
   }

   directive(_d) { return 'go'; }

   toJSON() {
      return {
         id: this.id, type: this.type,
         laneId: this.lane.id, distance: this.distance,
         limit: this.limit,
      };
   }

   draw(ctx) {
      const pos = this.iconPosition;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#cc1a1a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const display = Math.round(this.limit * 20);
      ctx.fillText(String(display), 0, 0);
      ctx.restore();
   }
}

class LayBy extends Marking {
   constructor(opts) { super({ ...opts, type: 'layby' }); }

   directive(_d) { return 'go'; }

   draw(ctx) {
      const pos = this.position;
      const dir = this.lane.dir;
      const perp = perpendicular(dir);
      const len = 26;
      const w = LANE_WIDTH * 0.55;

      ctx.save();
      const a = add(pos, scale(dir, -len/2));
      const b = add(pos, scale(dir,  len/2));
      const offset = scale(perp, w * 0.55);
      const c1 = add(a, offset);
      const c2 = add(b, offset);
      const c3 = add(b, scale(perp, w * 0.05));
      const c4 = add(a, scale(perp, w * 0.05));

      ctx.fillStyle = 'rgba(60, 60, 60, 0.85)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(c3.x, c3.y);
      ctx.lineTo(c4.x, c4.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', pos.x + offset.x * 0.6, pos.y + offset.y * 0.6);
      ctx.restore();
   }
}

if (typeof MARKING_TYPES !== 'undefined') {
   MARKING_TYPES.layby = LayBy;
}

class StartMarker extends Marking {
   constructor(opts) { super({ ...opts, type: 'start' }); }
   directive(_d) { return 'go'; }
   draw(ctx) {
      const pos = this.iconPosition;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(-1, -14, 2, 28);
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(0, -14, 14, 10);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, -14, 14, 10);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('START', 7, -9);
      ctx.restore();
   }
}

class EndMarker extends Marking {
   constructor(opts) { super({ ...opts, type: 'end' }); }
   directive(_d) { return 'go'; }
   draw(ctx) {
      const pos = this.iconPosition;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(-1, -14, 2, 28);
      const sq = 4;
      for (let r = 0; r < 2; r++) {
         for (let c = 0; c < 4; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#fff' : '#1e1e1e';
            ctx.fillRect(c * sq, -14 + r * sq, sq, sq);
         }
      }
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, -14, 4 * sq, 2 * sq);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 6px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('GOAL', 8, -5);
      ctx.restore();
   }
}

if (typeof MARKING_TYPES !== 'undefined') {
   MARKING_TYPES.start = StartMarker;
   MARKING_TYPES.end   = EndMarker;
}
