/* =====================================================================
   JCOE 표준시간 계산 엔진
   출처: ★JCOE 공정 생산 표준 시간 분석 - 20251218 (SMART기술팀)
   모든 시간 단위 = 초(sec).  길이 L: mm 와 m 을 구분해서 사용.
   ===================================================================== */

const MM_PER_INCH = 25.4;
const odInch = (od_mm) => od_mm / MM_PER_INCH;

/* 범위 테이블 조회: rows = [[min,max,val,...], ...] */
function pickRange(rows, x, valIdx = 2) {
  for (const r of rows) if (x >= r[0] && x <= r[1]) return r[valIdx];
  // 범위 밖 → 가장 가까운 경계 사용
  if (x < rows[0][0]) return rows[0][valIdx];
  return rows[rows.length - 1][valIdx];
}
/* 인치 키 테이블 조회 (짝수 인치) — 가장 가까운 값 */
function pickInch(obj, inch) {
  const keys = Object.keys(obj).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - inch) < Math.abs(best - inch)) best = k;
  return obj[best];
}
const ceil = Math.ceil, floor = Math.floor;

/* --------------------------------------------------------------------
   공정별 표준시간.  반환: { sec, terms:[{label,val}], expr }
   spec = { od (mm), t (mm), L (mm), qty, grade:'normal'|'high'|'hiMn',
            api5l:bool, markSpec:1|2, markEnd:1|2, defects:int,
            holdSec:number, rtType:'450kV'|'320kV'|'End-RT' }
   -------------------------------------------------------------------- */
const STD = {};

/* 1~2. Edge Miller (면취) */
STD.EdgeMiller = (s, line) => {
  const L = s.L, Lm = L / 1000;
  const feed = pickRange(T.emFeed, Lm);
  const base = line === '18M' ? 348 : 283;
  if (s.grade === 'hiMn') {
    const b = line === '18M' ? 2163 : 1810;
    const sec = b + L * 0.06 + feed / 215.6;
    return { sec, expr: `${b} + L×0.06 + feed/215.6  (고망간)`,
      terms: [['기본(고망간)', b], ['길이항 L×0.06', L * 0.06], ['피딩기 feed/215.6', feed / 215.6]] };
  }
  const row = T.emSpeed.find(r => s.t >= r.tmin && s.t <= r.tmax) || T.emSpeed[1];
  const v = s.grade === 'high' ? row.high : row.normal;   // 고속 Setting [m/min]
  const sec = base - 123 / v + feed / 215.6 + L * (0.06 / v - 0.0016);
  return { sec, expr: `${base} − 123/v + feed/215.6 + L×(0.06/v − 0.0016), v=${v}m/min, feed=${feed}mm`,
    terms: [['기본', base], ['−123/v', -123 / v], ['피딩기 feed/215.6', feed / 215.6],
            ['길이항', L * (0.06 / v - 0.0016)]] };
};

/* 3~4. Pre Bender */
STD.PreBender = (s, line) => {
  const pitch = pickRange(T.preBenderPitch, s.t);
  const base = line === '18M' ? 46.5 : 30;
  const n = ceil((s.L - 2200) / pitch);
  const sec = base + (pitch / 290 + 17.2) * n;
  return { sec, expr: `${base} + (pitch/290 + 17.2) × ceil((L−2200)/pitch), pitch=${pitch}mm, n=${n}`,
    terms: [['기본', base], [`성형 ${n}회`, (pitch / 290 + 17.2) * n]] };
};

/* 5~6. Press Bender */
STD.PressBender = (s, line) => {
  const inch = Math.round(odInch(s.od) / 2) * 2;
  const x1 = pickInch(T.pressX1, inch);
  const base = line === '18M' ? 203 : 178;
  const k = line === '18M' ? 32 : 36;
  const sec = base + (s.L / 1000) / 0.708 - s.od / 170 + x1 * k;
  return { sec, expr: `${base} + L[m]/0.708 − OD/170 + X1×${k}, X1=${x1}회(${inch}")`,
    terms: [['기본', base], ['길이항 L/0.708', (s.L / 1000) / 0.708], ['외경 보정 −OD/170', -s.od / 170],
            [`X1 Side Press ${x1}회`, x1 * k]] };
};

/* 7. Gap Press  (두께 25T 초과 시에만 투입) */
STD.GapPress = (s) => {
  const Lm = s.L / 1000;
  const seg = ceil(Lm / 6);
  const hi = s.grade === 'high';          // X70 이상인 경우 [ ]×2 추가 적용
  const bracket = seg * (45 + 20) * 2 * 2 * (hi ? 2 : 1);
  const sec = 464 - Lm / 0.3 + bracket;
  return { sec, expr: `464 − L[m]/0.3 + [ceil(L/6)×65×2]×2${hi ? '×2(X70↑)' : ''}, ceil(L/6)=${seg}`,
    terms: [['기본', 464], ['길이 보정 −L/0.3', -Lm / 0.3], [`프레스 ${seg}구간`, bracket]] };
};

/* 8. Tack Welder (태그 웰딩) */
STD.TackWelder = (s, line) => {
  const v = pickRange(T.tackWeld, s.t);          // mm/s
  const base = line === '18M' ? 185 : 200;
  const sec = base + s.L / v;
  return { sec, expr: `${base} + L / v,  v=${v.toFixed(1)}mm/s (WPS t=${s.t})`,
    terms: [['이송·Gap조정', base], ['용접 L/v', s.L / v]] };
};

/* 9. Inside Welder (내면 SAW) */
STD.InsideWelder = (s, line) => {
  const v = pickRange(T.insideWeld, s.t);
  const p = pickRange(T.insideWeld, s.t, 3);
  const base = line === '18M' ? 670 : 710;
  const sec = base + s.L / v;
  return { sec, expr: `${base} + L / v,  v=${v.toFixed(2)}mm/s, ${p}pass (WPS)`,
    terms: [['장입·Setting·배출', base], [`용접 L/v (${p}pass)`, s.L / v]] };
};

/* 10. Outside Welder (외면 SAW) */
STD.OutsideWelder = (s, line) => {
  const v = pickRange(T.outsideWeld, s.t);
  const p = pickRange(T.outsideWeld, s.t, 3);
  const base = line === '18M' ? 510 : 550;
  const sec = base + s.L / v;
  return { sec, expr: `${base} + L / v,  v=${v.toFixed(2)}mm/s, ${p}pass (WPS)`,
    terms: [['장입·Setting·배출', base], [`용접 L/v (${p}pass)`, s.L / v]] };
};

/* 11. 1st-UT (관단탭 절단 포함) */
STD.FirstUT = (s) => {
  const cv = pickRange(T.utCut, s.t);
  const sec = 240 + s.L / 150 + (9600 / cv) * 2;
  return { sec, expr: `240 + L/150 + (9600/절단속도)×2, 절단속도=${cv}`,
    terms: [['기본', 240], ['이송 L/150', s.L / 150], ['탭 절단 ×2', (9600 / cv) * 2]] };
};

/* 확관 Step Size / 확관 횟수 N */
function expanderStep(s) {
  const inch = Math.round(odInch(s.od));
  const keys = Object.keys(T.expanderDie).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - inch) < Math.abs(best - inch)) best = k;
  const dies = T.expanderDie[best];
  let die = dies.find(d => d[0] >= s.t) || dies[dies.length - 1];
  return { step: die[1], dieT: die[0], inch: best };
}
function expanderN(s) {
  const { step } = expanderStep(s);
  let n = ceil((s.L - 500) / step) + 2;
  if (n % 2 === 0) n += 1;                 // N은 항상 홀수
  return n;
}

/* 12~13. Expander (확관) — 병목 발생지 */
STD.Expander = (s, machine) => {
  const n = expanderN(s), d = expanderStep(s);
  if (machine === 'BOTH') {                 // 14M 초과 → #1·#2호기 동시 가동
    const a = 177 + n * 12 + (s.L + 3500) / 300, b = 165 + n * 7.5;
    return { sec: Math.max(a, b),
      expr: `#1·#2호기 동시 가동: max(#1 ${a.toFixed(0)}s, #2 ${b.toFixed(0)}s),  N=${n}회, step=${d.step}mm`,
      terms: [['#1호기 소요', a], ['#2호기 소요', b], ['동시 가동 → max 적용', Math.max(a, b)]] };
  }
  if (machine === 'RB') {
    const sec = 234 + (ceil(s.L / d.step) - 2) * 15;
    return { sec, expr: `RB라인: 234 + (ceil(L/step)−2)×15, step=${d.step}mm`,
      terms: [['기본', 234], ['확관', (ceil(s.L / d.step) - 2) * 15]] };
  }
  if (machine === 'M1') {
    const sec = 177 + n * 12 + (s.L + 3500) / 300;
    return { sec, expr: `#1호기: 177 + N×12 + (L+3500)/300,  N=${n}회, step=${d.step}mm`,
      terms: [['기본', 177], [`확관 ${n}회 ×12s`, n * 12], ['이송 (L+3500)/300', (s.L + 3500) / 300]] };
  }
  const sec = 165 + n * 7.5;
  return { sec, expr: `#2호기: 165 + N×7.5,  N=${n}회(홀수), step=${d.step}mm (${d.inch}" die t${d.dieT})`,
    terms: [['기본', 165], [`확관 ${n}회 ×7.5s`, n * 7.5]] };
};

/* 14. End-Facing (면취기) */
STD.EndFacing = (s) => {
  const inch = Math.round(odInch(s.od) / 2) * 2;
  let best = null, bd = 1e9;
  for (const r of T.endFacing) {
    if (s.t >= r[1] && s.t < r[2]) { const d = Math.abs(r[0] - inch); if (d < bd) { bd = d; best = r; } }
  }
  if (!best) best = T.endFacing[T.endFacing.length - 1];
  const sec = 363 + best[3];
  return { sec, expr: `363 + 저속절삭시간(${best[0]}", t${best[1]}~${best[2]}) = 363 + ${best[3]}s`,
    terms: [['기본', 363], ['저속 절삭(안전계수 K=1.5)', best[3]]] };
};

/* 15. Outer bead removal (슬러그/비드 제거) */
STD.OuterBead = (s) => ({
  sec: 55 + s.L / 20, expr: `55 + L/20  (컨베이어 1.2m/min)`,
  terms: [['기본', 55], ['이송 L/20', s.L / 20]]
});

/* 16. Hydraulic Tester (수압) */
STD.HydroTest = (s) => {
  const inch = Math.round(odInch(s.od) / 2) * 2;
  let fill = pickInch(T.hydroFill, inch);
  if (s.L / 1000 >= 17) fill += 20;                       // 18미터일 시 20초씩 추가
  const big = inch >= 36;
  const de = big ? T.hydroConst.deflate2nd_36up : T.hydroConst.deflate2nd;
  const av = big ? T.hydroConst.airVent_36up : T.hydroConst.airVent;
  const hold = s.holdSec != null ? s.holdSec : 60;        // MES 제작시방서 조회값
  const sec = 90 + fill + 30 + hold + de + av;
  return { sec, expr: `90 + 충수(${fill}s) + 압력상승(30s) + 유지(${hold}s) + 2차압빼기(${de}s) + 에어벤트(${av}s)`,
    terms: [['기본', 90], [`충수 ${inch}"`, fill], ['압력 상승', 30], ['압력 유지(MES)', hold],
            ['2차 압빼기', de], ['에어 벤트', av]] };
};

/* 17. Final-UT */
STD.FinalUT = (s) => ({
  sec: 200 + s.L / 216.7, expr: `200 + L/216.7`,
  terms: [['기본', 200], ['스캔 L/216.7', s.L / 216.7]]
});

/* 18. RT (X-ray) */
STD.RT = (s) => {
  const df = s.defects || 0;
  if (s.rtType === 'End-RT') {
    const sec = 240 + (s.L - 280) / 140 + s.L / 180 + df * 60;
    return { sec, expr: `End-RT: 240 + (L−280)/140 + L/180 + 불량×60`,
      terms: [['기본', 240], ['(L−280)/140', (s.L - 280) / 140], ['L/180', s.L / 180], [`불량 ${df}개소`, df * 60]] };
  }
  const base = s.rtType === '320kV' ? 345 : 325;
  const shots = ceil(s.L / 140);
  const sec = base + shots * 7.5 + df * 120;
  return { sec, expr: `${base} + ceil(L/140)×7.5 + 불량×120,  ${shots}회 촬영`,
    terms: [['기본', base], [`촬영 ${shots}회`, shots * 7.5], [`불량 ${df}개소`, df * 120]] };
};

/* 19. 포장 */
STD.Packing = (s, _l, seq) => {
  const mk = 30 * (s.markSpec || 2) * (s.markEnd || 2);
  const extra = (seq && seq % 10 === 0) ? 250 : 0;         // 1/10본마다 추가 검사
  const sec = 634 + (45000 - s.L) / 270 + mk + extra;
  return { sec, expr: `634 + (45000−L)/270 + 30×마킹사양(${s.markSpec || 2})×관단(${s.markEnd || 2})${extra ? ' + 250(10본째)' : ''}`,
    terms: [['기본', 634], ['이송 (45000−L)/270', (45000 - s.L) / 270], ['마킹', mk]].concat(extra ? [['10본째 추가검사', extra]] : []) };
};

/* --------------------------------------------------------------------
   설비 전환(Changeover) 시간 [초]  — PPT: "설비 전환 시간을 최소화하도록 스케줄링 필요"
   -------------------------------------------------------------------- */
const CHANGEOVER = {
  EdgeMiller:   { od: 0,    t: 1800, L: 0    },  // X-Tool 교체 30분 (25T 경계)
  PreBender:    { od: 1800, t: 900,  L: 0    },  // Upper/Lower Tool 교체
  PressBender:  { od: 3600, t: 0,    L: 0    },  // 상툴 1시간 / 하툴
  GapPress:     { od: 600,  t: 0,    L: 0    },
  TackWelder:   { od: 300,  t: 300,  L: 0    },
  InsideWelder: { od: 600,  t: 900,  L: 0    },  // WPS 변경
  OutsideWelder:{ od: 600,  t: 900,  L: 0    },
  FirstUT:      { od: 150,  t: 150,  L: 0    },  // UT Calibration 2.5min
  Expander:     { od: 5400, t: 1800, L: 3600 },  // 다이/헤드 교체 — 최대 병목
  EndFacing:    { od: 3600, t: 600,  L: 0    },  // 클램프 교체 60분(외경 변화 시)
  OuterBead:    { od: 120,  t: 0,    L: 0    },
  HydroTest:    { od: 3000, t: 0,    L: 0    },  // 수압 면판 교체 40~60분
  FinalUT:      { od: 150,  t: 150,  L: 0    },
  RT:           { od: 300,  t: 300,  L: 0    },
  Packing:      { od: 300,  t: 0,    L: 600  },
};
function changeoverSec(station, prev, cur) {
  if (!prev) return 0;
  const c = CHANGEOVER[station]; if (!c) return 0;
  let s = 0;
  if (Math.abs(prev.od - cur.od) > 0.5) s += c.od;
  if (Math.abs(prev.t - cur.t) > 0.5) s += c.t;
  if (Math.abs(prev.L - cur.L) > 1) s += c.L;
  // Edge Miller 은 25T 경계를 넘을 때만 Tool 교체
  if (station === 'EdgeMiller' && (prev.t >= 25) === (cur.t >= 25)) s = 0;
  return s;
}
