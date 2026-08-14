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

const api = new Function('T', engine + '\nreturn { STD, pickRange, expanderStep, expanderN, odInch, toolInfo, expanderSetup, setExpanderNMode, changeoverSec };')(T);
const { STD, pickRange, expanderStep, expanderN, toolInfo, expanderSetup, setExpanderNMode, changeoverSec } = api;

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
/* 엑셀 #1호기 식은 Total Summary!S22 **이미지**로만 적혀 있었다 (2026-08-14 추출):
     N = ROUNDUP(L / (다이 Size − 150))   ex) 12,802 / (550−150) = 33회
   OD914 t9.3 → #1 다이 700mm → StepSize 550 → ceil(12802/550) = 24
   운영 모델은 같은 분모에 round 를 쓰므로 23 이다 (차이는 올림/사사오입뿐). */
api.setExpanderNMode('excel');
expect('Expander #1 N [엑셀·ROUNDUP]', expanderN(A, 'M1'),       24, 0);
expect('Expander #2 N [엑셀·홀수]',   expanderN(A, 'M2'),        25, 0);
/* 엑셀 이미지의 계산 예시 그대로 — 24"×12.7t (#1 다이 550mm) · 12,802mm → 33회 */
expect('엑셀 예시 24" t12.7 → 33회',  expanderN({ od:610, t:12.7, L:12802 }, 'M1'), 33, 0);
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

/* 엑셀 row 14 :  464 − (L/0.3) + [{ceil(L/6M)×(45+20)}×2] × 2
   비고        :  ※ X70 이상인 경우 [ ] x2 적용  →  **대괄호 밖의 ×2 가 조건부**
   종전 기대값은 밖의 ×2 를 무조건 곱한 뒤 X70 에 또 ×2 를 곱한 값(2483.04)이었다.
   2026-08-14 전수 감사에서 일반강 2배·X70 4배로 과대 계상하고 있었음을 확인해 정정. */
const GP = (Lm, hi) => 464 - Lm / 0.3 + Math.ceil(Lm / 6) * (45 + 20) * 2 * (hi ? 2 : 1);
expect('GapPress 18.288m X70',  STD.GapPress(B).sec,                    GP(18.288, true));
expect('GapPress 18.288m 일반', STD.GapPress({...B, grade:'normal'}).sec, GP(18.288, false));
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

/* ---- E: 운영 모델 specs.py 원본 대조 (2026-08-06) ----------------------
   ortools_final_v2_ep12 의 specs.py / job_creator.py 를 직접 실행해 뽑은 값입니다.
   원본은 사내 자료라 저장소에 포함하지 않으므로, 대조 결과를 여기에 고정해 둡니다.
   전량 대조 결과 — 다이 스펙 212행 전부 일치 · #1/#2호기 셋업 4,050쌍 전부 일치. */
console.log('');
console.log('specs.py 원본 대조 (고정 기대값)');
setExpanderNMode('ortools');
/* 두께 ±0.1mm isclose 규칙: t18.8 은 18.9t(580mm) 와 "일치" 로 판정되어야 한다.
   이 규칙이 없으면 18.6~38.1t(340mm) 가 잡혀 N 이 25 → 39 회로 튄다. */
expect('specs: OD914 t18.8 #2 step', expanderStep({ od:914, t:18.8, L:12802 }, 'M2').step, 580, 0);
expect('specs: OD914 t18.8 #2 N',    expanderN   ({ od:914, t:18.8, L:12802 }, 'M2'),      24,  0);
/* #1호기 N 은 분모 하한 없이 step−150 (step≤150 이면 step−100) 을 그대로 쓴다. */
expect('specs: OD508 t9.5 #1 step',  expanderStep({ od:508, t:9.5, L:11500 }, 'M1').step,  170, 0);
expect('specs: OD508 t9.5 #1 N',     expanderN   ({ od:508, t:9.5, L:11500 }, 'M1'),       575, 0);
expect('specs: OD508 t9.5 #1 소요',  STD.Expander({ od:508, t:9.5, L:11500 }, 'M1').sec, 7127);
/* die 식별자는 입력 외경 기준 — 같은 다이라도 OD 가 다르면 다이 교체 90분 */
expect('specs: OD711.0→711.2 셋업',  expanderSetup({od:711.0,t:9.3},{od:711.2,t:8.85},'M1').sec, 5400);
/* R/B — 표준시간 엑셀 No.20.  확관 Step Size = **다이 Size − 90** (Expander(RB)!J4 이미지)
     OD914 t9.3 → RB 다이 700mm → StepSize 610 → N = ceil(12802/610) = 21
     sec = 234 + (21−2)×15 = 519
   2026-08-14 이전에는 −90 을 빠뜨리고 다이 Size 로 나누어 N=19, 489s 로 과소 계상했다. */
expect('RB 확관 StepSize = 다이−90',  expanderStep({ od:914, t:9.3, L:12802 }, 'RB').recipe, 610, 0);
expect('RB N = ceil(L/StepSize)',    expanderN   ({ od:914, t:9.3, L:12802 }, 'RB'),        21,  0);
expect('RB 234+(N−2)×15',
       STD.Expander({ od:914, t:9.3, L:12802 }, 'RB').sec, 234 + (21 - 2) * 15);

/* ---- F: 전수 감사 회귀 방지 (2026-08-06) ------------------------------- */
/* 면취기 룩업 "구멍" — 두께 8mm 미만에서 표의 마지막 행(64"·최악값)을 잡던 회귀 */
expect('면취기 t7.0 (구간 밖)',  STD.EndFacing({ od:508, t:7.0,  L:12000 }).sec,
                                 STD.EndFacing({ od:508, t:8.0,  L:12000 }).sec);
/* Edge Miller 25T 경계는 t > 25 (Gap Press·재질 대리변수와 통일) */
expect('EdgeMiller t25.0↔t24 전환 0', changeoverSec('EdgeMiller', {od:914,t:25.0,L:12802}, {od:914,t:24.0,L:12802}), 0);

/* 다이표에 외경이 없으면 가장 가까운 외경의 공구로 매핑한다 (2026-08-06 세아제강 방침).
   OD457 은 RB 다이표(610~1219)에 없으므로 610 의 공구를 쓴다 — 종전에는 '공구 미상' 이었다. */
{
  const ti = toolInfo(457, 9.5, 'RB');
  expect('폴백: OD457 RB step', ti.step, 550, 0);
  expect('폴백: OD457 RB 헤드', ti.head, 600, 0);
  console.log(`  → ${ti.approx}`);
}
/* OD1219 t44 는 엑셀·specs.py 모두 44t(250mm)/44t(700mm) 가 중복. 먼저 나온 250mm 를 쓴다(세아제강 지시) */
expect('OD1219 t44 #1 step (중복 → 250)', expanderStep({ od:1219, t:44, L:12802 }, 'M1').step, 250, 0);

/* ---- 룩업 테이블 조회 ------------------------------------------------- */
console.log('');
console.log('확관 step (36" t9.3) :', JSON.stringify(expanderStep(A)), ' N =', expanderN(A));
console.log('확관 step (48" t31.2):', JSON.stringify(expanderStep(B)), ' N =', expanderN(B));
console.log('WPS t=28.6  내면 :', pickRange(T.insideWeld, 28.6).toFixed(3), 'mm/s  (엑셀 8.730)');
console.log('WPS t=28.6  외면 :', pickRange(T.outsideWeld, 28.6).toFixed(3), 'mm/s  (엑셀 10.000)');
console.log('');
console.log(failed ? `${failed}건 FAIL` : '전 항목 PASS');
process.exitCode = failed ? 1 : 0;
