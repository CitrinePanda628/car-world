/* ============================================================================
 * personality.js
 * ----------------------------------------------------------------------------
 * The four driver personality profiles: good, aggressive, passive, distracted.
 * Each is a flat object of parameters that the Car class reads to vary its
 * behaviour.
 *
 * WHY THIS FILE EXISTS:
 *   For the educational simulator, it's interesting to see different driving
 *   styles interact at the same junction. Rather than hard-coding behaviour
 *   in Car, we externalise the differences into these profiles. To add a
 *   new personality, add an entry here and reference it from a CarSpawn.
 *
 * PARAMETER REFERENCE:
 *   speedMul        multiplier on each road's speedLimit
 *   followDist      preferred gap to car ahead (px)
 *   minGap          absolute minimum gap before emergency brake (px)
 *   reactionFrames  delay before reacting to changes (more = sluggish)
 *   overtakeUrge    0..1 likelihood of choosing to overtake when possible
 *   lanePref        'left' | 'right' — preferred lane on multi-lane roads
 *   obeysSpeed      ignores speed-limit signs if false
 *   obeysSigns      ignores stop/yield signs if false (currently always true)
 *   accelMul        acceleration multiplier
 *   brakeMul        brake multiplier (higher = harsher braking response)
 *   laneChangeSpeed lateral interpolation rate during a lane change (per frame)
 *   cornerFactor    speed retention through turns (lower = slower turn entry)
 *   usesIndicators  whether car shows turn indicators while changing
 *                   lanes/turning. Aggressive & distracted = false
 *
 * WHO CALLS THIS:
 *   - Car constructor stores `this.params = getPersonality(name)`
 *   - Speed-limit, follow-gap, accel/brake, lane-change choices all consult
 *     `this.params` throughout car.js
 * ============================================================================ */

const PERSONALITIES = {
   good: {
      label:        'Good driver',
      colour:       '#4caf50',
      speedMul:     1.00,
      followDist:   60,
      minGap:       36,
      reactionFrames: 2,
      overtakeUrge: 0.30,
      lanePref:     'left',
      obeysSpeed:   true,
      obeysSigns:   true,
      accelMul:     1.00,
      brakeMul:     1.00,
      laneChangeSpeed: 0.022,
      cornerFactor: 0.50,
      usesIndicators: true,
   },
   aggressive: {
      label:        'Aggressive',
      colour:       '#e53935',
      speedMul:     1.12,
      followDist:   42,
      minGap:       32,          
      reactionFrames: 1,
      overtakeUrge: 0.85,
      lanePref:     'right',
      obeysSpeed:   false,
      obeysSigns:   true,
      accelMul:     1.40,
      brakeMul:     1.40,        
      laneChangeSpeed: 0.032,
      cornerFactor: 0.40,
      usesIndicators: false,
   },
   passive: {
      label:        'Passive',
      colour:       '#8a95a0',
      speedMul:     0.72,
      followDist:   90,
      minGap:       44,
      reactionFrames: 5,
      overtakeUrge: 0.05,
      lanePref:     'left',
      obeysSpeed:   true,
      obeysSigns:   true,
      accelMul:     0.70,
      brakeMul:     0.90,
      laneChangeSpeed: 0.014,
      cornerFactor: 0.38,
      usesIndicators: true,
   },
   distracted: {
      label:        'Distracted',
      colour:       '#ab47bc',
      speedMul:     0.98,
      followDist:   58,
      minGap:       34,
      reactionFrames: 18,
      overtakeUrge: 0.12,
      lanePref:     'left',
      obeysSpeed:   true,
      obeysSigns:   true,
      accelMul:     0.90,
      brakeMul:     1.50,        
      laneChangeSpeed: 0.020,
      cornerFactor: 0.45,
      usesIndicators: false,
   },
};

function getPersonality(name) { return PERSONALITIES[name] || PERSONALITIES.good; }
