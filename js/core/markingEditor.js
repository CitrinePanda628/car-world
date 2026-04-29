/* ============================================================================
 * markingEditor.js
 * ----------------------------------------------------------------------------
 * The marking-placing tool: stop sign, yield, traffic light, pedestrian
 * crossing, speed limit, start/end marker.
 *
 * WHY THIS FILE EXISTS:
 *   When the user selects one of the marking buttons in the toolbar, this
 *   editor is enabled with a `tool` string identifying which kind of
 *   marking. On click, the editor finds the nearest lane, projects the click
 *   onto it to get a distance, and creates the appropriate Marking subclass.
 *
 * SYNC OPPOSITE:
 *   When `syncOpposite` is enabled (a checkbox in the side panel), placing
 *   a marking on one lane also places a paired marking on the opposite-
 *   direction lane of the same road, at a mirrored distance. This is
 *   useful for symmetric scenarios (matching stop signs on a 4-way etc.).
 *
 * WHO CALLS THIS:
 *   - main.js instantiates one MarkingEditor and enables it with the
 *     appropriate tool string when toolbar mode changes
 * ============================================================================ */

class MarkingEditor {
   /**
    * @param {Viewport} viewport
    * @param {RoadNetwork} network
    * @param {Function} getSettings  returns { syncOpposite: bool } each call
    */
   constructor(viewport, network, getSettings = null) {
      this.viewport = viewport;
      this.network  = network;
      this.getSettings = getSettings || (() => ({ syncOpposite: false }));
      this.enabled  = false;
      this.tool     = null;          // 'stop' | 'yield' | 'light' | 'crossing' | ...
      this.selected = null;
      this.hoverPos = null;
      this.hoverLane = null;

      this.#attach();
   }

   enable(tool) { this.enabled = true; this.tool = tool; this.selected = null; }
   disable()    { this.enabled = false; this.selected = null; }

   #attach() {
      const c = this.viewport.canvas;
      c.addEventListener("mousedown", e => this.#onDown(e));
      c.addEventListener("mousemove", e => this.#onMove(e));
      window.addEventListener("keydown", e => this.#onKey(e));
   }

   #onMove(e) {
      if (!this.enabled) return;
      this.hoverPos = this.viewport.getMouse(e);
      const { lane, dist } = this.network.nearestLane(this.hoverPos, 40);
      this.hoverLane = lane ? { lane, dist } : null;
   }

   #onDown(e) {
      if (!this.enabled || e.button !== 0) return;
      const pos = this.viewport.getMouse(e);

      
      for (const m of this.network.markings) {
         if (distance(pos, m.iconPosition) < 14) {
            this.network.removeMarking(m);
            this.selected = null;
            return;
         }
      }

      
      const { lane } = this.network.nearestLane(pos, 40);
      if (!lane) return;
      const { t } = projectOnSegment(lane.p1, lane.p2, pos);
      const tc = clamp(t, 0.05, 0.95);
      const distance_ = tc * lane.length;

      const cls = MARKING_TYPES[this.tool];
      if (!cls) return;

      
      let markingOpts = { lane, distance: distance_ };
      if (this.tool === 'light') {
         const settings = this.getSettings();
         if (settings.syncOpposite) {
            const groupId = 'g' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            markingOpts.group = groupId;
            markingOpts.phaseOffset = 0;
         }
      }
      const marking = new cls(markingOpts);
      this.network.addMarking(marking);
      this.selected = marking;

      
      if (this.tool === 'light' && markingOpts.group) {
         const oppositeLane = lane.road.lanes.find(l =>
            l.direction === -lane.direction && l.index === lane.index
         );
         if (oppositeLane) {
            
            
            
            
            const oppDist = clamp(oppositeLane.length - distance_, 0.05 * oppositeLane.length, 0.95 * oppositeLane.length);
            const paired = new cls({
               lane: oppositeLane,
               distance: oppDist,
               group: markingOpts.group,
               phaseOffset: 0,        
            });
            this.network.addMarking(paired);
         }
      }
   }

   #onKey(e) {
      if (!this.enabled) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
         this.network.removeMarking(this.selected);
         this.selected = null;
      }
      if (e.key === 'Escape') this.selected = null;
   }

   display(ctx) {
      if (!this.enabled) return;

      
      if (this.hoverLane) {
         const { lane } = this.hoverLane;
         const { t } = projectOnSegment(lane.p1, lane.p2,
                         this.viewport.getMouse({ offsetX: this.viewport.center.x, offsetY: this.viewport.center.y }));
         
         if (this.hoverPos) {
            const { point } = nearestOnSegment(lane.p1, lane.p2, this.hoverPos);
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 204, 0, 0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
         }
      }

      
      if (this.selected) {
         const p = this.selected.iconPosition;
         ctx.save();
         ctx.strokeStyle = 'rgba(255, 204, 0, 0.9)';
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
         ctx.stroke();
         ctx.restore();
      }
   }
}
