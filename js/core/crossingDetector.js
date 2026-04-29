/* ============================================================================
 * crossingDetector.js
 * ----------------------------------------------------------------------------
 * Visual hint: highlights points where two roads geometrically cross without
 * being formally connected by an Intersection. Helps users notice missing
 * intersection wiring while editing.
 *
 * WHY THIS FILE EXISTS:
 *   It's easy to draw two roads that visually overlap but lack a shared
 *   intersection — cars wouldn't be able to traverse from one to the other.
 *   This detector finds those crossings and renders a yellow exclamation
 *   triangle on top, so the user remembers to add an intersection there.
 *
 * WHO CALLS THIS:
 *   - main.js render loop calls update() then draw(ctx) each frame
 * ============================================================================ */

class CrossingDetector {
   constructor(network) {
      this.network = network;
      this.crossings = [];    
   }

   
   update() {
      this.crossings = [];
      const roads = this.network.roads;
      const EPS = 16;   

      for (let i = 0; i < roads.length; i++) {
         const A = roads[i];
         for (let j = i + 1; j < roads.length; j++) {
            const B = roads[j];
            const hit = segmentIntersect(A.start, A.end, B.start, B.end);
            if (!hit) continue;

            
            const p = new Point(hit.x, hit.y);
            if (distance(p, A.start) < EPS) continue;
            if (distance(p, A.end)   < EPS) continue;
            if (distance(p, B.start) < EPS) continue;
            if (distance(p, B.end)   < EPS) continue;

            this.crossings.push({ point: p, roadA: A, roadB: B });
         }
      }
   }

   draw(ctx) {
      for (const c of this.crossings) {
         const p = c.point;
         
         const pulse = (Math.sin(performance.now() / 300) + 1) / 2;
         const alpha = 0.5 + pulse * 0.4;

         ctx.save();
         ctx.fillStyle = `rgba(255, 200, 30, ${alpha})`;
         ctx.strokeStyle = '#111';
         ctx.lineWidth = 1.5;
         ctx.beginPath();
         const r = 14;
         ctx.moveTo(p.x, p.y - r);
         ctx.lineTo(p.x + r * 0.87, p.y + r * 0.5);
         ctx.lineTo(p.x - r * 0.87, p.y + r * 0.5);
         ctx.closePath();
         ctx.fill();
         ctx.stroke();

         
         ctx.fillStyle = '#111';
         ctx.font = 'bold 14px sans-serif';
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         ctx.fillText('!', p.x, p.y + 1);

         
         ctx.restore();
      }
   }
}
