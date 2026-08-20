#!/usr/bin/env node
/**
 * 2026-08-19 전수 감사 회귀 방지 (node 전용 항목)
 *
 * 이번 감사에서 실제로 재현된 결함이 되살아나지 않는지 봅니다.
 * 브라우저가 필요한 항목은 verify_vfedit2.js 에 있습니다.
 *
 *   node tools/verify_audit2.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));
const ORDERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/orders.json'), 'utf8'));
const engine = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8');
const flow = fs.readFileSync(path.join(ROOT, 'src/flow.js'), 'utf8');

const E = new Function('T', engine + '\nreturn { STD, setRefTbl, setRefStd, changeoverSec, refTblKeyValid, REF };')(T);
const F = new Function('T', 'ORDERS', engine + '\n' + flow +
  '\nreturn { simulate, verifyOrder, setRefTbl, setRefStd, STD };')(T, ORDERS);

let fail = 0;
const ok = (name, cond, extra) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra != null ? '  ' + extra : ''}`); };
const CFG = { startDate:'2026-03-02', shifts:2, netHoursPerShift:7.5, skipWeekend:false, useRB:true,
  useCP:false, processingFinalUT:false, holdSec:60, changeover:true, freeStationSec:300,
  eventCap:1e9, sameODConcurrency:true, useM3:false, dispatchRule:'EAT' };
const SPEC = { od:914, t:9.3, L:12802, qty:70, grade:'normal', api5l:true, markSpec:2, markEnd:2,
               defects:0, holdSec:60, rtType:'450kV' };

/* ── A. 산식 표기 ───────────────────────────────────────────────── */
console.log('── A. 산식 표기 ──');
{
  const t = E.STD.GapPress({ od:914, t:31.8, L:12802, grade:'normal' }).tpl;
  ok('A1 Gap Press 적용 산식에 템플릿 리터럴이 새지 않는다', !/\$\{/.test(t), t.slice(-40));
}
{
  /* 모든 STD 의 tpl·subst 에 `${` 가 없어야 한다 */
  let leak = [];
  for (const k of Object.keys(E.STD)) {
    if (typeof E.STD[k] !== 'function') continue;
    for (const g of ['normal','high','hiMn']) for (const rt of ['450kV','320kV','End-RT'])
      for (const m of (k === 'Expander' ? ['M1','M2','RB','BOTH'] : [null])) {
        const s = { ...SPEC, grade:g, rtType:rt, t: g === 'high' ? 31.8 : 9.3 };
        const r = m ? E.STD[k](s, m, {}) : E.STD[k](s, '12M', 1, 1);
        if (/\$\{/.test(r.tpl) || /\$\{/.test(r.subst)) leak.push(k + '/' + g + '/' + rt + (m ? '/' + m : ''));
      }
  }
  ok('A2 전 공정·전 분기에서 산식 문자열에 코드 조각이 없다', leak.length === 0, leak.join(', ') || '누출 0');
}
{
  const r = E.STD.Expander({ od:300, t:5, L:1, heat:false }, 'RB', {});
  const m = /=\s*([\d.]+)\s*s$/.exec(r.subst);
  ok('A3 R/B 확관 표기식이 max(N−2,0) 클램프를 반영한다', Math.abs(+m[1] - r.sec) < 1,
     `표기 ${m[1]} / 엔진 ${r.sec}`);
}
{
  E.setRefTbl({ 'insideWeld|2|2': 0.0004 });
  const r = E.STD.InsideWelder({ od:914, t:9.3, L:14074.225 }, '12M');
  E.setRefTbl({});
  ok('A4 아주 작은 값이 「/0」 으로 찍히지 않는다', !/\/0[\s+)]|\/0$/.test(r.subst), r.subst);
}

/* ── B. 계산 정확성 ─────────────────────────────────────────────── */
console.log('\n── B. 계산 정확성 ──');
{
  /* 세아제강 2026-08-06 확정: 셋업은 상위값만, 합산 아님 */
  const s = E.changeoverSec('PreBender', { od:914, t:20, L:12000 }, { od:1016, t:31.8, L:12000 });
  ok('B1 전환시간은 od·t·L 중 가장 큰 값 하나만 (합산 아님)', s === 1800, `${s}s (od 1800 / t 900)`);
  const s2 = E.changeoverSec('PreBender', { od:914, t:20, L:12000 }, { od:914, t:31.8, L:12000 });
  ok('B1 두께만 달라지면 두께 값', s2 === 900, `${s2}s`);
}
{
  /* 선단 여유가 관 길이보다 커도 성형 횟수는 음수가 되지 않는다 */
  E.setRefStd({ PreBender: { lead: 20000 } });
  const r = E.STD.PreBender({ od:914, t:9.3, L:12802 }, '18M');
  E.setRefStd({});
  ok('B2 Pre Bender 성형 횟수가 음수가 되지 않는다', r.sec > 0 && !/×\s*-/.test(r.subst),
     `${r.sec.toFixed(1)}s · ${r.subst}`);
}
{
  const long = E.STD.HydroTest({ od:914, t:9.3, L:18288, holdSec:60 }).vars.find(v => v[0] === '충수 시간(s)');
  ok('B3 18m 이상 제품도 충수시간 칸을 편집할 수 있다', !!(long && long[3] && long[3].key), long && long[3] && long[3].key);
}

/* ── C. 표 재정의 방어 ──────────────────────────────────────────── */
console.log('\n── C. 엑셀 표 재정의 방어 ──');
{
  const base = E.STD.TackWelder(SPEC, '12M').sec;
  for (const v of [0, -1, -0, Infinity, NaN, '5', null, true, [7]]) {
    E.setRefTbl({ 'tackWeld|1|2': v });
    const got = E.STD.TackWelder(SPEC, '12M').sec;
    if (Math.abs(got - base) > 1e-9) { ok(`C1 잡값 ${JSON.stringify(v)} 이 그대로 먹힌다`, false, `${got}`); }
  }
  E.setRefTbl({});
  ok('C1 0·음수·비수치 재정의가 전부 무시된다', true, '9종 검사');
  E.setRefTbl({ 'tackWeld|1|2': 30 });
  const chg = E.STD.TackWelder(SPEC, '12M').sec;
  E.setRefTbl({});
  ok('C1 정상 양수는 반영된다', Math.abs(chg - base) > 1, `${base.toFixed(0)} → ${chg.toFixed(0)}`);
}
{
  const good = ['tackWeld|0|2','insideWeld|1|3','emSpeed|0|high','pressX1|30','hydroFill|36',
                'hydroConst|airVent_36up','endFacing|5|3','emFeed|0|2','preBenderPitch|0|2','utCut|0|2'];
  const bad  = ['insideWeld|3','insideWeld|03|2','emFeed|1','constructor|name','tackWeld|length',
                'dieSpec|M1','expanderDie|18','packingMarking|markSpec','endFacingTC|x',
                'hydroConst|pressureRise','tackWeld|0|0','tackWeld|0|3','emSpeed|0|tmin',
                'tackWeld|0.0|2','tackWeld|00|2','tackWeld| 0|2','tackWeld|1e0|2','__proto__|toString',
                'tackWeld|999|2','없는표|0|2','tackWeld|0|2|3','tackWeld|-1|2'];
  ok('C2 정상 키는 전부 통과', good.every(k => E.refTblKeyValid(k)), good.filter(k => !E.refTblKeyValid(k)).join(', ') || `${good.length}개`);
  ok('C2 먹통·위조 키는 전부 거부', bad.every(k => !E.refTblKeyValid(k)), bad.filter(k => E.refTblKeyValid(k)).join(', ') || `${bad.length}개`);
}
{
  /* 엔진이 실제로 만드는 키는 하나도 빠짐없이 유효해야 한다 */
  const keys = new Set();
  for (let i = 0; i < 1500; i++) {
    const s = { od:200+((i*97)%1500), t:1+((i*13)%60), L:1000+((i*811)%20000), qty:1+(i%300),
      grade:['normal','high','hiMn'][i%3], api5l:i%2===0, markSpec:1+i%2, markEnd:1+i%2,
      defects:i%4, holdSec:60, rtType:['450kV','320kV','End-RT'][i%3] };
    for (const k of Object.keys(E.STD)) {
      if (typeof E.STD[k] !== 'function') continue;
      const calls = k === 'Expander' ? [[s,'M1',{}],[s,'M2',{}],[s,'RB',{}],[s,'BOTH',{}]] : [[s, i%2?'12M':'18M', i%20, 1+i%5]];
      for (const a of calls) { let r; try { r = E.STD[k].apply(null, a); } catch (e) { continue; }
        for (const v of (r.vars || [])) if (v[3] && v[3].key) keys.add(v[3].key); }
    }
  }
  const miss = [...keys].filter(k => !E.refTblKeyValid(k));
  ok('C3 엔진이 만드는 모든 편집 키가 유효 판정된다', miss.length === 0, `${keys.size}개 중 미통과 ${miss.length}`);
}

/* ── D. 산식 검증이 시뮬레이션과 같은 값을 보여주는가 ──────────── */
console.log('\n── D. 산식 검증 ↔ 시뮬레이션 일치 ──');
{
  const S = F.simulate(ORDERS, CFG);
  ok('D0 이벤트에 전역 누적 본 번호(g)가 실린다', S.events.every(e => typeof e.g === 'number'),
     `표본 g=${S.events[0].g}`);

  /* 화면이 하는 것과 **똑같이** — 그 본의 실제 호기·전역순번을 이벤트에서 꺼내 넘긴다 */
  let bad = 0, all = 0, worst = null;
  for (const o of ORDERS) {
    const ev = S.events.filter(e => String(e.o) === String(o.no));
    for (let k = 1; k <= o.qty; k++) {
      const mine = ev.filter(e => e.k === k);
      if (!mine.length) continue;
      const expEv = mine.find(e => e.n === 'EXP' || e.n === 'RB');
      const V = F.verifyOrder(o.no, CFG, { k, seqGlobal: mine[0].g, machine: expEv ? expEv.mach : null });
      if (!V) continue;
      const first = {};
      for (const e of mine) if (first[e.n] == null) first[e.n] = e.d;
      for (const st of V.steps) {
        const a = first[st.nid]; if (a == null) continue;
        all++;
        const d = Math.abs(st.sec - a);
        if (d > 1) { bad++; if (!worst || d > worst.d) worst = { no:o.no, k, nid:st.nid, d, scr:st.sec, real:a }; }
      }
    }
  }
  ok('D1 전 오더·전 본·전 공정에서 산식 결과 = 시뮬레이션 실행값', bad === 0,
     bad ? `${bad}/${all} 불일치 · 최악 ${worst.no} k=${worst.k} ${worst.nid} 화면 ${worst.scr.toFixed(0)}s vs 실제 ${worst.real.toFixed(0)}s`
         : `${all.toLocaleString()}건 전부 일치`);

  /* 오더 안에서 확관 호기가 갈리는 것을 실제로 확인 — 이 전제가 깨지면 D1 이 무의미해진다 */
  const mix = new Set();
  const byO = {};
  for (const e of S.events) if (e.n === 'EXP' || e.n === 'RB') (byO[e.o] = byO[e.o] || new Set()).add(e.mach);
  for (const k in byO) if (byO[k].size > 1) mix.add(k);
  ok('D2 오더 안에서 확관 호기가 갈리는 경우가 실제로 존재한다 (본 단위 재현이 필요한 이유)',
     mix.size > 0, `${mix.size}/${Object.keys(byO).length} 오더 혼재`);
}

console.log(fail ? `\n${fail}건 FAIL` : '\n전 항목 PASS');
process.exit(fail ? 1 : 0);
