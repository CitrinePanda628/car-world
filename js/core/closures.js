/* ============================================================================
 * closures.js
 * ----------------------------------------------------------------------------
 * Road closures: a span of a lane that is blocked, forcing cars to lane-change
 * around it.
 *
 * WHY THIS FILE EXISTS:
 *   Real driving requires reacting to roadworks. A RoadClosure represents a
 *   blocked region on a specific lane between distStart and distEnd. Cars
 *   approaching look ahead, see the closure, and trigger a lane change to
 *   a clear sibling lane. The closure has a hit-test for editor picking and
 *   a draw method for the orange-and-black hatched rendering.
 *
 *   A specific scenario ('closure-detour') uses this to demonstrate the
 *   detour decision-making.
 *
 * WHO CALLS THIS:
 *   - Cars consult #closureAhead() in their speed control
 *   - closureEditor lets the user create/edit closures
 *   - Scenarios construct RoadClosure objects for the closure-detour scenario
 *   - RoadNetwork holds the array `closures[]`
 * ============================================================================ */

class RoadClosure {
   /**
    * @param {object} opts  { id?, lane, distStart, distEnd } — the lane and
    *                       the [distStart, distEnd] range that's blocked
    */
   constructor({ id, lane, distStart, distEnd }) {
      this.id = id ?? RoadClosure.nextId++;
      this.lane = lane;
      this.distStart = distStart;
      this.distEnd   = distEnd;
   }
   static nextId = 1;

   get length()    { return this.distEnd - this.distStart; }
   get midPoint()  { return this.lane.pointAtDistance((this.distStart + this.distEnd) / 2); }
   get startPoint(){ return this.lane.pointAtDistance(this.distStart); }
   get endPoint()  { return this.lane.pointAtDistance(this.distEnd); }

   /** Editor pick-test: is the world point p over this closure's swept area? */
   hitTest(p) {
      const a = this.startPoint, b = this.endPoint;
      const { point, t } = nearestOnSegment(a, b, p);
      if (t < -0.2 || t > 1.2) return false;
      return distance(p, point) < LANE_WIDTH * 0.65;
   }

   
   hitHandle(p) {
      if (distance(p, this.startPoint) < 10) return 'start';
      if (distance(p, this.endPoint)   < 10) return 'end';
      return null;
   }

   draw(ctx) {
      const a = this.startPoint;
      const b = this.endPoint;
      const len = distance(a, b);
      if (len < 2) return;

      const dir = normalize(subtract(b, a));
      const perp = perpendicular(dir);
      const halfW = LANE_WIDTH / 2 - 2;

      
      const corners = [
         add(a, scale(perp,  halfW)),
         add(b, scale(perp,  halfW)),
         add(b, scale(perp, -halfW)),
         add(a, scale(perp, -halfW)),
      ];

      
      ctx.save();
      ctx.fillStyle = 'rgba(220, 130, 30, 0.35)';
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fill();

      
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.clip();

      ctx.strokeStyle = 'rgba(255, 200, 40, 0.95)';
      ctx.lineWidth = 5;
      const stripeStep = 12;
      const stripeCount = Math.ceil((len + LANE_WIDTH) / stripeStep);
      
      for (let i = 0; i < stripeCount; i++) {
         const t = i * stripeStep;
         
         const p1 = add(a, add(scale(dir, t - LANE_WIDTH/2),        scale(perp, -halfW)));
         const p2 = add(a, add(scale(dir, t - LANE_WIDTH/2 + LANE_WIDTH), scale(perp,  halfW)));
         ctx.beginPath();
         ctx.moveTo(p1.x, p1.y);
         ctx.lineTo(p2.x, p2.y);
         ctx.stroke();
      }
      ctx.restore();

      
      ctx.strokeStyle = '#e88030';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
   }

   drawHandles(ctx, selected = false) {
      for (const pt of [this.startPoint, this.endPoint]) {
         ctx.beginPath();
         ctx.fillStyle = selected ? '#ffcc00' : '#e88030';
         ctx.strokeStyle = '#000';
         ctx.lineWidth = 1.5;
         ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
         ctx.fill();
         ctx.stroke();
      }
   }

   toJSON() {
      return {
         id: this.id, laneId: this.lane.id,
         distStart: this.distStart, distEnd: this.distEnd,
      };
   }

   static fromJSON(data, laneLookup) {
      const lane = laneLookup(data.laneId);
      if (!lane) return null;
      const c = new RoadClosure({
         id: data.id, lane,
         distStart: data.distStart, distEnd: data.distEnd,
      });
      RoadClosure.nextId = Math.max(RoadClosure.nextId, (data.id ?? 0) + 1);
      return c;
   }
}
