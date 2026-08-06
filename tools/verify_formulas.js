#!/usr/bin/env node
/**
 * 표준시간 산출식 교차검증
 *
 * src/engine.js 의 구현 결과를, 엑셀 「Total Summary」 산출식을 이 파일에서
 * 독립적으로 다시 쓴 값과 대조합니다. 단위 해석(길이 m vs mm)이 어긋나면
 * 여기서 바로 FAIL 로 드러납니다.
 *
 *   node tools/verify_formulas.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));
const engine = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8');

const api = new Function('T', engine + '\nreturn { STD, pickRange, expanderStep, expanderN, odInch, toolInfo, expanderSetup, setExpanderNMode };')(T);
const { STD, pickRange, expanderStep, expanderN, toolInfo, expanderSetup, setExpanderNMode } = api;

let failed = 0;
function expect(name, got, want, tol = 0.5) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} got=${got.toFixed(2).padStart(9)}  want=${want.toFixed(2)}`);
}

/* ---- A: OD914 × t9.3 × 12.802m, 12M 라인, API 5L ---------------------- */
const A = { od: 914, t: 9.3, L: 12802, qty: 70, grade: 'normal', api5l: true,
            markSpec: 2, markEnd: 2, defects: 0, holdSec: 60, rtType: '450kV' };

expect('EdgeMiller 12M 일반',   STD.EdgeMiller(A, '12M').sec,   283 - 123 / 5 + 15250 / 215.6 + 12802 * (0.06 / 5 - 0.0016));
expect('PreBender 12M',         STD.PreBender(A, '12M').sec,    30 + (1450 / 290 + 17.2) * Math.ceil((12802 - 2200) / 1450));
expect('PressBender 12M',       STD.PressBender(A, '12M').sec,  178 + 12.802 / 0.708 - 914 / 170 + 12 * 36);
expect('TackWelder 12M',        STD.TackWelder(A, '12M').sec,   200 + 12802 / 66.6666667, 0.1);
expect('InsideWelder 12M',      STD.InsideWelder(A, '12M').sec, 710 + 12802 / 21.6666667, 0.1);
expect('OutsideWelder 12M',     STD.OutsideWelder(A, '12M').sec, 550 + 12802 / 21.6666667, 0.1);
expect('FirstUT',               STD.FirstUT(A).sec,             240 + 12802 / 150 + (9600 / 750) * 2);
/* 확관은 호기별 다이 스펙이 다르다 (specs.py die_specs_m1/m2/rb).
   OD914 t9.3 → #1호기 9t(700mm), #2호기 9.5t(580mm) */
expect('Expander #1 die step',  expanderStep(A, 'M1').step,     700, 0);
expect('Expander #2 die step',  expanderStep(A, 'M2').step,     580, 0);
/* 기본값은 운영 모델(specs.py) N식 — 2026-08-06 세아제강 확정.
   엑셀 표준시간 분석 식은 대조용으로 남아 있으므로 두 모드를 각각 검증한다. */
api.setExpanderNMode('excel');
expect('Expander #1 N [엑셀·홀수]',   expanderN(A, 'M1'),        21, 0);
expect('Expander #2 N [엑셀·홀수]',   expanderN(A, 'M2'),        25, 0);
api.setExpanderNMode('ortools');
expect('Expander #1 N [운영모델]',    expanderN(A, 'M1'),        23, 0);
expect('Expander #2 N [운영모델·짝수]', expanderN(A, 'M2'),      24, 0);
const nM1 = expanderN(A, 'M1'), nM2 = expanderN(A, 'M2');
expect('Expander #2',           STD.Expander(A, 'M2').sec,      165 + nM2 * 7.5);
expect('Expander #1',           STD.Expander(A, 'M1').sec,      177 + nM1 * 12 + (12802 + 3500) / 300);
expect('Expander #1·#2 동시',   STD.Expander(A, 'BOTH').sec,    Math.max(177 + nM1 * 12 + (12802 + 3500) / 300, 165 + nM2 * 7.5));
expect('EndFacing 36" t9.3',    STD.EndFacing(A).sec,           363 + 221.61);
expect('OuterBead',             STD.OuterBead(A).sec,           55 + 12802 / 20);
expect('HydroTest 36"',         STD.HydroTest(A).sec,           90 + 85 + 30 + 60 + 300 + 180);
expect('FinalUT',               STD.FinalUT(A).sec,             200 + 12802 / 216.7);
expect('RT 450kV',              STD.RT(A).sec,                  325 + Math.ceil(12802 / 140) * 7.5);
expect('Packing',               STD.Packing(A, '12M', 1).sec,   634 + (45000 - 12802) / 270 + 30 * 2 * 2);

/* ---- B: OD1219 × t31.2 × 18.288m, 18M 라인, 고강도(X70↑) --------------- */
const B = { od: 1219, t: 31.2, L: 18288, qty: 20, grade: 'high', api5l: false,
            markSpec: 1, markEnd: 1, defects: 2, holdSec: 120, rtType: '320kV' };

expect('GapPress 18.288m X70',  STD.GapPress(B).sec,            464 - 18.288 / 0.3 + Math.ceil(18.288 / 6) * (45 + 20) * 2 * 2 * 2);
expect('EdgeMiller 18M 고강도', STD.EdgeMiller(B, '18M').sec,   348 - 123 / 2 + 19250 / 215.6 + 18288 * (0.06 / 2 - 0.0016));
expect('PreBender 18M t31.2',   STD.PreBender(B, '18M').sec,    46.5 + (800 / 290 + 17.2) * Math.ceil((18288 - 2200) / 800));
expect('InsideWelder t31.2 2pass', STD.InsideWelder(B, '18M').sec, 670 + 18288 / 8.953488372, 0.1);
expect('RT 320kV 불량 2개소',   STD.RT(B).sec,                  345 + Math.ceil(18288 / 140) * 7.5 + 2 * 120);

/* ---- C: 확관 공구 / 셋업 시간 (specs.get_tool_info · get_setup_time_val) --- */
console.log('');
const t914 = toolInfo(914, 9.3, 'M1');
expect('toolInfo OD914 t9.3 헤드',  t914.head,   800, 0);
expect('toolInfo OD914 t9.3 step',  t914.step,   700, 0);

const S = (od, t) => ({ od, t, L: 12802 });
expect('셋업 동일 스펙 → 0',        expanderSetup(S(914, 9.3),  S(914, 9.3),  'M1').sec,     0, 0);
expect('셋업 다이만 교체 → 90분',   expanderSetup(S(914, 9.3),  S(914, 25.4), 'M1').sec, 5400, 0);
expect('셋업 헤드 교체 → 150분',    expanderSetup(S(914, 9.3),  S(660, 9),    'M1').sec, 9000, 0);
expect('셋업 드로바 교체 → 270분',  expanderSetup(S(914, 9.3),  S(508, 9),    'M1').sec, 16200, 0);
console.log('  OD914→OD660 :', expanderSetup(S(914, 9.3), S(660, 9), 'M1').kind);
console.log('  OD914→OD508 :', expanderSetup(S(914, 9.3), S(508, 9), 'M1').kind);

/* ---- D: 확관 N 산출식 병기 (엑셀 vs 운영 최적화 모델) --------------------- */
console.log('');
console.log('N 산출식 비교 (OD914 t9.3 L12.802m)');
setExpanderNMode('excel');
const eM1 = expanderN(A, 'M1'), eM2 = expanderN(A, 'M2');
setExpanderNMode('ortools');
const oM1 = expanderN(A, 'M1'), oM2 = expanderN(A, 'M2');
setExpanderNMode('excel');
console.log(`  #1호기  엑셀 N=${eM1}  vs  운영모델 N=${oM1}   (${((oM1/eM1-1)*100).toFixed(0)}%)`);
console.log(`  #2호기  엑셀 N=${eM2}  vs  운영모델 N=${oM2}   (${((oM2/eM2-1)*100).toFixed(0)}%)`);

/* ---- 룩업 테이블 조회 ------------------------------------------------- */
console.log('');
console.log('확관 step (36" t9.3) :', JSON.stringify(expanderStep(A)), ' N =', expanderN(A));
console.log('확관 step (48" t31.2):', JSON.stringify(expanderStep(B)), ' N =', expanderN(B));
console.log('WPS t=28.6  내면 :', pickRange(T.insideWeld, 28.6).toFixed(3), 'mm/s  (엑셀 8.730)');
console.log('WPS t=28.6  외면 :', pickRange(T.outsideWeld, 28.6).toFixed(3), 'mm/s  (엑셀 10.000)');
console.log('');
console.log(failed ? `${failed}건 FAIL` : '전 항목 PASS');
process.exitCode = failed ? 1 : 0;
