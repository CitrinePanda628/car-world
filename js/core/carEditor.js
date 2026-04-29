/* ============================================================================
 * carEditor.js
 * ----------------------------------------------------------------------------
 * Tool for placing CarSpawn definitions on lanes. Active when the toolbar's
 * 🚗 button is selected.
 *
 * WHY THIS FILE EXISTS:
 *   A scenario starts with no live cars — only "spawns" describing where
 *   cars should be created when the simulation begins. This editor lets the
 *   user place those spawns: click on a lane, the spawn is created at the
 *   click's projected distance with the personality currently chosen in the
 *   side panel (good/aggressive/passive/distracted).
 *
 *   At sim start, RoadNetwork.cars is iterated and a live Car is instantiated
 *   for each spawn.
 *
 * WHO CALLS THIS:
 *   - main.js enables/disables and reads selected spawn for the side panel
 * ============================================================================ */

class CarEditor {
   /**
    * @param {Viewport} viewport
    * @param {RoadNetwork} network
    * @param {Function} getSettings  returns { personality, isMain } per call
    */
   constructor(viewport, network, getSettings) {
      this.viewport = viewport;
      this.network  = network;
      this.getSettings = getSettings;
      this.enabled  = false;
      this.selected = null;
      this.hoverPos = null;
      this.dragging = null;
      this.#attach();
   }

   enable()  { this.enabled = true; this.selected = null; }
   disable() { this.enabled = false; this.selected = null; this.dragging = null; }

   #attach() {
      const c = this.viewport.canvas;
      c.addEventListener("mousedown", e => this.#onDown(e));
      c.addEventListener("mousemove", e => this.#onMove(e));
      c.addEventListener("mouseup",   e => this.#onUp(e));
      window.addEventListener("keydown", e => this.#onKey(e));
   }

   #onMove(e) {
      if (!this.enabled) return;
      this.hoverPos = this.viewport.getMouse(e);
      if (this.dragging) {
         const { lane, dist } = this.network.nearestLane(this.hoverPos, 50);
         if (lane) {
            this.dragging.lane = lane;
            const { t } = projectOnSegment(lane.p1, lane.p2, this.hoverPos);
            this.dragging.progress = clamp(t, 0.03, 0.97);
         }
      }
   }

   #onDown(e) {
      if (!this.enabled || e.button !== 0) return;
      const pos = this.viewport.getMouse(e);

      
      for (const c of this.network.cars) {
         if (distance(pos, c.position) < 14) {
            this.selected = c;
            this.dragging = c;
            return;
         }
      }

      
      const { lane } = this.network.nearestLane(pos, 50);
      if (!lane) return;
      const { t } = projectOnSegment(lane.p1, lane.p2, pos);
      const progress = clamp(t, 0.03, 0.97);

      const { personality, isMain } = this.getSettings();

      
      if (isMain) for (const c of this.network.cars) c.isMain = false;

      const spawn = new CarSpawn({ lane, progress, personality, isMain });
      this.network.addCar(spawn);
      this.selected = spawn;
   }

   #onUp() { this.dragging = null; }

   #onKey(e) {
      if (!this.enabled) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
         this.network.removeCar(this.selected);
         this.selected = null;
      }
      if (e.key === 'Escape') this.selected = null;
   }

   display(ctx) {
      if (!this.enabled) return;

      if (this.selected) {
         const p = this.selected.position;
         ctx.save();
         ctx.strokeStyle = 'rgba(255, 204, 0, 0.9)';
         ctx.lineWidth = 2;
         ctx.setLineDash([4, 4]);
         ctx.beginPath();
         ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
         ctx.stroke();
         ctx.setLineDash([]);
         ctx.restore();
      }
   }
}
