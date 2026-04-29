/* ============================================================================
 * markings.js
 * ----------------------------------------------------------------------------
 * Lane markings: stop signs, yield signs, traffic lights, crossings, speed
 * limit signs, start markers, end markers.
 *
 * WHY THIS FILE EXISTS:
 *   Cars need to obey signage. Each Marking lives at a specific distance
 *   along a specific Lane. Cars query `network.markingsOnLane(lane)` to
 *   discover what's ahead.
 *
 *   The base Marking class holds id, type, lane, distance. Subclasses add
 *   behaviour (e.g. TrafficLight has `state` and toggles via groups).
 *   Position is derived on demand from `lane.pointAtDistance(distance)`,
 *   and `iconPosition` adds a sideways offset so icons render beside the
 *   lane rather than on top of it.
 *
 * WHO CALLS THIS:
 *   - Scenarios: build markings via `network.addMarking(new StopSign({...}))`
 *   - markingEditor.js: creates markings on user click
 *   - JunctionArbiter: reads light/stop markings via markingsOnLane
 *   - Car: reads markings via #markingAhead() to plan stops
 *   - decisions.js: queries markings to set up driving-decision quizzes
 * ============================================================================ */

class Marking {
   constructor({ id, type, lane, distance }) {
      // id is preserved across save/load so editors can reference markings
      // even after the network has been rebuilt.
      this.id = id ?? Marking.nextId++;
      this.type = type;
      this.lane = lane;
      this.distance = distance;
   }
   static nextId = 1;

   /** World point at this marking's lane position. */
   get position() { return this.lane.pointAtDistance(this.distance); }

   /** Like position, but offset to the left of the lane so icons sit beside the road. */
   get iconPosition() {
      const pos = this.position;
      const leftPerp = perpendicular(this.lane.dir);
      return add(pos, scale(leftPerp, LANE_WIDTH * 0.55));
   }

   
   
   
   directive(_distAhead) { return 'go'; }

   toJSON() {
      return {
         id: this.id, type: this.type,
         laneId: this.lane.id, distance: this.distance,
      };
   }
   static fromJSON(data, laneLookup) {
      const lane = laneLookup(data.laneId);
      if (!lane) return null;
      const cls = MARKING_TYPES[data.type];
      if (!cls) return null;
      const m = new cls({
         id: data.id, lane, distance: data.distance,
         group: data.group, phaseOffset: data.phaseOffset,
         limit: data.limit,
      });
      Marking.nextId = Math.max(Marking.nextId, (data.id ?? 0) + 1);
      return m;
   }
}

class StopSign extends Marking {
   constructor(opts) { super({ ...opts, type: 'stop' }); }

   
   directive(distAhead) {
      if (distAhead < 45 && distAhead > -5) return 'stop';
      if (distAhead < 90) return 'slow';
      return 'go';
   }

   draw(ctx) {
      const pos = this.iconPosition;
      const stopLine = this.position;
      const laneLeft = perpendicular(this.lane.dir);

      
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      const halfLane = LANE_WIDTH / 2;
      const a = add(stopLine, scale(laneLeft,  halfLane));
      const b = add(stopLine, scale(laneLeft, -halfLane));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();

      
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = '#cc1a1a';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const r = 11;
      for (let i = 0; i < 8; i++) {
         const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
         const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
         if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('STOP', 0, 0);
      ctx.restore();
   }
}

class YieldSign extends Marking {
   constructor(opts) { super({ ...opts, type: 'yield' }); }

   directive(distAhead) {
      if (distAhead < 60 && distAhead > -5) return 'slow';
      return 'go';
   }

   draw(ctx) {
      const pos = this.iconPosition;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#cc1a1a';
      ctx.lineWidth = 2.5;
      const r = 12;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.87, r * 0.5);
      ctx.lineTo(-r * 0.87, r * 0.5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#cc1a1a';
      ctx.font = 'bold 6px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('YIELD', 0, 0);
      ctx.restore();
   }
}

class TrafficLight extends Marking {
   constructor(opts) {
      super({ ...opts, type: 'light' });
      this.phase = 0;   
      this.cycleFrames = 900;
      
      
      
      this.group       = opts.group       ?? null;
      this.phaseOffset = opts.phaseOffset ?? 0;
   }

   
   
   
   static groupPhases = new Map();   
   static resetGroups() { TrafficLight.groupPhases.clear(); }
   static tickGroups()  {
      for (const [g, p] of TrafficLight.groupPhases) {
         TrafficLight.groupPhases.set(g, p + 1);
      }
   }

   get effectivePhase() {
      if (this.group) {
         if (!TrafficLight.groupPhases.has(this.group)) {
            TrafficLight.groupPhases.set(this.group, 0);
         }
         return (TrafficLight.groupPhases.get(this.group) + this.phaseOffset) % this.cycleFrames;
      }
      return this.phase % this.cycleFrames;
   }

   get state() {
      const p = this.effectivePhase;
      if (p < 480) return 'green';
      if (p < 570) return 'yellow';
      return 'red';
   }

   tick() {
      if (!this.group) this.phase++;
      
   }

   directive(distAhead) {
      if (distAhead > 90 || distAhead < -5) return 'go';
      const s = this.state;
      if (s === 'red')    return 'stop';
      if (s === 'yellow') return distAhead < 45 ? 'stop' : 'slow';
      return 'go';
   }

   toJSON() {
      return {
         id: this.id, type: this.type,
         laneId: this.lane.id, distance: this.distance,
         group: this.group, phaseOffset: this.phaseOffset,
      };
   }

   draw(ctx) {
      const pos = this.iconPosition;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-6, -18, 12, 32);
      
      const s = this.state;
      ctx.fillStyle = s === 'red'    ? '#f33' : '#411';  ctx.beginPath(); ctx.arc(0, -12, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = s === 'yellow' ? '#ff3' : '#442';  ctx.beginPath(); ctx.arc(0,  -2, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = s === 'green'  ? '#3f3' : '#141';  ctx.beginPath(); ctx.arc(0,   8, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
   }
}

const MARKING_TYPES = {
   stop:  StopSign,
   yield: YieldSign,
   light: TrafficLight,
};
