const DECISION_TRIGGERS = {
   'slow-car-ahead': {
      id: 'slow-car-ahead',
      question: "A slow car is ahead of you. What do you do?",
      options: [
         { text: "Wait patiently behind them", correct: true,  action: 'default',
           feedback: "Correct — stay back unless you can see a clear, legal gap to overtake." },
         { text: "Tailgate to pressure them", correct: false, action: 'tailgate',
           feedback: "Tailgating is dangerous and illegal — watch how close you get." },
         { text: "Overtake immediately", correct: false, action: 'force-overtake',
           feedback: "You didn't check it was safe — the overtake is happening anyway." },
      ],
   },
   'approaching-stop-sign': {
      id: 'approaching-stop-sign',
      question: "A stop sign is ahead. How will you approach it?",
      options: [
         { text: "Come to a complete stop", correct: true, action: 'default',
           feedback: "Correct — stop signs require a full stop, even if the way looks clear." },
         { text: "Slow down but roll through", correct: false, action: 'ignore-stop',
           feedback: "A rolling stop is illegal and unsafe — rolling through now." },
         { text: "Maintain speed if no cars visible", correct: false, action: 'speed-up',
           feedback: "You might miss a pedestrian or a car at a blind angle — now speeding up anyway." },
      ],
   },
   'junction-ahead': {
      id: 'junction-ahead',
      question: "You're approaching a junction. What's your priority?",
      options: [
         { text: "Slow down and check all directions", correct: true, action: 'default',
           feedback: "Correct — approach every junction prepared to stop and give way." },
         { text: "Keep your speed if you have right of way", correct: false, action: 'speed-up',
           feedback: "Right of way must be given, not taken — now charging through." },
      ],
   },
   'red-light-ahead': {
      id: 'red-light-ahead',
      question: "The traffic light ahead is red. What do you do?",
      options: [
         { text: "Stop at the line and wait", correct: true, action: 'default',
           feedback: "Correct — stop behind the line and wait for green." },
         { text: "Slow down but keep moving", correct: false, action: 'ignore-light',
           feedback: "You must fully stop at a red light — now running it." },
      ],
   },
   'closed-road-ahead': {
      id: 'closed-road-ahead',
      question: "The road ahead is closed. What should you do?",
      options: [
         { text: "Slow down and find an alternative route", correct: true, action: 'default',
           feedback: "Correct — approach closures gently and look for a detour." },
         { text: "Push through the barrier", correct: false, action: 'ignore-closure',
           feedback: "Closed means closed — but here we go, watch what happens." },
      ],
   },
   'roundabout-ahead': {
      id: 'roundabout-ahead',
      question: "A roundabout is ahead. How do you approach?",
      options: [
         { text: "Slow down and yield to traffic on the ring", correct: true, action: 'default',
           feedback: "Correct — traffic already on the roundabout has priority." },
         { text: "Enter at full speed if it looks clear", correct: false, action: 'speed-up',
           feedback: "You haven't given yourself time to react if a car appears — entering fast anyway." },
         { text: "Stop completely even if the ring is empty", correct: false, action: 'ignore-stop',
           feedback: "Unnecessary stopping causes confusion and rear-end risk — there's no stop sign at a roundabout." },
      ],
   },
   'left-turn-oncoming': {
      id: 'left-turn-oncoming',
      question: "You want to turn across oncoming traffic. What's correct?",
      options: [
         { text: "Pull into the junction and wait for a clear gap", correct: true, action: 'default',
           feedback: "Correct — position yourself in the junction and only complete the turn when oncoming is clear." },
         { text: "Block your lane until the road is empty", correct: false, action: 'default',
           feedback: "You hold up traffic behind you unnecessarily — better to pull in and wait properly." },
         { text: "Force the turn and make oncoming brake", correct: false, action: 'speed-up',
           feedback: "Aggressive — and dangerous. Now executing." },
      ],
   },
   'overtake-decision': {
      id: 'overtake-decision',
      question: "There's a slow car ahead and the next lane is clear. What do you do?",
      options: [
         { text: "Signal, check mirrors and blind spot, then overtake", correct: true, action: 'default',
           feedback: "Correct — proper overtaking sequence." },
         { text: "Just swerve out and overtake", correct: false, action: 'force-overtake',
           feedback: "No signal, no checks — now executing." },
         { text: "Stay behind and wait, even if it's safe", correct: false, action: 'default',
           feedback: "Overly cautious — lane discipline matters; if it's safe, overtake decisively." },
      ],
   },
};

class DecisionManager {
   constructor() {
      this.panel     = document.getElementById('decisionPanel');
      this.questionEl= document.getElementById('decisionQuestion');
      this.optionsEl = document.getElementById('decisionOptions');
      this.feedbackEl= document.getElementById('decisionFeedback');

      this.mode          = 'teach';   
      this.active        = null;      
      this.firedThisRun  = new Set();
      this.cooldown      = new Map(); 
      this.paused        = false;
      this.slowCarFrames = 0;
      this.onResume      = null;
      this.mainCar       = null;      
   }

   setMode(m) { this.mode = m; this.reset(); }
   reset() { this.firedThisRun.clear(); this.cooldown.clear(); this.slowCarFrames = 0; this.hide(); this.paused = false; }

   isPaused() { return this.paused; }

   
   evaluate(mainCar, allCars, network) {
      if (this.mode !== 'decision' || this.active) return;
      if (!mainCar) return;
      this.mainCar = mainCar;

      
      for (const [k, v] of this.cooldown) {
         if (v <= 1) this.cooldown.delete(k); else this.cooldown.set(k, v - 1);
      }

      const myDir = new Point(Math.cos(mainCar.angle), Math.sin(mainCar.angle));

      
      let sameDirAhead = null, sameDirAheadD = Infinity;
      for (const c of allCars) {
         if (c === mainCar) continue;
         const otherDir = new Point(Math.cos(c.angle), Math.sin(c.angle));
         if (dot(myDir, otherDir) < 0.4) continue;
         const toO = subtract(new Point(c.x, c.y), new Point(mainCar.x, mainCar.y));
         if (dot(toO, myDir) < 0) continue;
         const d = magnitude(toO);
         if (d < 90 && d < sameDirAheadD) { sameDirAheadD = d; sameDirAhead = c; }
      }
      if (sameDirAhead && sameDirAhead.speed < mainCar.speed * 0.70 + 0.2) {
         this.slowCarFrames++;
         if (this.slowCarFrames > 40) this.#maybeFire('slow-car-ahead');
      } else {
         this.slowCarFrames = 0;
      }

      
      const nextMarking = this.#markingAhead(mainCar, network, 80);
      if (nextMarking) {
         const { marking, dist } = nextMarking;
         if (marking.type === 'stop' && dist < 70) this.#maybeFire('approaching-stop-sign');
         if (marking.type === 'light' && marking.state === 'red' && dist < 70) this.#maybeFire('red-light-ahead');
      }

      
      if (mainCar.nextLane && mainCar.nextLane.road.closed) {
         const d = mainCar.lane.length - mainCar.distAlong;
         if (d < 130) this.#maybeFire('closed-road-ahead');
      }

      
      
      const distToEnd = mainCar.lane.length - mainCar.distAlong;
      if (distToEnd < 90) {
         const exits = network.getExits(mainCar.lane);
         if (exits.length >= 2) this.#maybeFire('junction-ahead');
      }
   }

   #markingAhead(car, network, range) {
      const onLane = network.markingsOnLane(car.lane).filter(m => m.distance > car.distAlong);
      if (onLane.length) return { marking: onLane[0], dist: onLane[0].distance - car.distAlong };
      if (car.nextLane && (car.lane.length - car.distAlong) < range) {
         const onNext = network.markingsOnLane(car.nextLane);
         if (onNext.length) return { marking: onNext[0], dist: (car.lane.length - car.distAlong) + onNext[0].distance };
      }
      return null;
   }

   #maybeFire(triggerId) {
      if (this.firedThisRun.has(triggerId)) return;
      if (this.cooldown.has(triggerId)) return;
      const trig = DECISION_TRIGGERS[triggerId];
      if (!trig) return;
      this.fire(trig);
   }

   fire(trigger) {
      this.active = trigger;
      this.paused = true;
      this.firedThisRun.add(trigger.id);
      this.cooldown.set(trigger.id, 60 * 30);
      this.questionEl.textContent = trigger.question;
      this.optionsEl.innerHTML = '';
      this.feedbackEl.textContent = '';
      this.feedbackEl.className = 'feedback';

      for (const opt of trigger.options) {
         const b = document.createElement('button');
         b.className = 'decision-option';
         b.textContent = opt.text;
         b.onclick = () => this.#answer(opt);
         this.optionsEl.appendChild(b);
      }
      this.panel.classList.remove('hidden');
   }

   #answer(opt) {
      
      for (const b of this.optionsEl.querySelectorAll('button')) {
         b.disabled = true;
         if (b.textContent === opt.text) b.classList.add(opt.correct ? 'correct' : 'wrong');
      }
      this.feedbackEl.textContent = opt.feedback;
      this.feedbackEl.className = 'feedback ' + (opt.correct ? 'correct' : 'wrong');

      
      
      if (this.mainCar && opt.action && opt.action !== 'default') {
         this.mainCar.setOverride(opt.action);
      }

      
      this.paused = false;

      const cont = document.createElement('button');
      cont.className = 'decision-continue';
      cont.textContent = opt.correct ? 'Continue' : 'Got it, continue';
      cont.onclick = () => this.#close();
      this.optionsEl.appendChild(cont);
   }

   #close() {
      this.active = null;
      this.paused = false;
      this.hide();
      if (this.onResume) this.onResume();
   }

   hide() {
      this.panel.classList.add('hidden');
   }
}
