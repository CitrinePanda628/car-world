/* ============================================================================
 * viewport.js
 * ----------------------------------------------------------------------------
 * Owns the canvas <-> world transform: zoom, pan, and mouse-coordinate
 * conversion.
 *
 * WHY THIS FILE EXISTS:
 *   The world coordinates of the simulation are huge and arbitrary (cars at
 *   x=±500, y=±450 etc.). The HTML canvas is fixed-size. This class bridges
 *   the two: every drawing call goes through `reset()` which sets up the
 *   2D transform, and every mouse event goes through `getMouse(evt)` which
 *   converts pixel coordinates back to world coordinates.
 *
 * WHY ZOOM IS INVERTED:
 *   This codebase uses zoom as a "scale-down divisor". Higher `zoom` means
 *   a wider field of view (farther out). The canvas transform is
 *   `scale(1/zoom, 1/zoom)`. Mouse conversion multiplies by `zoom` to undo
 *   that.
 *
 * WHO CALLS THIS:
 *   - main.js: creates one Viewport instance bound to the canvas
 *   - main.js render loop: calls `viewport.reset()` once per frame, then
 *     all drawing happens in world coordinates
 *   - All editors (roadEditor, markingEditor, etc.): call `getMouse(evt)`
 *     in their pointer handlers to translate clicks into world points
 *
 * INTERACTION MODEL:
 *   - Wheel: zoom in/out (clamped 0.5..5)
 *   - Middle-button or right-button drag: pan the world
 *   - Left-click: passes through to the active editor; the viewport itself
 *     does not consume left-clicks
 * ============================================================================ */

class Viewport {
   /**
    * @param {HTMLCanvasElement} canvas the canvas the simulation renders into
    */
   constructor(canvas) {
      this.canvas = canvas;
      this.ctx    = canvas.getContext("2d");

      // World-to-screen transform parameters.
      this.zoom   = 1;
      this.center = new Point(canvas.width / 2, canvas.height / 2);
      // offset places world origin at canvas centre at startup.
      this.offset = scale(this.center, -1);

      // Drag state for pan. While dragging, drag.offset is added on top of
      // this.offset so the partial-drag is visible mid-gesture.
      this.drag = {
         start: new Point(0, 0),
         end:   new Point(0, 0),
         offset:new Point(0, 0),
         active: false,
      };

      this.#attach();
   }

   /**
    * Clear the canvas and reset the 2D transform so subsequent draw calls
    * use world coordinates. Called once per render frame from main.js.
    */
   reset() {
      const { ctx, canvas, center, zoom } = this;
      ctx.restore();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.scale(1 / zoom, 1 / zoom);
      const o = this.getOffset();
      ctx.translate(o.x, o.y);
   }

   /**
    * Convert a mouse event's screen coordinates to world coordinates.
    * @param subtractDrag if true, subtracts the in-progress drag offset
    *   so callers see the world point under the cursor before drag began.
    */
   getMouse(evt, subtractDrag = false) {
      const p = new Point(
         (evt.offsetX - this.center.x) * this.zoom - this.offset.x,
         (evt.offsetY - this.center.y) * this.zoom - this.offset.y
      );
      return subtractDrag ? subtract(p, this.drag.offset) : p;
   }

   /** Combined pan offset: committed offset + in-progress drag offset. */
   getOffset() { return add(this.offset, this.drag.offset); }

   #attach() {
      this.canvas.addEventListener("wheel",     e => this.#onWheel(e),     { passive: false });
      this.canvas.addEventListener("mousedown", e => this.#onDown(e));
      this.canvas.addEventListener("mousemove", e => this.#onMove(e));
      this.canvas.addEventListener("mouseup",   e => this.#onUp(e));
      this.canvas.addEventListener("contextmenu", e => e.preventDefault());
   }

   #onWheel(e) {
      e.preventDefault();
      const dir = Math.sign(e.deltaY);
      this.zoom = clamp(this.zoom + dir * 0.1, 0.5, 5);
   }

   #onDown(e) {
      // Middle (1) and right (2) buttons begin a pan. Left button (0) is
      // intentionally ignored so editors can use it for selection/drawing.
      if (e.button === 1 || e.button === 2) {
         this.drag.start = this.getMouse(e);
         this.drag.active = true;
      }
   }

   #onMove(e) {
      if (this.drag.active) {
         this.drag.end    = this.getMouse(e);
         this.drag.offset = subtract(this.drag.end, this.drag.start);
      }
   }

   #onUp(e) {
      if (this.drag.active) {
         // Bake the in-progress drag into the committed offset.
         this.offset = add(this.offset, this.drag.offset);
         this.drag = {
            start: new Point(0, 0), end: new Point(0, 0),
            offset:new Point(0, 0), active: false,
         };
      }
   }
}
