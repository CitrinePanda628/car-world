const SCENARIOS = {

   'busy-overtake': {
      label: 'Busy dual-carriageway',
      description: 'Two-lane road with mixed traffic. Aggressive drivers overtake; main car must stay safe.',
      build(network) {
         network.clear();
         const road = new Road(new Point(-500, 0), new Point(500, 0),
            { lanesForward: 2, lanesReverse: 2, speedLimit: 1.8 });
         network.addRoad(road);

         const f0 = road.lanes.find(l => l.direction === +1 && l.index === 0);
         const f1 = road.lanes.find(l => l.direction === +1 && l.index === 1);
         const r0 = road.lanes.find(l => l.direction === -1 && l.index === 0);
         const r1 = road.lanes.find(l => l.direction === -1 && l.index === 1);

         network.addMarking(new StartMarker({ lane: f0, distance: 30 }));
         network.addMarking(new EndMarker({ lane: f0, distance: f0.length - 30 }));

         network.addCar(new CarSpawn({ lane: f0, progress: 0.05, personality: 'good',     isMain: true }));
         network.addCar(new CarSpawn({ lane: f0, progress: 0.22, personality: 'passive',  isMain: false }));
         network.addCar(new CarSpawn({ lane: f1, progress: 0.10, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: f1, progress: 0.55, personality: 'good',      isMain: false }));
         network.addCar(new CarSpawn({ lane: r0, progress: 0.20, personality: 'distracted', isMain: false }));
         network.addCar(new CarSpawn({ lane: r1, progress: 0.40, personality: 'good',      isMain: false }));
      },
   },

   'signalled-crossroads': {
      label: 'Signalled crossroads',
      description: 'Four-way junction with synchronised traffic lights. Heavy traffic from all directions.',
      build(network) {
         network.clear();
         const r1 = new Road(new Point(-350, 0),  new Point(-50, 0),  { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const r2 = new Road(new Point(50, 0),    new Point(350, 0),  { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const r3 = new Road(new Point(0, -350),  new Point(0, -50),  { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const r4 = new Road(new Point(0, 50),    new Point(0, 350),  { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         network.addRoad(r1); network.addRoad(r2);
         network.addRoad(r3); network.addRoad(r4);

         const it = network.addIntersection(new Point(0, 0));
         it.connect(r1, 'end');
         it.connect(r2, 'start');
         it.connect(r3, 'end');
         it.connect(r4, 'start');

         const addLight = (road, whichEnd, group, offset) => {
            const inboundLane = road.lanes.find(l =>
               (whichEnd === 'end'   && l.direction === +1) ||
               (whichEnd === 'start' && l.direction === -1)
            );
            if (inboundLane) {
               network.addMarking(new TrafficLight({
                  lane: inboundLane,
                  distance: Math.max(0, inboundLane.length - 22),
                  group, phaseOffset: offset,
               }));
            }
         };
         addLight(r1, 'end',   'xstreet', 0);
         addLight(r2, 'start', 'xstreet', 0);
         addLight(r3, 'end',   'xstreet', 450);
         addLight(r4, 'start', 'xstreet', 450);

         const mainLane = r1.lanes.find(l => l.direction === +1);
         network.addMarking(new StartMarker({ lane: mainLane, distance: 30 }));
         const goalLane = r2.lanes.find(l => l.direction === +1);
         network.addMarking(new EndMarker({ lane: goalLane, distance: goalLane.length - 30 }));

         network.addCar(new CarSpawn({ lane: mainLane, progress: 0.10, personality: 'good',       isMain: true }));
         network.addCar(new CarSpawn({ lane: r1.lanes.find(l => l.direction === +1), progress: 0.45, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: r2.lanes.find(l => l.direction === -1), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r2.lanes.find(l => l.direction === -1), progress: 0.65, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: r3.lanes.find(l => l.direction === +1), progress: 0.15, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r3.lanes.find(l => l.direction === +1), progress: 0.55, personality: 'distracted', isMain: false }));
         network.addCar(new CarSpawn({ lane: r4.lanes.find(l => l.direction === -1), progress: 0.30, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r4.lanes.find(l => l.direction === -1), progress: 0.70, personality: 'aggressive', isMain: false }));
      },
   },

   'urban-route': {
      label: 'Urban route (multi-junction)',
      description: 'Drive across town through 3 junctions: a give-way, a crossroads, and a pelican crossing.',
      build(network) {
         network.clear();
         const a = new Road(new Point(-500, 0),  new Point(-200, 0),   { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const b = new Road(new Point(-200, 0), new Point(100, 0),     { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const c = new Road(new Point(100, 0),  new Point(450, 0),     { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const sideN = new Road(new Point(-200, -250), new Point(-200, 0), { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });
         const sideS = new Road(new Point(100, 0), new Point(100, 250),   { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });
         network.addRoad(a); network.addRoad(b); network.addRoad(c);
         network.addRoad(sideN); network.addRoad(sideS);

         const it1 = network.addIntersection(new Point(-200, 0));
         it1.connect(a, 'end');
         it1.connect(b, 'start');
         it1.connect(sideN, 'end');

         const it2 = network.addIntersection(new Point(100, 0));
         it2.connect(b, 'end');
         it2.connect(c, 'start');
         it2.connect(sideS, 'start');

         const sideNLane = sideN.lanes.find(l => l.direction === +1);
         if (sideNLane) network.addMarking(new YieldSign({ lane: sideNLane, distance: sideNLane.length - 8 }));
         const sideSLane = sideS.lanes.find(l => l.direction === -1);
         if (sideSLane) network.addMarking(new YieldSign({ lane: sideSLane, distance: sideSLane.length - 8 }));

         const cFwd = c.lanes.find(l => l.direction === +1);
         network.addMarking(new PelicanCrossing({ lane: cFwd, distance: cFwd.length * 0.55 }));
         const cRev = c.lanes.find(l => l.direction === -1);
         network.addMarking(new PelicanCrossing({ lane: cRev, distance: cRev.length * 0.45 }));

         const startLane = a.lanes.find(l => l.direction === +1);
         network.addMarking(new StartMarker({ lane: startLane, distance: 30 }));
         const goalLane = c.lanes.find(l => l.direction === +1);
         network.addMarking(new EndMarker({ lane: goalLane, distance: goalLane.length - 30 }));

         network.addCar(new CarSpawn({ lane: startLane, progress: 0.10, personality: 'good',       isMain: true }));
         network.addCar(new CarSpawn({ lane: b.lanes.find(l => l.direction === -1), progress: 0.30, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: c.lanes.find(l => l.direction === -1), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: c.lanes.find(l => l.direction === +1), progress: 0.80, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: sideNLane, progress: 0.20, personality: 'good',  isMain: false }));
         network.addCar(new CarSpawn({ lane: sideS.lanes.find(l => l.direction === +1), progress: 0.30, personality: 'distracted', isMain: false }));
      },
   },

   'closure-detour': {
      label: 'Lane closure',
      description: 'Two-lane road with a closure ahead. Cars must merge into the open lane safely.',
      build(network) {
         network.clear();
         const road = new Road(new Point(-500, 0), new Point(500, 0),
            { lanesForward: 2, lanesReverse: 1, speedLimit: 1.6 });
         network.addRoad(road);

         const f0 = road.lanes.find(l => l.direction === +1 && l.index === 0);
         const f1 = road.lanes.find(l => l.direction === +1 && l.index === 1);
         const r0 = road.lanes.find(l => l.direction === -1);

         network.addClosure(new RoadClosure({
            lane: f0,
            distStart: f0.length * 0.45,
            distEnd:   f0.length * 0.62,
         }));

         network.addMarking(new StartMarker({ lane: f0, distance: 30 }));
         network.addMarking(new EndMarker({ lane: f0, distance: f0.length - 30 }));

         network.addCar(new CarSpawn({ lane: f0, progress: 0.05, personality: 'good',       isMain: true }));
         network.addCar(new CarSpawn({ lane: f0, progress: 0.20, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: f1, progress: 0.30, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: f1, progress: 0.60, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: r0, progress: 0.40, personality: 'good',       isMain: false }));
      },
   },

   'rush-hour': {
      label: 'Rush hour grid',
      description: 'Showcase scenario: complex network with multiple junctions, mixed signals, heavy traffic.',
      build(network) {
         network.clear();
         const east  = new Road(new Point(-500, 0),  new Point(0, 0),   { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         const west  = new Road(new Point(0, 0),     new Point(500, 0), { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         const nrth  = new Road(new Point(0, -350),  new Point(0, 0),   { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });
         const sth   = new Road(new Point(0, 0),     new Point(0, 350), { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });
         network.addRoad(east); network.addRoad(west);
         network.addRoad(nrth); network.addRoad(sth);

         const it = network.addIntersection(new Point(0, 0));
         it.connect(east, 'end');
         it.connect(west, 'start');
         it.connect(nrth, 'end');
         it.connect(sth,  'start');

         const addLight = (road, whichEnd, group, offset) => {
            const inboundLane = road.lanes.find(l =>
               (whichEnd === 'end'   && l.direction === +1) ||
               (whichEnd === 'start' && l.direction === -1)
            );
            if (inboundLane) {
               network.addMarking(new TrafficLight({
                  lane: inboundLane,
                  distance: Math.max(0, inboundLane.length - 24),
                  group, phaseOffset: offset,
               }));
            }
         };
         addLight(east, 'end',   'rush', 0);
         addLight(west, 'start', 'rush', 0);
         addLight(nrth, 'end',   'rush', 450);
         addLight(sth,  'start', 'rush', 450);

         const startLane = east.lanes.find(l => l.direction === +1 && l.index === 0);
         network.addMarking(new StartMarker({ lane: startLane, distance: 30 }));
         const goalLane = west.lanes.find(l => l.direction === +1 && l.index === 0);
         network.addMarking(new EndMarker({ lane: goalLane, distance: goalLane.length - 30 }));

         network.addCar(new CarSpawn({ lane: startLane, progress: 0.05, personality: 'good',       isMain: true }));
         network.addCar(new CarSpawn({ lane: east.lanes.find(l => l.direction === +1 && l.index === 1), progress: 0.30, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: east.lanes.find(l => l.direction === +1 && l.index === 0), progress: 0.50, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: east.lanes.find(l => l.direction === -1 && l.index === 0), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: east.lanes.find(l => l.direction === -1 && l.index === 1), progress: 0.55, personality: 'distracted', isMain: false }));
         network.addCar(new CarSpawn({ lane: west.lanes.find(l => l.direction === +1 && l.index === 0), progress: 0.30, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: west.lanes.find(l => l.direction === -1 && l.index === 0), progress: 0.45, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: west.lanes.find(l => l.direction === -1 && l.index === 1), progress: 0.70, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: nrth.lanes.find(l => l.direction === +1), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: nrth.lanes.find(l => l.direction === +1), progress: 0.60, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: sth.lanes.find(l  => l.direction === -1), progress: 0.30, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: sth.lanes.find(l  => l.direction === -1), progress: 0.65, personality: 'aggressive', isMain: false }));
      },
   },

   'showcase': {
      label: 'Grand showcase',
      description: 'Large mixed network: signalled crossroads, roundabout, T-junction, lane closure, pelican crossing, highway slip-road. Drive end-to-end.',
      build(network) {
         network.clear();

         const r1 = new Road(new Point(-900, -200), new Point(-500, -200),
            { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         const r2 = new Road(new Point(-500, -200), new Point(-150, -200),
            { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         const r3 = new Road(new Point(-150, -200), new Point(200, -200),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const r4 = new Road(new Point(200, -200), new Point(550, -200),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });

         const sideUp   = new Road(new Point(-500, -450), new Point(-500, -200),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });
         const sideDown = new Road(new Point(-500, -200), new Point(-500, 0),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });

         const tSide = new Road(new Point(200, -400), new Point(200, -200),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });

         const rb_a = new Road(new Point(550, -200), new Point(680, -200),
            { lanesForward: 2, lanesReverse: 2, speedLimit: 1.5 });
         const rb_b = new Road(new Point(820, -200), new Point(950, -200),
            { lanesForward: 2, lanesReverse: 2, speedLimit: 1.5 });
         const rb_n = new Road(new Point(750, -400), new Point(750, -270),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });
         const rb_s = new Road(new Point(750, -130), new Point(750, 50),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });

         const hwy = new Road(new Point(-500, 200), new Point(900, 200),
            { roadClass: 'highway', lanesForward: 3, lanesReverse: 3, speedLimit: 3.0 });
         const slip = new Road(new Point(-300, 50), new Point(0, 178),
            { lanesForward: 1, lanesReverse: 0, speedLimit: 2.4 });

         const exitConn = new Road(new Point(-500, 0), new Point(-500, 200),
            { lanesForward: 1, lanesReverse: 1, speedLimit: 1.4 });

         [r1, r2, r3, r4, sideUp, sideDown, tSide,
          rb_a, rb_b, rb_n, rb_s, hwy, slip, exitConn].forEach(r => network.addRoad(r));

         const j1 = network.addIntersection(new Point(-500, -200));
         j1.connect(r1, 'end');
         j1.connect(r2, 'start');
         j1.connect(sideUp, 'end');
         j1.connect(sideDown, 'start');

         const addLight = (road, whichEnd, group, offset) => {
            const inboundLane = road.lanes.find(l =>
               (whichEnd === 'end' && l.direction === +1) ||
               (whichEnd === 'start' && l.direction === -1)
            );
            if (inboundLane) {
               network.addMarking(new TrafficLight({
                  lane: inboundLane,
                  distance: Math.max(0, inboundLane.length - 24),
                  group, phaseOffset: offset,
               }));
            }
         };
         addLight(r1, 'end', 'showcase-1', 0);
         addLight(r2, 'start', 'showcase-1', 0);
         addLight(sideUp, 'end', 'showcase-1', 450);
         addLight(sideDown, 'start', 'showcase-1', 450);

         const j2 = network.addIntersection(new Point(-150, -200));
         j2.connect(r2, 'end');
         j2.connect(r3, 'start');

         const f0 = r3.lanes.find(l => l.direction === +1);
         if (f0) {
            network.addClosure(new RoadClosure({
               lane: f0,
               distStart: f0.length * 0.55,
               distEnd:   f0.length * 0.72,
            }));
         }

         const fwdR3 = r3.lanes.find(l => l.direction === +1);
         if (fwdR3) network.addMarking(new PelicanCrossing({ lane: fwdR3, distance: fwdR3.length * 0.30 }));
         const revR3 = r3.lanes.find(l => l.direction === -1);
         if (revR3) network.addMarking(new PelicanCrossing({ lane: revR3, distance: revR3.length * 0.65 }));

         const j3 = network.addIntersection(new Point(200, -200));
         j3.connect(r3, 'end');
         j3.connect(r4, 'start');
         j3.connect(tSide, 'end');

         const tInbound = tSide.lanes.find(l => l.direction === +1);
         if (tInbound) {
            network.addMarking(new YieldSign({
               lane: tInbound, distance: Math.max(0, tInbound.length - 8),
            }));
         }

         const j4 = network.addIntersection(new Point(550, -200));
         j4.connect(r4, 'end');
         j4.connect(rb_a, 'start');

         const rbCenter = network.addIntersection(new Point(750, -200), { kind: 'roundabout' });
         rbCenter.connect(rb_a, 'end');
         rbCenter.connect(rb_b, 'start');
         rbCenter.connect(rb_n, 'end');
         rbCenter.connect(rb_s, 'start');

         const j5 = network.addIntersection(new Point(-500, 0));
         j5.connect(sideDown, 'end');
         j5.connect(exitConn, 'start');

         const j6 = network.addIntersection(new Point(-500, 200));
         j6.connect(exitConn, 'end');
         j6.connect(hwy, 'start');

         const slipFwd = slip.lanes.find(l => l.direction === +1);
         const hwyFwd0 = hwy.lanes.find(l => l.direction === +1 && l.index === 0);
         if (slipFwd && hwyFwd0) {
            const slipEndProj = (slip.end.x - hwy.start.x) / (hwy.end.x - hwy.start.x);
            slip.mergeTarget = {
               intoRoad: hwy,
               projectFrom: Math.max(0, slipEndProj * hwyFwd0.length - 200),
               projectTo:   Math.min(hwyFwd0.length, slipEndProj * hwyFwd0.length + 50),
            };
         }

         const startLane = r1.lanes.find(l => l.direction === +1 && l.index === 0);
         network.addMarking(new StartMarker({ lane: startLane, distance: 30 }));
         const goalLane = rb_b.lanes.find(l => l.direction === +1 && l.index === 0);
         network.addMarking(new EndMarker({ lane: goalLane, distance: goalLane.length - 30 }));

         network.addCar(new CarSpawn({ lane: startLane, progress: 0.05, personality: 'good', isMain: true }));

         const lanes = [
            r1.lanes.find(l => l.direction === +1 && l.index === 1),
            r1.lanes.find(l => l.direction === -1 && l.index === 0),
            r2.lanes.find(l => l.direction === +1 && l.index === 0),
            r2.lanes.find(l => l.direction === -1 && l.index === 1),
            r3.lanes.find(l => l.direction === -1),
            r4.lanes.find(l => l.direction === +1),
            r4.lanes.find(l => l.direction === -1),
            tSide.lanes.find(l => l.direction === -1),
            sideUp.lanes.find(l => l.direction === +1),
            sideDown.lanes.find(l => l.direction === -1),
            rb_a.lanes.find(l => l.direction === +1 && l.index === 0),
            rb_a.lanes.find(l => l.direction === -1 && l.index === 1),
            rb_b.lanes.find(l => l.direction === -1 && l.index === 0),
            rb_n.lanes.find(l => l.direction === +1),
            rb_s.lanes.find(l => l.direction === -1),
            hwy.lanes.find(l => l.direction === +1 && l.index === 1),
            hwy.lanes.find(l => l.direction === +1 && l.index === 2),
            hwy.lanes.find(l => l.direction === -1 && l.index === 0),
            hwy.lanes.find(l => l.direction === -1 && l.index === 1),
            slip.lanes.find(l => l.direction === +1),
         ];
         const personalities = ['good', 'aggressive', 'passive', 'distracted'];
         lanes.forEach((lane, i) => {
            if (!lane) return;
            const p = 0.10 + (i * 0.13) % 0.80;
            const pers = personalities[i % personalities.length];
            network.addCar(new CarSpawn({ lane, progress: p, personality: pers, isMain: false }));
         });
      },
   },

   'roundabout': {
      label: 'Roundabout',
      description: 'Four-arm roundabout. Cars yield to traffic already on the ring.',
      build(network) {
         network.clear();

         const r1 = new Road(new Point(-450, 0),  new Point(-130, 0),  { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const r2 = new Road(new Point(130, 0),   new Point(450, 0),   { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const r3 = new Road(new Point(0, -450),  new Point(0, -130),  { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         const r4 = new Road(new Point(0, 130),   new Point(0, 450),   { lanesForward: 1, lanesReverse: 1, speedLimit: 1.5 });
         network.addRoad(r1); network.addRoad(r2);
         network.addRoad(r3); network.addRoad(r4);

         const it = network.addIntersection(new Point(0, 0), { kind: 'roundabout' });
         it.connect(r1, 'end');
         it.connect(r2, 'start');
         it.connect(r3, 'end');
         it.connect(r4, 'start');

         const startLane = r1.lanes.find(l => l.direction === +1);
         network.addMarking(new StartMarker({ lane: startLane, distance: 30 }));
         const goalLane = r4.lanes.find(l => l.direction === +1);
         network.addMarking(new EndMarker({ lane: goalLane, distance: goalLane.length - 30 }));

         network.addCar(new CarSpawn({ lane: startLane, progress: 0.05, personality: 'good',       isMain: true }));
         network.addCar(new CarSpawn({ lane: r1.lanes.find(l => l.direction === +1), progress: 0.50, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: r2.lanes.find(l => l.direction === -1), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r2.lanes.find(l => l.direction === -1), progress: 0.55, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: r3.lanes.find(l => l.direction === +1), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r4.lanes.find(l => l.direction === -1), progress: 0.30, personality: 'distracted', isMain: false }));
         network.addCar(new CarSpawn({ lane: r4.lanes.find(l => l.direction === -1), progress: 0.65, personality: 'good',       isMain: false }));
      },
   },

   'roundabout-large': {
      label: 'Large roundabout (2 lanes)',
      description: 'Big multi-lane roundabout. Inner ring for far exits, outer ring for near exits.',
      build(network) {
         network.clear();

         const r1 = new Road(new Point(-550, 0),  new Point(-180, 0),  { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         const r2 = new Road(new Point(180, 0),   new Point(550, 0),   { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         const r3 = new Road(new Point(0, -550),  new Point(0, -180),  { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         const r4 = new Road(new Point(0, 180),   new Point(0, 550),   { lanesForward: 2, lanesReverse: 2, speedLimit: 1.6 });
         network.addRoad(r1); network.addRoad(r2);
         network.addRoad(r3); network.addRoad(r4);

         const it = network.addIntersection(new Point(0, 0), { kind: 'roundabout' });
         it.connect(r1, 'end');
         it.connect(r2, 'start');
         it.connect(r3, 'end');
         it.connect(r4, 'start');

         const startLane = r1.lanes.find(l => l.direction === +1 && l.index === 0);
         network.addMarking(new StartMarker({ lane: startLane, distance: 30 }));
         const goalLane = r3.lanes.find(l => l.direction === -1 && l.index === 0);
         network.addMarking(new EndMarker({ lane: goalLane, distance: goalLane.length - 30 }));

         network.addCar(new CarSpawn({ lane: startLane, progress: 0.05, personality: 'good',       isMain: true }));
         network.addCar(new CarSpawn({ lane: r1.lanes.find(l => l.direction === +1 && l.index === 1), progress: 0.40, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: r2.lanes.find(l => l.direction === -1 && l.index === 0), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r2.lanes.find(l => l.direction === -1 && l.index === 1), progress: 0.55, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: r3.lanes.find(l => l.direction === +1 && l.index === 0), progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r3.lanes.find(l => l.direction === +1 && l.index === 1), progress: 0.50, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: r4.lanes.find(l => l.direction === -1 && l.index === 0), progress: 0.30, personality: 'distracted', isMain: false }));
         network.addCar(new CarSpawn({ lane: r4.lanes.find(l => l.direction === -1 && l.index === 1), progress: 0.65, personality: 'good',       isMain: false }));
      },
   },

   'highway-merge': {
      label: 'Highway merge',
      description: 'Slip road runs parallel to a 3-lane motorway. Match the speed of the leftmost lane and merge into a gap.',
      build(network) {
         network.clear();

         const highway = new Road(new Point(-700, 0), new Point(700, 0),
            { roadClass: 'highway', lanesForward: 3, lanesReverse: 3, speedLimit: 3.0 });
         network.addRoad(highway);

         const slipStart = new Point(-500, 90);
         const slipEnd   = new Point(0, 22);
         const slip = new Road(slipStart, slipEnd,
            { roadClass: 'normal', lanesForward: 1, lanesReverse: 0, speedLimit: 2.4 });
         network.addRoad(slip);

         const slipDir = normalize(subtract(slipEnd, slipStart));
         const projT0 = (slipStart.x - highway.start.x) / (highway.end.x - highway.start.x);
         const projT1 = (slipEnd.x   - highway.start.x) / (highway.end.x - highway.start.x);
         const fwd0 = highway.lanes.find(l => l.direction === +1 && l.index === 0);
         const fwd1 = highway.lanes.find(l => l.direction === +1 && l.index === 1);
         const fwd2 = highway.lanes.find(l => l.direction === +1 && l.index === 2);
         const rev0 = highway.lanes.find(l => l.direction === -1 && l.index === 0);
         const rev1 = highway.lanes.find(l => l.direction === -1 && l.index === 1);

         slip.mergeTarget = {
            intoRoad: highway,
            projectFrom: projT0 * fwd0.length,
            projectTo:   projT1 * fwd0.length,
         };

         const slipFwd = slip.lanes.find(l => l.direction === +1);
         network.addMarking(new StartMarker({ lane: slipFwd, distance: 30 }));
         network.addMarking(new EndMarker({ lane: fwd0, distance: fwd0.length - 30 }));

         network.addCar(new CarSpawn({ lane: slipFwd, progress: 0.05, personality: 'good',       isMain: true }));
         network.addCar(new CarSpawn({ lane: fwd0, progress: 0.10, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: fwd0, progress: 0.40, personality: 'passive',    isMain: false }));
         network.addCar(new CarSpawn({ lane: fwd1, progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: fwd1, progress: 0.55, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: fwd2, progress: 0.05, personality: 'aggressive', isMain: false }));
         network.addCar(new CarSpawn({ lane: fwd2, progress: 0.45, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: rev0, progress: 0.20, personality: 'good',       isMain: false }));
         network.addCar(new CarSpawn({ lane: rev1, progress: 0.55, personality: 'aggressive', isMain: false }));
      },
   },

};

function loadScenario(id, network, onDone) {
   const s = SCENARIOS[id];
   if (!s) return false;
   s.build(network);
   if (onDone) onDone();
   return true;
}
