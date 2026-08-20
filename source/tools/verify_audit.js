#!/usr/bin/env node
/**
 * 2026-08-14 전수 감사 회귀 방지 테스트
 *
 *   node tools/verify_audit.js
 *
 * 감사에서 찾아 고친 결함이 다시 들어오지 않는지 확인합니다.
 * 각 항목의 주석에 「종전 동작 → 정정 후」를 적어 두었습니다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const src = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8') + '\n'
          + fs.readFileSync(path.join(ROOT, 'src/flow.js'), 'utf8') + '\n'
          + fs.readFileSync(path.join(ROOT, 'src/prodlog.js'), 'utf8') + '\n'
          + fs.readFileSync(path.join(ROOT, 'src/planload.js'), 'utf8');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));
const ORDERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/orders.json'), 'utf8'));
const api = new Function('T', 'ORDERS', src + `
  return { simulate, optimizeExpander, routeOf, STD, NODES, NODE, importOptPlan,
           normMachine, rbCapable, forceRB, useRBLine, expanderStep, expanderN, toolInfo,
           setRefStd, setRefCo, setRefCap, refDiff, refCoDiff, REF, REF_STD_DEFAULT, CHANGEOVER,
           setExpanderNMode, PlanLoader, loadProdLog, plogSpec, plogParseCSV, verifyProdLog };
`)(T, ORDERS);

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra != null ? '  ' + extra : ''}`);
}
function near(name, got, want, tol = 0.5) {
  ok(name, Math.abs(got - want) <= tol, `got=${(+got).toFixed(2)} want=${(+want).toFixed(2)}`);
}

const CFG = { startDate:'2026-03-02', dateMode:'sheet', dueAnalysis:false, shifts:2,
  netHoursPerShift:7.5, changeover:true, useCP:false, rbMode:'force', rbPost:'shared',
  expRuleSet:'ortools', dispatchRule:'EAT', holdSec:60, freeStationSec:300, eventCap:1e9, seed:1 };

console.log('── engine.js ──');

/* A1. Gap Press — 대괄호 밖의 ×2 는 X70 이상 조건부.
   종전: 무조건 ×2 후 X70 에 또 ×2 → 일반강 2배 · X70 4배 */
const GP = (Lm, hi) => 464 - Lm / 0.3 + Math.ceil(Lm / 6) * 65 * 2 * (hi ? 2 : 1);
near('A1 GapPress X70 (12.802m)',  api.STD.GapPress({ od:1219, t:31.2, L:12802, grade:'high'   }).sec, GP(12.802, true));
near('A1 GapPress 일반 (12.802m)', api.STD.GapPress({ od:1219, t:31.2, L:12802, grade:'normal' }).sec, GP(12.802, false));
ok  ('A1 X70 이 일반강의 정확히 2배',
     Math.abs(api.STD.GapPress({od:1219,t:31.2,L:12802,grade:'high'}).sec - 464 + 12.802/0.3
            - 2 * (api.STD.GapPress({od:1219,t:31.2,L:12802,grade:'normal'}).sec - 464 + 12.802/0.3)) < 0.01);

/* A2. Edge Miller — 「첫 본 생산 시 +1분 50초」. 종전: 항 자체가 없었다 */
const em1 = api.STD.EdgeMiller({ od:914, t:9.3, L:12802 }, '18M', 1, 1).sec;
const em2 = api.STD.EdgeMiller({ od:914, t:9.3, L:12802 }, '18M', 2, 2).sec;
near('A2 Edge Miller 첫 본 = 2본째 + 110s', em1 - em2, 110);
near('A2 고망간도 첫 본 +110s',
     api.STD.EdgeMiller({ od:914, t:9.3, L:12802, grade:'hiMn' }, '18M', 1, 1).sec
   - api.STD.EdgeMiller({ od:914, t:9.3, L:12802, grade:'hiMn' }, '18M', 2, 2).sec, 110);

/* A3. 수압 36" 판정은 공칭 인치. 종전: 짝수 스냅 때문에 35"(OD889)가 36" 로 올라가 +180s */
near('A3 수압 OD889 (35") = 565s', api.STD.HydroTest({ od:889, t:12.7, L:12000, holdSec:60 }).sec, 565);
near('A3 수압 OD914 (36") = 745s', api.STD.HydroTest({ od:914, t:12.7, L:12000, holdSec:60 }).sec, 745);

/* A4. R/B 확관 — StepSize = 다이−90, 옥외 열처리는 「15초 제외」 = 234 고정.
   종전: StepSize 에 −90 없음(N 과소), 열처리 기본값을 219 로 지어냈음 */
near('A4 R/B StepSize = 다이−90', api.expanderStep({ od:914, t:9.3, L:12802 }, 'RB').recipe, 610, 0);
near('A4 R/B 비열처리 519s', api.STD.Expander({ od:914, t:9.3, L:12802 }, 'RB').sec, 519);
near('A4 R/B 열처리 234s 고정', api.STD.Expander({ od:914, t:9.3, L:12802, heat:true }, 'RB').sec, 234);

console.log('\n── flow.js ──');

/* B1. R/B 길이 상한 = 12.8384m (#2호기와 동일).
   종전: 12.8 로 잘라 공장 주력 12.802m 제품이 전부 R/B 부적격 */
ok('B1 rbCapable L=12802 → true', api.rbCapable({ od:914, t:12.7, L:12802 }, CFG) === true);
ok('B1 rbCapable L=12839 → false', api.rbCapable({ od:914, t:12.7, L:12839 }, CFG) === false);
ok('B1 구 동작 복원 (rbLenLimit 12.8)',
   api.rbCapable({ od:914, t:12.7, L:12802 }, { ...CFG, rbLenLimit: 12.8 }) === false);
ok('B1 46" 는 여전히 제외', api.rbCapable({ od:1168, t:12.7, L:12000 }, CFG) === false);

/* B2. 같은 판매오더가 여러 행이면 orderSpan 을 합친다.
   종전: 덮어써서 tEnd·처리량·가용시간이 줄고 가동률이 100% 를 넘었다 */
const DUP = [
  { no:'350894', od:914,  t:12.7, L:12000, qty:200 },
  { no:'350894', od:1016, t:12.7, L:12000, qty:1   },
];
const Sdup = api.simulate(DUP, CFG);
near('B2 합산 수량 201본', Sdup.orderSpan['350894'].qty, 201, 0);
ok  ('B2 가동률 100% 초과 없음', !Sdup.stats.some(x => x.util > 100),
     'max=' + Math.max(...Sdup.stats.map(x => x.util)).toFixed(1) + '%');

/* B3. 계획서 로더가 붙이는 `-2` 접미사도 외부 스케줄에 매칭된다.
   종전: 정확 일치만 봐서 R/U 분할 오더의 뒤 행이 핀되지 않았다 */
const SPLIT = [
  { no:'350894',   od:914, t:12.7, L:12000, qty:4 },
  { no:'350894-2', od:914, t:12.7, L:12000, qty:4 },
];
const plan = api.importOptPlan([['OrderNo','Machine'], ['350894','Expander#2']]);
const Ssp = api.simulate(SPLIT, { ...CFG, dispatchRule:'IMPORT', plan });
const mach = {};
for (const e of Ssp.events.filter(e => e.n === 'EXP')) {   // 이벤트 키: o(오더) n(노드) mach(호기)
  (mach[e.o] = mach[e.o] || new Set()).add(e.mach);
}
ok('B3 350894-2 도 #2호기로 핀', mach['350894-2'] && mach['350894-2'].size === 1 && mach['350894-2'].has('M2'),
   '350894=' + [...(mach['350894'] || [])] + ' / 350894-2=' + [...(mach['350894-2'] || [])]);

/* B4. 설비 코드 → 호기 매핑. 종전: 숫자 부분일치라 EP102→M2, EP103→M3, EP104→M1 */
ok('B4 EP102 → RB', api.normMachine('EP102') === 'RB');
ok('B4 EP103 → M1', api.normMachine('EP103') === 'M1');
ok('B4 EP104 → M2', api.normMachine('EP104') === 'M2');
ok('B4 Expander#2 → M2 (기존 표기 유지)', api.normMachine('Expander#2') === 'M2');

/* B5. 포장 「1/10본마다 추가 검사」는 전역 순번 기준.
   종전: 오더 내 순번이라 오더를 어떻게 쪼개느냐로 포장 부하가 달라졌다 */
const mk = (rows, per) => Array.from({ length: rows }, (_, i) =>
  ({ no:'P' + i, od:914, t:12.7, L:12000, qty:per }));
const pk = (o) => api.simulate(o, { ...CFG, changeover:false })
  .stats.find(x => x.id === 'PACK').busyH;
near('B5 1오더×100본 = 100오더×1본 (포장 부하)', pk(mk(1, 100)), pk(mk(100, 1)), 0.02);
near('B5 20오더×5본도 동일',                     pk(mk(20, 5)),  pk(mk(100, 1)), 0.02);

/* B6. 외부 스케줄이 R/B 를 지정해도 적격성은 지킨다.
   종전: 무조건 R/B → 18m·t30·46" 제품이 12.8m 상한 설비에서 처리된 것으로 나왔다 */
const BAD = [{ no:'X1', od:1168, t:30, L:18000, qty:3 }];
const warn = [];
const Sbad = api.simulate(BAD, { ...CFG, dispatchRule:'IMPORT', planWarn: warn,
  plan: api.importOptPlan([['OrderNo','Machine'], ['X1','Expander#RB']]) });
ok('B6 부적격 제품은 R/B 로 가지 않는다',
   !Object.values(Sbad.orderSpan)[0].route.includes('RB'), Object.values(Sbad.orderSpan)[0].route.join('>'));
ok('B6 경고가 남는다', warn.length > 0, warn[0]);

/* B7. 라우트 상한에 걸려 사라진 본수를 센다. 종전: 조용히 소멸 */
const RW = [{ no:'A', od:914, t:12.7, L:12000, qty:20, api5l:true }];
const Srw = api.simulate(RW, { ...CFG, deadline:'2027-12-31',
  stochastic:{ on:true, pDefect:0.95, pWeld:0, maxRework:40, cvTime:0, cvSetup:0, pBreak:0 } });
ok('B7 routeAborted 가 KPI 로 노출된다', typeof Srw.kpi.routeAborted === 'number',
   'routeAborted=' + Srw.kpi.routeAborted);

/* B8. 납기 분석을 켜면 sheet 모드에서도 납기가 살아 있다. 종전: 항상 null → 늘 "0건 지연" */
const DUE = ORDERS.slice(0, 5).map(o => ({ ...o, due:'2026-03-05 08:00' }));
const Son  = api.simulate(DUE, { ...CFG, dueAnalysis:true  });
const Soff = api.simulate(DUE, { ...CFG, dueAnalysis:false });
ok('B8 dueAnalysis on → 납기 집계됨', Son.kpi.due.withDue === 5, 'withDue=' + Son.kpi.due.withDue);
ok('B8 dueAnalysis off → 집계 안 함',  Soff.kpi.due.withDue === 0);

/* B9. 실적 보정이 최적화 엔진에도 걸린다. 종전: 시뮬에만 걸려 Cmax 와 축이 어긋났다 */
const o1 = api.optimizeExpander(ORDERS, { ...CFG, iters: 200 });
const o2 = api.optimizeExpander(ORDERS, { ...CFG, iters: 200, stdCalib:{ Expander: 0.5 } });
ok('B9 보정이 확관 Cmax 를 바꾼다', o2.cmaxH < o1.cmaxH * 0.75,
   `cmax ${o1.cmaxH.toFixed(1)}h → ${o2.cmaxH.toFixed(1)}h`);

/* B10. 옥외 열처리(C2) 제품이 R/B 로 강제된다. 종전: HT102 열만 봐서 C2 는 본류로 갔다 */
ok('B10 heat=true → forceRB', api.forceRB({ od:1067, t:19.6, L:12192, heat:true }, CFG) === true);
ok('B10 HT102 도 그대로',      api.forceRB({ od:1067, t:19.6, L:12192, bottleneck:'HT102' }, CFG) === true);

/* B11. R/B 2차 U.T 는 본류와 같은 D5 조건. 종전: 무조건 태워 본류보다 검사를 더 받았다 */
const rt1 = api.routeOf({ od:914, t:12.7, L:12000, qty:5,  api5l:false, heat:true }, CFG).route;
const rt2 = api.routeOf({ od:914, t:12.7, L:12000, qty:80, api5l:true,  heat:true }, CFG).route;
ok('B11 비 API 5L R/B → 2차 U.T 없음', rt1.includes('RB') && !rt1.includes('FUT'), rt1.join('>'));
ok('B11 API 5L R/B → 2차 U.T 있음',    rt2.includes('RB') &&  rt2.includes('FUT'), rt2.join('>'));
ok('B11 R/B 도 수압은 무조건',          rt1.includes('HYD'));

/* B12. 빈 오더셋 / qty 0 방어. 종전: makespanH = -Infinity */
ok('B12 빈 오더셋도 유한값', isFinite(api.simulate([], CFG).kpi.makespanH));
ok('B12 qty 0 도 유한값',    isFinite(api.simulate([{ no:'Z', od:914, t:12.7, L:12000, qty:0 }], CFG).kpi.makespanH));

/* 전체 회귀 — 기본 오더셋에서 가동률이 100% 를 넘지 않고 탈락이 없어야 한다 */
console.log('\n── 기본 오더셋 58건 ──');
const SB = api.simulate(ORDERS, CFG);
ok('가동률 100% 초과 없음', !SB.stats.some(x => x.util > 100),
   'max=' + Math.max(...SB.stats.map(x => x.util)).toFixed(1) + '%');
ok('라우트 탈락 0본', SB.kpi.routeAborted === 0);
console.log(`  Makespan ${(SB.kpi.makespanH / 24).toFixed(1)}일 · 1위 병목 ` +
  `${SB.stats[0].label} ${SB.stats[0].util.toFixed(1)}%`);

/* ==================================================================
   기준정보(REF) 레이어 — 화면에서 고친 값이 계산에 반영되고, 되돌아가는가
   ================================================================== */
console.log('\n── 기준정보 (REF) ──');
const SP = { od:914, t:9.3, L:12802, qty:70, grade:'normal', markSpec:2, markEnd:2, holdSec:60, rtType:'450kV' };

/* C1. 표준시간 상수를 바꾸면 결과가 그만큼 움직인다 */
const pk0 = api.STD.Packing(SP, '12M', 5).sec;
api.setRefStd({ Packing: { base: 500 } });
const pk1 = api.STD.Packing(SP, '12M', 5).sec;
near('C1 포장 기본 634→500 → 정확히 −134s', pk0 - pk1, 134);
ok  ('C1 refDiff 가 변경분만 돌려준다',
     JSON.stringify(api.refDiff()) === '{"Packing":{"base":500}}', JSON.stringify(api.refDiff()));

/* C2. 빈 객체 {} 로도 완전히 되돌아간다 (종전 버그: {} 가 truthy 라 이전 값이 남았다) */
api.setRefStd({});
near('C2 setRefStd({}) → 원래대로', api.STD.Packing(SP, '12M', 5).sec, pk0);
ok  ('C2 refDiff 비어 있음', Object.keys(api.refDiff()).length === 0);

/* C3. 확관 Step 여유값도 기준정보에서 바뀐다 */
const rb0 = api.expanderStep(SP, 'RB').recipe;
api.setRefStd({ Expander: { marginRB: 0 } });
const rb1 = api.expanderStep(SP, 'RB').recipe;
near('C3 R/B Step 여유 90→0 → recipe +90', rb1 - rb0, 90);
api.setRefStd({});
near('C3 되돌리면 원래 recipe', api.expanderStep(SP, 'RB').recipe, rb0);

/* C4. 전환시간도 반영되고 되돌아간다 */
const co0 = api.CHANGEOVER.EndFacing.od;
api.setRefCo({ EndFacing: { od: 0 } });
ok('C4 전환시간 반영', api.CHANGEOVER.EndFacing.od === 0);
ok('C4 refCoDiff 가 변경분만', JSON.stringify(api.refCoDiff()) === '{"EndFacing":{"od":0}}', JSON.stringify(api.refCoDiff()));
api.setRefCo({});
ok('C4 전환시간 되돌리기', api.CHANGEOVER.EndFacing.od === co0);
ok('C4 refCoDiff 비어 있음', Object.keys(api.refCoDiff()).length === 0);

/* C5. 설비 대수 변경이 시뮬레이션에 반영된다 */
const base = api.simulate(ORDERS, CFG);
api.setRefCap({ PACK: 2 });
const twice = api.simulate(ORDERS, CFG);
api.setRefCap({});
const back = api.simulate(ORDERS, CFG);
ok('C5 포장 2대 → Makespan 감소',
   twice.kpi.makespanH < base.kpi.makespanH * 0.95,
   `${(base.kpi.makespanH/24).toFixed(1)}일 → ${(twice.kpi.makespanH/24).toFixed(1)}일`);
near('C5 되돌리면 원래 Makespan', back.kpi.makespanH, base.kpi.makespanH, 0.01);
ok('C5 대수 범위 밖(0·99)은 무시', (api.setRefCap({ PACK: 0, EF: 99 }), !api.REF.cap.PACK && !api.REF.cap.EF));
api.setRefCap({});

/* C6. 기준정보를 안 건드리면 엑셀 대조값과 완전히 같다 (verify_formulas 와 이중 확인) */
near('C6 무변경 시 포장 = 873.3s', api.STD.Packing(SP, '12M', 5).sec, 873.3, 0.1);
near('C6 무변경 시 확관 #1 = 507.3s (177 + N23×12 + (12802+3500)/300)', api.STD.Expander(SP, 'M1').sec, 507.34, 0.1);

/* ==================================================================
   2026-08-14 2차 전수 감사 — 병렬 코드 감사에서 나온 결함들
   ================================================================== */
console.log('\n── 2차 감사: 엔진 ──');

/* D1. 소형 다이(step ≤ 150) 의 −100 여유 규칙이 모든 경로에 적용되는가.
   종전: stepMargin 이 무조건 150 → recipe = max(step−150,1) = 1mm
        → 엑셀 N 모드에서 OD508 t20.25 18.288m 이 N=18,288회 / 219,706s 로 폭주 */
const SMALL = { od:508, t:20.25, L:18288 };
near('D1 소형 다이 recipe = step−100', api.expanderStep(SMALL, 'M1').recipe, 50, 0);
api.setExpanderNMode('excel');
near('D1 엑셀 N = ceil(L/50)', api.expanderN(SMALL, 'M1'), Math.ceil(18288/50), 0);
near('D1 엑셀 소요 4,642s (종전 219,706s)', api.STD.Expander(SMALL, 'M1').sec, 4642, 1);
api.setExpanderNMode('ortools');
near('D1 운영모델도 같은 분모', api.expanderN(SMALL, 'M1'), Math.ceil(18288/50), 0);
near('D1 큰 다이는 −150 그대로', api.expanderStep({od:914,t:9.3,L:12802},'M1').recipe, 550, 0);

/* D2. 프로토타입 오염 — `__proto__` 키가 Object.prototype 을 건드리면 안 된다 */
api.setRefCo(JSON.parse('{"__proto__":{"od":9999,"t":1,"L":2}}'));
ok('D2 setRefCo 가 Object.prototype 을 오염시키지 않는다', ({}).od === undefined, '({}).od=' + ({}).od);
api.setRefStd(JSON.parse('{"__proto__":{"base":1}}'));
ok('D2 setRefStd 도 안전', ({}).base === undefined);
api.setRefCo({}); api.setRefStd({});

/* D3. 확관 대수는 기준정보에서 못 바꾼다 (설정 탭 소관) — 받아두면 기준선이 영영 안 잡힌다 */
ok('D3 setRefCap 이 EXP 를 받지 않는다', (api.setRefCap({ EXP: 4 }), Object.keys(api.REF.cap).length === 0));
/* D4. 숫자가 아닌 값은 받지 않는다 */
ok('D4 true / "5" / [3] 거부', (api.setRefCap({ PACK: true }), Object.keys(api.REF.cap).length === 0)
   && (api.setRefCap({ PACK: '5' }), Object.keys(api.REF.cap).length === 0)
   && (api.setRefCap({ PACK: [3] }), Object.keys(api.REF.cap).length === 0));
ok('D4 setRefCo 가 null 항목에 안 터진다', (() => { try { api.setRefCo({ Packing: null }); return true; } catch (e) { return false; } })());
api.setRefCap({});

console.log('\n── 2차 감사: 계획서 로더 ──');
const PL = api.PlanLoader;
const runPlan = (rows) => {
  const h = PL.detectHeader(rows), m = PL.autoMap(rows[h], rows.slice(h + 1));
  return PL.buildOrders(rows.slice(h + 1), m, PL.guessUnits(rows.slice(h + 1), m),
                        { startDate: '2026-03-02', rowBase: h + 1 });
};
/* E1. 열 별칭 'o.d' 가 'MODEL' 에 부분일치해 외경 열을 가로채던 문제 — 완전일치가 이겨야 한다 */
const e1 = runPlan([['ORDER','MODEL','OD','THK','LENGTH','QTY'],
  ['A',800,914,9.3,12802,10],['B',800,762,9.5,12802,20],['C',1200,1219,25.4,12000,30]]);
ok('E1 MODEL 열이 외경을 가로채지 않는다', e1.orders.map(o=>o.od).join(',') === '914,762,1219',
   e1.orders.map(o=>o.od).join(','));
/* E2. 중복 오더 접미어가 실제 '-2' 오더와 충돌하던 문제 */
const e2 = runPlan([['판매오더','외경','두께','길이','수량'],
  ['A',914,9.3,12802,10],['A',914,9.3,12802,20],['A-2',1219,25.4,12000,30],['A',762,9.5,12802,40]]);
ok('E2 오더번호가 서로 겹치지 않는다',
   new Set(e2.orders.map(o=>o.no)).size === e2.orders.length && e2.orders.length === 4,
   e2.orders.map(o=>o.no).join(','));
/* E3. 병합된 일자 셀 — 직전 날짜를 이어받아야 한다 (종전: 시작일부터 6시간 사다리) */
const e3 = runPlan([['일자','외경','두께','길이','수량'],
  ['2026-04-01',914,9.3,12802,10],['',914,9.3,12802,10],['',914,9.3,12802,10],
  ['2026-04-08',914,9.3,12802,10],['',914,9.3,12802,10]]);
ok('E3 병합 일자 셀이 직전 날짜를 잇는다',
   e3.orders.map(o=>o.start.slice(0,10)).join(' ') === '2026-04-01 2026-04-01 2026-04-01 2026-04-08 2026-04-08',
   e3.orders.map(o=>o.start.slice(0,10)).join(' '));
/* E4. 반올림하면 0 이 되는 수량은 오더로 내보내지 않는다 */
const e4 = runPlan([['판매오더','외경','두께','길이','수량'],
  ['A',914,9.3,12802,0.4],['B',914,9.3,12802,1.6],['C',914,9.3,12802,10]]);
ok('E4 소수 수량 0.4 는 건너뛰고 알린다',
   e4.orders.length === 2 && e4.skipped.some(x=>/0\.4/.test(x.why)), JSON.stringify(e4.skipped));

console.log('\n── 2차 감사: 실적 로그 ──');
/* F1. 자재내역의 인치 표기(42") 가 파일 나머지를 삼키던 CSV 파서 버그 */
const f1 = api.plogParseCSV([
  'a,b,c',
  'NX52L2 BBE 42" 762x9.5tx12.802M,2,3',
  'x,y,z',
].join('\n'));
ok('F1 필드 중간 따옴표가 파일을 삼키지 않는다', f1.length === 2 && f1[1].a === 'x',
   `${f1.length}행 · ${JSON.stringify(f1[0]).slice(0,60)}`);
/* F2. mm 표기를 미터로 오독해 길이가 1000배가 되던 문제 */
near('F2 12192mm → 12192', api.plogSpec('NX52L2 BBE 762x9.5tx12192mm A44').L, 12192, 0);
near('F2 12.802M → 12802', api.plogSpec('NX52L2 BBE 762x9.5tx12.802M A44').L, 12802, 0);
/* F3. 시각을 하나도 못 읽는 파일은 던지지 말고 오류로 돌려준다 */
const f3 = api.loadProdLog([
  'poll_time,REAL_WC_ID,REAL_WC_DESC,OPERATION_NM,WO_NO,MATERIAL_DESC,WORK_DATE,SHIFT,LAST_TIME,PROD_QTY_cum,qty_delta',
  '2026/07/20 15:01:14,PK113,포장,포장,1,NX52L2 BBE 762x9.5tx12.802M,2026-07-20,2,2026/07/20 15:01:05,2,2',
].join('\n'));
ok('F3 시각 전부 실패 → error 객체', !!(f3 && f3.error), JSON.stringify(f3).slice(0, 80));
/* F4. 숫자가 아닌 누적값은 0 으로 삼키지 않는다 */
const f4 = api.loadProdLog([
  'poll_time,REAL_WC_ID,REAL_WC_DESC,OPERATION_NM,WO_NO,MATERIAL_DESC,WORK_DATE,SHIFT,LAST_TIME,PROD_QTY_cum,qty_delta',
  '2026-07-20 15:01:14,PK113,포장,포장,1,NX52L2 BBE 762x9.5tx12.802M,2026-07-20,2,2026-07-20 15:01:05,N/A,0',
  '2026-07-20 16:01:14,PK113,포장,포장,1,NX52L2 BBE 762x9.5tx12.802M,2026-07-20,2,2026-07-20 16:01:05,7,7',
].join('\n'));
ok('F4 N/A 누적행을 버리고 7본으로 센다', !f4.error && f4.wcStat[0].qty === 7,
   f4.error || (f4.wcStat[0].qty + '본'));

console.log(failed ? `\n${failed}건 FAIL` : '\n전 항목 PASS');
process.exit(failed ? 1 : 0);
