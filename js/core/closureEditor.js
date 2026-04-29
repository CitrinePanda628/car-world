/* ============================================================================
 * closureEditor.js
 * ----------------------------------------------------------------------------
 * Tool for placing/dragging RoadClosure spans on lanes. Click on a lane to
 * create a default-length closure at that point; drag handles to resize.
 * Right-click to delete.
 *
 * WHY THIS FILE EXISTS:
 *   Closures are a lane-distance range, not a single point — placing them
 *   visually requires the user to pick a midpoint and length. This editor
 *   handles those gestures.
 *
 * WHO CALLS THIS:
 *   - main.js enables/disables when 'closure' toolbar mode is active
 * ============================================================================ */

class ClosureEditor {
   constructor(viewport, network) {
      this.viewport = viewport;
      this.network  = network;
      this.enabled  = false;
      this.selected = null;
      this.hoverPos = null;
      this.dragging = null;   // { closure, end: 'start'|'end' } when resizing

      this.#attach();
   }

   enable()  { this.enabled = true;  this.selected = null; }
   disable() { this.enabled = false; this.selected = null; this.dragging = null; }

   #attach() {
      const c = this.viewport.canvas;
      c.addEventListener("mousedown", e => this.#onDown(e));
      c.addEventListener("mousemove", e => this.#onMove(e));
      c.addEventListener("mouseup",   e => this.#onUp(e));
      window.addEventListener("keydown", e => this.#onKey(e));
   }

   #onDown(e) {
      if (!this.enabled || e.button !== 0) return;
      const pos = this.viewport.getMouse(e);

      
      for (const c of this.network.closures) {
         const which = c.hitHandle(pos);
         if (which) { this.selected = c; this.dragging = { closure: c, which }; return; }
      }

      
      for (const c of this.network.closures) {
         if (c.hitTest(pos)) { this.selected = c; return; }
      }

      
      const { lane } = this.network.nearestLane(pos, 30);
      if (!lane) return;
      const { t } = projectOnSegment(lane.p1, lane.p2, pos);
      const centre = clamp(t, 0.1, 0.9) * lane.length;
      const half = 30;
      const closure = new RoadClosure({
         lane,
         distStart: Math.max(0, centre - half),
         distEnd:   Math.min(lane.length, centre + half),
      });
      this.network.addClosure(closure);
      this.selected = closure;
   }

   #onMove(e) {
      if (!this.enabled) return;
      this.hoverPos = this.viewport.getMouse(e);
      if (this.dragging) {
         const { closure, which } = this.dragging;
         const { t } = projectOnSegment(closure.lane.p1, closure.lane.p2, this.hoverPos);
         const d = clamp(t, 0.02, 0.98) * closure.lane.length;
         const MIN = 20;
         if (which === 'start') {
            closure.distStart = Math.min(d, closure.distEnd - MIN);
         } else {
            closure.distEnd = Math.max(d, closure.distStart + MIN);
         }
      }
   }

   #onUp() { this.dragging = null; }

   #onKey(e) {
      if (!this.enabled) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
         this.network.removeClosure(this.selected);
         this.selected = null;
      }
      if (e.key === 'Escape') this.selected = null;
   }

   display(ctx) {
      if (!this.enabled) return;
      for (const c of this.network.closures) {
         c.drawHandles(ctx, c === this.selected);
      }
   }
}
