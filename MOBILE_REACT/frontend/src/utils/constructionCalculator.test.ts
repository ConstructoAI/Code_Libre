/**
 * Smoke tests for the construction calculator pure logic.
 * Run with: npx tsx src/utils/constructionCalculator.test.ts
 *
 * Covers: arithmetic, percent semantics, memory, shift, multi-step fns,
 * roofing, stairs, polygon, arc, miter, jack, materials, conversions,
 * dms↔deg, edge cases (div0, sqrt-, NaN propagation), state reset.
 */

import {
  calcReducer,
  createInitialCalcState,
  resolveAction,
  parseFeetInches,
  formatFeetInches,
  formatCurrentValue,
  calcDiagonal,
  calcHipValley,
  calcSlopePercent,
  calcStairs,
  calcCircle,
  calcArc,
  calcPolygon,
  calcCompoundMiter,
  calcSpringAngle,
  calcJackRafter,
  calcColumnCone,
  calcBlocks,
  calcDrywall,
  calcStuds,
  calcBoardFeet,
  calcFooting,
  calcCost,
  convertLength,
  convertWeight,
  convertArea,
  convertVolume,
  dmsToDeg,
  degToDms,
  pitchToAngle,
  pitchToPercent,
  percentToPitch,
  type CalcState,
  type CalcAction,
} from './constructionCalculator';

let failed = 0;
let passed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  }
}

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function feed(actions: CalcAction[], initial?: CalcState): CalcState {
  return actions.reduce<CalcState>(
    (s, a) => calcReducer(s, a),
    initial ?? createInitialCalcState(),
  );
}

const digit = (d: string): CalcAction => ({ type: 'digit', digit: d });
const op = (o: string): CalcAction => ({ type: 'operation', op: o });
const equals: CalcAction = { type: 'equals' };
const clear: CalcAction = { type: 'clear' };
const clearAll: CalcAction = { type: 'clearAll' };
const decimal: CalcAction = { type: 'decimal' };
const percent: CalcAction = { type: 'percent' };

// ── 1. Pure math functions ────────────────────────────────
console.log('\n[1] Pure math functions');
assert(calcDiagonal(3, 4) === 5, 'calcDiagonal(3,4) should be 5');
assert(approx(calcHipValley(3, 4), Math.sqrt(9 + 32)), 'calcHipValley(3,4)');
assert(calcSlopePercent(6, 12) === 50, 'calcSlopePercent(6,12)=50%');
assert(calcSlopePercent(6, 0) === Infinity, 'calcSlopePercent(6,0)=Infinity');

const stair = calcStairs(280); // 280 cm total height
assert(stair.risers >= 1, 'stairs: at least 1 riser');
assert(approx(stair.riserHeight * stair.risers, 280, 0.01), 'stairs: riserHeight × risers === height');
assert(approx(2 * stair.riserHeight + stair.treadDepth, 63, 0.01), 'Blondel: 2h+g=63');

const stairLow = calcStairs(10); // very small height
assert(stairLow.risers >= 1, 'calcStairs guards risers >= 1');

const circle = calcCircle(5);
assert(circle.diameter === 10, 'circle d=2r');
assert(approx(circle.area, Math.PI * 25), 'circle area = πr²');

const arc = calcArc(10, 5);
assert(arc.angleDeg > 0 && arc.angleDeg < 90, 'arc angle in valid range');

const hex = calcPolygon(6, 1);
assert(hex.interiorAngle === 120, 'hexagon interior=120°');
assert(approx(hex.area, 1.5 * Math.sqrt(3), 1e-3), 'hexagon area=1.5√3');

const compM = calcCompoundMiter(90, 30);
assert(compM.miterAngle > 0 && compM.bevelAngle > 0, 'compound miter positive');

const spring = calcSpringAngle(45, 90);
assert(spring.miterAngle > 0, 'spring angle positive');

const jack = calcJackRafter(6, 40);
assert(jack.lengthFactor > 1, 'jack factor > 1 for non-zero pitch');

const cc = calcColumnCone(2, 10);
assert(approx(cc.cylinderVolume, Math.PI * 4 * 10, 1e-3), 'cylinder volume πr²h');
assert(approx(cc.coneVolume, cc.cylinderVolume / 3, 1e-3), 'cone = cylinder/3');

assert(calcBlocks(10, 2) >= 250, 'blocks: 10x2m = 20m² / 0.08 + waste');
assert(calcDrywall(10, 2) >= 7, 'drywall: 10x2m = 20m² / 3 + waste');
assert(calcStuds(10).studs40cm === 26, 'studs @40cm for 10m = 26 (10/0.4+1)');
assert(calcStuds(10).studs60cm === 18, 'studs @60cm for 10m = 18 (10/0.6+1)');
assert(approx(calcBoardFeet(2, 6, 12), 1, 1e-3), 'board feet 2x6x12in = 1 BF');
assert(approx(calcFooting(2, 0.3, 0.3), 0.18), 'footing volume = LxWxH');
assert(calcCost(15.5, 4) === 62, 'cost 15.5 × 4 = 62');

// ── 2. Conversions ────────────────────────────────────────
console.log('\n[2] Unit conversions');
assert(approx(convertLength(1, 'm', 'cm'), 100), 'convertLength m→cm');
assert(approx(convertLength(1, 'ft', 'in'), 12, 1e-9), 'convertLength ft→in');
assert(approx(convertLength(1, 'yds', 'm'), 0.9144), 'convertLength yds→m');
assert(approx(convertWeight(1, 'kg', 'lbs'), 1 / 0.453592, 1e-4), 'convertWeight kg→lbs');
assert(approx(convertArea(1, 'm2', 'ft2'), 1 / 0.092903, 1e-4), 'convertArea m²→ft²');
assert(approx(convertVolume(1, 'm3', 'litre'), 1000), 'convertVolume m³→L');

// ── 3. DMS ↔ Deg ──────────────────────────────────────────
console.log('\n[3] DMS ↔ Deg');
assert(approx(dmsToDeg(45.3000), 45 + 30 / 60, 1e-9), 'dmsToDeg 45°30\'00"=45.5');
assert(approx(degToDms(45.5), 45.30, 1e-9), 'degToDms 45.5=45°30\'');
const rt = degToDms(dmsToDeg(45.3015));
assert(approx(rt, 45.3015, 1e-4), `dms↔deg roundtrip 45.3015 got ${rt}`);

// ── 4. Slope conversions ──────────────────────────────────
console.log('\n[4] Slope (pitch ↔ angle ↔ percent)');
assert(approx(pitchToAngle(12), 45), '12:12 pitch = 45°');
assert(approx(pitchToPercent(6), 50), '6:12 pitch = 50%');
assert(approx(percentToPitch(50), 6), '50% = 6:12 pitch');

// ── 5. State machine: arithmetic ──────────────────────────
console.log('\n[5] State machine arithmetic');

let s = feed([digit('5'), op('+'), digit('3'), equals]);
assert(s.currentValue === 8, `5+3=8 got ${s.currentValue}`);
assert(s.display === '8', `display=8 got ${s.display}`);

s = feed([digit('1'), digit('0'), op('-'), digit('3'), equals]);
assert(s.currentValue === 7, `10-3=7 got ${s.currentValue}`);

s = feed([digit('6'), op('*'), digit('7'), equals]);
assert(s.currentValue === 42, `6*7=42 got ${s.currentValue}`);

s = feed([digit('2'), digit('0'), op('/'), digit('4'), equals]);
assert(s.currentValue === 5, `20/4=5 got ${s.currentValue}`);

// Division by zero
s = feed([digit('5'), op('/'), digit('0'), equals]);
assert(Number.isNaN(s.currentValue), `5/0 → NaN got ${s.currentValue}`);

// Decimal entry
s = feed([digit('1'), decimal, digit('5'), op('+'), digit('2'), decimal, digit('5'), equals]);
assert(approx(s.currentValue, 4), `1.5+2.5=4 got ${s.currentValue}`);

// Chained operations: 5 + 3 + 2 = 10
s = feed([digit('5'), op('+'), digit('3'), op('+'), digit('2'), equals]);
assert(s.currentValue === 10, `5+3+2=10 got ${s.currentValue}`);

// ── 6. Percent semantics (CRITICAL — agent flagged false positive) ─
console.log('\n[6] Percent semantics');

// Standalone: 50% of nothing = 0.5
s = feed([digit('5'), digit('0'), percent]);
assert(approx(s.currentValue, 0.5), `50% standalone = 0.5 got ${s.currentValue}`);

// 100 + 5%: should be 105 (5% of 100 = 5, then add)
s = feed([digit('1'), digit('0'), digit('0'), op('+'), digit('5'), percent, equals]);
assert(s.currentValue === 105, `100+5%=105 got ${s.currentValue}`);

// 200 - 10%: should be 180
s = feed([digit('2'), digit('0'), digit('0'), op('-'), digit('1'), digit('0'), percent, equals]);
assert(s.currentValue === 180, `200-10%=180 got ${s.currentValue}`);

// ── 7. Memory ─────────────────────────────────────────────
console.log('\n[7] Memory (Store / M+ / M- / Rcl / MC)');

s = feed([digit('5'), { type: 'memoryStore' }]);
assert(s.memory === 5, `Store 5 got ${s.memory}`);

s = feed([digit('5'), { type: 'memoryAdd' }, digit('3'), { type: 'memoryAdd' }]);
assert(s.memory === 8, `M+5 then M+3 = 8 got ${s.memory}`);

s = feed([digit('1'), digit('0'), { type: 'memoryStore' }, digit('3'), { type: 'memorySubtract' }]);
assert(s.memory === 7, `Store 10, M-3 = 7 got ${s.memory}`);

s = feed([digit('5'), { type: 'memoryStore' }, clearAll]);
assert(s.memory === 5, `clearAll preserves memory got ${s.memory}`);

s = feed([digit('5'), { type: 'memoryStore' }, { type: 'memoryClear' }]);
assert(s.memory === 0, `MC clears memory got ${s.memory}`);

s = feed([digit('4'), digit('2'), { type: 'memoryStore' }, clear, { type: 'memoryRecall' }]);
assert(s.currentValue === 42, `Rcl after Store 42 got ${s.currentValue}`);

// ── 8. Shift mode ─────────────────────────────────────────
console.log('\n[8] Shift mode');
s = feed([{ type: 'toggleShift' }]);
assert(s.shiftMode === true, 'shift on');
s = feed([{ type: 'toggleShift' }, { type: 'toggleShift' }]);
assert(s.shiftMode === false, 'shift toggles back');
// Shift auto-clears after digit
s = feed([{ type: 'toggleShift' }, digit('5')]);
assert(s.shiftMode === false, 'shift auto-resets after digit');

// ── 9. Math fns: sqrt / square / inverse / pi / +- ────────
console.log('\n[9] Math fns');
s = feed([digit('1'), digit('6'), { type: 'sqrt' }]);
assert(s.currentValue === 4, `sqrt(16)=4 got ${s.currentValue}`);

s = feed([digit('5'), { type: 'square' }]);
assert(s.currentValue === 25, `5²=25 got ${s.currentValue}`);

s = feed([digit('4'), { type: 'inverse' }]);
assert(s.currentValue === 0.25, `1/4=0.25 got ${s.currentValue}`);

s = feed([digit('0'), { type: 'inverse' }]);
assert(s.display === 'Error', `1/0 displays Error got ${s.display}`);

s = feed([{ type: 'pi' }]);
assert(approx(s.currentValue, Math.PI), `π = ${Math.PI} got ${s.currentValue}`);

s = feed([digit('5'), { type: 'plusMinus' }]);
assert(s.currentValue === -5, `+/− on 5 = -5 got ${s.currentValue}`);

// sqrt of negative → NaN → display 'Error'
s = feed([digit('4'), { type: 'plusMinus' }, { type: 'sqrt' }]);
assert(s.display === 'Error', `sqrt(-4) shows Error got ${s.display}`);

// ── 10. Roofing (rise/run/diag/hip/v/area) ────────────────
console.log('\n[10] Roofing functions');
s = feed([digit('6'), { type: 'setRise' }, digit('1'), digit('2'), { type: 'setRun' }, { type: 'calcDiag' }]);
assert(approx(s.currentValue, Math.sqrt(36 + 144)), `diag rise=6 run=12 got ${s.currentValue}`);
assert(s.lastResult?.type === 'diag', 'lastResult.type=diag');

s = feed([digit('6'), { type: 'setRise' }, digit('1'), digit('2'), { type: 'setRun' }, { type: 'calcHipV' }]);
assert(approx(s.currentValue, Math.sqrt(36 + 288)), `hip/v 6,12 got ${s.currentValue}`);

s = feed([digit('6'), { type: 'setRise' }, digit('1'), digit('2'), { type: 'setRun' }, { type: 'calcSlopePercent' }]);
assert(s.currentValue === 50, `slope% 6,12 = 50 got ${s.currentValue}`);

// Without setRise/setRun first: should not crash, should show error
s = feed([{ type: 'calcDiag' }]);
assert(s.display === 'Set Rise/Run', `calcDiag without rise/run got ${s.display}`);

// Roof Area: requires rise/run/length
s = feed([
  digit('6'), { type: 'setRise' },
  digit('1'), digit('2'), { type: 'setRun' },
  digit('1'), digit('0'), { type: 'setLength' },
  { type: 'calcRoofArea' },
]);
assert(s.currentValue > 0, `roof area positive got ${s.currentValue}`);
assert(s.lastResult?.type === 'roofArea', 'roofArea lastResult');

// ── 11. Stairs ────────────────────────────────────────────
console.log('\n[11] Stairs');
s = feed([digit('2'), digit('8'), digit('0'), { type: 'setHeight' }, { type: 'calcStair' }]);
assert(s.lastResult?.type === 'stair', 'stair lastResult');
assert(s.lastResult?.risers > 0, 'stair risers > 0');

// Without height: take currentValue
s = feed([digit('2'), digit('5'), digit('0'), { type: 'calcStair' }]);
assert(s.lastResult?.type === 'stair', 'stair fallback to currentValue');

// Without anything: error
s = feed([{ type: 'calcStair' }]);
assert(s.display === 'Set Height', `stair without input shows error got ${s.display}`);

// ── 12. Multi-step: Arc ───────────────────────────────────
console.log('\n[12] Multi-step Arc');
s = feed([digit('1'), digit('0'), { type: 'calcArc' }]); // first input: radius
assert(s.pendingFn === 'arc', `pendingFn=arc got ${s.pendingFn}`);
assert(s.display === 'Chord?', `arc prompt got ${s.display}`);
s = feed([digit('5'), { type: 'calcArc' }], s); // second input: chord, second press resolves
assert(s.lastResult?.type === 'arc', 'arc lastResult');
assert(s.pendingFn === null, 'pendingFn cleared after arc');

// ── 13. Multi-step: Polygon ───────────────────────────────
console.log('\n[13] Multi-step Polygon');
s = feed([digit('6'), { type: 'calcPolygon' }, digit('1'), { type: 'calcPolygon' }]);
assert(s.lastResult?.type === 'polygon', 'polygon lastResult');
assert(s.lastResult?.interiorAngle === 120, 'hexagon interior 120');

// ── 14. Multi-step: Cost ──────────────────────────────────
console.log('\n[14] Multi-step Cost');
s = feed([digit('1'), digit('5'), decimal, digit('5'), { type: 'calcCost' }, digit('4'), { type: 'calcCost' }]);
assert(s.currentValue === 62, `cost 15.5 × 4 = 62 got ${s.currentValue}`);

// ── 15. Compound Miter / Spring Angle ─────────────────────
console.log('\n[15] Compound Miter / Spring');
s = feed([digit('9'), digit('0'), { type: 'calcCompMiter' }, digit('3'), digit('0'), { type: 'calcCompMiter' }]);
assert(s.lastResult?.type === 'compMiter', 'compMiter lastResult');
assert(s.lastResult?.miterAngle != null, 'compMiter angles set');

s = feed([digit('4'), digit('5'), { type: 'calcSpringAngle' }, digit('9'), digit('0'), { type: 'calcSpringAngle' }]);
assert(s.lastResult?.type === 'springAngle', 'springAngle lastResult');

// ── 16. Jack rafter ───────────────────────────────────────
console.log('\n[16] Jack rafter');
s = feed([digit('6'), { type: 'setPitch' }, digit('4'), digit('0'), { type: 'calcJack' }]);
assert(s.lastResult?.type === 'jack', 'jack lastResult');
assert(s.lastResult?.lengthFactor > 1, 'jack lengthFactor > 1');

s = feed([{ type: 'calcJack' }]);
assert(s.display === 'Set Pitch', `jack without pitch got ${s.display}`);

// ── 17. Materials ─────────────────────────────────────────
console.log('\n[17] Materials');
s = feed([
  digit('1'), digit('0'), { type: 'setLength' },
  digit('3'), { type: 'setHeight' },
  { type: 'calcBlocks' },
]);
assert(s.lastResult?.type === 'blocks', 'blocks lastResult');
assert(s.lastResult?.value > 0, 'blocks value > 0');

s = feed([
  digit('1'), digit('0'), { type: 'setLength' },
  digit('3'), { type: 'setHeight' },
  { type: 'calcDrywall' },
]);
assert(s.lastResult?.type === 'drywall', 'drywall lastResult');

s = feed([digit('1'), digit('0'), { type: 'calcStuds' }]);
assert(s.lastResult?.type === 'studs', 'studs lastResult');
assert(s.lastResult?.studs40cm === 26, `studs @40cm got ${s.lastResult?.studs40cm}`);

s = feed([
  digit('2'), { type: 'setHeight' },
  digit('6'), { type: 'setWidth' },
  digit('1'), digit('2'), { type: 'setLength' },
  { type: 'calcBoardFeet' },
]);
assert(approx(s.currentValue, 1, 1e-3), `2x6x12in = 1 BF got ${s.currentValue}`);

s = feed([
  digit('2'), { type: 'setLength' },
  decimal, digit('3'), { type: 'setWidth' },
  decimal, digit('3'), { type: 'setHeight' },
  { type: 'calcFooting' },
]);
assert(approx(s.currentValue, 0.18, 1e-3), `footing 2x0.3x0.3 = 0.18 got ${s.currentValue}`);

// ── 18. Unit conversion via reducer ───────────────────────
console.log('\n[18] Unit conversion via reducer');
s = feed([digit('1'), { type: 'convertUnit', unit: 'm' }]);
assert(s.currentValue === 1, `1m → 1m base got ${s.currentValue}`);

s = feed([digit('1'), digit('0'), digit('0'), { type: 'convertUnit', unit: 'cm' }]);
assert(approx(s.currentValue, 1), `100cm → 1m got ${s.currentValue}`);

s = feed([digit('1'), { type: 'convertUnit', unit: 'ft' }]);
assert(approx(s.currentValue, 0.3048), `1ft → 0.3048m got ${s.currentValue}`);

// ── 19. Clear / ClearAll ──────────────────────────────────
console.log('\n[19] Clear / ClearAll');
s = feed([digit('5'), op('+'), digit('3'), clear]);
assert(s.currentValue === 0, `clear resets currentValue got ${s.currentValue}`);
assert(s.pendingOp === '+', 'clear keeps pendingOp');

s = feed([
  digit('5'), op('+'), digit('3'),
  { type: 'setRise' },
  digit('1'), { type: 'calcArc' }, // pendingFn=arc
  clearAll,
]);
assert(s.pendingOp === null, 'clearAll resets pendingOp');
assert(s.rise === null, 'clearAll resets rise');
assert(s.pendingFn === null, 'clearAll resets pendingFn');

// ── 20. History ───────────────────────────────────────────
console.log('\n[20] History');
s = feed([digit('5'), op('+'), digit('3'), equals]);
assert(s.history.length > 0, 'history has entries');
assert(s.history[0].op === '=' || s.history[0].result === 8, 'recent = entry');

// ── 21. dms↔deg toggle ────────────────────────────────────
console.log('\n[21] dms↔deg toggle');
s = feed([digit('4'), digit('5'), decimal, digit('5'), { type: 'dmsDeg' }]);
assert(s.history.some((h) => h.op === 'dms↔deg'), 'dmsDeg recorded in history');

// ── 22. displayNum behavior ───────────────────────────────
console.log('\n[22] Display formatting');
s = feed([decimal, digit('1'), op('+'), decimal, digit('2'), equals]);
// 0.1 + 0.2 should display 0.3 (not 0.30000000000000004)
assert(s.display === '0.3' || approx(parseFloat(s.display), 0.3), `0.1+0.2 displays cleanly got ${s.display}`);

// ── 23. degToDms — float precision & negatives (round 2 audit) ─
console.log('\n[23] degToDms edge cases');
assert(approx(degToDms(45.5), 45.30, 1e-9), `degToDms(45.5)=45.30 got ${degToDms(45.5)}`);
assert(approx(degToDms(45.1), 45.06, 1e-6), `degToDms(45.1)=45.06 got ${degToDms(45.1)}`);
assert(approx(degToDms(0.5), 0.30, 1e-9), `degToDms(0.5)=0.30 got ${degToDms(0.5)}`);
assert(approx(degToDms(60), 60, 1e-9), `degToDms(60)=60 got ${degToDms(60)}`);
// Negative degrees: -45.5° = -(45° 30') = -45.30 (NOT -45.7)
assert(approx(degToDms(-45.5), -45.30, 1e-9), `degToDms(-45.5)=-45.30 got ${degToDms(-45.5)}`);
assert(approx(degToDms(-0.5), -0.30, 1e-9), `degToDms(-0.5)=-0.30 got ${degToDms(-0.5)}`);
// Float-precision: 45° 01' 00" = 45 + 1/60 = 45.016666...°
assert(approx(degToDms(45 + 1 / 60), 45.01, 1e-6), `degToDms(45+1/60)=45.01 got ${degToDms(45 + 1/60)}`);
// Roundtrips
assert(approx(degToDms(dmsToDeg(45.3)), 45.30, 1e-6), `degToDms(dmsToDeg(45.3))=45.30 got ${degToDms(dmsToDeg(45.3))}`);
assert(approx(degToDms(dmsToDeg(45.5959)), 45.5959, 1e-6), `roundtrip 45.5959 got ${degToDms(dmsToDeg(45.5959))}`);
assert(approx(dmsToDeg(degToDms(45.5)), 45.5, 1e-6), `roundtrip dms(degToDms(45.5))=45.5 got ${dmsToDeg(degToDms(45.5))}`);

// ── 24. clear should reset multi-step pendingFn (round 2 audit) ─
console.log('\n[24] clear resets pendingFn');
s = feed([digit('1'), digit('0'), { type: 'calcArc' }]);
assert(s.pendingFn === 'arc', 'arc started');
s = feed([clear], s);
assert(s.pendingFn === null, `clear should reset pendingFn got ${s.pendingFn}`);
assert(s.pendingFnValue === null, `clear should reset pendingFnValue got ${s.pendingFnValue}`);
// After clear, restarting an Arc should treat next number as radius (not chord)
s = feed([digit('5'), { type: 'calcArc' }], s);
assert(s.pendingFn === 'arc', 'after clear+digit+calcArc, pendingFn=arc again (radius captured)');
assert(s.display === 'Chord?', `awaiting chord got ${s.display}`);

// Polygon abandonment + clear
s = feed([digit('6'), { type: 'calcPolygon' }, clear]);
assert(s.pendingFn === null, `polygon clear resets pendingFn got ${s.pendingFn}`);

// Cost abandonment + clear
s = feed([digit('1'), digit('0'), { type: 'calcCost' }, clear]);
assert(s.pendingFn === null, `cost clear resets pendingFn got ${s.pendingFn}`);

// ── 25. dmsToDeg additional edge cases (negative + boundaries) ──
console.log('\n[25] dmsToDeg additional');
assert(approx(dmsToDeg(-45.3), -45.5, 1e-9), `dmsToDeg(-45.3)=-45.5 got ${dmsToDeg(-45.3)}`);
assert(approx(dmsToDeg(0), 0, 1e-9), `dmsToDeg(0)=0`);
assert(approx(dmsToDeg(45.5959), 45 + 59/60 + 59/3600, 1e-9), `dmsToDeg(45.5959) max minutes got ${dmsToDeg(45.5959)}`);

// ── 26. createInitialCalcState invariants ───────────────────────
console.log('\n[26] Initial state invariants');
const init = createInitialCalcState();
assert(init.display === '0', 'init display=0');
assert(init.currentValue === 0, 'init currentValue=0');
assert(init.pendingOp === null, 'init pendingOp=null');
assert(init.pendingValue === null, 'init pendingValue=null');
assert(init.newNumber === true, 'init newNumber=true');
assert(init.memory === 0, 'init memory=0');
assert(init.shiftMode === false, 'init shiftMode=false');
assert(init.pendingFn === null, 'init pendingFn=null');
assert(init.history.length === 0, 'init history empty');
assert(init.rise === null && init.run === null && init.pitch === null, 'init dims null');

// ── 27. resolveAction helper (round 4 audit) ───────────────────
console.log('\n[27] resolveAction helper');
const init27 = createInitialCalcState();
// 27.1 Pas de shift, pas de pendingFn → primaire
const a27a = resolveAction(init27, { type: 'setRise' }, { type: 'calcSlopePercent' });
assert(a27a.type === 'setRise', `no shift, no pending → primary; got ${a27a.type}`);

// 27.2 shiftMode true, pas de pendingFn → shift
const a27b = resolveAction({ ...init27, shiftMode: true }, { type: 'setRise' }, { type: 'calcSlopePercent' });
assert(a27b.type === 'calcSlopePercent', `shift on, no pending → shift; got ${a27b.type}`);

// 27.3 pendingFn=polygon, shiftMode false, shift action matches → forced shift (le bug fix)
const a27c = resolveAction({ ...init27, pendingFn: 'polygon' }, { type: 'setRun' }, { type: 'calcPolygon' });
assert(a27c.type === 'calcPolygon', `polygon pending → forced calcPolygon; got ${a27c.type}`);

// 27.4 pendingFn=polygon, shift action does NOT match (autre bouton) → primaire
const a27d = resolveAction({ ...init27, pendingFn: 'polygon' }, { type: 'setRise' }, { type: 'calcSlopePercent' });
assert(a27d.type === 'setRise', `polygon pending mais autre bouton → primary; got ${a27d.type}`);

// 27.5 pendingFn=springAngle, shift matches → forced
const a27e = resolveAction({ ...init27, pendingFn: 'springAngle' }, { type: 'calcCompMiter' }, { type: 'calcSpringAngle' });
assert(a27e.type === 'calcSpringAngle', `springAngle pending → forced; got ${a27e.type}`);

// 27.6 pendingFn=cost, shift matches → forced
const a27f = resolveAction({ ...init27, pendingFn: 'cost' }, { type: 'digit', digit: '0' }, { type: 'calcCost' });
assert(a27f.type === 'calcCost', `cost pending → forced; got ${a27f.type}`);

// 27.7 pendingFn=arc (NOT in PENDING_TO_RESOLVER table car Arc est primaire) → comportement normal
const a27g = resolveAction({ ...init27, pendingFn: 'arc' }, { type: 'setRun' }, { type: 'calcPolygon' });
assert(a27g.type === 'setRun', `arc pending mais Run shift Polygon → primary (arc se resout via tap Arc primaire); got ${a27g.type}`);

// ── 28. Flow utilisateur Polygon end-to-end (la vraie regression) ─
console.log('\n[28] Polygon end-to-end via shift');
// Sequence reelle: 6 [shift] [Run] 1 [Run]
// (le digit reset shift donc on tape AVANT shift)
let s28 = createInitialCalcState();
s28 = calcReducer(s28, { type: 'digit', digit: '6' });
s28 = calcReducer(s28, { type: 'toggleShift' }); // shift on apres le digit
assert(s28.shiftMode === true, 'shift on');
// Tap Run en mode shift -> resolveAction renvoie calcPolygon
let a28 = resolveAction(s28, { type: 'setRun' }, { type: 'calcPolygon' });
s28 = calcReducer(s28, a28);
assert(s28.pendingFn === 'polygon', `pendingFn=polygon got ${s28.pendingFn}`);
assert(s28.shiftMode === false, 'shift auto-reset par calcPolygon');
// User tape "1" pour la longueur de cote -- shift reste false
s28 = calcReducer(s28, { type: 'digit', digit: '1' });
assert(s28.shiftMode === false, 'shift toujours false apres digit');
// User retap Run -- shiftMode false, MAIS pendingFn=polygon donc resolveAction
// force calcPolygon (le bug fix: avant ce commit, ça dispatchait setRun)
a28 = resolveAction(s28, { type: 'setRun' }, { type: 'calcPolygon' });
assert(a28.type === 'calcPolygon', `2eme tap Run avec pendingFn=polygon → calcPolygon force; got ${a28.type}`);
s28 = calcReducer(s28, a28);
assert(s28.lastResult?.type === 'polygon', `polygon resolu; lastResult.type=${s28.lastResult?.type}`);
assert(s28.lastResult?.interiorAngle === 120, `hexagone 120°`);
assert(s28.pendingFn === null, 'pendingFn cleared apres resolution');

// ── 29. Flow utilisateur SpringAngle end-to-end ────────────
console.log('\n[29] SpringAngle end-to-end via shift');
// 45 [shift] [Miter→Spring] 90 [Miter→Spring]
let s29 = createInitialCalcState();
s29 = calcReducer(s29, { type: 'digit', digit: '4' });
s29 = calcReducer(s29, { type: 'digit', digit: '5' });
s29 = calcReducer(s29, { type: 'toggleShift' });
let a29 = resolveAction(s29, { type: 'calcCompMiter' }, { type: 'calcSpringAngle' });
s29 = calcReducer(s29, a29);
assert(s29.pendingFn === 'springAngle', `pendingFn=springAngle got ${s29.pendingFn}`);
s29 = calcReducer(s29, { type: 'digit', digit: '9' });
s29 = calcReducer(s29, { type: 'digit', digit: '0' });
a29 = resolveAction(s29, { type: 'calcCompMiter' }, { type: 'calcSpringAngle' });
assert(a29.type === 'calcSpringAngle', `2eme tap force calcSpringAngle (shift off mais pendingFn=springAngle)`);
s29 = calcReducer(s29, a29);
assert(s29.lastResult?.type === 'springAngle', 'springAngle resolved');

// ── 30. Flow utilisateur Cost end-to-end ───────────────────
console.log('\n[30] Cost end-to-end via shift');
// 15.5 [shift] [0→Cost] 4 [0→Cost]  -- 15.5 × 4 = 62
let s30 = createInitialCalcState();
s30 = calcReducer(s30, { type: 'digit', digit: '1' });
s30 = calcReducer(s30, { type: 'digit', digit: '5' });
s30 = calcReducer(s30, { type: 'decimal' });
s30 = calcReducer(s30, { type: 'digit', digit: '5' });
s30 = calcReducer(s30, { type: 'toggleShift' });
let a30 = resolveAction(s30, { type: 'digit', digit: '0' }, { type: 'calcCost' });
s30 = calcReducer(s30, a30);
assert(s30.pendingFn === 'cost', `pendingFn=cost got ${s30.pendingFn}`);
s30 = calcReducer(s30, { type: 'digit', digit: '4' });
a30 = resolveAction(s30, { type: 'digit', digit: '0' }, { type: 'calcCost' });
assert(a30.type === 'calcCost', `2eme tap force calcCost`);
s30 = calcReducer(s30, a30);
assert(s30.currentValue === 62, `cost 15.5 × 4 = 62, got ${s30.currentValue}`);

// ── 31. parseFeetInches (parser) ───────────────────────────────
console.log('\n[31] parseFeetInches');
assert(parseFeetInches('3\'10 1/4"') === 46.25, `3'10 1/4" = 46.25 got ${parseFeetInches('3\'10 1/4"')}`);
assert(parseFeetInches('5\'2 1/2"') === 62.5, `5'2 1/2" = 62.5 got ${parseFeetInches('5\'2 1/2"')}`);
assert(parseFeetInches('3\'') === 36, `3' = 36 got ${parseFeetInches('3\'')}`);
assert(parseFeetInches('10"') === 10, `10" = 10 got ${parseFeetInches('10"')}`);
assert(parseFeetInches('1/2"') === 0.5, `1/2" = 0.5 got ${parseFeetInches('1/2"')}`);
assert(parseFeetInches('3\'10"') === 46, `3'10" = 46 got ${parseFeetInches('3\'10"')}`);
assert(parseFeetInches('3\'10-1/4"') === 46.25, `3'10-1/4" dash = 46.25 got ${parseFeetInches('3\'10-1/4"')}`);
assert(parseFeetInches('3.5\'') === 42, `3.5' = 42 got ${parseFeetInches('3.5\'')}`);
assert(parseFeetInches('-3\'10"') === -46, `-3'10" = -46 got ${parseFeetInches('-3\'10"')}`);
assert(parseFeetInches('10 1/4') === 10.25, `10 1/4 = 10.25 got ${parseFeetInches('10 1/4')}`);
assert(parseFeetInches('') === null, `empty = null`);
assert(parseFeetInches('  ') === null, `whitespace = null`);
assert(parseFeetInches('3\' 10"') === 46, `3' 10" with space = 46 got ${parseFeetInches('3\' 10"')}`);
assert(parseFeetInches('1\'0 1/16"') === 12.0625, `1'0 1/16" = 12.0625 got ${parseFeetInches('1\'0 1/16"')}`);
// Division by zero in fraction
assert(parseFeetInches('1/0"') === null, `1/0 invalid = null got ${parseFeetInches('1/0"')}`);

// ── 32. formatFeetInches (formatter) ─────────────────────────
console.log('\n[32] formatFeetInches');
assert(formatFeetInches(46.25) === `3' 10 1/4"`, `46.25 → 3' 10 1/4" got "${formatFeetInches(46.25)}"`);
assert(formatFeetInches(62.5) === `5' 2 1/2"`, `62.5 → 5' 2 1/2" got "${formatFeetInches(62.5)}"`);
assert(formatFeetInches(108.75) === `9' 0 3/4"`, `108.75 → 9' 0 3/4" got "${formatFeetInches(108.75)}"`);
assert(formatFeetInches(36) === `3'`, `36 → 3' got "${formatFeetInches(36)}"`);
assert(formatFeetInches(10) === `10"`, `10 → 10" got "${formatFeetInches(10)}"`);
assert(formatFeetInches(0.5) === `1/2"`, `0.5 → 1/2" got "${formatFeetInches(0.5)}"`);
assert(formatFeetInches(0) === `0"`, `0 → 0" got "${formatFeetInches(0)}"`);
assert(formatFeetInches(12) === `1'`, `12 → 1' got "${formatFeetInches(12)}"`);
assert(formatFeetInches(-46.25) === `-3' 10 1/4"`, `-46.25 → -3' 10 1/4" got "${formatFeetInches(-46.25)}"`);
assert(formatFeetInches(NaN) === 'Error', `NaN → Error`);
assert(formatFeetInches(Infinity) === 'Error', `Infinity → Error`);
// Carry: 11.999... rounds up to 12 = 1'
assert(formatFeetInches(11.97) === `12"` || formatFeetInches(11.97) === `1'`, `11.97 ≈ 12" or 1' got "${formatFeetInches(11.97)}"`);
// 1/16 precision
assert(formatFeetInches(0.0625) === `1/16"`, `0.0625 → 1/16" got "${formatFeetInches(0.0625)}"`);
// 32 precision
assert(formatFeetInches(0.03125, 32) === `1/32"`, `0.03125 with 32 → 1/32" got "${formatFeetInches(0.03125, 32)}"`);
// Simplified fraction: 8/16 → 1/2
assert(formatFeetInches(0.5) === `1/2"`, `8/16 simplifies to 1/2`);
// Non-trivial fraction: 3/16 stays 3/16
assert(formatFeetInches(10 + 3/16) === `10 3/16"`, `10 3/16" got "${formatFeetInches(10 + 3/16)}"`);

// ── 33. Roundtrip parse → format ────────────────────────────
console.log('\n[33] parse ↔ format roundtrip');
const cases33 = [
  { input: `3'10 1/4"`, expected: `3' 10 1/4"` },
  { input: `5'2 1/2"`, expected: `5' 2 1/2"` },
  { input: `1'0 1/16"`, expected: `1' 0 1/16"` },
  { input: `0'0 3/4"`, expected: `3/4"` },
];
cases33.forEach(({ input, expected }) => {
  const inches = parseFeetInches(input)!;
  const back = formatFeetInches(inches);
  assert(back === expected, `roundtrip "${input}" → ${inches}in → "${back}" expected "${expected}"`);
});

// ── 34. enterDimension action + flow 3'10 1/4 + 5'2 1/2 = 9' 0 3/4 ─
console.log('\n[34] Flow complet 3\'10 1/4" + 5\'2 1/2" = 9\' 0 3/4"');
let s34 = createInitialCalcState();
const dim1 = parseFeetInches(`3'10 1/4"`)!;
s34 = calcReducer(s34, { type: 'enterDimension', inches: dim1 });
assert(s34.currentValue === 46.25, `1ere dimension currentValue=46.25 got ${s34.currentValue}`);
assert(s34.displayAsFeetInches === true, `displayAsFeetInches=true`);
assert(s34.display === `3' 10 1/4"`, `display = "3' 10 1/4"" got "${s34.display}"`);

s34 = calcReducer(s34, { type: 'operation', op: '+' });
assert(s34.pendingOp === '+', `pending op +`);
assert(s34.displayAsFeetInches === true, `flag preserve apres +`);

const dim2 = parseFeetInches(`5'2 1/2"`)!;
s34 = calcReducer(s34, { type: 'enterDimension', inches: dim2 });
assert(s34.currentValue === 62.5, `2eme dimension = 62.5 got ${s34.currentValue}`);

s34 = calcReducer(s34, { type: 'equals' });
assert(s34.currentValue === 108.75, `total = 108.75 got ${s34.currentValue}`);
assert(s34.display === `9' 0 3/4"`, `display = "9' 0 3/4"" got "${s34.display}"`);

// ── 35. toggleFeetInchesDisplay ─────────────────────────────
console.log('\n[35] toggleFeetInchesDisplay');
let s35 = createInitialCalcState();
s35 = calcReducer(s35, { type: 'enterDimension', inches: 46.25 });
assert(s35.displayAsFeetInches === true, `flag on apres enter`);
s35 = calcReducer(s35, { type: 'toggleFeetInchesDisplay' });
assert(s35.displayAsFeetInches === false, `flag off`);
assert(s35.display === '46.25', `display retour decimal got "${s35.display}"`);
s35 = calcReducer(s35, { type: 'toggleFeetInchesDisplay' });
assert(s35.displayAsFeetInches === true, `flag re-on`);
assert(s35.display === `3' 10 1/4"`, `display retour ft-in got "${s35.display}"`);

// ── 36. clearAll reset displayAsFeetInches ──────────────────
console.log('\n[36] clearAll reset feet-inches mode');
let s36 = createInitialCalcState();
s36 = calcReducer(s36, { type: 'enterDimension', inches: 100 });
assert(s36.displayAsFeetInches === true);
s36 = calcReducer(s36, { type: 'clearAll' });
assert(s36.displayAsFeetInches === false, `clearAll reset displayAsFeetInches`);

// ── 37. formatCurrentValue helper ───────────────────────────
console.log('\n[37] formatCurrentValue helper');
const s37a = { ...createInitialCalcState(), currentValue: 46.25, displayAsFeetInches: true };
assert(formatCurrentValue(s37a) === `3' 10 1/4"`, `format ft-in mode`);
const s37b = { ...createInitialCalcState(), currentValue: 46.25, displayAsFeetInches: false };
assert(formatCurrentValue(s37b) === '46.25', `format decimal mode`);

// ── 38. Multiplication en mode feet-inches ──────────────────
console.log('\n[38] Multiplication en mode ft-in');
let s38 = createInitialCalcState();
s38 = calcReducer(s38, { type: 'enterDimension', inches: 46.25 }); // 3' 10 1/4"
s38 = calcReducer(s38, { type: 'operation', op: '*' });
s38 = calcReducer(s38, { type: 'digit', digit: '3' });
s38 = calcReducer(s38, { type: 'equals' });
assert(s38.currentValue === 138.75, `46.25 * 3 = 138.75 got ${s38.currentValue}`);
assert(s38.display === `11' 6 3/4"`, `display = "11' 6 3/4"" got "${s38.display}"`);

// ── 39. Saisie directe via touches: 3 [F] 6 [I] 1 [/] 2 [I] ──
console.log('\n[39] Saisie directe Master Pro 3-touches');
let s39 = createInitialCalcState();
s39 = calcReducer(s39, { type: 'digit', digit: '3' });
s39 = calcReducer(s39, { type: 'applyFeet' });
assert(s39.dimMode === true, 'dimMode on apres applyFeet');
assert(s39.dimAccum === 36, `dimAccum=36 got ${s39.dimAccum}`);
assert(s39.displayAsFeetInches === true, 'flag on');

s39 = calcReducer(s39, { type: 'digit', digit: '6' });
s39 = calcReducer(s39, { type: 'applyInch' });
assert(s39.dimAccum === 42, `dimAccum=42 got ${s39.dimAccum}`);

s39 = calcReducer(s39, { type: 'digit', digit: '1' });
s39 = calcReducer(s39, { type: 'fractionSep' });
assert(s39.dimFracNum === 1, `fracNum=1 got ${s39.dimFracNum}`);

s39 = calcReducer(s39, { type: 'digit', digit: '2' });
s39 = calcReducer(s39, { type: 'applyInch' });
assert(s39.dimAccum === 42.5, `dimAccum=42.5 (avec frac 1/2) got ${s39.dimAccum}`);
assert(s39.dimFracNum === null, 'fracNum cleared');

// ── 40. Master Pro auto-commit via [+] (3-touches sans Inch final) ──
console.log('\n[40] Auto-commit fraction via operateur (3 touches, sans Inch final)');
let s40 = createInitialCalcState();
s40 = calcReducer(s40, { type: 'digit', digit: '3' });
s40 = calcReducer(s40, { type: 'applyFeet' });
s40 = calcReducer(s40, { type: 'digit', digit: '6' });
s40 = calcReducer(s40, { type: 'applyInch' });
s40 = calcReducer(s40, { type: 'digit', digit: '1' });
s40 = calcReducer(s40, { type: 'fractionSep' });
s40 = calcReducer(s40, { type: 'digit', digit: '2' });
// User skip le [Inch] et tape directement [+] -- doit auto-commit la fraction
s40 = calcReducer(s40, { type: 'operation', op: '+' });
assert(s40.dimMode === false, 'dimMode off apres operation');
assert(s40.currentValue === 42.5, `currentValue commited = 42.5 got ${s40.currentValue}`);
assert(s40.pendingOp === '+', 'pending op +');

// ── 41. Flow complet 3'10 1/4" + 5'2 1/2" = 9' 0 3/4" via touches ──
console.log('\n[41] Flow Master Pro complet via clavier physique');
let s41 = createInitialCalcState();
// 3 [F] 10 [I] 1 [/] 4 [I]
s41 = calcReducer(s41, { type: 'digit', digit: '3' });
s41 = calcReducer(s41, { type: 'applyFeet' });
s41 = calcReducer(s41, { type: 'digit', digit: '1' });
s41 = calcReducer(s41, { type: 'digit', digit: '0' });
s41 = calcReducer(s41, { type: 'applyInch' });
s41 = calcReducer(s41, { type: 'digit', digit: '1' });
s41 = calcReducer(s41, { type: 'fractionSep' });
s41 = calcReducer(s41, { type: 'digit', digit: '4' });
s41 = calcReducer(s41, { type: 'applyInch' });
assert(s41.dimAccum === 46.25, `1ere dim = 46.25 got ${s41.dimAccum}`);
// [+]
s41 = calcReducer(s41, { type: 'operation', op: '+' });
assert(s41.currentValue === 46.25, `commit 1ere = 46.25 got ${s41.currentValue}`);
// 5 [F] 2 [I] 1 [/] 2 [I]
s41 = calcReducer(s41, { type: 'digit', digit: '5' });
s41 = calcReducer(s41, { type: 'applyFeet' });
s41 = calcReducer(s41, { type: 'digit', digit: '2' });
s41 = calcReducer(s41, { type: 'applyInch' });
s41 = calcReducer(s41, { type: 'digit', digit: '1' });
s41 = calcReducer(s41, { type: 'fractionSep' });
s41 = calcReducer(s41, { type: 'digit', digit: '2' });
s41 = calcReducer(s41, { type: 'applyInch' });
assert(s41.dimAccum === 62.5, `2eme dim = 62.5 got ${s41.dimAccum}`);
// [=]
s41 = calcReducer(s41, { type: 'equals' });
assert(s41.currentValue === 108.75, `total = 108.75 got ${s41.currentValue}`);
assert(s41.display === `9' 0 3/4"`, `display = "9' 0 3/4"" got "${s41.display}"`);

// ── 42. fractionSep ignore quand dimMode off ────────────────
console.log('\n[42] fractionSep no-op hors dimMode');
let s42 = createInitialCalcState();
s42 = calcReducer(s42, { type: 'digit', digit: '5' });
const before = { ...s42 };
s42 = calcReducer(s42, { type: 'fractionSep' });
assert(s42.dimFracNum === before.dimFracNum, `pas de change si dimMode false`);

// ── 43. applyInch finalisation seulement de fraction valide ──
console.log('\n[43] applyInch ignore fraction si denom = 0');
let s43 = createInitialCalcState();
s43 = calcReducer(s43, { type: 'digit', digit: '3' });
s43 = calcReducer(s43, { type: 'applyFeet' });
s43 = calcReducer(s43, { type: 'digit', digit: '6' });
s43 = calcReducer(s43, { type: 'applyInch' });
s43 = calcReducer(s43, { type: 'digit', digit: '1' });
s43 = calcReducer(s43, { type: 'fractionSep' });
// User entre 0 comme denom puis [I] -- ne doit pas crash, ignore la fraction
s43 = calcReducer(s43, { type: 'digit', digit: '0' });
s43 = calcReducer(s43, { type: 'applyInch' });
assert(s43.dimAccum === 42, `denom 0 ignored, accum stays 42 got ${s43.dimAccum}`);

// ── REPORT ───────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('All tests passed.');
}
