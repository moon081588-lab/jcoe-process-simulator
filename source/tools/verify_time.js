#!/usr/bin/env node
/**
 * 1차 검증 — **시간 3요소가 제대로 나오는가** (전수)
 *
 *   조관계획서를 넣었을 때 각 공정의
 *     · 운영(가공) 시간   · 설비 전환(tool change) 시간   · 대기 시간
 *   이 «맞게 계산되고, 서로 아귀가 맞고, 어떤 설정에서도 무너지지 않는가» 를 봅니다.
 *   전역 최적화(어떻게 하면 빨라지나)는 2차 과제라 다루지 않습니다.
 *
 *   node tools/verify_time.js
 *
 * 검사 축
 *   A 항등식   네 조각의 합이 실제 시간과 같은가 — **설정 25종 × 오더셋 6종**
 *   B 출처     가공 = 표준시간 산식 / 전환 = 공구 계층 룰 재계산
 *   C 집계     설비별 합계 = 이벤트 합 (BOTH 동시가동 규칙 포함)
 *   D 인과     「대기」가 정말 대기인가 — 설비가 놀고 있는데 기다린 시간을 계량
 *   E 불변식   설비를 늘리면 대기가 줄고, 전환을 끄면 0 이 되는가
 *   F 경계     1본 오더 · 재작업 루프 · 동시가동 · R/B 경유 · Gap Press
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));
const ORDERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/orders.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8') + '\n'
          + fs.readFileSync(path.join(ROOT, 'src/flow.js'), 'utf8');
const A = new Function('T', 'ORDERS', src + `
  return { simulate, pipeTimeSplit, orderTimeSplit, verifyOrder, changeoverSec, optimizeExpander,
           setRefCap, setRefStd, specOf, routeOf, expanderMode,
           STD, NODE, NODES, RB_LINE, EXP_MACHINES };`)(T, ORDERS);

let fail = 0;
const ok = (n, c, e) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e != null ? '  ' + e : ''}`); };
const h = v => (v / 3600).toFixed(1) + 'h';
const TOL = 5;                       // 초 — 캘린더 경계의 부동소수 오차

const BASE = { startDate:'2026-03-02', shifts:2, netHoursPerShift:7.5, skipWeekend:false, useRB:true,
  useCP:false, processingFinalUT:false, holdSec:60, changeover:true, freeStationSec:300,
  eventCap:1e9, sameODConcurrency:true, useM3:false, dispatchRule:'EAT' };

/* ── 오더셋 6종 — 경계를 일부러 건드린다 ─────────────────────────── */
const spec = (o) => ({ no:o.no, od:o.od, t:o.t, L:o.L, qty:o.qty, start:'2026-03-02 08:00' });
const SETS = {
  '기본 계획서': ORDERS,
  '1본 오더만': ORDERS.slice(0, 12).map((o, i) => spec({ ...o, no:'S1-'+i, qty:1 })),
  '18M 만': [{ no:'L18', od:914, t:19.1, L:18288, qty:40, start:'2026-03-02 08:00' }],
  '동시가동(BOTH)': [{ no:'B1', od:1067, t:19.6, L:18288, qty:30, start:'2026-03-02 08:00' },
                     { no:'B2', od:914,  t:16,   L:17770, qty:25, start:'2026-03-02 08:00' }],
  'Gap Press(t>25)': [{ no:'G1', od:1219, t:31.8, L:12192, qty:35, start:'2026-03-02 08:00' },
                      { no:'G2', od:762,  t:37.3, L:12802, qty:20, start:'2026-03-02 08:00' }],
  '규격 전량 상이': ORDERS.slice(0, 20).map((o, i) =>
      spec({ ...o, no:'D-'+i, od: 508 + i * 36, t: 9.5 + i * 1.3, qty: 4 })),
};

/* ── 설정 25종 ────────────────────────────────────────────────── */
const PLAN = A.optimizeExpander(ORDERS, BASE, { weights:{cmax:1,setup:1.4,bal:0.25}, iters:6000 });
const STO = { on:true, cvTime:0.15, cvSetup:0.25, pDefect:0.05, pWeld:0.65, maxRework:2,
              mtbfH:200, mttrH:1.5, repairSec:1800, reweldSec:3600, expIssueSec:2700 };
const CFGS = [
  ['기본 (2근·EAT)', {}],
  ['교대 1근', { shifts:1 }], ['교대 2근연장', { shifts:'2E' }], ['교대 3근', { shifts:3 }],
  ['주말 비가동', { skipWeekend:true }],
  ['실가동 6h/shift', { netHoursPerShift:6 }],
  ['CP 투입', { useCP:true }],
  ['전환시간 OFF', { changeover:false }],
  ['R/B force', { rbMode:'force' }], ['R/B capable', { rbMode:'capable' }], ['R/B off', { rbMode:'off' }],
  ['R/B 전용 후처리', { rbMode:'capable', rbPost:'dedicated' }],
  ['확관 3호기', { useM3:true }],
  ['동일외경 제약 OFF', { sameODConcurrency:false }],
  ['프로세싱 2차 U.T', { processingFinalUT:true }],
  ['API5L 대리변수 OFF', { api5lProxy:false }],
  ['배분 RR', { dispatchRule:'RR' }], ['배분 SETUP', { dispatchRule:'SETUP' }],
  ['배분 SPEC', { dispatchRule:'SPEC' }],
  ['배분 OPT', { dispatchRule:'OPT', plan:PLAN }],
  ['순차 투입 8h', { dateMode:'seq', seqGapH:8 }],
  ['마감일 지정', { deadline:'2026-03-20' }],
  ['확관 셋업 legacy', { expSetupMode:'legacy' }],
  ['확관 제약 ppt', { expRuleSet:'ppt' }],
  ['변동성 ON (재작업)', { stochastic:STO, seed:7 }],
];

/* 항등식 검사 한 판 */
function identity(orders, cfg) {
  let S; try { S = A.simulate(orders, cfg); } catch (e) { return { err: e.message }; }
  let bBar = 0, bPipe = 0, bRow = 0, worst = 0, n = 0, rework = 0;
  for (const o of orders) {
    const Tb = A.orderTimeSplit(S, o.no);
    if (Tb && Math.abs(Tb.work + Tb.setup + Tb.wait + Tb.closed - Tb.total) > TOL) bBar++;
    for (let k = 1; k <= o.qty; k++) {
      const p = A.pipeTimeSplit(S, o.no, k); if (!p) continue; n++;
      if (Math.abs(p.work + p.setup + p.wait + p.closed - p.total) > TOL) bPipe++;
      const rw = p.rows.reduce((a,r)=>a+r.wait,0), rs = p.rows.reduce((a,r)=>a+r.setup,0), rk = p.rows.reduce((a,r)=>a+r.work,0);
      const d = Math.max(Math.abs(rw-p.wait), Math.abs(rs-p.setup), Math.abs(rk-p.work));
      if (d > TOL) bRow++;
      if (d > worst) worst = d;
      if (p.rows.length > new Set(p.rows.map(r=>r.nid)).size) rework++;
    }
  }
  return { S, bad: bBar + bPipe + bRow, bBar, bPipe, bRow, worst, n, rework };
}

console.log(`계획서 ${ORDERS.length}오더 · ${ORDERS.reduce((a,o)=>a+o.qty,0).toLocaleString()}본\n`);

/* ── A. 항등식 ───────────────────────────────────────────────── */
console.log('── A. 항등식 — 가공+전환+대기+비가동 = 실제 시간 ──');
{
  let bad = 0, cases = 0, pipes = 0, worst = 0, rework = 0;
  const broken = [];
  for (const [cl, cp] of CFGS) {
    const r = identity(ORDERS, { ...BASE, ...cp });
    cases++;
    if (r.err) { bad++; broken.push(`${cl}: 예외 ${r.err}`); continue; }
    pipes += r.n; rework += r.rework;
    if (r.worst > worst) worst = r.worst;
    if (r.bad) { bad++; broken.push(`${cl}: 막대${r.bBar} 본${r.bPipe} 공정표${r.bRow} (최대 ${r.worst.toFixed(0)}s)`); }
  }
  ok('A1 설정 25종에서 항등식이 성립한다', bad === 0,
     bad ? broken.slice(0,3).join(' | ') : `${cases}종 · ${pipes.toLocaleString()}본 · 최대 차 ${worst.toFixed(1)}초`);
  ok('A2 재작업 루프(같은 공정 2회 통과)에서도 성립한다', rework > 0,
     `재작업 본 ${rework.toLocaleString()}개 검사`);

  bad = 0; const b2 = [];
  for (const name in SETS) {
    const r = identity(SETS[name], BASE);
    if (r.err || r.bad) { bad++; b2.push(`${name}: ${r.err || `막대${r.bBar} 본${r.bPipe} 공정표${r.bRow}`}`); }
  }
  ok('A3 오더셋 6종(1본·18M·동시가동·Gap Press·규격 전량 상이)에서 성립한다', bad === 0,
     bad ? b2.join(' | ') : Object.keys(SETS).join(' · '));
}

/* ── B. 값의 출처 ────────────────────────────────────────────── */
console.log('\n── B. 출처 — 가공은 산식, 전환은 공구 계층 ──');
const S0 = A.simulate(ORDERS, BASE);
{
  let bad = 0, all = 0, worstB = null;
  for (const o of ORDERS) {
    const ev = S0.events.filter(e => String(e.o) === String(o.no));
    for (let k = 1; k <= o.qty; k++) {
      const mine = ev.filter(e => e.k === k); if (!mine.length) continue;
      const exp = mine.find(e => e.n === 'EXP' || e.n === 'RB');
      const V = A.verifyOrder(o.no, BASE, { k, seqGlobal: mine[0].g, machine: exp ? exp.mach : null });
      if (!V) continue;
      const first = {};
      for (const e of mine) if (first[e.n] == null) first[e.n] = e.d;
      for (const st of V.steps) {
        const a = first[st.nid]; if (a == null) continue;
        all++;
        const d = Math.abs(st.sec - a);
        if (d > 1) { bad++; if (!worstB || d > worstB.d) worstB = { no:o.no, nid:st.nid, d }; }
      }
    }
  }
  ok('B1 가공시간 = 「산식 검증」 화면이 보여 주는 값', bad === 0,
     bad ? `${bad}/${all} 불일치 · 최악 ${worstB.no} ${worstB.nid}` : `${all.toLocaleString()}건 전부 일치`);
}
{
  let bad = 0, n = 0, zeroButDiff = 0, posButSame = 0;
  const last = {};
  for (const e of S0.events.slice().sort((a,b) => a.s - b.s)) {
    const nd = A.NODE[e.n]; if (!nd || nd.free || !nd.st) continue;
    const o = ORDERS.find(x => String(x.no) === String(e.o));
    const sp = { od: Math.trunc(o.od), t: Math.round(o.t*100)/100, L: o.L };
    const key = e.n + '#' + e.u, prev = last[key];
    const want = prev ? A.changeoverSec(nd.st, prev, sp, nd.st === 'Expander' ? (nd.machine || e.mach) : null) : 0;
    if (!e.both) {
      n++;
      if (Math.abs(e.co - want) > 1) bad++;
      /* 규격이 같은데 전환이 붙었나 / 규격이 다른데 전환이 0 인가 */
      const same = prev && Math.abs(prev.od-sp.od) < 0.5 && Math.abs(prev.t-sp.t) < 0.5 && Math.abs(prev.L-sp.L) < 1;
      if (same && e.co > 1) posButSame++;
      if (prev && !same && e.co === 0 && want > 0) zeroButDiff++;
    }
    last[key] = sp;
  }
  ok('B2 전환시간 = changeoverSec 독립 재계산', bad === 0, `${n.toLocaleString()}건 중 불일치 ${bad}`);
  ok('B3 직전과 규격이 같으면 전환이 붙지 않는다', posButSame === 0, `${posButSame}건`);
  ok('B3 규격이 다른데 전환이 0 인 경우가 없다', zeroButDiff === 0, `${zeroButDiff}건`);
  const s2 = A.changeoverSec('PreBender', {od:914,t:20,L:12000}, {od:1016,t:31.8,L:12000});
  ok('B4 공구 계층은 상위 하나만 (합산 아님)', s2 === 1800, `${s2}s — od 1800 / t 900, 합산이면 2700`);
}

/* ── C. 집계 ─────────────────────────────────────────────────── */
console.log('\n── C. 집계 — 설비별 합계 = 이벤트 합 ──');
{
  let bad = 0;
  for (const st of S0.stats) {
    const ev = S0.events.filter(e => e.n === st.id);
    const d = ev.reduce((a,e) => a + e.d * (e.both ? 2 : 1), 0) / 3600;   // BOTH 는 2대 점유
    const co = ev.reduce((a,e) => a + e.co, 0) / 3600;
    if (Math.abs(d - st.busyH) > 0.05 || Math.abs(co - st.setupH) > 0.05) {
      bad++; console.log(`   ✗ ${st.label.replace('\n',' ')} 가공 ${d.toFixed(1)}≠${st.busyH.toFixed(1)} · 전환 ${co.toFixed(1)}≠${st.setupH.toFixed(1)}`);
    }
  }
  ok('C1 설비별 가공·전환 = 이벤트 합 (BOTH 는 2대 점유)', bad === 0, `설비 ${S0.stats.length}개 중 불일치 ${bad}`);
  const wall = S0.events.filter(e => e.n === 'EXP').reduce((a,e) => a + e.co, 0) / 3600;
  ok('C2 확관 전환 벽시계 = KPI (BOTH 이중계상 없음)', Math.abs(wall - S0.kpi.expSetupH) < 0.05,
     `${wall.toFixed(1)}h = ${S0.kpi.expSetupH.toFixed(1)}h`);
  /* 가동률 정의 검산.
     util      = 호기별 (가공+전환)/가용 의 **최댓값** — 호기 편중을 가리지 않으려고 평균이 아닌 최댓값을 쓴다.
     utilAvg   = (가공 호기합 + 전환 벽시계) / (대수 × 가용) — 노드 전체 평균.
     둘은 호기 부하가 다르면 당연히 다르다(확관 71.3 vs 69.7). 그래서 각각 따로 검산한다. */
  let bu = 0, bv = 0, bs = 0;
  for (const st of S0.stats) {
    const avail = (A.RB_LINE.has(st.id) ? S0.calRB : S0.cal).capBetween(S0.t0, S0.tEnd);
    const uu = st.units.map(u => (u.busyH + u.setupH) * 3600 / avail * 100);
    const umax = Math.max(...uu);
    if (Math.abs(umax - st.util) > 0.05) {
      bu++; console.log(`   ✗ ${st.label.replace('\n',' ')} util ${umax.toFixed(2)} vs ${st.util.toFixed(2)}`);
    }
    const av = (st.busyH + st.setupH) * 3600 / st.cap / avail * 100;
    if (Math.abs(av - st.utilAvg) > 0.05) {
      bv++; console.log(`   ✗ ${st.label.replace('\n',' ')} utilAvg ${av.toFixed(2)} vs ${st.utilAvg.toFixed(2)}`);
    }
    const sb = st.units.reduce((a,u) => a + u.busyH, 0);
    const ss = st.units.reduce((a,u) => a + u.setupH, 0);
    if (Math.abs(sb - st.busyH) > 0.02 || Math.abs(ss - st.setupUnitsH) > 0.02) {
      bs++; console.log(`   ✗ ${st.label.replace('\n',' ')} 호기합 ${sb.toFixed(2)}/${ss.toFixed(2)} vs ${st.busyH.toFixed(2)}/${st.setupUnitsH.toFixed(2)}`);
    }
  }
  ok('C3 util = 호기별 (가공+전환)/가용 의 최댓값', bu === 0, `설비 ${S0.stats.length}개 중 불일치 ${bu}`);
  ok('C4 utilAvg = (가공 호기합 + 전환 벽시계) / (대수 × 가용)', bv === 0, `설비 ${S0.stats.length}개 중 불일치 ${bv}`);
  ok('C5 호기별 합계 = 노드 합계 (점유 기준)', bs === 0, `설비 ${S0.stats.length}개 중 불일치 ${bs}`);
  /* 전환 벽시계 ≤ 호기 점유합. BOTH 가 있는 노드에서만 엄격히 작아야 한다. */
  const expSt = S0.stats.find(s => s.id === 'EXP');
  ok('C6 확관 전환 벽시계 < 호기 점유합 (BOTH 이중계상 분리)',
     !!expSt && expSt.setupH < expSt.setupUnitsH - 0.5,
     expSt ? `벽시계 ${expSt.setupH.toFixed(1)}h < 점유합 ${expSt.setupUnitsH.toFixed(1)}h` : 'EXP 없음');
}

/* ── D. 인과 ─────────────────────────────────────────────────── */
console.log('\n── D. 인과 — 「대기」가 정말 대기인가 ──');
{
  /* 대기 구간 [r,cs) 동안 그 본은 아직 그 공정을 지나지 않았고, 앞 공정은 끝나 있어야 한다 */
  let bad = 0, n = 0;
  for (const e of S0.events) {
    if (e.cs < e.r - 1) bad++;                 // 설비를 준비되기 전에 잡을 수는 없다
    if (e.s < e.cs - 1) bad++;                 // 작업이 설비 확보보다 먼저일 수 없다
    if (e.e < e.s - 1) bad++;
    n++;
  }
  ok('D1 시각 순서가 r ≤ cs ≤ s ≤ e 를 지킨다', bad === 0, `${n.toLocaleString()}건 중 위반 ${bad}`);

  /* 앞 공정 종료 = 다음 공정 준비 (빈틈 없음) */
  let gap = 0, chk = 0;
  for (const o of ORDERS) for (let k = 1; k <= o.qty; k++) {
    const ev = S0.events.filter(x => String(x.o) === String(o.no) && x.k === k).sort((a,b)=>a.s-b.s);
    for (let i = 1; i < ev.length; i++) { chk++; if (Math.abs(ev[i].r - ev[i-1].e) > 1) gap++; }
  }
  ok('D2 앞 공정 종료 = 다음 공정 준비 (시간축에 빈틈 없음)', gap === 0, `${chk.toLocaleString()}쌍 중 어긋남 ${gap}`);

  /* 설비가 놀고 있는데 «적격한» 본이 기다린 시간 — 작업 보존 위반 계량 */
  const eligOf = {};
  for (const o of ORDERS) { const sp = A.specOf(o, BASE); eligOf[o.no] = A.expanderMode(sp, BASE); }
  const byNU = {}, byN = {};
  for (const e of S0.events) { (byNU[e.n+'#'+e.u] = byNU[e.n+'#'+e.u] || []).push(e); (byN[e.n] = byN[e.n] || []).push(e); }
  let viol = 0; const perNode = {};
  for (const key in byNU) {
    const [nid, uS] = key.split('#'), u = +uS;
    const ev = byNU[key].slice().sort((a,b) => a.cs - b.cs);
    const cal = A.RB_LINE.has(nid) ? S0.calRB : S0.cal;
    for (let i = 1; i < ev.length; i++) {
      const g0 = ev[i-1].e, g1 = ev[i].cs; if (g1 - g0 <= 1) continue;
      const open = cal.capBetween(g0, g1); if (open < 60) continue;
      const cand = byN[nid].filter(x => x.r <= g0 && x.cs >= g1);
      if (!cand.length) continue;
      const fit = cand.some(c => {
        if (nid !== 'EXP') return true;
        const el = eligOf[c.o] || eligOf[String(c.o).replace(/-\d+$/,'')];
        if (!el) return true;
        if (el.mode === 'BOTH') return false;
        const mk = A.EXP_MACHINES[u] && A.EXP_MACHINES[u].key;
        return !mk || el.list.includes(mk);
      });
      if (fit) { viol += open; perNode[nid] = (perNode[nid] || 0) + open; }
    }
  }
  const capTot = S0.stats.reduce((a,s) => a + s.cap, 0) * S0.cal.capBetween(S0.t0, S0.tEnd);
  ok('D3 작업 보존 위반(설비 유휴 + 적격 대기)이 총 설비능력의 5% 미만',
     viol / capTot < 0.05, `${h(viol)} / 총 능력 ${h(capTot)} = ${(viol/capTot*100).toFixed(2)}%`);
  console.log('   ※ 본 단위 순차 확정 방식의 특성 — 설비별:');
  Object.entries(perNode).sort((a,b)=>b[1]-a[1]).slice(0,4).forEach(([n2,v]) => {
    const st = S0.stats.find(x => x.id === n2), nd = A.NODE[n2] || { label:n2 };
    const cap2 = (st ? st.cap : 1) * S0.cal.capBetween(S0.t0, S0.tEnd);
    console.log(`      ${nd.label.replace('\n',' ').padEnd(14)} ${h(v).padStart(8)}  (그 설비 능력의 ${(v/cap2*100).toFixed(1)}%)`);
  });
}

/* ── E. 불변식 ───────────────────────────────────────────────── */
console.log('\n── E. 불변식 — 있어야 할 성질 ──');
const totWait = (S, orders) => {
  let w = 0; for (const o of orders) for (let k = 1; k <= o.qty; k++)
    { const p = A.pipeTimeSplit(S, o.no, k); if (p) w += p.wait; } return w;
};
{
  const S1 = A.simulate(ORDERS, { ...BASE, changeover:false });
  const co = S1.events.reduce((a,e) => a + e.co, 0);
  const su = S1.stats.reduce((a,s) => a + s.setupH, 0);
  ok('E1 전환시간을 끄면 전환이 정확히 0', co === 0 && su === 0, `이벤트 Σco=${co} · 설비 Σ=${su.toFixed(2)}h`);

  const w0 = totWait(S0, ORDERS);
  A.setRefCap({ PACK:3, HYD:2, EF:2 });
  const S2 = A.simulate(ORDERS, BASE); const w2 = totWait(S2, ORDERS);
  A.setRefCap({});
  ok('E2 병목 설비를 늘리면 총 대기가 줄어든다', w2 < w0, `${h(w0)} → ${h(w2)} (${((w2-w0)/w0*100).toFixed(1)}%)`);

  const S3 = A.simulate(ORDERS, { ...BASE, dateMode:'seq', seqGapH:8 });
  ok('E3 순차 투입하면 총 대기가 줄어든다', totWait(S3, ORDERS) < w0,
     `${h(w0)} → ${h(totWait(S3, ORDERS))}`);

  const a1 = A.simulate(ORDERS, BASE), a2 = A.simulate(ORDERS, BASE);
  ok('E4 같은 입력이면 결과가 완전히 같다 (결정론)',
     JSON.stringify(a1.stats) === JSON.stringify(a2.stats) && a1.tEnd === a2.tEnd, `완료 ${(a1.kpi.makespanH/24).toFixed(4)}일`);

  A.setRefStd({ Packing: { base: 1268 } });                   // 634 → 2배
  const S4 = A.simulate(ORDERS, BASE);
  const pk0 = S0.stats.find(x=>x.id==='PACK').busyH, pk4 = S4.stats.find(x=>x.id==='PACK').busyH;
  A.setRefStd({});
  ok('E5 표준시간을 2배로 하면 그 설비의 가공시간이 늘어난다', pk4 > pk0 * 1.5,
     `포장 가공 ${pk0.toFixed(0)}h → ${pk4.toFixed(0)}h`);

  /* 전환을 끄면 대기는 늘 수 없다(같거나 줄어야) — 전환이 사라진 만큼 설비가 빨리 빈다 */
  ok('E6 전환을 끄면 총 대기가 늘지 않는다', totWait(S1, ORDERS) <= w0 * 1.001,
     `${h(w0)} → ${h(totWait(S1, ORDERS))}`);
}

/* ── F. 경계 ─────────────────────────────────────────────────── */
console.log('\n── F. 경계 ──');
{
  const S5 = A.simulate(SETS['동시가동(BOTH)'], BASE);
  const bothEv = S5.events.filter(e => e.both);
  ok('F1 동시가동(BOTH) 본이 실제로 생긴다', bothEv.length > 0, `${bothEv.length}건`);
  let bad = 0;
  for (const o of SETS['동시가동(BOTH)']) for (let k = 1; k <= o.qty; k++) {
    const p = A.pipeTimeSplit(S5, o.no, k); if (!p) continue;
    if (Math.abs(p.work + p.setup + p.wait + p.closed - p.total) > TOL) bad++;
  }
  ok('F1 동시가동 본의 항등식', bad === 0, `불일치 ${bad}`);

  const S6 = A.simulate(ORDERS, { ...BASE, rbMode:'capable' });
  const rbPipes = new Set(S6.events.filter(e => A.RB_LINE.has(e.n)).map(e => e.o + '|' + e.k));
  ok('F2 R/B 경유 본이 실제로 생긴다 (두 캘린더 혼용)', rbPipes.size > 0, `${rbPipes.size}본`);
  bad = 0;
  for (const o of ORDERS) for (let k = 1; k <= o.qty; k++) {
    if (!rbPipes.has(o.no + '|' + k)) continue;
    const p = A.pipeTimeSplit(S6, o.no, k); if (!p) continue;
    const rw = p.rows.reduce((a,r)=>a+r.wait,0);
    if (Math.abs(p.work+p.setup+p.wait+p.closed-p.total) > TOL || Math.abs(rw-p.wait) > TOL) bad++;
  }
  ok('F2 R/B 경유 본의 항등식 (본류 12공정 + R/B 4공정)', bad === 0, `${rbPipes.size}본 중 불일치 ${bad}`);

  const S7 = A.simulate(SETS['Gap Press(t>25)'], BASE);
  ok('F3 Gap Press 경유 본이 실제로 생긴다', S7.events.some(e => e.n === 'GAP'),
     `${S7.events.filter(e=>e.n==='GAP').length}건`);

  const S8 = A.simulate(SETS['1본 오더만'], BASE);
  let one = 0;
  for (const o of SETS['1본 오더만']) { const p = A.pipeTimeSplit(S8, o.no, 1); if (p) one++; }
  ok('F4 1본 오더도 분해가 나온다', one === SETS['1본 오더만'].length, `${one}/${SETS['1본 오더만'].length}`);

  const S9 = A.simulate(ORDERS, { ...BASE, stochastic:STO, seed:7 });
  let rwPipes = 0;
  for (const o of ORDERS) for (let k = 1; k <= o.qty; k++) {
    const p = A.pipeTimeSplit(S9, o.no, k); if (!p) continue;
    if (p.rows.length > new Set(p.rows.map(r=>r.nid)).size) rwPipes++;
  }
  ok('F5 재작업 루프가 실제로 발생한다 (같은 공정 2회)', rwPipes > 0, `${rwPipes}본`);
}

/* ── 요약 ────────────────────────────────────────────────────── */
console.log('\n── 계획서 전체 시간 구성 (기본 설정) ──');
{
  let w = 0, s2 = 0, wt = 0, c = 0, n = 0;
  for (const o of ORDERS) for (let k = 1; k <= o.qty; k++) {
    const p = A.pipeTimeSplit(S0, o.no, k); if (!p) continue;
    w += p.work; s2 += p.setup; wt += p.wait; c += p.closed; n++;
  }
  const tot = w + s2 + wt + c;
  const row = (l, v) => console.log(`   ${l.padEnd(22)} ${h(v).padStart(11)}  ${(v/tot*100).toFixed(1).padStart(5)}%   본당 ${(v/n/3600).toFixed(2)}h`);
  console.log(`   본 ${n.toLocaleString()}개의 리드타임 합계 ${h(tot)}`);
  row('가공 (표준시간)', w); row('전환 (공구·다이 교체)', s2);
  row('대기 (앞 공정·설비 점유)', wt); row('비가동 (교대·주말)', c);
}

console.log(fail ? `\n${fail}건 FAIL` : '\n전 항목 PASS');
process.exit(fail ? 1 : 0);
