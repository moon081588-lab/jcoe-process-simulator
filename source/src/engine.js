/* =====================================================================
   JCOE 표준시간 계산 엔진
   출처: ★JCOE 공정 생산 표준 시간 분석 - 20251218 (SMART기술팀)
   모든 시간 단위 = 초(sec).  길이 L: mm 와 m 을 구분해서 사용.
   ===================================================================== */

const MM_PER_INCH = 25.4;
const odInch = (od_mm) => od_mm / MM_PER_INCH;

/* 범위 테이블 조회: rows = [[min,max,val,...], ...]
   엑셀 표는 구간이 1/100 단위로 끊겨 있어 사이에 "구멍"(예: 29.0~29.1)이 71곳 있습니다.
   종전에는 구멍에 떨어진 값이 조용히 '마지막 행'(가장 두꺼운=가장 느린 조건)을 받아
   두께 29.05mm 같은 입력에서 용접시간이 29% 과대 계상됐습니다.
   → 구멍에 떨어지면 가장 가까운 구간을 쓰고, 동점이면 위쪽(보수적) 구간을 씁니다. */
function pickRange(rows, x, valIdx = 2) {
  for (const r of rows) if (x >= r[0] && x <= r[1]) return r[valIdx];
  if (x < rows[0][0]) return rows[0][valIdx];
  if (x > rows[rows.length - 1][1]) return rows[rows.length - 1][valIdx];
  let best = rows[rows.length - 1], bd = Infinity;
  for (const r of rows) {
    const d = x < r[0] ? r[0] - x : x - r[1];
    if (d < bd || (d === bd && r[0] > x)) { bd = d; best = r; }   // 동점 → 위쪽 구간
  }
  return best[valIdx];
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

/* ====================================================================
   확관 공구(Head / Drawbar / Die) — 세아제강 운영 최적화 모델(specs.py) 이식
   T.dieSpec = { M1|M2|RB: [ [headGroup, od_mm, tmin, tmax, step_mm, label], ... ] }
   호기별 다이 스펙이 서로 다르므로 반드시 machine 을 넘겨야 한다.
   ==================================================================== */
const DIE_KEY = { M1: 'M1', M2: 'M2', M3: 'M2', RB: 'RB', BOTH: 'M1' };
const TDIFF_WARN = 3.0;          // 두께 최근접 매칭이 이 이상 벌어지면 경고

/** 외경 ±5mm 근사 + 두께 최근접으로 (헤드그룹, 드로바, 다이) 결정
    매칭 실패 시 die 를 규격 자체로 만들어 둔다 — 종전처럼 모두 'UNKNOWN' 이면
    서로 다른 규격 사이에서도 "교체 없음 0초" 가 되어 실제 공구 교체를 놓친다. */
function toolInfo(od, t, machine) {
  const rows = (T.dieSpec || {})[DIE_KEY[machine] || 'M2'] || [];
  /* 두께 판정 — specs.py 와 동일하게:
     · 구간 표기(18.6~38.1t) 는 구간 안이면 차이 0, 밖이면 가까운 경계까지의 거리
     · 단일 표기(18.9t) 는 math.isclose(abs_tol=0.1) 로 ±0.1mm 까지 "일치"(차이 0) 로 본다.
     이 ±0.1 규칙이 없으면 OD914 t18.8 에서 18.9t(580mm) 대신 18.6~38.1t(340mm) 가 잡혀
     확관 횟수가 25 → 39 회로 튄다. */
  const tDiffOf = (tmin, tmax) => (tmin !== tmax)
    ? ((t >= tmin && t <= tmax) ? 0 : Math.min(Math.abs(t - tmin), Math.abs(t - tmax)))
    : ((Math.abs(t - tmin) <= 0.1) ? 0 : Math.abs(t - tmin));
  const pickIn = (cand) => {
    let b = null, bd = Infinity;
    for (const r of cand) { const d = tDiffOf(r[2], r[3]); if (d < bd) { bd = d; b = { head:r[0], od:r[1], step:r[4], label:r[5] }; } }
    return b ? { best: b, tDiff: bd } : null;
  };

  /* 1차 — 외경 ±5mm 이내 (specs.get_tool_info 와 동일) */
  let hit = pickIn(rows.filter(r => Math.abs(r[1] - od) <= 5)), odGap = 0;

  /* 2차 — ±5mm 안에 후보가 없으면 **가장 가까운 외경**의 공구로 매핑한다.
     세아제강 2026-08-06: "로직에는 해당 오더의 스펙과 가장 가까운 tool 에 매핑되도록 해놓았습니다."
     specs.py 는 여기서 (None, None, UNKNOWN) 을 반환해 서로 다른 규격 사이에도 셋업이 0초가 됐다.
     폴백을 두면 드로바/헤드 교체가 제대로 판정되고, RB 적격 판정도 자연스럽게 근사값이 된다. */
  if (!hit && rows.length) {
    let nearestOd = null, nd = Infinity;
    for (const r of rows) { const d = Math.abs(r[1] - od); if (d < nd) { nd = d; nearestOd = r[1]; } }
    hit = pickIn(rows.filter(r => r[1] === nearestOd));
    odGap = nd;
  }
  if (!hit) {
    return { head: null, drawbar: `NA_${Math.round(od)}`, die: `NA|${Math.round(od)}|${t}`,
             step: null, label: '다이표 없음', unknown: true, tDiff: null, odGap: null };
  }
  const best = hit.best;
  const drawbar = (DIE_KEY[machine] === 'RB') ? `RB_${best.head}`
                : (best.head === 450 ? 'SMALL' : 'LARGE');
  /* die 식별자는 specs.py 와 동일하게 **입력 외경**을 쓴다 (die_id = (diameter, spec)).
     계획서 로더가 외경을 정수로 절사하므로 OD 711.0 과 711.2 는 같은 711 이 된다. */
  /* die 식별자 — 정확 매칭(±5mm)일 때는 specs.py 와 같이 **입력 외경**을 쓴다(die_id=(diameter, spec)).
     최근접 폴백으로 잡힌 경우에는 서로 다른 외경이 **같은 물리 다이 하나**로 매핑되므로,
     매칭된 다이표 외경을 키로 써야 없는 다이 교체 90분이 붙지 않는다. */
  return { head: best.head, drawbar, die: `${odGap > 0 ? best.od : od}|${best.label}`, step: best.step,
           label: best.label, tDiff: hit.tDiff, odGap,
           warn: hit.tDiff > TDIFF_WARN || odGap > 5,
           approx: odGap > 5 ? `외경 ${Math.round(od)} → 다이표 ${best.od} (${odGap.toFixed(0)}mm 차)` : null };
}

/** 확관 Step Size / 다이 정보 (호기별) */
function expanderStep(s, machine) {
  const ti = toolInfo(s.od, s.t, machine || 'M2');
  if (ti.step) return { step: ti.step, dieT: ti.label, inch: Math.round(odInch(s.od)), tool: ti };
  /* 호기별 다이표에 없으면 엑셀 「Expander(1호기)」 표로 폴백 */
  const inch = Math.round(odInch(s.od));
  const keys = Object.keys(T.expanderDie).map(Number).sort((a, b) => a - b);
  let bk = keys[0];
  for (const k of keys) if (Math.abs(k - inch) < Math.abs(bk - inch)) bk = k;
  const dies = T.expanderDie[bk];
  const die = dies.find(d => d[0] >= s.t) || dies[dies.length - 1];
  return { step: die[1], dieT: `t${die[0]}`, inch: bk, tool: ti, fallback: true };
}

/* 확관 횟수 N — 산출 근거가 두 가지로 갈려 있어 토글로 병기한다.
   'ortools' : 세아제강 운영 최적화 모델(specs.py) 구현 — 기본값(정본)
               M1  N = round(L / (step − (step≤150 ? 100 : 150)))
               M2  N = ceil((L−500)/step) + 2, 홀수면 +1 → 항상 짝수
   'excel'   : 「JCOE 공정 생산 표준 시간 분석」 시트 산출식 — 대조용
               N = ceil((L−500)/step) + 2, 짝수면 +1 → 항상 홀수
   두 식은 step 이 작을수록(=두꺼운 관) 크게 벌어진다.
   2026-08-06 세아제강 피드백 — "specs.py 가 맞습니다" → 운영 모델 식을 기본값으로 채택. */
let EXP_NMODE = 'ortools';
function setExpanderNMode(m) { EXP_NMODE = (m === 'excel') ? 'excel' : 'ortools'; }
function expanderNMode() { return EXP_NMODE; }

function expanderN(s, machine) {
  const { step } = expanderStep(s, machine);
  if (EXP_NMODE === 'ortools' && (machine === 'M1' || machine === 'BOTH')) {
    /* specs.calculate_time_m1 그대로 — 하한을 두지 않는다.
       step 이 작을수록 분모(step−150 또는 step−100)가 급격히 줄어 N 이 크게 튄다.
       예) OD508 t9.5 step170 → 분모 20 → 11.5m 에서 N=575 회 (2,987s → 7,127s).
       종전에는 하한 50 을 두었으나 정본과 어긋나므로 제거했다.
       분모가 0 이하가 되는 표상의 step 은 없지만, 만약을 대비해 0 나눗셈만 막는다. */
    const den = step - (step <= 150 ? 100 : 150);
    return Math.round(s.L / (den > 0 ? den : 1));
  }
  let n = ceil((s.L - 500) / step) + 2;
  if (EXP_NMODE === 'ortools') { if (n % 2 === 1) n += 1; }   // 짝수 보정
  else                        { if (n % 2 === 0) n += 1; }   // 홀수 보정
  return n;
}

/* 12~13. Expander (확관) — 병목 발생지 */
STD.Expander = (s, machine) => {
  const tag = EXP_NMODE === 'ortools' ? '[운영모델 N식]' : '[엑셀 N식]';
  if (machine === 'BOTH') {                 // 14.021m 초과 → #1·#2호기 동시 가동
    const n1 = expanderN(s, 'M1'), n2 = expanderN(s, 'M2');
    const a = 177 + n1 * 12 + (s.L + 3500) / 300, b = 165 + n2 * 7.5;
    return { sec: Math.max(a, b),
      expr: `#1·#2호기 동시 가동: max(#1 ${a.toFixed(0)}s, #2 ${b.toFixed(0)}s) ${tag}`,
      terms: [['#1호기 소요', a], ['#2호기 소요', b], ['동시 가동 → max 적용', Math.max(a, b)]] };
  }
  const d = expanderStep(s, machine), n = expanderN(s, machine);
  if (machine === 'RB') {
    const sec = 234 + (ceil(s.L / d.step) - 2) * 15;
    return { sec, expr: `RB라인: 234 + (ceil(L/step)−2)×15, step=${d.step}mm`,
      terms: [['기본', 234], ['확관', (ceil(s.L / d.step) - 2) * 15]] };
  }
  if (machine === 'M1') {
    const sec = 177 + n * 12 + (s.L + 3500) / 300;
    return { sec, expr: `#1호기: 177 + N×12 + (L+3500)/300,  N=${n}회, step=${d.step}mm ${tag}`,
      terms: [['기본', 177], [`확관 ${n}회 ×12s`, n * 12], ['이송 (L+3500)/300', (s.L + 3500) / 300]] };
  }
  const sec = 165 + n * 7.5;
  return { sec, expr: `#2호기: 165 + N×7.5,  N=${n}회, step=${d.step}mm (${d.dieT}) ${tag}`,
    terms: [['기본', 165], [`확관 ${n}회 ×7.5s`, n * 7.5]] };
};

/* 14. End-Facing (면취기) */
STD.EndFacing = (s) => {
  const inch = Math.round(odInch(s.od) / 2) * 2;
  /* 두께 구간이 8~15 / 15~30 / 30~999 뿐이라 t < 8 이면 어떤 행도 매칭되지 않는다.
     종전 폴백은 표의 마지막 행(64" · t30~999 · 가장 느림)이라, 외경을 무시하고 최악값을 잡았다.
     (t 7.0 → 880.1s / t 8.0 → 506.6s 로 0.1mm 차이에 +74% 점프)
     구간 밖이면 pickRange 와 같은 원칙으로 **가장 가까운 두께 구간**을 쓴다. */
  let best = null, bd = 1e9;
  const score = (r) => {
    const tGap = (s.t >= r[1] && s.t < r[2]) ? 0 : Math.min(Math.abs(s.t - r[1]), Math.abs(s.t - r[2]));
    return tGap * 1000 + Math.abs(r[0] - inch);        // 두께 구간 적합도 우선, 그다음 외경 근접
  };
  for (const r of T.endFacing) { const d = score(r); if (d < bd) { bd = d; best = r; } }
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
  Expander:     { od: 5400, t: 1800, L: 3600 },  // (폴백) 실제는 EXP_SETUP 공구 계층 룰 사용
  EndFacing:    { od: 3600, t: 600,  L: 0    },  // 클램프 교체 60분(외경 변화 시)
  OuterBead:    { od: 120,  t: 0,    L: 0    },
  HydroTest:    { od: 3000, t: 0,    L: 0    },  // 수압 면판 교체 40~60분
  FinalUT:      { od: 150,  t: 150,  L: 0    },
  RT:           { od: 300,  t: 300,  L: 0    },
  Packing:      { od: 300,  t: 0,    L: 600  },
};
/* 확관 셋업 — 공구 계층 룰 (세아제강 운영 최적화 모델 specs.get_setup_time_val)
   드로바 교체 270분 > 헤드 교체 150분 > 다이 교체 90분 > 동일 0
   od/t 변화폭이 아니라 "장착 공구가 실제로 바뀌는가"로 판정한다. */
const EXP_SETUP = { drawbar: 270 * 60, head: 150 * 60, die: 90 * 60 };
let EXP_SETUP_MODE = 'tool';                       // 'tool' | 'legacy'
function setExpSetupMode(m) { EXP_SETUP_MODE = (m === 'legacy') ? 'legacy' : 'tool'; }
function expanderSetup(prev, cur, machine) {
  if (!prev) return { sec: 0, kind: '없음' };
  const a = toolInfo(prev.od, prev.t, machine || 'M2');
  const b = toolInfo(cur.od,  cur.t,  machine || 'M2');
  /* 한쪽이라도 다이표에 없는 규격이면 판정 불가.
     규격이 다르면 최소 다이 교체는 일어난다고 보고 보수적으로 부과한다. */
  if (a.unknown || b.unknown) {
    if (Math.abs(prev.od - cur.od) < 0.5 && Math.abs(prev.t - cur.t) < 0.05)
      return { sec: 0, kind: '교체 없음', from: a, to: b, unknown: true };
    return { sec: EXP_SETUP.die, kind: 'Die 교체(공구 미상 — 보수적 추정)', from: a, to: b, unknown: true };
  }
  if (a.drawbar !== b.drawbar) return { sec: EXP_SETUP.drawbar, kind: 'Drawbar 교체', from: a, to: b };
  if (a.head    !== b.head)    return { sec: EXP_SETUP.head,    kind: 'Head 교체',    from: a, to: b };
  if (a.die     !== b.die)     return { sec: EXP_SETUP.die,     kind: 'Die 교체',     from: a, to: b };
  return { sec: 0, kind: '교체 없음', from: a, to: b };
}

function changeoverSec(station, prev, cur, machine) {
  if (!prev) return 0;
  if (station === 'Expander' && EXP_SETUP_MODE === 'tool') return expanderSetup(prev, cur, machine).sec;
  const c = CHANGEOVER[station]; if (!c) return 0;
  let s = 0;
  if (Math.abs(prev.od - cur.od) > 0.5) s += c.od;
  if (Math.abs(prev.t - cur.t) > 0.5) s += c.t;
  if (Math.abs(prev.L - cur.L) > 1) s += c.L;
  // Edge Miller 은 25T 경계를 넘을 때만 Tool 교체
  /* 경계는 Gap Press 투입 조건·재질 대리변수와 같은 `t > 25` 로 통일 (종전 `>= 25` 는 t=25.0 에서 어긋남) */
  if (station === 'EdgeMiller' && (prev.t > 25) === (cur.t > 25)) s = 0;
  return s;
}
