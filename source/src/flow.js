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
  { id:'SLUG',  label:'슬러그 제거', sub:'Outer bead removal', st:'OuterBead', kind:'proc', x:980,  y:110, cap:4 },
  { id:'OSAW',  label:'외면 SAW*',  sub:'Outside SAW', st:'OutsideWelder', kind:'proc', x:1120, y:110, cap:4 },
  { id:'CUT',   label:'관단탭 절단', kind:'proc', st:null, x:1270, y:110, cap:1, free:true },

  /* ---- 확관 라인 (우 → 좌) ---- */
  { id:'D2',    label:'단일 오더\nAPI 5L or\n50PCS 이상', kind:'dec', x:1418, y:307 },
  { id:'UT1',   label:'1차 U.T', sub:'UT109', st:'FirstUT', kind:'proc', x:1265, y:400, cap:1 },
  { id:'BUF',   label:'10번 문 적재', sub:'Buffer · Max 4,000톤', kind:'buf', x:1085, y:315 },
  { id:'D3',    label:'RB 라인\n투입 필요', kind:'dec', x:919, y:310 },
  { id:'RB',    label:'R/B Expander', sub:'EP102 · 여분 라인', st:'Expander', machine:'RB', kind:'proc', x:912, y:405, cap:1 },
  { id:'EXP',   label:'Expander', sub:'EP103 · EP104', st:'Expander', kind:'proc', x:740, y:315, cap:2, bottleneck:true },
  { id:'D4',    label:'CP\n투입', kind:'dec', x:594, y:310 },
  { id:'CP',    label:'Calibration Press', kind:'proc', st:null, x:587, y:405, cap:1, free:true },
  { id:'EF',    label:'면취 공정', sub:'FC110', st:'EndFacing', kind:'proc', x:420, y:315, cap:1 },
  { id:'HYD',   label:'수압 Test', sub:'HY106', st:'HydroTest', kind:'proc', x:255, y:315, cap:1 },

  /* ---- 검사 · 보수 · 출하 ---- */
  { id:'D5',    label:'API 5L\n제품', kind:'dec', x:104, y:520 },
  { id:'FUT',   label:'2차 U.T', sub:'UT110', st:'FinalUT', kind:'proc', x:250, y:620, cap:1 },
  { id:'XE',    label:'관단 R/T', sub:'RT102 · 관단부만', st:'RT', rtType:'End-RT', kind:'proc', x:400, y:620, cap:1 },
  { id:'FX',    label:'F-X ray', sub:'RT101 320kV · RT105 450kV', st:'RT', rtType:'450kV', kind:'proc', x:560, y:530, cap:2 },
  { id:'D6',    label:'불량', kind:'dec', x:700, y:528 },
  { id:'RP',    label:'Repair', kind:'proc', st:null, x:760, y:640, cap:1, free:true },
  { id:'D7',    label:'용접\n문제', kind:'dec', x:767, y:726 },
  { id:'RW',    label:'보수 용접', kind:'proc', st:null, x:760, y:810, cap:1, free:true },
  { id:'EP',    label:'Expander 문제', sub:'★ 병목 발생지', kind:'proc', st:null, x:1000, y:722, cap:1, free:true, bottleneck:true },
  { id:'PACK',  label:'JCOE 포장', sub:'PK113', st:'Packing', kind:'proc', x:1130, y:530, cap:1 },

  /* ---- R/B 라인 전용 후처리 (Zone 3) — 2026-08-06 현장 설비 화면으로 확인 ----
     R/B Expander(EP102) → R/B 면취(FC112) → R/B RT(RT104) → 배척 포장(PK112)
     JCOE 본류와 **후처리 설비가 완전히 분리**되어 있고, R/B 라인에는 수압 Test·2차 U.T 가 없다.
     종전에는 RB → 포장 직행이라 JCOE 포장(PK113) 용량을 잘못 나눠 쓰고 있었다. */
  { id:'RBEF',  label:'R/B 면취', sub:'FC112', st:'EndFacing', kind:'proc', x:912, y:600, cap:1 },
  { id:'RBRT',  label:'R/B RT',  sub:'RT104', st:'RT', rtType:'450kV', kind:'proc', x:912, y:700, cap:1 },
  { id:'PACKRB',label:'배척 포장', sub:'PK112', st:'Packing', kind:'proc', x:912, y:800, cap:1 },
];
const NODE = Object.fromEntries(NODES.map(n => [n.id, n]));
/* R/B 라인 소속 노드 — 별도 근무조 캘린더를 쓴다 */
const RB_LINE = new Set(['RB','RBEF','RBRT','PACKRB']);

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
  ['RB','RBEF','','v'], ['RBEF','RBRT','','v'], ['RBRT','PACKRB','','v'],
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
  const toRB = useRBLine(s, cfg);
  r.push(toRB ? 'RB' : 'EXP');                       // D3: R/B 라인 투입 여부
  if (toRB) {
    /* R/B 라인은 후처리 설비가 따로 있다 (Zone 3) — 수압 Test·2차 U.T 는 없다 */
    r.push('RBEF', 'RBRT', 'PACKRB');
  } else {
    if (cfg.useCP) r.push('CP');                     // D4
    r.push('EF', 'HYD');
    if (s.api5l) r.push('FUT', 'XE');                // D5
    else if (cfg.processingFinalUT) r.push('FUT');
    r.push('FX');
    r.push('PACK');
  }
  return { route: r, line };
}

/* --------------------------------------------------------------------
   교대 캘린더  (Excel: 실 라인 가동 시간 = 7.5H / Shift)
   -------------------------------------------------------------------- */
/* --------------------------------------------------------------------
   세아제강 실제 교대 시간표 (2026-08-06 확인)
     1근   07:00–11:30, 12:00–15:00        점심 11:30–12:00      실가동 7.5h
     2근   15:00–18:00, 18:30–23:00        저녁 18:00–18:30      실가동 7.5h
     3근   23:00–02:45, 03:15–07:00(익일)  야식 02:45–03:15      실가동 7.5h
     2근연장  (2근에 추가) 23:30–03:00(익일)                      +3.5h
   근무 형태가 월마다 달라 **2근을 기본**으로 고정한다.
   종전에는 08:00~15:30 / 16:00~23:30 으로 잡아 실제와 최대 1시간씩 어긋났다.
   시간은 [시작h, 종료h] 로 적되 24 를 넘으면 익일로 넘어간 것으로 본다.
   -------------------------------------------------------------------- */
const SHIFT_BLOCKS = {
  1:  [[7, 11.5], [12, 15]],
  2:  [[7, 11.5], [12, 15], [15, 18], [18.5, 23]],
  '2E': [[7, 11.5], [12, 15], [15, 18], [18.5, 23], [23.5, 27]],   // 2근연장
  3:  [[7, 11.5], [12, 15], [15, 18], [18.5, 23], [23, 26.75], [27.25, 31]],
};
/* 하루(0~24h) 기준 구간으로 접고, 이어지는 구간은 합친다 */
function foldWindows(blocks) {
  const raw = [];
  for (let [a, b] of blocks) {
    while (b > a) {
      const end = Math.min(b, Math.ceil((a + 1e-9) / 24) * 24 || 24);
      raw.push([a % 24, ((end % 24) === 0 && end > a) ? 24 : end % 24]);
      a = end;
    }
  }
  raw.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const w of raw) {
    const last = out[out.length - 1];
    if (last && w[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], w[1]);
    else out.push([w[0], w[1]]);
  }
  return out;
}
function makeCalendar(cfg, shiftsOverride) {
  const shifts = shiftsOverride || cfg.shifts;   // 1 | 2 | '2E' | 3
  const netH = cfg.netHoursPerShift;             // 기본 7.5 — 실제 시간표와 일치
  let blocks = (SHIFT_BLOCKS[shifts] || SHIFT_BLOCKS[2]).map(w => w.slice());
  /* netH 를 7.5 에서 바꾸면(민감도 분석) 각 교대의 마지막 구간을 그만큼 늘리거나 줄인다.
     기본값 7.5 에서는 실제 시간표와 정확히 같다. */
  const per = (shifts === 1) ? 7.5 : 7.5;
  if (Math.abs(netH - per) > 1e-6) {
    const d = netH - per;
    const nShift = (shifts === 1) ? 1 : (shifts === 3 ? 3 : 2);
    const idx = [];
    if (shifts === 1) idx.push(1);
    else if (shifts === 2 || shifts === '2E') idx.push(1, 3);
    else idx.push(1, 3, 5);
    let shiftSeen = 0;
    for (const i of idx) { if (blocks[i]) { blocks[i][1] += d; shiftSeen++; } if (shiftSeen >= nShift) break; }
  }
  const wins = foldWindows(blocks);
  const dayCap = wins.reduce((a, w) => a + (w[1] - w[0]), 0) * 3600;
  return {
    wins, dayCap,
    /* [t0, t1] 구간의 실제 가용 가동시간[초]. 주말 비가동을 정확히 반영한다.
       종전에는 (달력일수 × dayCap) 으로 계산해 주말 비가동 시 가동률이 35% 과소 보고됐다. */
    capBetween(t0, t1) {
      if (!(t1 > t0)) return 0;
      let total = 0;
      const d = new Date(t0 * 1000); d.setHours(0, 0, 0, 0);
      let day = d.getTime() / 1000;
      for (let g = 0; g < 4000 && day < t1; g++, day += 86400) {
        const dd = new Date(day * 1000);
        if (cfg.skipWeekend && (dd.getDay() === 0 || dd.getDay() === 6)) continue;
        for (const w of wins) {
          const a = Math.max(t0, day + w[0] * 3600), b = Math.min(t1, day + w[1] * 3600);
          if (b > a) total += b - a;
        }
      }
      return total;
    },
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
   확관 제약 기준 (RULESET)

   ★ 2026-08-06 확정 (세아제강 피드백)
     · 문세희 — "PPT 자료랑 ortools 안의 specs.py 사이에 간극이 있다면 specs.py 가 맞습니다.
                 PPT 제작 이후에 계속 수정사항이 있었고, PPT 에는 생략된 내용도 있습니다."
     · 김명건 — "12.802m → 1·2호기, 실제 로그 확인해보니 Expander 2호기에서 만든 로그가 있어
                 ortools 파일 기준으로 보시면 됩니다."
   ⇒ 정본은 'ortools'(운영 모델). 'ppt' 는 대조용으로만 남긴다.

     'ortools' : 확관 공정 최적화 운영 모델 (specs.py / optimizer_grouped.py) — 기본값
     'ppt'     : 공정 다이어그램 + 확관기별 공정 제약표 (슬라이드 3·4) — 구버전, 참고용
   -------------------------------------------------------------------- */
const EXP_RULESET = {
  ortools: {
    label: '확관 최적화 운영 모델 (정본)',
    L1: 14.021, L2: 12.8384,       // specs.BOTH_LENGTH_THRESHOLD / optimizer_grouped.py:85
    m2Exclusive: true,             // 외경 48"↑/22"↓ 는 #2호기 "전용"(hard)
    rb: 'ortools',                 // RB: 다이표 외경 & 9≤t≤25.4 & L≤12.8
  },
  ppt: {
    label: '공정 다이어그램 · 제약표 (구버전)',
    L1: 14.0, L2: 12.8,            // [m] 초과 시 작업 불가
    m2Exclusive: false,            // 외경 48"↑/22"↓ 는 "우선 투입"(soft)
    rb: 'ppt',                     // RB: 두께 25T 이하 & 외경 24" 이하 (전부 만족)
  },
};
const EXP_RULESET_DEFAULT = 'ortools';
function expRules(cfg) {
  const base = EXP_RULESET[(cfg && cfg.expRuleSet) === 'ppt' ? 'ppt' : EXP_RULESET_DEFAULT];
  return {
    L1: cfg && cfg.expL1 != null ? +cfg.expL1 : base.L1,
    L2: cfg && cfg.expL2 != null ? +cfg.expL2 : base.L2,
    m2Exclusive: cfg && cfg.m2ExclusiveOD != null ? !!cfg.m2ExclusiveOD : base.m2Exclusive,
    rb: (cfg && cfg.rbCond) || base.rb,
    label: base.label,
  };
}
const OD_M2_HI = 48 * 25.4 * 0.997;   // 1217.6mm 이상 → #2호기
const OD_M2_LO = 22 * 25.4 * 1.003;   //  560.5mm 이하 → #2호기

function expanderMode(spec, cfg) {
  const R = expRules(cfg);
  const Lm = spec.L / 1000;
  const pool = cfg.useM3 ? ['M1','M2','M3'] : ['M1','M2'];
  if (Lm > R.L1) return { mode:'BOTH', list:['M1','M2'], why:`L ${Lm.toFixed(3)}m > ${R.L1}m — 단독 불가` };
  const lim = { M1: R.L1, M2: R.L2, M3: R.L2 };
  let single = pool.filter(m => Lm <= lim[m]);
  if (!single.length) return { mode:'BOTH', list:['M1','M2'], over:true, why:'적격 호기 없음' };
  /* 외경 48"↑ / 22"↓ → #2호기 전용 (길이 제약이 우선 적용된 뒤에만 판정) */
  if (R.m2Exclusive && single.length > 1 && (spec.od >= OD_M2_HI || spec.od <= OD_M2_LO)) {
    const only = single.filter(m => m !== 'M1');
    if (only.length) return { mode:'SINGLE', list:only, why:`외경 ${odInch(spec.od).toFixed(0)}" — #2호기 전용` };
  }
  return { mode:'SINGLE', list:single };
}
/* #2호기 우선 투입 규격 (제약표) */
const M2_PREFERRED = (s) => (s.od >= OD_M2_HI || s.od <= OD_M2_LO);

/* --------------------------------------------------------------------
   RB 라인 적격성 — 두 자료가 외경 조건에서 정면으로 갈린다
     · 다이어그램  「RB 라인 투입 조건 (전부 만족): 두께 25T 이하 · 외경 24" 이하」
     · 운영 모델    RB 다이표 외경(610~1219mm = 24"~48") & 9mm ≤ t ≤ 25.4mm & L ≤ 12.8m
   Force_RB (RB 강제 투입) — 제약표「확관 3호기: 열처리 공정 제품 & 배척 제품 우선 투입」과 일치
     · 병목공정 == 'HT102'            (열처리 제품)
     · 원재료길이 / 제품길이 ≥ 1.8      (배척 = 원판 1장에서 2본)
   -------------------------------------------------------------------- */
let _rbOD = null;
function rbDiameters() {
  if (_rbOD) return _rbOD;
  _rbOD = new Set(((T.dieSpec || {}).RB || []).map(r => r[1]));
  return _rbOD;
}
function rbCapable(s, cfg) {
  const R = expRules(cfg);
  if ((s.L / 1000) > 12.8) return false;
  if (R.rb === 'ortools') {
    if (s.t < 9 || s.t > 25.4) return false;
    for (const od of rbDiameters()) if (Math.abs(od - s.od) <= 5) return true;
    return false;
  }
  return s.t <= 25 && odInch(s.od) <= 24;          // 다이어그램 조건
}
function forceRB(s, cfg) {
  if (!rbCapable(s, cfg)) return false;
  if (String(s.bottleneck || '').trim().toUpperCase() === 'HT102') return true;   // 열처리
  if (s.rawL > 0 && s.L > 0 && (s.rawL / s.L) >= 1.8) return true;                // 배척
  return false;
}
/* 라우팅 시점의 RB 투입 판정.  rbMode: 'capable' | 'force' | 'off' */
function usesPlan(cfg) {
  return !!(cfg && cfg.plan && (cfg.dispatchRule === 'OPT' || cfg.dispatchRule === 'IMPORT'));
}
function useRBLine(s, cfg) {
  /* 기본은 「열처리·배척 제품만」 — R/B 는 #1·#2호기 잔여 CAPA 가 없을 때
     증산용으로 돌리는 여분 라인이다 (2026-08-06 세아제강). 종전 기본값 'capable'(적격 전량)은 현장과 다르다. */
  const mode = cfg.rbMode || (cfg.useRB === false ? 'off' : 'force');
  if (usesPlan(cfg) && cfg.plan.assign && s.no != null) {     // 최적화/외부 스케줄 지정이 우선
    const a = cfg.plan.assign[s.no];
    if (a === 'RB') return true;
    if (a === 'M1' || a === 'M2' || a === 'M3' || a === 'BOTH') return false;
  }
  if (mode === 'off') return false;
  if (mode === 'force') return forceRB(s, cfg);
  return rbCapable(s, cfg) && (cfg.useRB !== false);
}

const DISPATCH_RULES = {
  EAT   : { label:'최단 가용 (Earliest Available)', desc:'가장 먼저 비는 호기에 배정 — 현장 기본 가정' },
  RR    : { label:'균등 배분 (Round-robin)',        desc:'호기 부하를 번갈아 균등하게' },
  SETUP : { label:'전환 최소 (Setup-aware)',        desc:'직전 작업과 규격이 같은 호기 우선 → 전환시간 회피' },
  SPEC  : { label:'규격 우선 (Spec-based)',          desc:'외경 48" 이상 · 22" 이하는 #2호기 우선 (제약표)' },
  OPT   : { label:'최적화 엔진 스케줄',              desc:'z(j,m)+x(ij) 최적해를 그대로 투입' },
  IMPORT: { label:'외부 최적화 스케줄 (OR-Tools)',   desc:'CP-SAT 결과 파일의 배정·순서를 그대로 투입' },
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
        const ca=changeoverSec('Expander',a.last,spec,EXP_MACHINES[a.idx]&&EXP_MACHINES[a.idx].key),
              cb=changeoverSec('Expander',b.last,spec,EXP_MACHINES[b.idx]&&EXP_MACHINES[b.idx].key);
        if (ca!==cb) return ca<cb?a:b;
        return a.free<=b.free?a:b; });
    }
    case 'SPEC': {
      /* 제약표: 외경 48"↑ / 22"↓ 는 #2호기(및 3호기) 우선 투입.
         그 외 규격은 "우선" 규정이 없으므로 #1호기 강제가 아니라 가장 빨리 비는 호기로 보낸다. */
      if (M2_PREFERRED(spec)) {
        const pref = cand.filter(u => u.idx >= 1);
        if (pref.length) return pref.reduce((a,b)=>a.free<=b.free?a:b);
      }
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
function setupBetween(a, b, m) { return changeoverSec('Expander', a ? a.spec : null, b.spec, m || 'M2'); }

/* 전진 시뮬레이션 평가 */
function evalSchedule(order, assign, cfg, w) {
  const ms = cfg.useM3 ? ['M1','M2','M3'] : ['M1','M2'];
  const free = {}, last = {}, span = {};
  ms.forEach(m => { free[m]=0; last[m]=null; span[m]=0; });
  let setupTot = 0;
  for (const j of order) {
    if (j.mode === 'BOTH') {
      let st = Math.max(free.M1, free.M2);
      const su = Math.max(setupBetween(last.M1,j,'M1'), setupBetween(last.M2,j,'M2'));
      setupTot += su;
      const en = st + su + j.p.BOTH;
      free.M1 = free.M2 = en; last.M1 = last.M2 = j;
      span.M1 += su + j.p.BOTH; span.M2 += su + j.p.BOTH;
    } else {
      const m = assign[j.no] && j.elig.includes(assign[j.no]) ? assign[j.no] : j.elig[0];
      const su = setupBetween(last[m], j, m);
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
      for (const m of j.elig){ const e=free[m]+setupBetween(last[m],j,m)+j.p[m]; if(e<be){be=e;best=m;} }
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
      const su=Math.max(setupBetween(last.M1,j,'M1'), setupBetween(last.M2,j,'M2'));
      const st=Math.max(free.M1,free.M2)+su, en=st+j.p.BOTH;
      detail.push({no:j.no, m:'BOTH', st, en, setup:su, p:j.p.BOTH, qty:j.qty});
      free.M1=free.M2=en; last.M1=last.M2=j;
    } else {
      const m=bestAssign[j.no]||j.elig[0];
      const su=setupBetween(last[m],j,m);
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
    weights: w, iters, src:'SA',
  };
}

/* ====================================================================
   외부 최적화 스케줄 가져오기 (OR-Tools CP-SAT 결과)
   optimizer_grouped.solve_integrated_schedule() 가 뽑는 DataFrame 을
   CSV / XLSX / JSON 어느 형태로 내보내도 읽을 수 있게 헤더를 느슨하게 인식한다.
     필수 : OrderNo(또는 판매오더/오더/오더번호) · Machine(또는 설비/호기)
     선택 : Ex_Start(시작) · Ex_End · Quantity · Length · Diameter · Thickness
   Machine 값 매핑 :
     Expander#1 / EXPANDER#1 / M1 / 1호기      → M1
     Expander#2 / M2 / 2호기                   → M2
     Expander#RB / RB                          → RB
     Both / BOTH / 동시                        → BOTH
   ==================================================================== */
const IMP_KEYS = {
  no:      ['orderno','order_no','판매오더','오더','오더번호','order','vbtxt'],
  machine: ['machine','설비','호기','expander','배정','assign'],
  start:   ['ex_start','start','시작','착수','starttime'],
  end:     ['ex_end','end','종료','완료','endtime'],
  qty:     ['quantity','qty','수량','계획수량','본수'],
  L:       ['length','길이'],
  od:      ['diameter','외경'],
  t:       ['thickness','두께'],
  stage:   ['stage','detailno','detail_no'],
};
function _impNorm(h) { return String(h == null ? '' : h).trim().toLowerCase().replace(/[\s_()·]/g, ''); }
function _impFind(headers, cands) {
  const hs = headers.map(_impNorm);
  for (const c of cands) {
    const cn = _impNorm(c);
    let i = hs.indexOf(cn);            if (i >= 0) return i;
    i = hs.findIndex(h => h.includes(cn) && h.length <= cn.length + 4);
    if (i >= 0) return i;
  }
  return -1;
}
function normMachine(v) {
  const x = String(v == null ? '' : v).trim().toUpperCase().replace(/[\s_#]/g, '');
  if (!x) return null;
  if (x.includes('BOTH') || x.includes('동시')) return 'BOTH';
  if (x.includes('RB')) return 'RB';
  if (x.includes('3')) return 'M3';
  if (x.includes('2')) return 'M2';
  if (x.includes('1')) return 'M1';
  return null;
}

/** rows: 2차원 배열([헤더행, ...데이터]) 또는 객체 배열 */
function importOptPlan(rows) {
  if (!rows || !rows.length) throw new Error('빈 파일입니다.');
  let headers, body;
  if (Array.isArray(rows[0])) {
    /* 헤더 행 탐색 — OrderNo/Machine 두 열을 모두 찾을 수 있는 첫 행 */
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const h = rows[i].map(x => x);
      if (_impFind(h, IMP_KEYS.no) >= 0 && _impFind(h, IMP_KEYS.machine) >= 0) { hi = i; break; }
    }
    if (hi < 0) throw new Error('OrderNo(판매오더) 와 Machine(설비) 열을 찾지 못했습니다.');
    headers = rows[hi]; body = rows.slice(hi + 1);
  } else {
    headers = Object.keys(rows[0]); body = rows.map(r => headers.map(h => r[h]));
  }
  const ix = {}; for (const k of Object.keys(IMP_KEYS)) ix[k] = _impFind(headers, IMP_KEYS[k]);
  if (ix.no < 0 || ix.machine < 0) throw new Error('OrderNo(판매오더) 와 Machine(설비) 열을 찾지 못했습니다.');

  const detail = [], assign = {}, warn = [];
  for (const r of body) {
    const no = r[ix.no] == null ? '' : String(r[ix.no]).trim();
    if (!no || no.toLowerCase() === 'nan') continue;
    const m = normMachine(r[ix.machine]);
    if (!m) { warn.push(`${no}: 설비값 '${r[ix.machine]}' 인식 실패`); continue; }
    const num = i => (i >= 0 && r[i] != null && r[i] !== '' && isFinite(+r[i])) ? +r[i] : null;
    const st = num(ix.start), en = num(ix.end);
    detail.push({ no, m, st: st == null ? detail.length : st, en: en == null ? null : en,
                  qty: num(ix.qty), L: num(ix.L), od: num(ix.od), t: num(ix.t),
                  stage: ix.stage >= 0 ? r[ix.stage] : null,
                  setup: 0, p: (st != null && en != null) ? (en - st) : null });
    /* 같은 판매오더가 R/U 로 쪼개져 두 행이면 먼저 나온 배정을 채택 (동일 설비 강제 제약) */
    if (assign[no] == null) assign[no] = m;
    else if (assign[no] !== m) warn.push(`${no}: 행마다 설비가 다름(${assign[no]} / ${m}) — 앞의 값 사용`);
  }
  if (!detail.length) throw new Error('읽을 수 있는 행이 없습니다.');
  detail.sort((a, b) => a.st - b.st);
  const uniq = []; const seen = new Set();
  for (const d of detail) if (!seen.has(d.no)) { seen.add(d.no); uniq.push(d.no); }

  const cnt = { M1:0, M2:0, M3:0, RB:0, BOTH:0 };
  Object.values(assign).forEach(m => cnt[m]++);
  /* 초/분 단위 판정 — 종전에는 "정렬 후 마지막 행의 en" 하나만 봐서
     ① 마지막 행 en 이 null 이면 무조건 'min', ② st 정렬이라 마지막 시작 ≠ 마지막 종료,
     ③ makespan 이 20,000초(5.6h) 이하인 초 단위 파일을 분으로 오판했다. 전 행의 최댓값으로 판정한다. */
  const spanRaw = detail.reduce((a, d) => Math.max(a, d.en == null ? 0 : d.en), 0);
  const unit = spanRaw > 20000 ? 'sec' : 'min';
  return {
    src: 'IMPORT', assign, seq: uniq, detail, warn,
    nRows: detail.length, nOrders: uniq.length, count: cnt,
    machines: ['M1','M2','M3'].filter(m => cnt[m] > 0).concat(cnt.BOTH ? [] : []),
    spanH: spanRaw ? (unit === 'sec' ? spanRaw / 3600 : spanRaw / 60) : null,
    unit,
  };
}

/* 오더 → spec */
function specOf(o, cfg) {
  return {
    no:o.no,
    /* 운영 모델은 계획서를 읽을 때 외경을 정수로 **절사**하고 두께를 소수 2자리로 반올림한다
       (`data_loader.py:51-52` — `df["외경"].astype(int)` / `df["두께"].astype(float).round(2)`).
       이 정규화를 거쳐야 OD 711.0 과 711.2 가 같은 다이(711)로 판정돼 헛된 다이 교체 90분이 사라지고,
       RB 적격의 외경 정확일치(`d not in valid_rb_diameters`)도 정본과 같은 답을 낸다. */
    od:Math.trunc(o.od), t:Math.round(o.t * 100) / 100, L:o.L, qty:o.qty,
    bottleneck: o.bottleneck || null,     // 병목 공정 작업장 (HT102 = 열처리 → RB 강제)
    rawL: o.rawL || 0,                    // 원재료 길이 [mm] — 더블 파이프 판정용
    /* 재질은 계획서 `재질` 열에서 읽는다(API-X70L2 → 고강도). 열이 없을 때만 두께를 대리변수로 쓰고,
       경계는 Gap Press 투입 조건(t > 25)과 맞춘다. */
    grade: o.grade || (o.t > 25 ? 'high' : 'normal'),
    /* 계획서에 API 5L 열이 없다. 종전에는 `qty >= 50` 을 무조건 대리변수로 썼는데,
       그러면 다이어그램에서 조건이 서로 다른 D2(API 5L **또는** 50PCS↑ → 1차 U.T)와
       D5(API 5L → Final U.T + 관단 X-ray)가 같은 조건이 되어 버린다.
       기본값은 종전 동작을 유지하되(cfg.api5lProxy !== false), 끌 수 있게 노출한다. */
    api5l: o.api5l != null ? o.api5l : ((cfg.api5lProxy !== false) && o.qty >= 50),
    markSpec:2, markEnd:2, defects:0, holdSec:cfg.holdSec, rtType:'450kV'
  };
}

/* ====================================================================
   확률 변동 (Stochastic) — 매 실행마다 다른 결과
   기본값은 모두 0 이므로 변동성을 끄면 결정론 결과와 완전히 동일하다.
   ==================================================================== */
const STOCH_DEFAULT = {
  on: false,
  cvTime: 0.10,      // 작업시간 변동계수 (로그정규)
  cvSetup: 0.20,     // 설비 전환시간 변동계수
  pDefect: 0.02,     // F-X ray 불량 발생률 (본당)
  pWeld: 0.65,       // 불량 중 용접 문제 비율 (나머지는 Expander 문제)
  maxRework: 2,      // 본당 최대 재작업 횟수
  mtbfH: 0,          // 설비 평균 고장 간격 [h] (0 = 고장 없음)
  mttrH: 1.5,        // 평균 수리 시간 [h]
  repairSec: 1800,   // Repair 소요
  reweldSec: 3600,   // 보수 용접 소요
  expIssueSec: 2700, // Expander 문제 처리 소요
};
/* mulberry32 — 시드 기반 결정론적 난수 */
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* 로그정규 배수 — 평균 1, 변동계수 cv */
function lnormMul(rng, cv) {
  if (!cv) return 1;
  const s2 = Math.log(1 + cv * cv), s = Math.sqrt(s2);
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(z * s - s2 / 2);
}
const expo = (rng, mean) => -mean * Math.log(1 - rng());

/* --------------------------------------------------------------------
   계획 기간 — 시작일 / 마감일 / 오더 투입일 처리 방식
     dateMode 'plan'  : 계획서에 적힌 투입일 그대로 (시작일보다 이른 건 시작일로 당김)
              'shift' : 계획서 순서·간격은 유지하고 전체를 시작일에 맞춰 평행 이동
              'seq'   : 시작일부터 seqGapH 간격으로 순차 투입 (계획서 날짜 무시)
   -------------------------------------------------------------------- */
function applyPeriod(orders, cfg) {
  const t0 = new Date(cfg.startDate + 'T08:00:00').getTime() / 1000;
  const mode = cfg.dateMode || 'plan';
  const src = orders.slice().sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const ts = o => o.start ? new Date(o.start.replace(' ', 'T')).getTime() / 1000 : t0;
  const fmt = t => { const d = new Date(t * 1000), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  if (mode === 'seq') {
    const gap = (cfg.seqGapH || 6) * 3600;
    return src.map((o, i) => ({ ...o, start: fmt(t0 + i * gap) }));
  }
  if (mode === 'shift') {
    const min = Math.min(...src.map(ts));
    const off = t0 - min;
    return src.map(o => ({ ...o, start: fmt(ts(o) + off), due: o.due
      ? fmt(new Date(o.due.replace(' ', 'T')).getTime() / 1000 + off) : o.due }));
  }
  return src;
}

/* --------------------------------------------------------------------
   반복 실행 (몬테카를로) — 시드를 바꿔가며 N 회 실행하고 분포를 낸다.
   onProgress(i, n) 가 있으면 청크 단위로 비동기 실행한다.
   -------------------------------------------------------------------- */
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function summarize(v) {
  const s = v.slice().sort((a, b) => a - b);
  const mean = v.reduce((a, x) => a + x, 0) / (v.length || 1);
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, v.length - 1));
  return { n: v.length, mean, sd, min: s[0] || 0, max: s[s.length - 1] || 0,
           p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9), values: s };
}
function monteCarlo(orders, cfg, n, onProgress, done) {
  const runs = [];
  const base = { ...cfg, collectEvents: false };
  let i = 0;
  const chunk = () => {
    const t0 = performance.now();
    while (i < n && performance.now() - t0 < 120) {
      const S = simulate(orders, { ...base, seed: (cfg.seed || 1) + i * 7919 });
      const e = S.stats.find(x => x.id === 'EXP');
      runs.push({
        makespanD: S.kpi.makespanH / 24, expSetupH: S.kpi.expSetupH, totalSetupH: S.kpi.totalSetupH,
        expUtil: S.kpi.expUtil, rework: S.kpi.rework, breakdowns: S.kpi.breakdowns,
        downtimeH: S.kpi.downtimeH, thru: S.kpi.throughputPerDay,
        topUtil: S.stats[0] ? S.stats[0].util : 0, topName: S.stats[0] ? S.stats[0].label : '',
        u1: e && e.units[0] ? e.units[0].jobs : 0, u2: e && e.units[1] ? e.units[1].jobs : 0,
        u3: e && e.units[2] ? e.units[2].jobs : 0, balH: S.kpi.expBalanceH,
      });
      i++;
    }
    if (onProgress) onProgress(i, n);
    if (i < n) setTimeout(chunk, 0);
    else if (done) done(finish());
  };
  const finish = () => ({
    n: runs.length, runs,
    makespanD: summarize(runs.map(r => r.makespanD)),
    expSetupH: summarize(runs.map(r => r.expSetupH)),
    totalSetupH: summarize(runs.map(r => r.totalSetupH)),
    expUtil: summarize(runs.map(r => r.expUtil)),
    rework: summarize(runs.map(r => r.rework)),
    downtimeH: summarize(runs.map(r => r.downtimeH)),
    thru: summarize(runs.map(r => r.thru)),
    topName: runs.length ? runs[0].topName : '',
  });
  if (onProgress || done) { chunk(); return null; }
  while (i < n) {
    const S = simulate(orders, { ...base, seed: (cfg.seed || 1) + i * 7919 });
    const e = S.stats.find(x => x.id === 'EXP');
    runs.push({ makespanD: S.kpi.makespanH / 24, expSetupH: S.kpi.expSetupH, totalSetupH: S.kpi.totalSetupH,
      expUtil: S.kpi.expUtil, rework: S.kpi.rework, breakdowns: S.kpi.breakdowns, downtimeH: S.kpi.downtimeH,
      thru: S.kpi.throughputPerDay, topUtil: S.stats[0] ? S.stats[0].util : 0,
      topName: S.stats[0] ? S.stats[0].label : '',
      u1: e && e.units[0] ? e.units[0].jobs : 0, u2: e && e.units[1] ? e.units[1].jobs : 0,
      u3: e && e.units[2] ? e.units[2].jobs : 0, balH: S.kpi.expBalanceH });
    i++;
  }
  return finish();
}

/* --------------------------------------------------------------------
   시뮬레이터 — 파이프 단위 FIFO 디스패치
   -------------------------------------------------------------------- */
function simulate(orders, cfg) {
  const cal = makeCalendar(cfg);
  /* RB 라인은 1근무조 고정 (M1/M2 는 2~3근). 확관 최적화 운영 모델의 rb_multiplier 근거 */
  const calRB = makeCalendar(cfg, cfg.rbShifts || 1);
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
  const ST = Object.assign({}, STOCH_DEFAULT, cfg.stochastic || {});
  const rng = makeRng(cfg.seed || 1);
  const collect = cfg.collectEvents !== false;
  let nRework = 0, nBreak = 0, downtime = 0;

  const events = [];
  const pipeCount = {};
  const setupWall = {};      // 노드별 벽시계 전환시간 (BOTH 이중 계상 방지)
  const orderSpan = {};
  const ctx = { rr: 0 };
  const bothOrders = new Set(), fixedOrders = new Set();
  let seqGlobal = 0;

  /* 계획 기간 적용 후, 투입 순서: 최적화 스케줄이 있으면 그 순서, 없으면 계획일 순 */
  const plan = cfg.plan || null;
  const deadlineTs = cfg.deadline ? new Date(cfg.deadline + 'T23:59:59').getTime() / 1000 : null;
  let doneInPeriod = 0, overflow = 0;
  const dueStat = { withDue: 0, late: 0, tardyH: 0, maxTardyH: 0 };
  let sorted = applyPeriod(orders, cfg);
  const planRule = (cfg.dispatchRule === 'OPT' || cfg.dispatchRule === 'IMPORT');
  if (plan && planRule && cfg.applyOptSeq !== false && plan.seq && plan.seq.length) {
    const rank = {}; plan.seq.forEach((no, i) => rank[no] = i);
    sorted = sorted.slice().sort((a, b) =>
      (rank[a.no] != null ? rank[a.no] : 9999) - (rank[b.no] != null ? rank[b.no] : 9999));
  }

  for (const o of sorted) {
    const spec = specOf(o, cfg);
    const { route, line } = routeOf(spec, cfg);
    const useOptSeq = plan && planRule && cfg.applyOptSeq !== false && plan.seq && plan.seq.length;
    const rel = useOptSeq ? t0
      : Math.max(t0, o.start ? new Date(o.start.replace(' ', 'T')).getTime() / 1000 : t0);
    let oS = Infinity, oE = -Infinity;

    for (let k = 1; k <= o.qty; k++) {
      seqGlobal++;
      let ready = rel, prevId = null, rework = 0, guard = 0;
      const queue = route.slice();
      while (queue.length && guard++ < 300) {
        const nid = queue.shift();
        const n = NODE[nid];
        if (!n || n.kind === 'buf') continue;
        const units = pools[nid];
        let u, coUnits = null, machine;

        if (nid === 'EXP') {
          let em = expanderMode(spec, cfg);                         // ③ 적격집합 ℰ
          /* 외부/내부 최적화 스케줄이 BOTH 로 지정했으면 그대로 따른다 */
          if (planRule && plan && plan.assign[o.no] === 'BOTH') em = { mode:'BOTH', list:['M1','M2'] };
          if (em.mode === 'BOTH') {
            /* 14M 초과 → #1·#2호기 동시 가동 (소요 = max) */
            coUnits = units.filter(x => x.idx <= 1);
            u = coUnits.reduce((a, b) => (a.free >= b.free ? a : b));  // 늦게 비는 쪽 기준
            machine = 'BOTH';
            bothOrders.add(o.no);
          } else {
            let cand = units.filter(x => em.list.includes(EXP_MACHINES[x.idx].key));
            if (!cand.length) cand = units;
            if (planRule && plan && plan.assign[o.no] && plan.assign[o.no] !== 'BOTH' && plan.assign[o.no] !== 'RB') {
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
        const freeSec = nid === 'RP' ? ST.repairSec : nid === 'RW' ? ST.reweldSec
                      : nid === 'EP' ? ST.expIssueSec : cfg.freeStationSec;
        /* RT 는 노드마다 촬영 방식이 다르다 — 관단 X-ray(XE)=End-RT, F-X ray=전장 450kV */
        const nspec = n.rtType ? Object.assign({}, spec, { rtType: n.rtType }) : spec;
        const res = (n.st === 'Expander')
          ? STD.Expander(nspec, machine === 'M3' ? 'M2' : machine)
          : (fn ? fn(nspec, line, k) : { sec: freeSec, expr: '고정 시간(측정 대상 외)', terms: [] });
        let dur = res.sec;
        const seize = coUnits || [u];
        /* 전환시간도 작업시간과 같은 호기 기준으로 계산해야 한다.
           RB 노드는 풀 인덱스가 0 이라 종전에는 M1 다이표로 전환시간이 계산됐다. */
        let co = (n.free || cfg.changeover === false) ? 0 : Math.max(...seize.map(x =>
          changeoverSec(n.st, x.last, nspec,
            n.st === 'Expander' ? (n.machine || (EXP_MACHINES[x.idx] && EXP_MACHINES[x.idx].key)) : null)));
        if (ST.on) {
          dur *= lnormMul(rng, ST.cvTime);
          if (co > 0) co *= lnormMul(rng, ST.cvSetup);
          if (ST.mtbfH > 0 && rng() < dur / (ST.mtbfH * 3600)) {      // 설비 고장
            const dt = expo(rng, ST.mttrH * 3600);
            dur += dt; nBreak++; downtime += dt;
          }
        }

        const arrive = ready;
        let cs = Math.max(ready, ...seize.map(x => x.free));
        if (nid === 'EXP' && !coUnits) cs = sameODBlockUntil(units, u, spec, cs, cfg);  // 동시 가동 시 동일 외경
        const CAL = RB_LINE.has(nid) ? calRB : cal;
        let st = cs;
        if (co > 0) {
          st = CAL.run(cs, co);
          seize.forEach(x => x.setup += co);            // 호기별 점유(BOTH 는 2대가 각각 점유)
          setupWall[nid] = (setupWall[nid] || 0) + co;  // 노드 벽시계 전환시간 (BOTH 도 1회)
        }
        const en = CAL.run(st, dur);
        for (const x of seize) {
          x.free = en; x.busy += dur; x.jobs++; x.last = { od: spec.od, t: spec.t, L: spec.L };
        }
        pipeCount[nid] = (pipeCount[nid] || 0) + 1;      // 파이프 실제 통과 본수 (BOTH 도 1회)
        ready = en;
        if (collect) events.push({ o: o.no, k, n: nid, p: prevId, u: u.idx, r: arrive, cs, s: st, e: en, d: dur, co,
                      both: !!coUnits, mach: machine, rw: rework > 0 });
        prevId = nid;
        if (st < oS) oS = st;
        if (en > oE) oE = en;

        if (nid === 'PACK' && deadlineTs != null) { if (en <= deadlineTs) doneInPeriod++; else overflow++; }

        /* 불량 발생 → Repair → 용접 문제(보수 용접·재검사) / Expander 문제(재확관) */
        if (ST.on && nid === 'FX' && rework < ST.maxRework && rng() < ST.pDefect) {
          rework++; nRework++;
          /* 남아 있던 꼬리(예: PACK)를 비우고 다시 넣는다.
             비우지 않으면 재작업 1회마다 PACK 이 두 번 실행돼 포장 부하가 과대 계상된다. */
          const back = (rng() < ST.pWeld)
            ? ['RP', 'RW', ...route.slice(route.indexOf('FX'))]
            : ['RP', 'EP', ...route.slice(route.indexOf('EXP'))];
          queue.length = 0; queue.push(...back);
        }
      }
    }
    let tardyH = null;
    if (o.due) {
      const dueTs = new Date(o.due.replace(' ', 'T')).getTime() / 1000;
      dueStat.withDue++;
      tardyH = (oE - dueTs) / 3600;
      if (tardyH > 0) { dueStat.late++; dueStat.tardyH += tardyH; dueStat.maxTardyH = Math.max(dueStat.maxTardyH, tardyH); }
    }
    orderSpan[o.no] = { s: oS, e: oE, qty: o.qty, od: o.od, t: o.t, L: o.L, line, route,
                        due: o.due || null, tardyH };
  }

  /* 가동률 */
  const tEnd = Math.max(...Object.values(orderSpan).map(v => v.e));
  const horizon = tEnd - t0;
  const days = horizon / 86400;
  const availPerUnit = cal.capBetween(t0, tEnd);
  const availRB = calRB.capBetween(t0, tEnd);          // RB 는 1근무조라 가용시간이 다르다
  const stats = [];
  for (const n of NODES) {
    if (n.kind !== 'proc') continue;
    const avail = RB_LINE.has(n.id) ? availRB : availPerUnit;
    const units = pools[n.id];
    const busy = units.reduce((a, u) => a + u.busy, 0);
    const setupUnits = units.reduce((a, u) => a + u.setup, 0);
    /* 노드 전환시간은 **벽시계 기준**으로 센다. BOTH 작업은 한 번의 셋업이 두 호기를 동시에 묶으므로
       호기별 합계(setupUnits)로 세면 이중 계상된다. 호기별 가동률에는 점유 기준(u.setup)을 그대로 쓴다. */
    const setup = (setupWall[n.id] != null) ? setupWall[n.id] : setupUnits;
    const jobs = units.reduce((a, u) => a + u.jobs, 0);
    if (!jobs) continue;
    const unitUtil = units.map(u => avail ? (u.busy + u.setup) / avail * 100 : 0);
    const utilMax = Math.max(...unitUtil), utilMin = Math.min(...unitUtil);
    stats.push({
      id: n.id, label: n.label, st: n.st, cap: units.length,
      jobs: pipeCount[n.id] || jobs,          // 처리 본수 = 실제 파이프 수
      unitJobs: jobs,                          // 호기별 합계 (BOTH 는 2대가 각각 계상)
      busyH: busy / 3600, setupH: setup / 3600, setupUnitsH: setupUnits / 3600,
      /* util = 설비 1대 기준 가동률의 최댓값. 대수로 나눈 평균은 호기 편중을 가려서 쓰지 않는다 */
      util: utilMax,
      utilAvg: avail ? (busy + setup) / (avail * units.length) * 100 : 0,
      shifts: RB_LINE.has(n.id) ? (cfg.rbShifts || 1) : cfg.shifts,
      unitUtil, imbalance: utilMax - utilMin,
      /* 전환 비중은 **설비 점유 기준**(호기별 합계)으로 센다 — busy 도 호기별 합계이므로 단위를 맞춘다 */
      setupShare: (busy + setupUnits) ? setupUnits / (busy + setupUnits) * 100 : 0,
      loadMaxH: Math.max(...units.map(u => (u.busy + u.setup) / 3600)),
      units: units.map((u, i) => ({ id: u.id, busyH: u.busy / 3600, setupH: u.setup / 3600,
                                    jobs: u.jobs, util: unitUtil[i] }))
    });
  }
  stats.sort((a, b) => b.util - a.util);
  const expStat = stats.find(x => x.id === 'EXP');
  const kpi = {
    makespanH: horizon / 3600,
    totalSetupH: stats.reduce((a, x) => a + x.setupH, 0),
    expSetupH: expStat ? expStat.setupH : 0,
    /* expUtil = 확관 호기 중 가장 바쁜 1대의 가동률 (대수 평균이 아님).
       expUtilAvg 를 함께 내보내 "설비군 전체 가동률" 로 오해되지 않게 한다. */
    expUtil: expStat ? expStat.util : 0,
    expUtilAvg: expStat ? expStat.utilAvg : 0,
    expUnitUtil: expStat ? expStat.unitUtil.slice() : [],
    /* 호기 부하 편차 = 전 호기(3호기 포함) 최대−최소.
       **가공 + 전환** 으로 센다. 종전에는 가공시간만 세서, 최적화 엔진이 실제로 최소화하는
       목적항(evalSchedule 의 bal = setup+processing)과 정의가 달랐다. 그 결과 화면 두 곳이
       같은 이름으로 다른 값을 말했고, "최적화로 편차가 줄었다" 는 결론도 뒤집힌다. */
    expBalanceH: expStat && expStat.units.length
      ? Math.max(...expStat.units.map(u => u.busyH + u.setupH)) - Math.min(...expStat.units.map(u => u.busyH + u.setupH)) : 0,
    expBalanceBusyH: expStat && expStat.units.length
      ? Math.max(...expStat.units.map(u => u.busyH)) - Math.min(...expStat.units.map(u => u.busyH)) : 0,
    bothOrders: Array.from(bothOrders), fixedOrders: Array.from(fixedOrders),
    rework: nRework, breakdowns: nBreak, downtimeH: downtime / 3600,
    deadline: deadlineTs, doneInPeriod, overflow, due: dueStat,
    periodDays: deadlineTs ? (deadlineTs - t0) / 86400 : null,
    throughputPerDay: Object.values(orderSpan).reduce((a, v) => a + v.qty, 0) / (horizon / 86400),
    seed: cfg.seed || 1, stochOn: !!ST.on,
  };
  return { events, orderSpan, stats, t0, tEnd, horizonH: horizon / 3600, cal, calRB, kpi,
           rule: cfg.dispatchRule, eligRule: cfg.eligRule };
}
