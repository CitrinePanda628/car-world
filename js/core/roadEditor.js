/* ============================================================================
 * roadEditor.js
 * ----------------------------------------------------------------------------
 * The road-drawing tool. Active when the user is in 'road' mode (the road
 * toolbar button is selected).
 *
 * WHY THIS FILE EXISTS:
 *   Users build scenarios by drawing roads. This editor handles the gestures:
 *     - Click on grass: begin a new road segment
 *     - Click again: complete the segment as a Road (snapping endpoints to
 *       intersections within ATTACH_DIST)
 *     - Drag a road endpoint: move it (and update connections)
 *     - Right-click on a road: delete it
 *     - Click a road body: select it for editing in the side panel
 *
 *   The editor draws preview overlays (the road being dragged, snap hints).
 *   Selection state is published via the onSelect callback so main.js can
 *   show the road-properties panel.
 *
 * WHO CALLS THIS:
 *   - main.js instantiates one RoadEditor and toggles enabled per mode
 *   - Receives mouse events directly from the canvas via attached listeners
 *
 * COORDINATION:
 *   - Calls `network.addRoad`, `network.removeRoad` for structural edits
 *   - Calls `viewport.getMouse(evt)` to convert pixel coords to world coords
 * ============================================================================ */

class RoadEditor {
   /**
    * @param {Viewport} viewport     for mouse->world conversion
    * @param {RoadNetwork} network   the network to modify
    * @param {Function} onSelect     called as onSelect(road|null) when
    *                                selection changes, so main.js can update
    *                                the side panel
    */
   constructor(viewport, network, onSelect) {
      this.viewport = viewport;
      this.network  = network;
      this.onSelect = onSelect;

      this.enabled      = false;
      this.pendingStart = null;   // first click of a 2-click road
      this.selected     = null;
      this.dragging     = null;   // { endpoint: 'start'|'end', road }
      this.hoverPos     = null;
      this.hoverPoint   = null;   // snapped variant of hoverPos for preview

      this.#attach();
   }

   enable()  { this.enabled = true; }
   disable() { this.enabled = false; this.pendingStart = null; this.dragging = null; }
   deselect(){ this.selected = null; this.pendingStart = null; if (this.onSelect) this.onSelect(null); }

   #attach() {
      const c = this.viewport.canvas;
      c.addEventListener("mousedown", e => this.#onDown(e));
      c.addEventListener("mousemove", e => this.#onMove(e));
      c.addEventListener("mouseup",   e => this.#onUp(e));
      window.addEventListener("keydown", e => this.#onKey(e));
   }

   
   
   #nearestHandle(pos, r = 16) {
      let best = null, bestD = r;

      for (const road of this.network.roads) {
         for (const which of ['start', 'end']) {
            const p = road[which];
            const d = distance(pos, p);
            if (d < bestD) { bestD = d; best = { kind: 'endpoint', point: p, road, which }; }
         }
      }
      for (const it of this.network.intersections) {
         const d = distance(pos, it.center);
         if (d < bestD) { bestD = d; best = { kind: 'intersection', point: it.center, intersection: it }; }
      }
      return best;
   }

   #hitRoadBody(pos) {
      for (const r of this.network.roads) {
         const { point, t } = nearestOnSegment(r.start, r.end, pos);
         if (distance(pos, point) < 20 && t >= 0 && t <= 1) return r;
      }
      return null;
   }

   
   #handleToConnection(road, which, handle) {
      if (handle.kind === 'intersection') {
         handle.intersection.connect(road, which);
      } else if (handle.kind === 'endpoint') {
         
         const other = handle.road;
         const otherEnd = handle.which;
         const existingConn = otherEnd === 'start' ? other.startConn : other.endConn;
         if (existingConn) {
            existingConn.intersection.connect(road, which);
            return;
         }
         
         const midPt = average(which === 'start' ? road.start : road.end,
                               otherEnd === 'start' ? other.start : other.end);
         const it = this.network.addIntersection(midPt);
         it.connect(road, which);
         it.connect(other, otherEnd);
      }
   }

   #onDown(e) {
      if (!this.enabled) return;

      if (e.button === 2) {
         if (this.pendingStart) {
            this.pendingStart = null;
            this.selected = null;
            if (this.onSelect) this.onSelect(null);
            return;
         }
         const pos = this.viewport.getMouse(e);
         const hit = this.#hitRoadBody(pos);
         if (hit) {
            this.network.removeRoad(hit);
            if (this.selected === hit) this.deselect();
            return;
         }
         return;
      }

      if (e.button !== 0) return;
      const pos = this.viewport.getMouse(e);

      this.mouseDownAt = pos.clone();
      this.mouseDownHandle = this.#nearestHandle(pos, 14);
      this.mouseDownRoadBody = this.mouseDownHandle ? null : this.#hitRoadBody(pos);
      this.mouseHasMoved = false;
   }

   #onMove(e) {
      if (!this.enabled) return;
      this.hoverPos = this.viewport.getMouse(e);

      
      const h = this.#nearestHandle(this.hoverPos, 16);
      this.hoverPoint = h ? h.point : null;

      
      if (this.mouseDownAt && !this.dragging && !this.mouseHasMoved) {
         if (distance(this.hoverPos, this.mouseDownAt) > 4) {
            this.mouseHasMoved = true;
            
            if (this.mouseDownHandle) {
               this.dragging = this.mouseDownHandle;
               if (this.dragging.kind === 'endpoint') {
                  this.selected = this.dragging.road;
                  if (this.onSelect) this.onSelect(this.selected);
               }
            }
         }
      }

      
      if (this.dragging) {
         if (this.dragging.kind === 'endpoint') {
            const { road, which } = this.dragging;
            const conn = which === 'start' ? road.startConn : road.endConn;
            if (conn) {
               const it = conn.intersection;
               if (distance(this.hoverPos, it.center) > it.radius + 30) {
                  it.disconnect(road);
                  if (which === 'start') road.startConn = null;
                  else                   road.endConn = null;
                  if (it.slots.length === 0) {
                     this.network.intersections = this.network.intersections.filter(x => x !== it);
                  }
               }
            }
            road.update({ [which]: this.hoverPos.clone() });
         } else if (this.dragging.kind === 'intersection') {
            const it = this.dragging.intersection;
            it.center = this.hoverPos.clone();
            for (const slot of it.slots) {
               if (slot.road) it.roadUpdated(slot.road);
            }
         }
      }
   }

   #onUp(e) {
      if (!this.enabled) return;

      
      if (this.mouseDownAt && !this.mouseHasMoved) {
         this.#handleClick(this.mouseDownAt, this.mouseDownHandle, this.mouseDownRoadBody);
      }

      
      if (this.dragging && this.dragging.kind === 'endpoint') {
         const { road, which } = this.dragging;
         const endPt = which === 'start' ? road.start : road.end;
         const alreadyConn = which === 'start' ? road.startConn : road.endConn;
         if (!alreadyConn) {
            const h = this.#nearestHandle(endPt, ATTACH_DIST);
            if (h && !(h.kind === 'endpoint' && h.road === road)) {
               this.#handleToConnection(road, which, h);
            } else {
               const hit = this.network.findRoadHit(endPt, 18);
               if (hit && hit.road !== road) {
                  const it = this.network.splitRoadAt(hit.road, hit.point);
                  if (it) {
                     if (which === 'start') road.update({ start: it.center.clone() });
                     else                   road.update({ end:   it.center.clone() });
                     it.connect(road, which);
                     this.#autoPlaceTJunctionMarking(road, which);
                  }
               }
            }
         }
      }

      this.dragging = null;
      this.mouseDownAt = null;
      this.mouseDownHandle = null;
      this.mouseDownRoadBody = null;
      this.mouseHasMoved = false;
   }

   
   #autoPlaceTJunctionMarking(road, which) {
      const inboundLane = road.lanes.find(l =>
         (which === 'end'   && l.direction === +1) ||
         (which === 'start' && l.direction === -1)
      );
      if (!inboundLane) return;
      const dist = Math.max(0, inboundLane.length - 8);
      const cls = MARKING_TYPES.yield;
      if (cls) this.network.addMarking(new cls({ lane: inboundLane, distance: dist }));
   }

   #handleClick(pos, handle, roadBody) {
      if (this.pendingStart) {
         let endPt = handle ? handle.point.clone() : pos.clone();
         let endRoadHit = null;
         if (!handle) {
            endRoadHit = this.network.findRoadHit(pos, 18);
            if (endRoadHit) endPt = endRoadHit.point.clone();
         }

         if (distance(endPt, this.pendingStart.point) < 10) {
            this.pendingStart = null;
            return;
         }

         const road = new Road(this.pendingStart.point.clone(), endPt);
         this.network.addRoad(road);

         if (this.pendingStart.handle) {
            this.#handleToConnection(road, 'start', this.pendingStart.handle);
         } else if (this.pendingStart.roadHit) {
            const it = this.network.splitRoadAt(this.pendingStart.roadHit.road, this.pendingStart.roadHit.point);
            if (it) { road.update({ start: it.center.clone() }); it.connect(road, 'start'); this.#autoPlaceTJunctionMarking(road, 'start'); }
         }

         if (handle) {
            this.#handleToConnection(road, 'end', handle);
         } else if (endRoadHit) {
            const it = this.network.splitRoadAt(endRoadHit.road, endRoadHit.point);
            if (it) { road.update({ end: it.center.clone() }); it.connect(road, 'end'); this.#autoPlaceTJunctionMarking(road, 'end'); }
         }

         this.selected = road;
         if (this.onSelect) this.onSelect(road);
         this.pendingStart = null;
         return;
      }

      
      if (handle) {
         if (handle.kind === 'endpoint') {
            this.selected = handle.road;
            if (this.onSelect) this.onSelect(this.selected);
            this.pendingStart = { point: handle.point.clone(), handle };
         } else if (handle.kind === 'intersection') {
            if (this.pendingStart) {
               return;
            }
            this.selected = handle.intersection;
            if (this.onSelect) this.onSelect(handle.intersection);
            this.pendingStart = { point: handle.point.clone(), handle };
         }
         return;
      }

      if (roadBody) {
         this.selected = roadBody;
         if (this.onSelect) this.onSelect(this.selected);
         return;
      }

      
      this.pendingStart = { point: pos.clone(), handle: null };
      this.selected = null;
      if (this.onSelect) this.onSelect(null);
   }

   #onKey(e) {
      if (!this.enabled) return;
      if (e.key === 'Escape') {
         this.pendingStart = null;
         this.deselect();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
         this.network.removeRoad(this.selected);
         this.deselect();
      }
   }

   
   display(ctx) {
      if (!this.enabled) return;

      
      if (this.pendingStart) {
         ctx.fillStyle = 'rgba(255,204,0,0.8)';
         ctx.beginPath();
         ctx.arc(this.pendingStart.point.x, this.pendingStart.point.y, 6, 0, Math.PI * 2);
         ctx.fill();
         if (this.hoverPos) {
            ctx.strokeStyle = 'rgba(255,204,0,0.45)';
            ctx.setLineDash([6, 6]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.pendingStart.point.x, this.pendingStart.point.y);
            ctx.lineTo(this.hoverPos.x, this.hoverPos.y);
            ctx.stroke();
            ctx.setLineDash([]);
         }
      }

      
      this.network.drawEditorHandles(ctx, this.selected, this.hoverPoint);

      
      if (this.selected) {
         if (this.selected instanceof Intersection) {
            const it = this.selected;
            ctx.strokeStyle = 'rgba(255,204,0,0.7)';
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.arc(it.center.x, it.center.y, it.radius + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
         } else {
            const r = this.selected;
            ctx.strokeStyle = 'rgba(255,204,0,0.6)';
            ctx.lineWidth = 3;
            ctx.setLineDash([10, 6]);
            ctx.beginPath();
            ctx.moveTo(r.start.x, r.start.y);
            ctx.lineTo(r.end.x,   r.end.y);
            ctx.stroke();
            ctx.setLineDash([]);
         }
      }
   }
}
