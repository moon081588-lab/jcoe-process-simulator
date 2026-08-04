/* =====================================================================
   JCOE 공정 흐름 그래프 — 세아제강 다이어그램(PPT) 기반
   좌표계 1600 × 860
   kind: 'proc' | 'dec' | 'buf' | 'end'
   ===================================================================== */
const NODES = [
  /* ---- 조관 라인 (12M / 18M 병렬) ---- */
  { id:'EM12',  label:'12M E/M',  sub:'Edge Miller', st:'EdgeMiller', line:'12M', kind:'proc', x:80,  y:80,  cap:1 },
  { id:'EM18',  label:'18M E/M',  sub:'Edge Miller', st:'EdgeMiller', line:'18M', kind:'proc', x:80,  y:165, cap:1 },
  { id:'PB12',  label:'12M Pre Bender', st:'PreBender', line:'12M', kind:'proc', x:230, y:80,  cap:1 },
  { id:'PB18',  label:'18M Pre Bender', st:'PreBender', line:'18M', kind:'proc', x:230, y:165, cap:1 },
  { id:'PR12',  label:'12M Press Bender', st:'PressBender', line:'12M', kind:'proc', x:390, y:80,  cap:1 },
  { id:'PR18',  label:'18M Press Bender', st:'PressBender', line:'18M', kind:'proc', x:390, y:165, cap:1 },

  { id:'D1',    label:'후판 두께\n25T 초과', kind:'dec', x:554, y:110 },
  { id:'GAP',   label:'Gap Press', sub:'25T 초과 시 투입', st:'GapPress', kind:'proc', x:547, y:212, cap:1 },

  { id:'TACK',  label:'태그 웰딩*', sub:'간이 용접 · PCS=후판 수', st:'TackWelder', kind:'proc', x:700, y:110, cap:1 },
  { id:'ISAW',  label:'내면 SAW*',  sub:'Inside SAW', st:'InsideWelder',  kind:'proc', x:840,  y:110, cap:4 },
  { id:'SLUG',  label:'슬러그 제거', sub:'Outer bead removal', st:'OuterBead', kind:'proc', x:980,  y:110, cap:1 },
  { id:'OSAW',  label:'외면 SAW*',  sub:'Outside SAW', st:'OutsideWelder', kind:'proc', x:1120, y:110, cap:4 },
  { id:'CUT',   label:'관단탭 절단', kind:'proc', st:null, x:1270, y:110, cap:1, free:true },

  /* ---- 확관 라인 (우 → 좌) ---- */
  { id:'D2',    label:'단일 오더\nAPI 5L or\n50PCS 이상', kind:'dec', x:1418, y:307 },
  { id:'UT1',   label:'1차 U.T', st:'FirstUT', kind:'proc', x:1265, y:400, cap:1 },
  { id:'BUF',   label:'10번 문 적재', sub:'Buffer · Max 4,000톤', kind:'buf', x:1085, y:315 },
  { id:'D3',    label:'RB 라인\n투입 필요', kind:'dec', x:919, y:310 },
  { id:'RB',    label:'RB 라인 이동', sub:'t≤25T · OD≤24"', st:'Expander', machine:'RB', kind:'proc', x:912, y:405, cap:1 },
  { id:'EXP',   label:'Expander', sub:'JCOE 병목 공정', st:'Expander', kind:'proc', x:740, y:315, cap:2, bottleneck:true },
  { id:'D4',    label:'CP\n투입', kind:'dec', x:594, y:310 },
  { id:'CP',    label:'Calibration Press', kind:'proc', st:null, x:587, y:405, cap:1, free:true },
  { id:'EF',    label:'면취기', sub:'End-Facing', st:'EndFacing', kind:'proc', x:420, y:315, cap:1 },
  { id:'HYD',   label:'수압', sub:'Hydraulic Tester', st:'HydroTest', kind:'proc', x:255, y:315, cap:1 },

  /* ---- 검사 · 보수 · 출하 ---- */
  { id:'D5',    label:'API 5L\n제품', kind:'dec', x:104, y:520 },
  { id:'FUT',   label:'Final U.T', st:'FinalUT', kind:'proc', x:250, y:620, cap:1 },
  { id:'XE',    label:'관단 X-ray', st:'RT', kind:'proc', x:400, y:620, cap:1 },
  { id:'FX',    label:'F-X ray', sub:'Full Length (Max 3대)', st:'RT', kind:'proc', x:560, y:530, cap:2 },
  { id:'D6',    label:'불량', kind:'dec', x:700, y:528 },
  { id:'RP',    label:'Repair', kind:'proc', st:null, x:760, y:640, cap:1, free:true },
  { id:'D7',    label:'용접\n문제', kind:'dec', x:767, y:726 },
  { id:'RW',    label:'보수 용접', kind:'proc', st:null, x:760, y:810, cap:1, free:true },
  { id:'EP',    label:'Expander 문제', sub:'★ 병목 발생지', kind:'proc', st:null, x:1000, y:722, cap:1, free:true, bottleneck:true },
  { id:'PACK',  label:'포장 및 출하', st:'Packing', kind:'proc', x:1130, y:530, cap:1 },
];
const NODE = Object.fromEntries(NODES.map(n => [n.id, n]));

/* 연결선: [from, to, label, routing]  routing: 'h'|'v'|'hv'|'vh' */
const EDGES = [
  ['EM12','PB12','','h'], ['PB12','PR12','','h'],
  ['EM18','PB18','','h'], ['PB18','PR18','','h'],
  ['PR12','D1','','hv'],  ['PR18','D1','','hv'],
  ['D1','GAP','Yes','v'], ['GAP','TACK','','hv'], ['D1','TACK','No','h'],
  ['TACK','ISAW','','h'], ['ISAW','SLUG','','h'], ['SLUG','OSAW','','h'], ['OSAW','CUT','','h'],
  ['CUT','D2','','vh'],
  ['D2','UT1','Yes','vh'], ['UT1','BUF','','hv'], ['D2','BUF','No (By-pass)','vh'],
  ['BUF','D3','','h'],
  ['D3','RB','Yes','v'], ['D3','EXP','No','h'],
  ['RB','PACK','','C',{a:'r', b:'t', pts:[[1075,434],[1075,505],[1189,505]]}],
  ['EXP','D4','','h'],
  ['D4','CP','Yes','v'], ['CP','EF','','hv'], ['D4','EF','No','h'],
  ['EF','HYD','','h'], ['HYD','D5','','vh'],
  ['D5','FUT','Yes','vh'], ['FUT','XE','','h'], ['XE','FX','','hv'],
  ['D5','FX','By-pass (프로세싱 파이프)','h'],
  ['FX','D6','','h'], ['D6','PACK','No','h'],
  ['D6','RP','Yes','vh'], ['RP','D7','','v'],
  ['D7','RW','Yes','v'], ['D7','EP','No','h'],
  ['RW','FX','재검사','C',{a:'l', b:'b', pts:[[622,833]]}],
  ['EP','EXP','재확관','C',{a:'t', b:'b', pts:[[1059,492],[799,492]]}],
];

/* --------------------------------------------------------------------
   라우팅: 제품 사양 → 통과 노드 시퀀스
   -------------------------------------------------------------------- */
function routeOf(s, cfg) {
  const Lm = s.L / 1000;
  const line = Lm > 13 ? '18M' : '12M';
  const r = [];
  r.push(line === '18M' ? 'EM18' : 'EM12');
  r.push(line === '18M' ? 'PB18' : 'PB12');
  r.push(line === '18M' ? 'PR18' : 'PR12');
  if (s.t > 25) r.push('GAP');                       // D1: 후판 두께 25T 초과
  r.push('TACK', 'ISAW', 'SLUG', 'OSAW', 'CUT');
  if (s.api5l || s.qty >= 50) r.push('UT1');         // D2
  r.push('BUF');
  const rbOK = s.t <= 25 && odInch(s.od) <= 24;      // D3: RB 라인 투입 조건
  r.push(rbOK && cfg.useRB ? 'RB' : 'EXP');
  if (r[r.length - 1] === 'EXP') {
    if (cfg.useCP) r.push('CP');                     // D4
    r.push('EF', 'HYD');
    if (s.api5l) r.push('FUT', 'XE');                // D5
    else if (cfg.processingFinalUT) r.push('FUT');
    r.push('FX');
  }
  r.push('PACK');
  return { route: r, line };
}

/* --------------------------------------------------------------------
   교대 캘린더  (Excel: 실 라인 가동 시간 = 7.5H / Shift)
   -------------------------------------------------------------------- */
function makeCalendar(cfg) {
  const shifts = cfg.shifts;                 // 1 | 2 | 3
  const netH = cfg.netHoursPerShift;         // 7.5
  const wins = [];
  if (shifts === 1) wins.push([8, 8 + netH]);
  else if (shifts === 2) wins.push([8, 8 + netH], [16, 16 + netH]);
  else wins.push([0, netH], [8, 8 + netH], [16, 16 + netH]);
  const dayCap = wins.reduce((a, w) => a + (w[1] - w[0]), 0) * 3600;
  return {
    wins, dayCap,
    /* t(sec, epoch) 를 다음 가동 시각으로 이동 */
    snap(t) {
      const d = new Date(t * 1000);
      let h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      if (cfg.skipWeekend && (d.getDay() === 0 || d.getDay() === 6)) {
        const nd = new Date(d); nd.setHours(0, 0, 0, 0);
        nd.setDate(nd.getDate() + (d.getDay() === 6 ? 2 : 1));
        return this.snap(nd.getTime() / 1000 + wins[0][0] * 3600);
      }
      for (const w of wins) { if (h < w[0]) return t + (w[0] - h) * 3600; if (h < w[1]) return t; }
      const nd = new Date(d); nd.setHours(0, 0, 0, 0); nd.setDate(nd.getDate() + 1);
      return this.snap(nd.getTime() / 1000 + wins[0][0] * 3600);
    },
    /* dur 초를 가동시간 안에서만 소비하며 종료시각 반환 */
    run(t, dur) {
      let cur = this.snap(t), left = dur, guard = 0;
      while (left > 1e-6 && guard++ < 4000) {
        const d = new Date(cur * 1000);
        const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
        const w = wins.find(w => h >= w[0] && h < w[1]);
        const avail = w ? (w[1] - h) * 3600 : 0;
        if (avail >= left) return cur + left;
        left -= avail; cur = this.snap(cur + avail + 1);
      }
      return cur;
    }
  };
}


/* ====================================================================
   확관기(Expander) 적격성 · 배분 규칙 · 최적화 엔진
   PPT「최적화 모델 구성」:
     min  ①(목적함수)          z(j,m) ∈ {0,1}  작업 j 를 설비 m 에 배정
     s.t. ② Σ_m z(j,m) = 1      모든 작업은 정확히 한 설비에
          ③ z(j,m) = 0  ∀(j,m)∉ℰ   적격집합(설비 제약) 밖은 배정 불가
          ④ S_j ≥ C_i + s_ij − M(1−x_ij)   동일 설비 내 순서변수 x_ij + 전환시간 s_ij
   ==================================================================== */
const EXP_MACHINES = [
  { key:'M1', idx:0, label:'확관 #1호기' },
  { key:'M2', idx:1, label:'확관 #2호기' },
  { key:'M3', idx:2, label:'확관 #3호기' },
];

/* --------------------------------------------------------------------
   확관기 제약 (자료 그대로)
     · 확관 1호기 : 14m 이상 작업 불가 / 2호기와 동시 작업 시 동일 외경 제품만 가능
     · 확관 2호기 : 12.8m 이상 작업 불가 / 외경 48" 이상 & 22" 이하 우선 투입
     · 확관 3호기 : 12.8m 이상 작업 불가 / 열처리 제품 & 배척 제품 우선 투입
   ⇒ 다이어그램 주석과 정확히 일치
     · 12.8M~14M 제품 → #2·#3호기가 불가하므로 Only #1 Expander 가동
     · 14M 초과 제품  → 어느 호기도 단독 불가 → #1·#2 Expander 동시 가동 (소요=max)
   -------------------------------------------------------------------- */
const EXP_LIMIT = { M1: 14.0, M2: 12.8, M3: 12.8 };   // [m] 이상 작업 불가

function expanderMode(spec, cfg) {
  const Lm = spec.L / 1000;
  const pool = cfg.useM3 ? ['M1','M2','M3'] : ['M1','M2'];
  const single = pool.filter(m => Lm < EXP_LIMIT[m]);
  if (single.length) return { mode:'SINGLE', list:single };
  if (Lm < EXP_LIMIT.M1 * 2) return { mode:'BOTH', list:['M1','M2'] };   // 동시 가동
  return { mode:'BOTH', list:['M1','M2'], over:true };
}
/* #2호기 우선 투입 규격 (제약표) */
const M2_PREFERRED = (s) => { const inch = odInch(s.od); return inch >= 48 || inch <= 22; };

const DISPATCH_RULES = {
  EAT   : { label:'최단 가용 (Earliest Available)', desc:'가장 먼저 비는 호기에 배정 — 현장 기본 가정' },
  RR    : { label:'균등 배분 (Round-robin)',        desc:'호기 부하를 번갈아 균등하게' },
  SETUP : { label:'전환 최소 (Setup-aware)',        desc:'직전 작업과 규격이 같은 호기 우선 → 전환시간 회피' },
  SPEC  : { label:'규격 우선 (Spec-based)',          desc:'외경 48" 이상 · 22" 이하는 #2호기 우선 (제약표)' },
  OPT   : { label:'최적화 엔진 스케줄',              desc:'z(j,m)+x(ij) 최적해를 그대로 투입' },
};

function pickExpander(cand, spec, cfg, ctx) {
  if (cand.length === 1) return cand[0];
  switch (cfg.dispatchRule) {
    case 'RR': { ctx.rr = (ctx.rr || 0) + 1; return cand[ctx.rr % cand.length]; }
    case 'SETUP': {
      const same = cand.filter(u => u.last && Math.abs(u.last.od-spec.od)<0.5
        && Math.abs(u.last.t-spec.t)<0.5 && Math.abs(u.last.L-spec.L)<1);
      if (same.length) return same.reduce((a,b)=>a.free<=b.free?a:b);
      return cand.reduce((a,b)=>{
        const ca=changeoverSec('Expander',a.last,spec), cb=changeoverSec('Expander',b.last,spec);
        if (ca!==cb) return ca<cb?a:b;
        return a.free<=b.free?a:b; });
    }
    case 'SPEC': {
      const want = M2_PREFERRED(spec) ? 1 : 0;
      const pref = cand.filter(u=>u.idx===want);
      if (pref.length) return pref.reduce((a,b)=>a.free<=b.free?a:b);
      return cand.reduce((a,b)=>a.free<=b.free?a:b);
    }
    default: return cand.reduce((a,b)=>a.free<=b.free?a:b);
  }
}

/* 「2호기와 동시 작업 시 동일 외경 제품만 가능」 — 동시 가동 구간의 외경 일치 제약 */
function sameODBlockUntil(units, u, spec, st, cfg) {
  if (!cfg.sameODConcurrency) return st;
  let t = st;
  for (const o of units) {
    if (o === u) continue;
    if (o.free > t && o.last && Math.abs(o.last.od - spec.od) > 0.5) t = o.free;
  }
  return t;
}

/* --------------------------------------------------------------------
   최적화 엔진 — 병렬설비 + 순서의존 전환시간 + 동시가동(BOTH) 작업
   해 표현: 전역 작업 순서 order[] + SINGLE 작업의 호기 배정 assign{}
   평가   : 전진 시뮬레이션 (BOTH 작업은 #1·#2 동시 점유)
   -------------------------------------------------------------------- */
function buildExpJobs(orders, cfg) {
  const jobs = [];
  for (const o of orders) {
    const spec = specOf(o, cfg);
    const { route } = routeOf(spec, cfg);
    if (!route.includes('EXP')) continue;
    const em = expanderMode(spec, cfg);
    const p = {};
    for (const m of (cfg.useM3?['M1','M2','M3']:['M1','M2'])) p[m] = STD.Expander(spec, m==='M3'?'M2':m).sec * o.qty;
    p.BOTH = STD.Expander(spec, 'BOTH').sec * o.qty;
    jobs.push({ no:o.no, spec, qty:o.qty, mode:em.mode, elig:em.list, p });
  }
  return jobs;
}
function setupBetween(a, b) { return changeoverSec('Expander', a ? a.spec : null, b.spec); }

/* 전진 시뮬레이션 평가 */
function evalSchedule(order, assign, cfg, w) {
  const ms = cfg.useM3 ? ['M1','M2','M3'] : ['M1','M2'];
  const free = {}, last = {}, span = {};
  ms.forEach(m => { free[m]=0; last[m]=null; span[m]=0; });
  let setupTot = 0;
  for (const j of order) {
    if (j.mode === 'BOTH') {
      let st = Math.max(free.M1, free.M2);
      const su = Math.max(setupBetween(last.M1,j), setupBetween(last.M2,j));
      setupTot += su;
      const en = st + su + j.p.BOTH;
      free.M1 = free.M2 = en; last.M1 = last.M2 = j;
      span.M1 += su + j.p.BOTH; span.M2 += su + j.p.BOTH;
    } else {
      const m = assign[j.no] && j.elig.includes(assign[j.no]) ? assign[j.no] : j.elig[0];
      const su = setupBetween(last[m], j);
      setupTot += su;
      let st = free[m];
      if (cfg.sameODConcurrency) {              // 동시 가동 시 동일 외경만
        for (const o of ms) if (o!==m && free[o]>st && last[o] && Math.abs(last[o].spec.od-j.spec.od)>0.5) st = free[o];
      }
      free[m] = st + su + j.p[m]; last[m] = j; span[m] += su + j.p[m];
    }
  }
  const cmax = Math.max(...ms.map(m=>free[m]));
  const loads = ms.map(m=>span[m]);
  const bal = Math.max(...loads) - Math.min(...loads);
  return { cost: w.cmax*cmax + w.setup*setupTot + w.bal*bal, cmax, setupTot, bal,
           load: Object.fromEntries(ms.map(m=>[m,span[m]])) };
}

function optimizeExpander(orders, cfg, opts) {
  const w = (opts && opts.weights) || { cmax:1, setup:1.4, bal:0.25 };
  const iters = (opts && opts.iters) || 24000;
  const jobs = buildExpJobs(orders, cfg);
  if (!jobs.length) return null;
  const ms = cfg.useM3 ? ['M1','M2','M3'] : ['M1','M2'];

  /* 초기해: 규격(외경→두께→길이) 그룹핑 + 최단완료 배정 */
  let order = jobs.slice().sort((a,b)=> a.spec.od-b.spec.od || a.spec.t-b.spec.t || a.spec.L-b.spec.L);
  const assign = {};
  { const free={}; ms.forEach(m=>free[m]=0); const last={}; ms.forEach(m=>last[m]=null);
    for (const j of order) {
      if (j.mode==='BOTH'){ const st=Math.max(free.M1,free.M2)+j.p.BOTH; free.M1=free.M2=st; last.M1=last.M2=j; continue; }
      let best=null, be=Infinity;
      for (const m of j.elig){ const e=free[m]+setupBetween(last[m],j)+j.p[m]; if(e<be){be=e;best=m;} }
      assign[j.no]=best; free[best]=be; last[best]=j;
    } }

  let cur = evalSchedule(order, assign, cfg, w);
  let best = cur, bestOrder = order.slice(), bestAssign = {...assign};
  let T = Math.max(1, cur.cost*0.06);
  const cool = Math.pow(0.0004, 1/iters);
  let rnd = 20260804;
  const rand = () => { rnd = (rnd*1103515245 + 12345) & 0x7fffffff; return rnd/0x7fffffff; };

  for (let it=0; it<iters; it++) {
    const op = rand();
    let trialOrder = order, trialAssign = assign, undo = null;
    if (op < 0.45) {                                   // 순서 swap
      const a=Math.floor(rand()*order.length), b=Math.floor(rand()*order.length);
      if(a===b){ T*=cool; continue; }
      trialOrder = order.slice(); const t0=trialOrder[a]; trialOrder[a]=trialOrder[b]; trialOrder[b]=t0;
    } else if (op < 0.72) {                            // 순서 shift
      const a=Math.floor(rand()*order.length), b=Math.floor(rand()*order.length);
      trialOrder = order.slice(); const j=trialOrder.splice(a,1)[0]; trialOrder.splice(b,0,j);
    } else {                                           // 호기 재배정
      const singles = order.filter(j=>j.mode==='SINGLE' && j.elig.length>1);
      if(!singles.length){ T*=cool; continue; }
      const j = singles[Math.floor(rand()*singles.length)];
      const alt = j.elig.filter(m=>m!==assign[j.no]);
      trialAssign = {...assign}; trialAssign[j.no] = alt[Math.floor(rand()*alt.length)];
    }
    const ev = evalSchedule(trialOrder, trialAssign, cfg, w);
    if (ev.cost < cur.cost || rand() < Math.exp((cur.cost-ev.cost)/Math.max(1e-6,T))) {
      order = trialOrder; Object.keys(trialAssign).forEach(k=>assign[k]=trialAssign[k]); cur = ev;
      if (ev.cost < best.cost) { best = ev; bestOrder = order.slice(); bestAssign = {...assign}; }
    }
    T *= cool;
  }

  /* 결과 상세 타임라인 */
  const free={}, last={}; ms.forEach(m=>{free[m]=0; last[m]=null;});
  const detail=[];
  for (const j of bestOrder) {
    if (j.mode==='BOTH') {
      const su=Math.max(setupBetween(last.M1,j), setupBetween(last.M2,j));
      const st=Math.max(free.M1,free.M2)+su, en=st+j.p.BOTH;
      detail.push({no:j.no, m:'BOTH', st, en, setup:su, p:j.p.BOTH, qty:j.qty});
      free.M1=free.M2=en; last.M1=last.M2=j;
    } else {
      const m=bestAssign[j.no]||j.elig[0];
      const su=setupBetween(last[m],j);
      let st=free[m];
      if (cfg.sameODConcurrency) for (const o of ms)
        if(o!==m && free[o]>st && last[o] && Math.abs(last[o].spec.od-j.spec.od)>0.5) st=free[o];
      st+=su; const en=st+j.p[m];
      detail.push({no:j.no, m, st, en, setup:su, p:j.p[m], qty:j.qty});
      free[m]=en; last[m]=j;
    }
  }
  detail.sort((a,b)=>a.st-b.st);
  const assignOut={}; detail.forEach(d=>assignOut[d.no]=d.m);
  return {
    assign: assignOut, seq: detail.map(d=>d.no), detail,
    cmaxH: best.cmax/3600, setupH: best.setupTot/3600, balH: best.bal/3600,
    loadH: Object.fromEntries(ms.map(m=>[m,(best.load[m]||0)/3600])),
    machines: ms, nJobs: jobs.length,
    nBoth: jobs.filter(j=>j.mode==='BOTH').length,
    nFixed: jobs.filter(j=>j.mode==='SINGLE'&&j.elig.length===1).length,
    nFree: jobs.filter(j=>j.mode==='SINGLE'&&j.elig.length>1).length,
    weights: w, iters,
  };
}

/* 오더 → spec */
function specOf(o, cfg) {
  return {
    od:o.od, t:o.t, L:o.L, qty:o.qty,
    grade: o.grade || (o.t >= 25 ? 'high' : 'normal'),
    api5l: o.api5l != null ? o.api5l : (o.qty >= 50),
    markSpec:2, markEnd:2, defects:0, holdSec:cfg.holdSec, rtType:'450kV'
  };
}

/* --------------------------------------------------------------------
   시뮬레이터 — 파이프 단위 FIFO 디스패치
   -------------------------------------------------------------------- */
function simulate(orders, cfg) {
  const cal = makeCalendar(cfg);
  const t0 = new Date(cfg.startDate + 'T08:00:00').getTime() / 1000;

  /* 자원 풀 생성 */
  const pools = {};
  if (NODE.EXP) NODE.EXP.cap = cfg.useM3 ? 3 : 2;
  for (const n of NODES) {
    if (n.kind !== 'proc') continue;
    const units = [];
    for (let i = 0; i < (n.cap || 1); i++)
      units.push({ id: n.id + '#' + (i + 1), idx: i, free: t0, last: null, busy: 0, setup: 0, jobs: 0 });
    pools[n.id] = units;
  }
  const events = [];
  const orderSpan = {};
  const ctx = { rr: 0 };
  const bothOrders = new Set(), fixedOrders = new Set();
  let seqGlobal = 0;

  /* 투입 순서: 최적화 스케줄이 있으면 그 순서, 없으면 계획일 순 */
  const plan = cfg.plan || null;
  let sorted = orders.slice().sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  if (plan && cfg.dispatchRule === 'OPT' && cfg.applyOptSeq !== false && plan.seq && plan.seq.length) {
    const rank = {}; plan.seq.forEach((no, i) => rank[no] = i);
    sorted = sorted.slice().sort((a, b) =>
      (rank[a.no] != null ? rank[a.no] : 9999) - (rank[b.no] != null ? rank[b.no] : 9999));
  }

  for (const o of sorted) {
    const spec = specOf(o, cfg);
    const { route, line } = routeOf(spec, cfg);
    const useOptSeq = plan && cfg.dispatchRule === 'OPT' && cfg.applyOptSeq !== false && plan.seq && plan.seq.length;
    const rel = useOptSeq ? t0
      : Math.max(t0, o.start ? new Date(o.start.replace(' ', 'T')).getTime() / 1000 : t0);
    let oS = Infinity, oE = -Infinity;

    for (let k = 1; k <= o.qty; k++) {
      seqGlobal++;
      let ready = rel, prevId = null;
      for (const nid of route) {
        const n = NODE[nid];
        if (n.kind === 'buf') continue;
        const units = pools[nid];
        let u, coUnits = null, machine;

        if (nid === 'EXP') {
          const em = expanderMode(spec, cfg);                       // ③ 적격집합 ℰ
          if (em.mode === 'BOTH') {
            /* 14M 초과 → #1·#2호기 동시 가동 (소요 = max) */
            coUnits = units.filter(x => x.idx <= 1);
            u = coUnits.reduce((a, b) => (a.free >= b.free ? a : b));  // 늦게 비는 쪽 기준
            machine = 'BOTH';
            bothOrders.add(o.no);
          } else {
            let cand = units.filter(x => em.list.includes(EXP_MACHINES[x.idx].key));
            if (!cand.length) cand = units;
            if (cfg.dispatchRule === 'OPT' && plan && plan.assign[o.no] && plan.assign[o.no] !== 'BOTH') {
              const want = plan.assign[o.no];
              const fixed = cand.filter(x => EXP_MACHINES[x.idx].key === want);
              u = fixed.length ? fixed[0] : pickExpander(cand, spec, cfg, ctx);
            } else {
              u = pickExpander(cand, spec, cfg, ctx);
            }
            machine = EXP_MACHINES[u.idx].key;
            if (cand.length === 1) fixedOrders.add(o.no);
          }
        } else {
          u = units.reduce((a, b) => (a.free <= b.free ? a : b));
          machine = n.machine || null;
        }

        const fn = n.free ? null : STD[n.st];
        const res = fn ? fn(spec, line, k, machine) : { sec: cfg.freeStationSec, expr: '고정 시간(측정 대상 외)', terms: [] };
        const dur = (n.st === 'Expander') ? STD.Expander(spec, machine === 'M3' ? 'M2' : machine).sec : res.sec;
        const seize = coUnits || [u];
        const co = n.free ? 0 : Math.max(...seize.map(x => changeoverSec(n.st, x.last, spec)));

        const arrive = ready;
        let cs = Math.max(ready, ...seize.map(x => x.free));
        if (nid === 'EXP' && !coUnits) cs = sameODBlockUntil(units, u, spec, cs, cfg);  // 동시 가동 시 동일 외경
        let st = cs;
        if (co > 0) { st = cal.run(cs, co); seize.forEach(x => x.setup += co); }
        const en = cal.run(st, dur);
        for (const x of seize) {
          x.free = en; x.busy += dur; x.jobs++; x.last = { od: spec.od, t: spec.t, L: spec.L };
        }
        ready = en;
        events.push({ o: o.no, k, n: nid, p: prevId, u: u.idx, r: arrive, cs, s: st, e: en, d: dur, co,
                      both: !!coUnits, mach: machine });
        prevId = nid;
        if (st < oS) oS = st;
        if (en > oE) oE = en;
      }
    }
    orderSpan[o.no] = { s: oS, e: oE, qty: o.qty, od: o.od, t: o.t, L: o.L, line, route };
  }

  /* 가동률 */
  const tEnd = Math.max(...Object.values(orderSpan).map(v => v.e));
  const horizon = tEnd - t0;
  const days = horizon / 86400;
  const availPerUnit = days * cal.dayCap;
  const stats = [];
  for (const n of NODES) {
    if (n.kind !== 'proc') continue;
    const units = pools[n.id];
    const busy = units.reduce((a, u) => a + u.busy, 0);
    const setup = units.reduce((a, u) => a + u.setup, 0);
    const jobs = units.reduce((a, u) => a + u.jobs, 0);
    if (!jobs) continue;
    stats.push({
      id: n.id, label: n.label, st: n.st, cap: units.length, jobs,
      busyH: busy / 3600, setupH: setup / 3600,
      util: availPerUnit ? (busy + setup) / (availPerUnit * units.length) * 100 : 0,
      units: units.map(u => ({ id: u.id, busyH: u.busy / 3600, setupH: u.setup / 3600, jobs: u.jobs }))
    });
  }
  stats.sort((a, b) => b.util - a.util);
  const expStat = stats.find(x => x.id === 'EXP');
  const kpi = {
    makespanH: horizon / 3600,
    totalSetupH: stats.reduce((a, x) => a + x.setupH, 0),
    expSetupH: expStat ? expStat.setupH : 0,
    expUtil: expStat ? expStat.util : 0,
    expBalanceH: expStat ? Math.abs((expStat.units[0] ? expStat.units[0].busyH : 0)
                                  - (expStat.units[1] ? expStat.units[1].busyH : 0)) : 0,
    bothOrders: Array.from(bothOrders), fixedOrders: Array.from(fixedOrders),
  };
  return { events, orderSpan, stats, t0, tEnd, horizonH: horizon / 3600, cal, kpi,
           rule: cfg.dispatchRule, eligRule: cfg.eligRule };
}
