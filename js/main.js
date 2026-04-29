const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');

let viewport;
function resizeCanvas() {
   canvas.width  = canvas.clientWidth;
   canvas.height = canvas.clientHeight;
   if (viewport) viewport.center = new Point(canvas.width / 2, canvas.height / 2);
}
resizeCanvas();
viewport = new Viewport(canvas);
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const network = new RoadNetwork();

const legacySaved = localStorage.getItem('scenario');
if (legacySaved) {
   try {
      network.loadJSON(JSON.parse(legacySaved));
      try {
         const existing = JSON.parse(localStorage.getItem('savedScenarios_v1') || '{}');
         if (!existing['Last session']) {
            existing['Last session'] = JSON.parse(legacySaved);
            localStorage.setItem('savedScenarios_v1', JSON.stringify(existing));
         }
      } catch {}
      localStorage.removeItem('scenario');
   } catch (e) { console.warn('Saved data corrupt', e); }
}

const roadEditor    = new RoadEditor(viewport, network, onRoadSelected);
const markingEditor = new MarkingEditor(viewport, network, () => ({
   syncOpposite: document.getElementById('syncLightsToggle')?.checked ?? false,
}));
const carEditor     = new CarEditor(viewport, network, () => ({
   personality: activePersonality,
   isMain: mainToggle.checked,
}));
const closureEditor = new ClosureEditor(viewport, network);
const crossingDetector = new CrossingDetector(network);
const simulation = new Simulation(network);
const debugOverlay = new DebugOverlay();
const debugExport  = new DebugExport();
const history = new History(network);
history.primeBaseline();

let activeMode        = 'road';
let activePersonality = 'good';
const mainToggle = document.getElementById('isMainToggle');

function setMode(mode) {
   if (simulation.running) simulation.stop();
   activeMode = mode;

   roadEditor.disable();
   markingEditor.disable();
   carEditor.disable();
   closureEditor.disable();

   if (mode === 'road')      roadEditor.enable();
   if (mode === 'stop')      markingEditor.enable('stop');
   if (mode === 'yield')     markingEditor.enable('yield');
   if (mode === 'light')     markingEditor.enable('light');
   if (mode === 'crossing')  markingEditor.enable('crossing');
   if (mode === 'speedlimit')markingEditor.enable('speedlimit');
   if (mode === 'start')     markingEditor.enable('start');
   if (mode === 'end')       markingEditor.enable('end');
   if (mode === 'car')       carEditor.enable();
   if (mode === 'closure')   closureEditor.enable();
   if (mode === 'sim')       { simulation.setMode(runMode); simulation.start(); simulation.setSpeed(1); updateSpeedUI(1); }

   document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
   const btn = document.getElementById('btn-' + mode);
   if (btn) btn.classList.add('active');

   document.getElementById('carOptions').classList.toggle('hidden', mode !== 'car');
   document.getElementById('lightOptions').classList.toggle('hidden', mode !== 'light');
   document.getElementById('speedBar').classList.toggle('hidden', mode !== 'sim');
   if (mode !== 'road') onRoadSelected(null);
}

for (const m of ['road', 'stop', 'yield', 'light', 'crossing', 'speedlimit', 'start', 'end', 'car', 'closure', 'sim']) {
   const btn = document.getElementById('btn-' + m);
   if (btn) btn.onclick = () => setMode(m);
}

const restartBtn = document.getElementById('btn-restart');
if (restartBtn) restartBtn.onclick = () => {
   if (simulation.running) simulation.restart();
   else setMode('sim');
};

const debugBtn = document.getElementById('btn-debug');
if (debugBtn) debugBtn.onclick = () => {
   debugOverlay.toggle();
   debugBtn.classList.toggle('active', debugOverlay.enabled);
};

const moreBtn = document.getElementById('btnMore');
const moreMenu = document.getElementById('moreMenu');
if (moreBtn) moreBtn.onclick = (e) => {
   e.stopPropagation();
   moreMenu.classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
   if (moreMenu && !moreMenu.classList.contains('hidden')
       && !moreMenu.contains(e.target) && e.target !== moreBtn) {
      moreMenu.classList.add('hidden');
   }
});

const debugExportBtn = document.getElementById('btn-debug-export');
if (debugExportBtn) debugExportBtn.onclick = () => {
   debugExport.toggle(simulation);
   debugExportBtn.classList.toggle('active', debugExport.visible);
};

// Debug-export panel wiring. Inlined (not gated on 'load') because main.js
// runs after all DOM elements are present in the body, so listeners attach
// reliably without race conditions.
{
   const refreshBtn = document.getElementById('debugRefresh');
   const copyBtn    = document.getElementById('debugCopy');
   const closeBtn   = document.getElementById('debugClose');
   const tabState   = document.getElementById('debugTabState');
   const tabHist    = document.getElementById('debugTabHistory');
   if (refreshBtn) refreshBtn.onclick = () => debugExport.refresh(simulation);
   if (copyBtn)    copyBtn.onclick    = () => {
      const ta = document.getElementById('debugExportText');
      if (ta) {
         ta.select();
         document.execCommand('copy');
         copyBtn.textContent = 'Copied!';
         setTimeout(() => copyBtn.textContent = 'Copy', 800);
      }
   };
   if (closeBtn) closeBtn.onclick = () => {
      debugExport.visible = false;
      const panel = document.getElementById('debugExportPanel');
      if (panel) panel.classList.add('hidden');
      if (debugExportBtn) debugExportBtn.classList.remove('active');
   };
   if (tabState) tabState.onclick = () => debugExport.setView('state', simulation);
   if (tabHist)  tabHist.onclick  = () => debugExport.setView('history', simulation);
}

document.addEventListener('mouseup', () => {
   if (!simulation.running) {
      setTimeout(() => history.capture(), 0);
   }
});
document.addEventListener('change', e => {
   if (e.target && e.target.id && e.target.id.startsWith('p')) {
      setTimeout(() => history.capture(), 0);
   }
});
document.addEventListener('keydown', e => {
   const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
   const isRedo = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey));
   if (isUndo) { e.preventDefault(); doUndo(); }
   else if (isRedo) { e.preventDefault(); doRedo(); }
});

function doUndo() {
   if (simulation.running) return;
   if (history.undo()) {
      roadEditor.deselect();
   }
}
function doRedo() {
   if (simulation.running) return;
   if (history.redo()) {
      roadEditor.deselect();
   }
}

document.getElementById('btnUndo').onclick = doUndo;
document.getElementById('btnRedo').onclick = doRedo;

document.querySelectorAll('.pers-btn').forEach(b => {
   b.onclick = () => {
      activePersonality = b.dataset.pers;
      document.querySelectorAll('.pers-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
   };
});

let runMode = 'teach';
document.querySelectorAll('.mode-btn').forEach(b => {
   b.onclick = () => {
      runMode = b.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (simulation.running) simulation.setMode(runMode);
   };
});
simulation.setMode(runMode);

function updateSpeedUI(v) {
   document.querySelectorAll('.speed-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === v);
   });
}
document.querySelectorAll('.speed-btn').forEach(b => {
   b.onclick = () => {
      const v = parseFloat(b.dataset.speed);
      simulation.setSpeed(v);
      updateSpeedUI(v);
   };
});

const panel = document.getElementById('props');
const propBody = document.getElementById('propsBody');

function onRoadSelected(road) {
   if (!road) { panel.classList.add('hidden'); return; }
   panel.classList.remove('hidden');

   if (road instanceof Intersection) {
      const it = road;
      propBody.innerHTML = `
         <div class="field">
            <label>Junction type</label>
            <select id="pIK">
               <option value="plain"      ${it.kind === 'plain'      ? 'selected' : ''}>Plain junction</option>
               <option value="roundabout" ${it.kind === 'roundabout' ? 'selected' : ''}>Roundabout</option>
            </select>
         </div>
         <div class="field hint">${it.slots.length} road${it.slots.length === 1 ? '' : 's'} connected</div>
         <button id="pIDel" class="danger">Delete junction</button>
      `;
      document.getElementById('pIK').onchange = e => {
         it.kind = e.target.value;
         it.refreshKind();
         network.rebuild();
      };
      document.getElementById('pIDel').onclick = () => {
         for (const slot of [...it.slots]) {
            if (slot.road) it.disconnect(slot.road);
         }
         const idx = network.intersections.indexOf(it);
         if (idx >= 0) network.intersections.splice(idx, 1);
         network.rebuild();
         roadEditor.deselect();
      };
      return;
   }

   propBody.innerHTML = `
      <div class="field">
         <label>Forward lanes</label>
         <input type="number" id="pLF" min="1" max="3" value="${road.lanesForward}">
      </div>
      <div class="field">
         <label>Reverse lanes</label>
         <input type="number" id="pLR" min="0" max="3" value="${road.lanesReverse}">
         <div class="hint">0 = one-way road</div>
      </div>
      <div class="field">
         <label>Road type</label>
         <select id="pRC">
            <option value="normal" ${road.roadClass !== 'highway' ? 'selected' : ''}>Normal road</option>
            <option value="highway" ${road.roadClass === 'highway' ? 'selected' : ''}>Highway / motorway</option>
         </select>
      </div>
      <div class="field">
         <label>Speed limit</label>
         <input type="number" id="pSL" min="0.3" max="4" step="0.1" value="${road.speedLimit}">
      </div>
      <div class="field">
         <label class="check">
            <input type="checkbox" id="pCL" ${road.closed ? 'checked' : ''}>
            Road closed
         </label>
      </div>
      <div class="field">
         <label class="check">
            <input type="checkbox" id="pST" ${road.singleTrack ? 'checked' : ''}>
            Single-track (passing places)
         </label>
         <div class="hint">Both directions share one lane. Add 🅿️ lay-bys for cars to wait.</div>
      </div>
      <div class="field">
         <label>Merges into (slip road)</label>
         <select id="pMT">
            <option value="">—</option>
            ${network.roads
              .filter(r => r !== road && r.roadClass === 'highway')
              .map(r => `<option value="${r.id}" ${road.mergeTarget && road.mergeTarget.intoRoad === r ? 'selected' : ''}>Highway #${r.id}</option>`)
              .join('')}
         </select>
         <div class="hint">If set, this road acts as a slip road merging into the chosen highway's leftmost lane.</div>
      </div>
      <button id="pDel" class="danger">Delete road</button>
   `;
   document.getElementById('pLF').oninput = e => road.update({ lanesForward: Math.max(1, parseInt(e.target.value) || 1) });
   document.getElementById('pLR').oninput = e => road.update({ lanesReverse: Math.max(0, parseInt(e.target.value) || 0) });
   document.getElementById('pSL').oninput = e => road.update({ speedLimit: parseFloat(e.target.value) || 1.5 });
   document.getElementById('pMT').onchange = e => {
      const id = parseInt(e.target.value);
      if (!id) {
         road.mergeTarget = null;
      } else {
         const target = network.roads.find(r => r.id === id);
         if (target) {
            const slipEnd = road.end;
            const ax = target.end.x - target.start.x;
            const ay = target.end.y - target.start.y;
            const bx = slipEnd.x - target.start.x;
            const by = slipEnd.y - target.start.y;
            const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / (ax * ax + ay * ay)));
            const fwd0 = target.lanes.find(l => l.direction === +1 && l.index === 0);
            if (fwd0) {
               road.mergeTarget = {
                  intoRoad: target,
                  projectFrom: Math.max(0, t * fwd0.length - 200),
                  projectTo:   Math.min(fwd0.length, t * fwd0.length + 50),
               };
            }
         }
      }
   };
   document.getElementById('pRC').onchange = e => {
      const rc = e.target.value;
      const upd = { roadClass: rc };
      if (rc === 'highway' && road.speedLimit < 2.5) upd.speedLimit = 3.0;
      if (rc === 'normal'  && road.speedLimit > 2.5) upd.speedLimit = 1.5;
      road.update(upd);
      onRoadSelected(road);
   };
   document.getElementById('pCL').onchange = e => road.update({ closed: e.target.checked });
   document.getElementById('pST').onchange = e => road.update({ singleTrack: e.target.checked });
   document.getElementById('pDel').onclick = () => { network.removeRoad(road); roadEditor.deselect(); };
}

const SAVES_KEY = 'savedScenarios_v1';

function listSaves() {
   try { return JSON.parse(localStorage.getItem(SAVES_KEY) || '{}'); }
   catch { return {}; }
}
function writeSaves(obj) {
   localStorage.setItem(SAVES_KEY, JSON.stringify(obj));
}
function refreshSaveList() {
   const sel = document.getElementById('savesSelect');
   if (!sel) return;
   const saves = listSaves();
   const names = Object.keys(saves).sort();
   sel.innerHTML = '<option value="">My saves…</option>'
      + names.map(n => `<option value="${n}">${n}</option>`).join('');
}
refreshSaveList();

document.getElementById('btnSave').onclick = () => {
   const existing = listSaves();
   const defaultName = `Scenario ${Object.keys(existing).length + 1}`;
   const name = prompt('Save as (name):', defaultName);
   if (!name) return;
   if (existing[name] && !confirm(`Overwrite "${name}"?`)) return;
   existing[name] = network.toJSON();
   writeSaves(existing);
   refreshSaveList();
   flash('btnSave', '✓ Saved');
};

document.getElementById('savesSelect').onchange = e => {
   const name = e.target.value;
   if (!name) return;
   const saves = listSaves();
   const data = saves[name];
   if (!data) return;

   const action = prompt(`Load "${name}"?  Type:\n  load   to load it\n  delete to delete it\n  rename to rename it\n  cancel to do nothing`, 'load');
   if (!action) { e.target.value = ''; return; }
   const a = action.trim().toLowerCase();

   if (a === 'load' || a === 'l') {
      if (simulation.running) simulation.stop();
      history.capture();
      network.loadJSON(data);
      roadEditor.deselect();
      setMode('road');
      history.capture();
   } else if (a === 'delete' || a === 'd') {
      if (confirm(`Delete save "${name}"?`)) {
         delete saves[name];
         writeSaves(saves);
         refreshSaveList();
      }
   } else if (a === 'rename' || a === 'r') {
      const newName = prompt('New name:', name);
      if (newName && newName !== name) {
         if (saves[newName] && !confirm(`Overwrite existing "${newName}"?`)) {
            e.target.value = '';
            return;
         }
         saves[newName] = saves[name];
         delete saves[name];
         writeSaves(saves);
         refreshSaveList();
      }
   }
   e.target.value = '';
};
document.getElementById('btnClear').onclick = () => {
   if (confirm('Delete everything?')) {
      history.capture();
      network.clear();
      history.capture();
      roadEditor.deselect();
   }
};
document.getElementById('btnExport').onclick = () => {
   const blob = new Blob([JSON.stringify(network.toJSON(), null, 2)], { type: 'application/json' });
   const a = document.createElement('a');
   a.href = URL.createObjectURL(blob);
   a.download = 'scenario.json';
   a.click();
   URL.revokeObjectURL(a.href);
};
document.getElementById('btnImport').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = e => {
   const f = e.target.files[0];
   if (!f) return;
   f.text().then(t => {
      try { network.loadJSON(JSON.parse(t)); roadEditor.deselect(); }
      catch (err) { alert('Invalid JSON: ' + err.message); }
   });
};

document.getElementById('scenarioSelect').onchange = e => {
   const id = e.target.value;
   if (!id) return;
   if (simulation.running) simulation.stop();
   history.capture();
   loadScenario(id, network, () => {
      roadEditor.deselect();
      setMode('road');
      history.capture();
   });
   e.target.value = '';
};

function flash(id, msg) {
   const b = document.getElementById(id);
   const orig = b.textContent;
   b.textContent = msg;
   setTimeout(() => b.textContent = orig, 900);
}

setMode('road');

function draw() {
   viewport.reset();

   ctx.fillStyle = '#2d5a3a';
   ctx.fillRect(-5000, -5000, 10000, 10000);

   network.draw(ctx);

   if (!simulation.running) {
      roadEditor.display(ctx);
      markingEditor.display(ctx);
      carEditor.display(ctx);
      closureEditor.display(ctx);
      crossingDetector.update();
      crossingDetector.draw(ctx);
      for (const c of network.cars) c.draw(ctx);
   }

   if (simulation.running) {
      simulation.tick();
      simulation.draw(ctx);
      debugOverlay.draw(ctx, simulation);
      if (debugExport.visible && (simulation.frameCount || 0) % 30 === 0) {
         debugExport.refresh(simulation);
      }
   }

   requestAnimationFrame(draw);
}
draw();
