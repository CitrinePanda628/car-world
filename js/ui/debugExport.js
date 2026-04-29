/* ============================================================================
 * debugExport.js
 * ----------------------------------------------------------------------------
 * Side panel showing a JSON snapshot of the simulation. Toggled by the 📋
 * toolbar button. Two tabs: 'State Snapshot' and 'Action History'.
 *
 * WHY THIS FILE EXISTS:
 *   When something doesn't behave correctly, having a precise per-car state
 *   dump (positions, speeds, lane ids, internal paths, what the arbiter
 *   thinks about each junction) makes diagnosis tractable. The panel
 *   auto-refreshes every 30 frames while the sim runs, and the user can
 *   copy the JSON to share for debugging.
 *
 *   The Action History tab shows car.actionLog entries — the rolling
 *   record of decisions each car has made (e.g. "U-turn at dead end",
 *   "STUCK at lane end").
 *
 * WHO CALLS THIS:
 *   - main.js wires the buttons (Refresh, Copy, Close, tab switches) on init
 *   - Simulation.tick() calls debugExport.refresh(simulation) every 30 frames
 *
 * SHAPE OF SNAPSHOT (top-level keys):
 *   frame, running, roads[], intersections[], markings[], closures[],
 *   cars[] (full per-car state), arbiterState[] (per-junction occupants
 *   and clearFrames)
 * ============================================================================ */

class DebugExport {
   constructor() {
      this.panel = null;
      this.textarea = null;
      this.visible = false;
      this.view = 'state';
   }

   init() {
      this.panel = document.getElementById('debugExportPanel');
      this.textarea = document.getElementById('debugExportText');
   }

   setView(v, simulation) {
      this.view = v;
      const stateBtn = document.getElementById('debugTabState');
      const histBtn  = document.getElementById('debugTabHistory');
      if (stateBtn && histBtn) {
         const isState = v === 'state';
         stateBtn.style.background = isState ? '#234' : '#1a1d24';
         stateBtn.style.color = isState ? '#fff' : '#bbb';
         stateBtn.style.border = isState ? '1px solid #456' : '1px solid #333';
         histBtn.style.background = !isState ? '#234' : '#1a1d24';
         histBtn.style.color = !isState ? '#fff' : '#bbb';
         histBtn.style.border = !isState ? '1px solid #456' : '1px solid #333';
      }
      if (simulation) this.refresh(simulation);
   }

   toggle(simulation) {
      if (!this.panel) this.init();
      if (!this.panel) return;
      this.visible = !this.visible;
      this.panel.classList.toggle('hidden', !this.visible);
      if (this.visible) this.refresh(simulation);
   }

   refresh(simulation) {
      if (!this.textarea) return;
      if (this.view === 'history') {
         this.textarea.value = JSON.stringify(this.historyDump(simulation), null, 2);
      } else {
         this.textarea.value = JSON.stringify(this.snapshot(simulation), null, 2);
      }
   }

   historyDump(simulation) {
      const out = {
         frame: simulation.frameCount || 0,
         note: 'Per-car action history. Each entry shows what decisions the car made and why.',
         cars: [],
      };
      for (const car of (simulation.cars || [])) {
         out.cars.push({
            personality: car.params ? car.params.label : null,
            isMain: !!car.isMain,
            currentState: car.state,
            currentLane: car.lane ? car.lane.id : null,
            speed: round(car.speed, 3),
            stuckFrames: car.stuckFrames,
            pos: { x: round(car.x), y: round(car.y) },
            target: car.targetRoad ? car.targetRoad.id : null,
            actions: (car.actionLog || []).slice(-25),
         });
      }
      return out;
   }

   snapshot(simulation) {
      const network = simulation.network;
      const arbiter = simulation.arbiter;
      const out = {
         frame: simulation.frameCount || 0,
         running: !!simulation.running,
         roads: [],
         intersections: [],
         markings: [],
         closures: [],
         cars: [],
         arbiterState: [],
      };

      for (const r of network.roads) {
         out.roads.push({
            id: r.id,
            start: { x: round(r.start.x), y: round(r.start.y) },
            end:   { x: round(r.end.x),   y: round(r.end.y) },
            lanesForward: r.lanesForward,
            lanesReverse: r.lanesReverse,
            roadClass: r.roadClass,
            speedLimit: r.speedLimit,
            closed: r.closed,
            singleTrack: r.singleTrack,
            mergeTarget: r.mergeTarget ? {
               intoRoadId: r.mergeTarget.intoRoad ? r.mergeTarget.intoRoad.id : null,
               projectFrom: round(r.mergeTarget.projectFrom),
               projectTo: round(r.mergeTarget.projectTo),
            } : null,
            length: round(r.length),
         });
      }

      for (const it of network.intersections) {
         out.intersections.push({
            id: it.id,
            kind: it.kind,
            center: { x: round(it.center.x), y: round(it.center.y) },
            radius: round(it.radius),
            slots: it.slots.map(s => ({
               idx: s.index,
               angle: round(s.angle, 3),
               roadId: s.road ? s.road.id : null,
               end: s.end,
            })),
            paths: [...it.internalLanes.values()].map(p => ({
               key: p.key,
               category: p.category,
            })),
         });
      }

      for (const m of network.markings) {
         const e = {
            type: m.type,
            laneId: m.lane ? m.lane.id : null,
            distance: round(m.distance),
         };
         if (m.type === 'light' && m.state) e.state = m.state;
         if (m.type === 'crossing' && m.state) e.state = m.state;
         if (m.limit !== undefined) e.limit = m.limit;
         if (m.group) e.group = m.group;
         out.markings.push(e);
      }

      for (const c of network.closures) {
         out.closures.push({
            laneId: c.lane ? c.lane.id : null,
            distStart: round(c.distStart),
            distEnd:   round(c.distEnd),
         });
      }

      for (const car of (simulation.cars || [])) {
         const granted = arbiter ? arbiter.mayProceed(car) : null;
         const onLaneId = car.lane ? car.lane.id : null;
         const targetLaneId = car.targetLane ? car.targetLane.id : null;
         const nextLaneId = car.nextLane ? car.nextLane.id : null;
         const targetRoadId = car.targetRoad ? car.targetRoad.id : null;

         const e = {
            isMain: !!car.isMain,
            personality: car.params ? car.params.label : null,
            pos: { x: round(car.x), y: round(car.y) },
            angle: round(car.angle, 3),
            speed: round(car.speed, 3),
            state: car.state,
            laneId: onLaneId,
            distAlong: round(car.distAlong),
            targetLaneId,
            nextLaneId,
            targetRoadId,
            lateralT: round(car.lateralT, 3),
            internalDist: round(car.internalDist),
            internalLength: round(car.internalLength),
            internalPathKey: car.internalPath ? car.internalPath.key : null,
            internalPathCategory: car.internalPath ? car.internalPath.category : null,
            granted,
            stuckFrames: car.stuckFrames,
            laneChangeCool: car.laneChangeCool,
            blink: car.activeIndicator ? car.activeIndicator() : null,
            braking: !!car.braking,
            stopHoldFrames: car.stopHoldFrames || 0,
            servedStops: car.servedStopIds ? [...car.servedStopIds] : [],
            override: car.override,
            merging: car.merging ? {
               sourceLaneId: car.merging.sourceLane.id,
               targetLaneId: car.merging.targetLane.id,
               framesElapsed: car.merging.framesElapsed,
               framesTotal: car.merging.framesTotal,
            } : null,
            recentActions: car.actionLog ? car.actionLog.slice(-12) : [],
            nearby: this.nearbyOf(car, simulation.cars, 80),
         };
         out.cars.push(e);
      }

      if (arbiter && arbiter.junctionStates) {
         for (const [key, st] of arbiter.junctionStates) {
            const occupants = [];
            if (st.occupants) {
               for (const car of st.occupants) {
                  occupants.push({
                     carIdx: simulation.cars.indexOf(car),
                     state: car.state,
                     speed: round(car.speed, 3),
                  });
               }
            }
            out.arbiterState.push({
               junctionKey: key,
               junctionId: st.junction.intersection ? st.junction.intersection.id : null,
               occupantSlot: st.occupantSlot,
               clearFrames: st.clearFrames,
               occupants,
            });
         }
      }

      return out;
   }

   nearbyOf(car, allCars, maxDist) {
      const out = [];
      for (const c of allCars) {
         if (c === car) continue;
         const dx = c.x - car.x;
         const dy = c.y - car.y;
         const d = Math.hypot(dx, dy);
         if (d > maxDist) continue;
         const dirX = Math.cos(car.angle);
         const dirY = Math.sin(car.angle);
         const forward = (dx * dirX + dy * dirY);
         const lateral = (dx * (-dirY) + dy * dirX);
         out.push({
            personality: c.params ? c.params.label : null,
            isMain: !!c.isMain,
            distance: round(d),
            forwardOffset: round(forward),
            lateralOffset: round(lateral),
            laneId: c.lane ? c.lane.id : null,
            state: c.state,
            speed: round(c.speed, 3),
         });
      }
      out.sort((a, b) => a.distance - b.distance);
      return out;
   }
}

function round(n, places = 0) {
   if (typeof n !== 'number' || !isFinite(n)) return n;
   const m = Math.pow(10, places);
   return Math.round(n * m) / m;
}
