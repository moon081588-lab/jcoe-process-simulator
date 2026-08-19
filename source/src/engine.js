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
/* ====================================================================
   기준정보 (REF) — 현장에서 바꿀 수 있는 값을 한곳에 모은다
   --------------------------------------------------------------------
   종전에는 표준시간 상수가 아래 STD 함수들 **안에 숫자로 박혀** 있어서
   현장에서 값을 하나 고치려면 코드를 열고 build.py 를 다시 돌려야 했다.
   이제 전부 REF.std 를 통해 읽으므로 화면(「기준정보」 탭)에서 고칠 수 있고,
   고친 내용은 JSON 한 장으로 내보내고 불러올 수 있다.

   ★ 값의 출처는 전부 「JCOE 공정 생산 표준 시간 분석」 엑셀 Total Summary 다.
     src 필드에 엑셀 행 번호를 적어 두었으니 화면에서 근거를 바로 확인할 수 있다.
   ==================================================================== */
const REF_STD_DEFAULT = {
  EdgeMiller: { _label:'1~2. Edge Miller', _src:'row 6~9',
    base18:{v:348,u:'s',l:'기본 (18M)'},        base12:{v:283,u:'s',l:'기본 (12M)'},
    hiMn18:{v:2163,u:'s',l:'기본 (18M 고망간)'}, hiMn12:{v:1810,u:'s',l:'기본 (12M 고망간)'},
    vNum:{v:123,u:'',l:'고속보정 분자 (−123/v)'},
    feedDiv:{v:215.6,u:'',l:'피딩기 분모 (feed/215.6)'},
    lenA:{v:0.06,u:'',l:'길이항 계수 A (0.06/v)'},
    lenB:{v:0.0016,u:'',l:'길이항 계수 B (−0.0016)'},
    firstPiece:{v:110,u:'s',l:'첫 본 생산 가산 (1분50초)'} },
  PreBender: { _label:'3~4. Pre Bender', _src:'row 10~11',
    base18:{v:46.5,u:'s',l:'기본 (18M)'}, base12:{v:30,u:'s',l:'기본 (12M)'},
    pitchDiv:{v:290,u:'',l:'피치 분모 (pitch/290)'},
    perStroke:{v:17.2,u:'s',l:'1스트로크 가산'},
    lead:{v:2200,u:'mm',l:'선단 여유 (L−2200)'} },
  PressBender: { _label:'5~6. Press Bender', _src:'row 12~13',
    base18:{v:203,u:'s',l:'기본 (18M)'}, base12:{v:178,u:'s',l:'기본 (12M)'},
    lenDiv:{v:0.708,u:'',l:'길이항 분모 (L[m]/0.708)'},
    odDiv:{v:170,u:'',l:'외경 보정 분모 (−OD/170)'},
    k18:{v:32,u:'s',l:'X1 1회당 (18M)'}, k12:{v:36,u:'s',l:'X1 1회당 (12M)'} },
  GapPress: { _label:'7. Gap Press (t>25 투입)', _src:'row 14',
    base:{v:464,u:'s',l:'기본'},
    lenDiv:{v:0.3,u:'',l:'길이 보정 분모 (−L[m]/0.3)'},
    segLen:{v:6,u:'m',l:'구간 길이 (ceil(L/6))'},
    per:{v:65,u:'s',l:'구간당 (45+20)'},
    mult:{v:2,u:'배',l:'대괄호 안 배수'},
    x70:{v:2,u:'배',l:'X70 이상 추가 배수'} },
  TackWelder: { _label:'8. Tack Welder', _src:'row 15',
    base18:{v:185,u:'s',l:'이송·Gap조정 (18M)'}, base12:{v:200,u:'s',l:'이송·Gap조정 (12M)'} },
  InsideWelder: { _label:'9. Inside Welder', _src:'row 16',
    base18:{v:670,u:'s',l:'장입·Setting·배출 (18M)'}, base12:{v:710,u:'s',l:'장입·Setting·배출 (12M)'} },
  OutsideWelder: { _label:'10. Outside Welder', _src:'row 17',
    base18:{v:510,u:'s',l:'장입·Setting·배출 (18M)'}, base12:{v:550,u:'s',l:'장입·Setting·배출 (12M)'} },
  FirstUT: { _label:'11. 1st-UT', _src:'row 18',
    base:{v:240,u:'s',l:'기본'}, feedDiv:{v:150,u:'',l:'이송 분모 (L/150)'},
    cutLen:{v:9600,u:'',l:'탭 절단 분자 (9600/절단속도)'},
    cutTimes:{v:2,u:'회',l:'탭 절단 횟수'} },
  Expander: { _label:'12~13. Expander (확관)', _src:'row 19·22·23 + Expander(RB)!J4',
    m1Base:{v:177,u:'s',l:'#1호기 기본'},   m1Per:{v:12,u:'s',l:'#1호기 확관 1회당'},
    m1FeedAdd:{v:3500,u:'mm',l:'#1호기 이송 가산 (L+3500)'},
    m1FeedDiv:{v:300,u:'',l:'#1호기 이송 분모 (/300)'},
    m2Base:{v:165,u:'s',l:'#2호기 기본'},   m2Per:{v:7.5,u:'s',l:'#2호기 확관 1회당'},
    rbBase:{v:234,u:'s',l:'R/B 기본'},      rbPer:{v:15,u:'s',l:'R/B 확관 1회당'},
    rbOffset:{v:2,u:'회',l:'R/B 확관 횟수 차감 (N−2)'},
    marginM1:{v:150,u:'mm',l:'#1·#2호기 Step 여유 (다이−150)'},
    marginM1Small:{v:100,u:'mm',l:'#1호기 소형 다이 여유 (step≤150 → −100)'},
    marginRB:{v:90,u:'mm',l:'R/B Step 여유 (다이−90)'},
    setupDrawbar:{v:270,u:'분',l:'셋업 — Drawbar 교체'},
    setupHead:{v:150,u:'분',l:'셋업 — Head 교체'},
    setupDie:{v:90,u:'분',l:'셋업 — Die 교체'} },
  EndFacing: { _label:'14. End-Facing', _src:'row 24',
    base:{v:363,u:'s',l:'기본 (저속절삭은 표 참조)'} },
  OuterBead: { _label:'15. Outer bead removal', _src:'row 25',
    base:{v:55,u:'s',l:'기본'}, feedDiv:{v:20,u:'',l:'이송 분모 (L/20, 컨베이어 1.2m/min)'} },
  HydroTest: { _label:'16. Hydraulic Tester (수압)', _src:'row 26',
    base:{v:90,u:'s',l:'기본'}, riseSec:{v:30,u:'s',l:'압력 상승'},
    longAdd:{v:20,u:'s',l:'18M 충수 가산'}, longThresholdM:{v:17,u:'m',l:'18M 판정 기준 길이'},
    bigInch:{v:36,u:'"',l:'대구경 판정 (이상이면 2차압빼기·에어벤트 상수 변경)'} },
  FinalUT: { _label:'17. Final-UT', _src:'row 27',
    base:{v:200,u:'s',l:'기본'}, scanDiv:{v:216.7,u:'',l:'스캔 분모 (L/216.7)'} },
  RT: { _label:'18. RT (X-ray)', _src:'row 28~29',
    base450:{v:325,u:'s',l:'기본 (전장 450kV)'}, base320:{v:345,u:'s',l:'기본 (전장 320kV)'},
    shotLen:{v:140,u:'mm',l:'1회 촬영 길이 (ceil(L/140))'},
    shotSec:{v:7.5,u:'s',l:'1회 촬영 시간'},
    defectSec:{v:120,u:'s',l:'불량 1개소당 (전장)'},
    endBase:{v:240,u:'s',l:'기본 (관단 End-RT)'},
    endLead:{v:280,u:'mm',l:'관단 선단 여유 (L−280)'},
    endDivA:{v:140,u:'',l:'관단 분모 A'}, endDivB:{v:180,u:'',l:'관단 분모 B'},
    endDefectSec:{v:60,u:'s',l:'불량 1개소당 (관단)'} },
  Packing: { _label:'19. 포장', _src:'row 30',
    base:{v:634,u:'s',l:'기본'},
    refLen:{v:45000,u:'mm',l:'이송 기준 길이 ((45000−L)/270)'},
    feedDiv:{v:270,u:'',l:'이송 분모'},
    markSec:{v:30,u:'s',l:'마킹 1건당 (×마킹사양×관단)'},
    extraEvery:{v:10,u:'본',l:'추가 검사 주기 (n본마다)'},
    extraSec:{v:250,u:'s',l:'추가 검사 소요'} },
};

/* 편집 가능한 현재값. REF.std[공정][키] 로 읽는다. */
function refClone(o) { return JSON.parse(JSON.stringify(o)); }
const REF = { std: refClone(REF_STD_DEFAULT), co: null, cap: {} };
/** 설비 대수 반영. patch = { 노드ID: 대수 } — 빈 객체면 코드 기본값 사용 */
function setRefCap(patch) {
  REF.cap = {};
  if (patch && typeof patch === 'object') for (const id in patch) {
    if (!own(patch, id)) continue;
    /* 확관(EXP) 대수는 「설정」 탭의 #3호기 사용 여부로 정해진다.
       여기서 받아 두면 적용은 안 되면서 「변경 1개」로만 남아, 기준선 재기준이 영영 안 된다. */
    if (id === 'EXP') continue;
    const raw = patch[id];
    if (typeof raw !== 'number' || !isFinite(raw)) continue;   // true·'5'·[3] 등은 받지 않는다
    const v = Math.round(raw);
    if (v >= 1 && v <= 20) REF.cap[id] = v;
  }
  /* ★ NODE[].cap 에 **직접** 반영한다.
     시뮬레이터의 자원 풀뿐 아니라 3D 설비 메쉬·투입산출 탭의 호기 목록·호기 라벨이
     전부 NODE[].cap 을 보기 때문이다. 종전에는 풀 생성부에서만 덮어써서
     대수를 늘려도 3D 는 옛 대수 그대로였고, 투입산출 탭 호기 칸이 '-' 로 나왔다. */
  if (typeof NODE !== 'undefined' && typeof NODE_CAP_DEFAULT !== 'undefined') {
    for (const id in NODE_CAP_DEFAULT) {
      if (NODE[id]) NODE[id].cap = REF.cap[id] || NODE_CAP_DEFAULT[id];
    }
  }
  return REF.cap;
}
/** 화면에서 고친 값을 반영. patch = { 공정: { 키: 숫자 } }
    ★ **항상 기본값으로 되돌린 뒤 패치를 얹는다.** 빈 객체 {} 를 넘기면 전부 원래대로가 된다.
      (종전에는 {} 가 truthy 라 "패치 없음"으로 흘러가 직전 수정값이 그대로 남았다) */
function setRefStd(patch) {
  REF.std = refClone(REF_STD_DEFAULT);
  if (!patch) return REF.std;
  if (typeof patch !== 'object') return REF.std;
  for (const proc in patch) {
    if (!own(patch, proc) || !own(REF.std, proc)) continue;
    const src = patch[proc];
    if (!src || typeof src !== 'object') continue;
    for (const k in src) {
      if (!own(src, k) || !own(REF.std[proc], k)) continue;
      if (typeof src[k] === 'number' && isFinite(src[k])) REF.std[proc][k].v = src[k];
    }
  }
  return REF.std;
}
/** 기본값과 다른 항목만 추린다 — 내보내기·변경 표시용 */
function refDiff() {
  const out = {};
  for (const proc in REF.std) for (const k in REF.std[proc]) {
    if (k[0] === '_') continue;
    if (REF.std[proc][k].v !== REF_STD_DEFAULT[proc][k].v) {
      (out[proc] = out[proc] || {})[k] = REF.std[proc][k].v;
    }
  }
  return out;
}
/** 짧은 참조 — RSTD.EdgeMiller.base18 처럼 쓴다.
    (flow.js 안에 지역변수 R 이 따로 있어 이름을 구분한다) */
const RSTD = new Proxy({}, { get: (_, proc) =>
  new Proxy({}, { get: (__, key) => (REF.std[proc] && REF.std[proc][key]) ? REF.std[proc][key].v : undefined }) });

/* ====================================================================
   산식 검증용 부가 정보
   --------------------------------------------------------------------
   「어떤 식에 어떤 값이 들어가 이 숫자가 나왔는가」를 화면에서 그대로 펼쳐 보이기 위해
   각 STD 함수가 아래 세 가지를 함께 돌려준다.

     tpl   적용 산식 — 기호 형태 (예: 348s − (123/고속값) + (전진거리/215.6) + …)
     vars  이 제품에 실제로 들어간 파라미터 [[이름, 값, 출처], …]
     subst 숫자를 대입한 식 (예: 348 − 123/5 + 15250/215.6 + … = 527 s)

   sec / expr / terms 는 그대로 두므로 기존 화면·검사에는 영향이 없다. (2026-08-14)
   ==================================================================== */
const nf = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v)) return v.toLocaleString();
  return (Math.round(v * 1000) / 1000).toString();
};
/** 산식 검증 정보를 결과 객체에 붙인다 */
function withCalc(res, tpl, vars, subst) {
  res.tpl = tpl;
  res.vars = vars;
  res.subst = `${subst} = ${res.sec.toFixed(0)} s`;
  return res;
}

const gradeLabel = (g) => g === 'hiMn' ? '고망간' : g === 'high' ? 'X65 이상(고강도)' : '일반';

const STD = {};

/* 1~2. Edge Miller (면취) */
/* 엑셀 비고 「※ 첫 본 생산 시: +1분 50초」 — 오더의 첫 본에만 110초를 더한다.
   seqInOrder 는 flow.js 가 넘기는 오더 안 본 번호(1부터). 종전에는 이 항이 빠져 있었다. */
STD.EdgeMiller = (s, line, _seqAll, seqInOrder) => {
  const E = RSTD.EdgeMiller;
  const L = s.L, Lm = L / 1000;
  const feed = pickRange(T.emFeed, Lm);
  const base = line === '18M' ? E.base18 : E.base12;
  const first = (seqInOrder === 1) ? E.firstPiece : 0;
  if (s.grade === 'hiMn') {
    const b = line === '18M' ? E.hiMn18 : E.hiMn12;
    const sec = b + L * E.lenA + feed / E.feedDiv + first;
    return withCalc({ sec, expr: `${b} + L×${E.lenA} + feed/${E.feedDiv}  (고망간)${first ? ` + ${E.firstPiece}(첫 본)` : ''}`,
      terms: [['기본(고망간)', b], [`길이항 L×${E.lenA}`, L * E.lenA], [`피딩기 feed/${E.feedDiv}`, feed / E.feedDiv]]
        .concat(first ? [['첫 본 생산 가산', first]] : []) },
      `${b}s + 길이×${E.lenA} + (전진거리/${E.feedDiv})${first ? ` + ${E.firstPiece}s(첫 본)` : ''}   [${line} 고망간]`,
      [['길이(mm)', L, '계획서'], ['두께(mm)', s.t, '계획서'], ['재질 등급', gradeLabel(s.grade), '계획서'],
       ['판재 이송거리(mm)', feed, '엑셀 emFeed 표 (길이 구간)'],
       ['오더 내 본 번호', seqInOrder, '시뮬레이터'] ],
      `${b} + ${nf(L)}×${E.lenA} + ${nf(feed)}/${E.feedDiv}${first ? ` + ${first}` : ''}`);
  }
  const row = T.emSpeed.find(r => s.t >= r.tmin && s.t <= r.tmax) || T.emSpeed[1];
  const v = s.grade === 'high' ? row.high : row.normal;   // 고속 Setting [m/min]
  const sec = base - E.vNum / v + feed / E.feedDiv + L * (E.lenA / v - E.lenB) + first;
  return withCalc({ sec, expr: `${base} − ${E.vNum}/v + feed/${E.feedDiv} + L×(${E.lenA}/v − ${E.lenB}), v=${v}m/min, feed=${feed}mm${first ? ` + ${E.firstPiece}(첫 본)` : ''}`,
    terms: [['기본', base], [`−${E.vNum}/v`, -E.vNum / v], [`피딩기 feed/${E.feedDiv}`, feed / E.feedDiv],
            ['길이항', L * (E.lenA / v - E.lenB)]].concat(first ? [['첫 본 생산 가산', first]] : []) },
    `${base}s − (${E.vNum}/고속값) + (전진거리/${E.feedDiv}) + 길이×(${E.lenA}/고속값 − ${E.lenB})`
      + `${first ? ` + ${E.firstPiece}s(첫 본)` : ''}   [${line} ${gradeLabel(s.grade)}]`,
    [['길이(mm)', L, '계획서'], ['두께(mm)', s.t, '계획서'], ['재질 등급', gradeLabel(s.grade), '계획서'],
     ['밀링 고속값(m/min)', v, `엑셀 emSpeed 표 (두께 ${row.tmin}~${row.tmax})`],
     ['판재 이송거리(mm)', feed, '엑셀 emFeed 표 (길이 구간)'],
     ['오더 내 본 번호', seqInOrder, '시뮬레이터 — 1이면 첫 본 가산']],
    `${base} − ${E.vNum}/${nf(v)} + ${nf(feed)}/${E.feedDiv} + ${nf(L)}×(${E.lenA}/${nf(v)}−${E.lenB})${first ? ` + ${first}` : ''}`);
};

/* 3~4. Pre Bender */
STD.PreBender = (s, line) => {
  const P = RSTD.PreBender;
  const pitch = pickRange(T.preBenderPitch, s.t);
  const base = line === '18M' ? P.base18 : P.base12;
  const n = ceil((s.L - P.lead) / pitch);
  const sec = base + (pitch / P.pitchDiv + P.perStroke) * n;
  return withCalc({ sec, expr: `${base} + (pitch/${P.pitchDiv} + ${P.perStroke}) × ceil((L−${P.lead})/pitch), pitch=${pitch}mm, n=${n}`,
    terms: [['기본', base], [`성형 ${n}회`, (pitch / P.pitchDiv + P.perStroke) * n]] },
    `${base}s + (피치/${P.pitchDiv} + ${P.perStroke}s) × 올림((길이−${P.lead})/피치)   [${line}]`,
    [['길이(mm)', s.L, '계획서'], ['두께(mm)', s.t, '계획서'],
     ['성형 피치(mm)', pitch, '엑셀 preBenderPitch 표 (두께별)'],
     ['성형 횟수 n(회)', n, `올림((${nf(s.L)}−${P.lead})/${nf(pitch)})`]],
    `${base} + (${nf(pitch)}/${P.pitchDiv} + ${P.perStroke}) × ${n}`);
};

/* 5~6. Press Bender */
STD.PressBender = (s, line) => {
  const inch = Math.round(odInch(s.od) / 2) * 2;
  const x1 = pickInch(T.pressX1, inch);
  const P = RSTD.PressBender;
  const base = line === '18M' ? P.base18 : P.base12;
  const k = line === '18M' ? P.k18 : P.k12;
  const sec = base + (s.L / 1000) / P.lenDiv - s.od / P.odDiv + x1 * k;
  return withCalc({ sec, expr: `${base} + L[m]/${P.lenDiv} − OD/${P.odDiv} + X1×${k}, X1=${x1}회(${inch}")`,
    terms: [['기본', base], [`길이항 L/${P.lenDiv}`, (s.L / 1000) / P.lenDiv], [`외경 보정 −OD/${P.odDiv}`, -s.od / P.odDiv],
            [`X1 Side Press ${x1}회`, x1 * k]] },
    `${base}s + (길이[m]/${P.lenDiv}) − (외경/${P.odDiv}) + X1횟수×${k}s   [${line}]`,
    [['길이(m)', s.L / 1000, '계획서'], ['외경(mm)', s.od, '계획서'],
     ['공칭 인치(")', inch, `외경 ${nf(s.od)}mm ÷ 25.4 → 짝수 인치 반올림`],
     ['X1 Side Press 횟수', x1, `엑셀 pressX1 표 (${inch}")`]],
    `${base} + ${nf(s.L / 1000)}/${P.lenDiv} − ${nf(s.od)}/${P.odDiv} + ${x1}×${k}`);
};

/* 7. Gap Press  (두께 25T 초과 시에만 투입) */
STD.GapPress = (s) => {
  const P = RSTD.GapPress;
  const Lm = s.L / 1000;
  const seg = ceil(Lm / P.segLen);
  /* 엑셀 원문 (row 14)
       464s − (제품 Spec 길이/0.3) + [{('제품 Spec 길이/6M' 올림)x(45+20)} x2] x2
     비고 : ※ X70 이상인 경우: [ ] x2 적용
     → 대괄호 [ ] 안이 {ceil(L/6)×65}×2 이고, **대괄호 밖의 ×2 가 X70 이상 조건**이다.
       종전 코드는 밖의 ×2 를 무조건 곱한 뒤 X70 에 또 ×2 를 곱해 **일반강 2배 · X70 4배**로
       계상하고 있었다. 게다가 flow.js 의 Gap Press 투입 조건(t>25)과 grade 대리변수 기준(t>25)이
       같아서 Gap Press 를 지나는 제품은 **전부 high** 가 되어, 실질적으로 늘 4배였다.
       (2026-08-14 전수 감사) */
  const hi = s.grade === 'high';          // X70 이상 → 대괄호 밖 ×2
  const bracket = seg * P.per * P.mult * (hi ? P.x70 : 1);
  const sec = P.base - Lm / P.lenDiv + bracket;
  return withCalc({ sec, expr: `${P.base} − L[m]/${P.lenDiv} + [ceil(L/${P.segLen})×${P.per}×${P.mult}]${hi ? `×${P.x70}(X70↑)` : ''}, ceil(L/${P.segLen})=${seg}`,
    terms: [['기본', P.base], [`길이 보정 −L/${P.lenDiv}`, -Lm / P.lenDiv], [`프레스 ${seg}구간`, bracket]] },
    `${P.base}s − (길이[m]/${P.lenDiv}) + [올림(길이/${P.segLen}m)×${P.per}s×${P.mult}]`
      + `${hi ? ` ×${P.x70}  ← X70 이상` : '   (X70 미만이라 대괄호 밖 ×${P.x70} 미적용)'}`,
    [['길이(m)', Lm, '계획서'], ['두께(mm)', s.t, '계획서 — t>25 일 때만 투입'],
     ['재질 등급', gradeLabel(s.grade), '계획서'],
     ['프레스 구간 수', seg, `올림(${nf(Lm)}/${P.segLen})`],
     ['X70 이상 배수', hi ? P.x70 : 1, hi ? '적용' : '미적용']],
    `${P.base} − ${nf(Lm)}/${P.lenDiv} + ${seg}×${P.per}×${P.mult}${hi ? `×${P.x70}` : ''}`);
};

/* 8. Tack Welder (태그 웰딩) */
STD.TackWelder = (s, line) => {
  const v = pickRange(T.tackWeld, s.t);          // mm/s
  const base = line === '18M' ? RSTD.TackWelder.base18 : RSTD.TackWelder.base12;
  const sec = base + s.L / v;
  return withCalc({ sec, expr: `${base} + L / v,  v=${v.toFixed(1)}mm/s (WPS t=${s.t})`,
    terms: [['이송·Gap조정', base], ['용접 L/v', s.L / v]] },
    `${base}s + (길이 / 용접속도)   [${line}]`,
    [['길이(mm)', s.L, '계획서'], ['두께(mm)', s.t, '계획서'],
     ['용접속도(mm/s)', v, `엑셀 tackWeld 표 (WPS 두께 ${nf(s.t)})`]],
    `${base} + ${nf(s.L)}/${nf(v)}`);
};

/* 9. Inside Welder (내면 SAW) */
STD.InsideWelder = (s, line) => {
  const v = pickRange(T.insideWeld, s.t);
  const p = pickRange(T.insideWeld, s.t, 3);
  const base = line === '18M' ? RSTD.InsideWelder.base18 : RSTD.InsideWelder.base12;
  const sec = base + s.L / v;
  return withCalc({ sec, expr: `${base} + L / v,  v=${v.toFixed(2)}mm/s, ${p}pass (WPS)`,
    terms: [['장입·Setting·배출', base], [`용접 L/v (${p}pass)`, s.L / v]] },
    `${base}s + (길이 / 용접속도)   [${line} · 내면 SAW]`,
    [['길이(mm)', s.L, '계획서'], ['두께(mm)', s.t, '계획서'],
     ['용접속도(mm/s)', v, `엑셀 insideWeld 표 (WPS 두께 ${nf(s.t)})`],
     ['용접 패스 수', p, '엑셀 insideWeld 표 — 속도에 이미 반영됨']],
    `${base} + ${nf(s.L)}/${nf(v)}`);
};

/* 10. Outside Welder (외면 SAW) */
STD.OutsideWelder = (s, line) => {
  const v = pickRange(T.outsideWeld, s.t);
  const p = pickRange(T.outsideWeld, s.t, 3);
  const base = line === '18M' ? RSTD.OutsideWelder.base18 : RSTD.OutsideWelder.base12;
  const sec = base + s.L / v;
  return withCalc({ sec, expr: `${base} + L / v,  v=${v.toFixed(2)}mm/s, ${p}pass (WPS)`,
    terms: [['장입·Setting·배출', base], [`용접 L/v (${p}pass)`, s.L / v]] },
    `${base}s + (길이 / 용접속도)   [${line} · 외면 SAW]`,
    [['길이(mm)', s.L, '계획서'], ['두께(mm)', s.t, '계획서'],
     ['용접속도(mm/s)', v, `엑셀 outsideWeld 표 (WPS 두께 ${nf(s.t)})`],
     ['용접 패스 수', p, '엑셀 outsideWeld 표 — 속도에 이미 반영됨']],
    `${base} + ${nf(s.L)}/${nf(v)}`);
};

/* 11. 1st-UT (관단탭 절단 포함) */
STD.FirstUT = (s) => {
  const P = RSTD.FirstUT;
  const cv = pickRange(T.utCut, s.t);
  const sec = P.base + s.L / P.feedDiv + (P.cutLen / cv) * P.cutTimes;
  return withCalc({ sec, expr: `${P.base} + L/${P.feedDiv} + (${P.cutLen}/절단속도)×${P.cutTimes}, 절단속도=${cv}`,
    terms: [['기본', P.base], [`이송 L/${P.feedDiv}`, s.L / P.feedDiv], [`탭 절단 ×${P.cutTimes}`, (P.cutLen / cv) * P.cutTimes]] },
    `${P.base}s + (길이/${P.feedDiv}) + (${P.cutLen}/절단속도)×${P.cutTimes}회`,
    [['길이(mm)', s.L, '계획서'], ['두께(mm)', s.t, '계획서'],
     ['관단탭 절단속도', cv, `엑셀 utCut 표 (두께 ${nf(s.t)})`]],
    `${P.base} + ${nf(s.L)}/${P.feedDiv} + (${P.cutLen}/${nf(cv)})×${P.cutTimes}`);
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
  /* 동점(같은 외경·같은 두께에 다이가 둘 이상) 은 **엑셀 순서상 먼저**를 채택하고
     나머지는 alts 로 남긴다.

     ── OD1219 44t(250mm)/44t(700mm) 중복의 결론 (2026-08-14) ───────────────
     괄호 안 숫자는 다이의 **F/L(Full Length)** 이다. 같은 엑셀 RB 시트의 세아제강 셀 메모가
     그렇게 쓰고 있다 —「32"x34 die (F/L 700mm) 대체 작업 진행중」,「다이 40" 44t 사용할 것 FL 300mm」.

     그리고 그 메모에 나오는 규격이 M1 다이표의 **700mm 이상치와 정확히 겹친다.**
     두께 34t 이상에서 step > 400mm 인 행은 표 전체에 딱 5개뿐이다.

         32" t34 → 700     ← 메모「32"x34 die (F/L 700mm) 대체 작업 진행중」
         40" t34 → 700     ← 메모「40"x34die (F/L 700mm) 대체 작업중」
         44" t44 → 700
         48" t44 → 700     ← 문의 대상
         60" t44 → 700

     44t 계열 15행 중 나머지 13행은 전부 110~300mm 이다. 즉 **정규 다이는 250mm 계열이고,
     700mm 는 정규 다이가 없거나 수리 중일 때 쓰는 「대체 작업」 다이**로 읽는 것이 맞다.
     → 현재 동작(엑셀 순서상 먼저인 **250mm 채택**)을 그대로 유지하고,
        700mm 는 alts 에 `substitute: true` 로 남겨 화면에 「대체 다이」로 표시한다. */
  const pickIn = (cand) => {
    let b = null, bd = Infinity; const alts = [];
    for (const r of cand) {
      const d = tDiffOf(r[2], r[3]);
      if (d < bd) { bd = d; b = { head:r[0], od:r[1], step:r[4], label:r[5] }; alts.length = 0; }
      else if (b && d === bd && r[4] !== b.step) {
        /* 두꺼운 관(t≥34)에서 채택값보다 크게 벌어진 F/L 은 「대체 작업」 다이로 본다 */
        const sub = (r[2] >= 34 && r[4] > 400 && r[4] > b.step * 2);
        alts.push({ head:r[0], od:r[1], step:r[4], label:r[5], substitute: sub });
      }
    }
    return b ? { best: b, tDiff: bd, alts } : null;
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
           inch: Math.round(od / 25.4),
           alts: hit.alts || [],
           warn: hit.tDiff > TDIFF_WARN || odGap > 5,
           approx: odGap > 5 ? `외경 ${Math.round(od)} → 다이표 ${best.od} (${odGap.toFixed(0)}mm 차)` : null };
}

/** 같은 외경·두께에 다이가 둘 이상인 칸을 전부 찾아 준다 (확인 요청용 진단) */
function dieDuplicates(machine) {
  const rows = (T.dieSpec || {})[DIE_KEY[machine] || 'M2'] || [];
  const seen = new Map(), out = [];
  for (const r of rows) {
    const k = `${r[1]}|${r[2]}|${r[3]}`;
    if (seen.has(k)) { const f = seen.get(k); out.push({ head:r[0], od:r[1], inch:Math.round(r[1]/25.4), t:r[2], steps:[f[4], r[4]], labels:[f[5], r[5]] }); }
    else seen.set(k, r);
  }
  return out;
}

/* --------------------------------------------------------------------
   확관 Step Size 여유값 — 표준시간 엑셀의 **이미지로만 적혀 있던** 규칙
     · Expander(1·2호기)  「통상 다이 Size[mm] − 150[mm] 를 적용
                            ex. 700mm 다이 사용 시 550mm 를 레시피(HMI Setting)에 입력.
                            단, 끝단 남을 길이가 150mm 이하일 경우 −100[mm] 를 적용」
     · R/B Expander       「통상 다이 Size[mm] − 90[mm] 를 적용
                            ex. 700mm 다이 사용 시 610mm 를 레시피에 입력」
   출처 — ★JCOE 공정 생산 표준 시간 분석 20251231 (POSTECH 송부).xlsx
          Total Summary!S22 (1호기) · S23 (2호기) · Expander(RB)!J4 이미지
   2026-08-14 확인. 종전 R/B 식은 이 −90 을 빠뜨리고 다이 Size 를 그대로 나눠
   확관 횟수를 과소 계상하고 있었다.
   -------------------------------------------------------------------- */
/** 확관 Step 여유값 [mm].
    ★ 「끝단 남을 길이가 150mm 이하일 경우 −100 을 적용」 규칙은 **다이 크기에 따라** 달라진다.
      종전에는 이 함수가 무조건 150 을 돌려줘서, step ≤ 150 인 다이(M1 표에 15행)에서
      recipe = max(step−150, 1) = **1mm** 가 됐다. 엑셀 N 모드는 그 1mm 로 나누므로
      OD508 t20.25 18.288m 에서 N 이 366 회가 아니라 **18,288 회**, 소요 4,642s → 219,706s 로 튀었다
      (기본 오더셋 makespan 24.4일 → 301.1일). 화면에 찍히는 HMI 레시피 값도 1mm 로 틀렸다. */
function stepMargin(machine, step) {
  const E = RSTD.Expander;
  if (machine === 'RB') return E.marginRB;
  return (step != null && step <= E.marginM1) ? E.marginM1Small : E.marginM1;
}

/** 확관 Step Size / 다이 정보 (호기별)
    step  = 다이표 값(= 다이 Size)
    recipe = 실제 HMI 에 입력하는 확관 Step Size = 다이 Size − 여유값 */
function expanderStep(s, machine) {
  const ti = toolInfo(s.od, s.t, machine || 'M2');
  if (ti.step) {
    const m = stepMargin(machine || 'M2', ti.step);
    return { step: ti.step, recipe: Math.max(ti.step - m, 1), margin: m,
             dieT: ti.label, inch: Math.round(odInch(s.od)), tool: ti };
  }
  /* 호기별 다이표에 없으면 엑셀 「Expander(1호기)」 표로 폴백 */
  const inch = Math.round(odInch(s.od));
  const keys = Object.keys(T.expanderDie).map(Number).sort((a, b) => a - b);
  let bk = keys[0];
  for (const k of keys) if (Math.abs(k - inch) < Math.abs(bk - inch)) bk = k;
  const dies = T.expanderDie[bk];
  const die = dies.find(d => d[0] >= s.t) || dies[dies.length - 1];
  const m = stepMargin(machine || 'M2', die[1]);
  return { step: die[1], recipe: Math.max(die[1] - m, 1), margin: m,
           dieT: `t${die[0]}`, inch: bk, tool: ti, fallback: true };
}

/* 확관 횟수 N — 산출 근거가 두 가지로 갈려 있어 토글로 병기한다.
   'ortools' : 세아제강 운영 최적화 모델(specs.py) 구현 — 기본값(정본)
               M1  N = round(L / (step − (step≤150 ? 100 : 150)))
               M2  N = ceil((L−500)/step) + 2, 홀수면 +1 → 항상 짝수
   'excel'   : 「JCOE 공정 생산 표준 시간 분석」 산출식 — 대조용
               M1  N = ROUNDUP(L / (다이 Size − 150))
                   근거: Total Summary!S22 이미지 「12,802 / (550−150) = 33회」
                   (24"×12.7t → M1 다이 550mm. round 면 32, **ROUNDUP 이라 33**)
               M2  N = ROUNDUP((L − (S_start + S_end)) / (F − O)) + 2 + α
                   근거: Total Summary!S23 이미지 + 셀 메모
                        「α : α 를 제외한 N 이 짝수일 시 +1, 즉 N 은 항상 홀수」
                   S_start+S_end · F−O 의 실제 수치는 이미지에 없어
                   500mm · 다이 Size 로 근사한다 (수치 확인 요청 중)
   ★ 정본(specs.py)은 M2 를 **짝수**로, 표준시간 엑셀 이미지는 **홀수**로 맞춘다 —
     서로 반대이며 2026-08-06 "specs.py 가 맞습니다" 회신에 따라 정본을 기본값으로 둔다.
   두 식은 step 이 작을수록(=두꺼운 관) 크게 벌어진다. */
let EXP_NMODE = 'ortools';
function setExpanderNMode(m) { EXP_NMODE = (m === 'excel') ? 'excel' : 'ortools'; }
function expanderNMode() { return EXP_NMODE; }

function expanderN(s, machine) {
  const { step, recipe } = expanderStep(s, machine);
  /* R/B — 표준시간 엑셀 No.20 산출식이 쓰는 확관 횟수. 다이 Size − 90 이 분모다. */
  if (machine === 'RB') return ceil(s.L / recipe);
  if (EXP_NMODE === 'excel' && (machine === 'M1' || machine === 'BOTH')) {
    /* 엑셀 이미지 식: ROUNDUP(L / (다이 Size − 150)) */
    return ceil(s.L / recipe);
  }
  if (EXP_NMODE === 'ortools' && (machine === 'M1' || machine === 'BOTH')) {
    /* specs.calculate_time_m1 그대로 — 하한을 두지 않는다.
       step 이 작을수록 분모(step−150 또는 step−100)가 급격히 줄어 N 이 크게 튄다.
       예) OD508 t9.5 step170 → 분모 20 → 11.5m 에서 N=575 회 (2,987s → 7,127s).
       종전에는 하한 50 을 두었으나 정본과 어긋나므로 제거했다.
       분모가 0 이하가 되는 표상의 step 은 없지만, 만약을 대비해 0 나눗셈만 막는다. */
    /* recipe 가 이미 「다이 − 여유값」이다 (여유값은 다이 크기에 따라 150/100). */
    return Math.round(s.L / (recipe > 0 ? recipe : 1));
  }
  let n = ceil((s.L - 500) / step) + 2;
  if (EXP_NMODE === 'ortools') { if (n % 2 === 1) n += 1; }   // 짝수 보정
  else                        { if (n % 2 === 0) n += 1; }   // 홀수 보정
  return n;
}

/* 12~13. Expander (확관) — 병목 발생지 */
STD.Expander = (s, machine, cfg) => {
  const tag = EXP_NMODE === 'ortools' ? '[운영모델 N식]' : '[엑셀 N식]';
  if (machine === 'BOTH') {                 // 14.021m 초과 → #1·#2호기 동시 가동
    const E = RSTD.Expander;
    const n1 = expanderN(s, 'M1'), n2 = expanderN(s, 'M2');
    const a = E.m1Base + n1 * E.m1Per + (s.L + E.m1FeedAdd) / E.m1FeedDiv, b = E.m2Base + n2 * E.m2Per;
    const d1 = expanderStep(s, 'M1'), d2 = expanderStep(s, 'M2');
    return withCalc({ sec: Math.max(a, b),
      expr: `#1·#2호기 동시 가동: max(#1 ${a.toFixed(0)}s, #2 ${b.toFixed(0)}s) ${tag}`,
      terms: [['#1호기 소요', a], ['#2호기 소요', b], ['동시 가동 → max 적용', Math.max(a, b)]] },
      `max( #1호기: ${E.m1Base}s + N₁×${E.m1Per}s + (길이+${E.m1FeedAdd})/${E.m1FeedDiv} ,  #2호기: ${E.m2Base}s + N₂×${E.m2Per}s )`
        + `   [길이 14.021m 초과 → 두 호기 동시 가동]`,
      [['길이(mm)', s.L, '계획서'], ['외경(mm)', s.od, '계획서'], ['두께(mm)', s.t, '계획서'],
       ['#1호기 다이(mm)', d1.step, '다이표 (specs.py)'], ['#1호기 Step(mm)', d1.recipe, `다이 ${nf(d1.step)} − 여유 ${nf(d1.margin)}`],
       ['#1호기 확관 횟수 N₁', n1, EXP_NMODE === 'excel' ? '엑셀 N식' : '운영모델 N식'],
       ['#2호기 다이(mm)', d2.step, '다이표 (specs.py)'], ['#2호기 Step(mm)', d2.recipe, `다이 ${nf(d2.step)} − 여유 ${nf(d2.margin)}`],
       ['#2호기 확관 횟수 N₂', n2, EXP_NMODE === 'excel' ? '엑셀 N식' : '운영모델 N식']],
      `max( ${E.m1Base}+${n1}×${E.m1Per}+(${nf(s.L)}+${E.m1FeedAdd})/${E.m1FeedDiv} , `
        + `${E.m2Base}+${n2}×${E.m2Per} )   [#1호기 ${a.toFixed(0)}s · #2호기 ${b.toFixed(0)}s]`);
  }
  const d = expanderStep(s, machine), n = expanderN(s, machine);
  if (machine === 'RB') {
    /* 표준시간 엑셀 No.20 「R/B - Expander」
         234s + (ROUNDUP(파이프 길이 / 확관 Step Size) − 2) × 15s
       확관 Step Size = 다이 Size − 90 (Expander(RB)!J4 이미지, 2026-08-14 확인).
       종전에는 −90 을 빠뜨리고 다이 Size 로 나누어 확관 횟수를 과소 계상했다.

       비고의 두 문장 —
         「※ 옥외 열처리 제품인 경우, 15초 제외
           → 옥외 열처리 제품이 아닌 경우, 상수 234초 고정」
       를 **문자 그대로** 읽으면:
         옥외 열처리 제품  →  「15초 제외」 = (N−2)×15 항을 빼고  **234s 고정**
         그 외            →  상수는 234 고정 + (N−2)×15 항 적용
       (열처리 제품은 확관 후 열처리로 치수가 다시 변하므로 확관을 최소화한다는 해석)
       2026-08-14 초안에서 「기본 상수 234−15=219」로 읽었으나, 엑셀에 219 라는 수는
       어디에도 없어 지어낸 값이 됩니다. 문자 그대로의 해석으로 되돌렸습니다.
       cfg.rbHeatRule = 'none' 으로 두면 전 제품에 (N−2)×15 를 적용합니다. */
    const E = RSTD.Expander;
    const heat = !!s.heat && (!cfg || cfg.rbHeatRule !== 'none');
    const add = heat ? 0 : Math.max(n - E.rbOffset, 0) * E.rbPer;
    const sec = E.rbBase + add;
    return withCalc({ sec,
      expr: heat
        ? `R/B: ${E.rbBase} 고정 (옥외 열처리 → 「15초 제외」),  참고 N=${n}회, StepSize=${d.recipe}mm (다이 ${d.step}−${E.marginRB})`
        : `R/B: ${E.rbBase} + (ROUNDUP(L/StepSize)−${E.rbOffset})×${E.rbPer},  N=${n}회, StepSize=${d.recipe}mm (다이 ${d.step}−${E.marginRB})`,
      terms: [['기본', E.rbBase]].concat(heat ? [] : [[`확관 ${n}회 (−${E.rbOffset})×${E.rbPer}s`, add]]) },
      heat ? `${E.rbBase}s 고정   [R/B · 옥외 열처리 제품 → (N−${E.rbOffset})×${E.rbPer}s 항 제외]`
           : `${E.rbBase}s + (확관횟수 N − ${E.rbOffset})×${E.rbPer}s   [R/B]`,
      [['길이(mm)', s.L, '계획서'], ['외경(mm)', s.od, '계획서'], ['두께(mm)', s.t, '계획서'],
       ['다이 크기(mm)', d.step, `다이표 — ${d.dieT}${d.fallback ? ' (엑셀 표 폴백)' : ''}`],
       ['Step 여유(mm)', d.margin, d.step <= RSTD.Expander.marginM1 && machine !== 'RB'
          ? '소형 다이 → −100' : (machine === 'RB' ? 'R/B → −90' : '통상 −150')],
       ['확관 Step(mm)', d.recipe, `다이 ${nf(d.step)} − 여유 ${nf(d.margin)} = HMI 입력값`],
       ['확관 횟수 N(회)', n, EXP_NMODE === 'excel' ? '엑셀 N식' : '운영모델 specs.py N식']].concat([['옥외 열처리', heat ? '예 (자재기호 C2 / 병목 HT102)' : '아니오', '계획서·자재내역']]),
      heat ? `${E.rbBase}` : `${E.rbBase} + (${n}−${E.rbOffset})×${E.rbPer}`);
  }
  const E = RSTD.Expander;
  if (machine === 'M1') {
    const sec = E.m1Base + n * E.m1Per + (s.L + E.m1FeedAdd) / E.m1FeedDiv;
    return withCalc({ sec, expr: `#1호기: ${E.m1Base} + N×${E.m1Per} + (L+${E.m1FeedAdd})/${E.m1FeedDiv},  N=${n}회, 다이 ${d.step}mm → StepSize ${d.recipe}mm ${tag}`,
      terms: [['기본', E.m1Base], [`확관 ${n}회 ×${E.m1Per}s`, n * E.m1Per],
              [`이송 (L+${E.m1FeedAdd})/${E.m1FeedDiv}`, (s.L + E.m1FeedAdd) / E.m1FeedDiv]] },
      `${E.m1Base}s + 확관횟수 N × ${E.m1Per}s + (길이+${E.m1FeedAdd})/${E.m1FeedDiv}   [확관 #1호기]`,
      [['길이(mm)', s.L, '계획서'], ['외경(mm)', s.od, '계획서'], ['두께(mm)', s.t, '계획서'],
       ['다이 크기(mm)', d.step, `다이표 — ${d.dieT}${d.fallback ? ' (엑셀 표 폴백)' : ''}`],
       ['Step 여유(mm)', d.margin, d.step <= RSTD.Expander.marginM1 && machine !== 'RB'
          ? '소형 다이 → −100' : (machine === 'RB' ? 'R/B → −90' : '통상 −150')],
       ['확관 Step(mm)', d.recipe, `다이 ${nf(d.step)} − 여유 ${nf(d.margin)} = HMI 입력값`],
       ['확관 횟수 N(회)', n, EXP_NMODE === 'excel' ? '엑셀 N식' : '운영모델 specs.py N식']],
      `${E.m1Base} + ${n}×${E.m1Per} + (${nf(s.L)}+${E.m1FeedAdd})/${E.m1FeedDiv}`);
  }
  const sec = E.m2Base + n * E.m2Per;
  return withCalc({ sec, expr: `#2호기: ${E.m2Base} + N×${E.m2Per},  N=${n}회, 다이 ${d.step}mm (${d.dieT}) ${tag}`,
    terms: [['기본', E.m2Base], [`확관 ${n}회 ×${E.m2Per}s`, n * E.m2Per]] },
    `${E.m2Base}s + 확관횟수 N × ${E.m2Per}s   [확관 #2호기]`,
      [['길이(mm)', s.L, '계획서'], ['외경(mm)', s.od, '계획서'], ['두께(mm)', s.t, '계획서'],
       ['다이 크기(mm)', d.step, `다이표 — ${d.dieT}${d.fallback ? ' (엑셀 표 폴백)' : ''}`],
       ['Step 여유(mm)', d.margin, d.step <= RSTD.Expander.marginM1 && machine !== 'RB'
          ? '소형 다이 → −100' : (machine === 'RB' ? 'R/B → −90' : '통상 −150')],
       ['확관 Step(mm)', d.recipe, `다이 ${nf(d.step)} − 여유 ${nf(d.margin)} = HMI 입력값`],
       ['확관 횟수 N(회)', n, EXP_NMODE === 'excel' ? '엑셀 N식' : '운영모델 specs.py N식']],
    `${E.m2Base} + ${n}×${E.m2Per}`);
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
  const B = RSTD.EndFacing.base;
  const sec = B + best[3];
  return withCalc({ sec, expr: `${B} + 저속절삭시간(${best[0]}", t${best[1]}~${best[2]}) = ${B} + ${best[3]}s`,
    terms: [['기본', B], ['저속 절삭(안전계수 K=1.5)', best[3]]] },
    `${B}s + 저속 절삭시간(표 조회)`,
    [['외경(mm)', s.od, '계획서'], ['두께(mm)', s.t, '계획서'],
     ['공칭 인치(")', inch, `외경 ${nf(s.od)}mm ÷ 25.4 → 짝수 인치`],
     ['저속 절삭시간(s)', best[3], `엑셀 endFacing 표 (${best[0]}" · t${best[1]}~${best[2]}, 안전계수 K=1.5)`]],
    `${B} + ${nf(best[3])}`);
};

/* 15. Outer bead removal (슬러그/비드 제거) */
STD.OuterBead = (s) => {
  const P = RSTD.OuterBead;
  return withCalc({ sec: P.base + s.L / P.feedDiv, expr: `${P.base} + L/${P.feedDiv}  (컨베이어 1.2m/min)`,
    terms: [['기본', P.base], [`이송 L/${P.feedDiv}`, s.L / P.feedDiv]] },
    `${P.base}s + (길이/${P.feedDiv})   [컨베이어 1.2m/min]`,
    [['길이(mm)', s.L, '계획서']],
    `${P.base} + ${nf(s.L)}/${P.feedDiv}`);
};

/* 16. Hydraulic Tester (수압) */
STD.HydroTest = (s) => {
  const inch = Math.round(odInch(s.od) / 2) * 2;
  const P = RSTD.HydroTest;
  let fill = pickInch(T.hydroFill, inch);
  if (s.L / 1000 >= P.longThresholdM) fill += P.longAdd;   // 18미터일 시 20초씩 추가
  /* 「36" 이상」 판정은 **공칭 인치**로 한다.
     종전에는 짝수 스냅(round(inch/2)×2)한 값을 썼기 때문에 OD889(정확히 35")가 36 으로 올라가
     2차 압빼기·에어 벤트 상수가 300/180 으로 잘못 바뀌었다(+180s). (2026-08-14 전수 감사) */
  const big = Math.round(odInch(s.od)) >= P.bigInch;
  const de = big ? T.hydroConst.deflate2nd_36up : T.hydroConst.deflate2nd;
  const av = big ? T.hydroConst.airVent_36up : T.hydroConst.airVent;
  const hold = s.holdSec != null ? s.holdSec : 60;        // MES 제작시방서 조회값
  const sec = P.base + fill + P.riseSec + hold + de + av;
  return withCalc({ sec, expr: `${P.base} + 충수(${fill}s) + 압력상승(${P.riseSec}s) + 유지(${hold}s) + 2차압빼기(${de}s) + 에어벤트(${av}s)`,
    terms: [['기본', P.base], [`충수 ${inch}"`, fill], ['압력 상승', P.riseSec], ['압력 유지(MES)', hold],
            ['2차 압빼기', de], ['에어 벤트', av]] },
    `${P.base}s + 충수시간 + ${P.riseSec}s(압력상승) + 압력유지 + 2차압빼기 + 에어벤트`
      + `   [${big ? `36" 이상` : `36" 미만`}${s.L / 1000 >= P.longThresholdM ? `, 18m 이상 +${P.longAdd}s` : ''}]`,
    [['외경(mm)', s.od, '계획서'], ['공칭 인치(")', Math.round(odInch(s.od)), `외경/25.4 반올림 — ${P.bigInch}" 이상이면 대구경 상수`],
     ['길이(mm)', s.L, '계획서'],
     ['충수 시간(s)', fill, `엑셀 hydroFill 표 (${inch}")${s.L / 1000 >= P.longThresholdM ? ` + 18m 가산 ${P.longAdd}` : ''}`],
     ['압력 상승(s)', P.riseSec, '기준정보'],
     ['압력 유지(s)', hold, s.holdSec != null ? 'MES 제작시방서 조회값' : '기본값 60s (시방서 미조회)'],
     ['2차 압빼기(s)', de, big ? '엑셀 hydroConst.deflate2nd_36up' : '엑셀 hydroConst.deflate2nd'],
     ['에어 벤트(s)', av, big ? '엑셀 hydroConst.airVent_36up' : '엑셀 hydroConst.airVent']],
    `${P.base} + ${nf(fill)} + ${P.riseSec} + ${nf(hold)} + ${nf(de)} + ${nf(av)}`);
};

/* 17. Final-UT */
STD.FinalUT = (s) => {
  const P = RSTD.FinalUT;
  return withCalc({ sec: P.base + s.L / P.scanDiv, expr: `${P.base} + L/${P.scanDiv}`,
    terms: [['기본', P.base], [`스캔 L/${P.scanDiv}`, s.L / P.scanDiv]] },
    `${P.base}s + (길이/${P.scanDiv})   [스캔 속도 환산]`,
    [['길이(mm)', s.L, '계획서'], ['스캔 환산계수', P.scanDiv, '기준정보 — 엑셀 row 27']],
    `${P.base} + ${nf(s.L)}/${P.scanDiv}`);
};

/* 18. RT (X-ray) */
STD.RT = (s) => {
  const P = RSTD.RT;
  const df = s.defects || 0;
  if (s.rtType === 'End-RT') {
    const sec = P.endBase + (s.L - P.endLead) / P.endDivA + s.L / P.endDivB + df * P.endDefectSec;
    return withCalc({ sec, expr: `End-RT: ${P.endBase} + (L−${P.endLead})/${P.endDivA} + L/${P.endDivB} + 불량×${P.endDefectSec}`,
      terms: [['기본', P.endBase], [`(L−${P.endLead})/${P.endDivA}`, (s.L - P.endLead) / P.endDivA],
              [`L/${P.endDivB}`, s.L / P.endDivB], [`불량 ${df}개소`, df * P.endDefectSec]] },
      `${P.endBase}s + (길이−${P.endLead})/${P.endDivA} + 길이/${P.endDivB} + 불량개소×${P.endDefectSec}s   [End-RT]`,
      [['길이(mm)', s.L, '계획서'], ['촬영 방식', 'End-RT', '계획서 — 관단부만 촬영'],
       ['도입 길이(mm)', P.endLead, '기준정보'],
       ['불량 개소(개)', df, s.defects != null ? '계획서/실적' : '기본값 0 (불량 미입력)'],
       ['불량 1개소 재촬영(s)', P.endDefectSec, '기준정보']],
      `${P.endBase} + (${nf(s.L)}−${P.endLead})/${P.endDivA} + ${nf(s.L)}/${P.endDivB} + ${df}×${P.endDefectSec}`);
  }
  const base = s.rtType === '320kV' ? P.base320 : P.base450;
  const shots = ceil(s.L / P.shotLen);
  const sec = base + shots * P.shotSec + df * P.defectSec;
  return withCalc({ sec, expr: `${base} + ceil(L/${P.shotLen})×${P.shotSec} + 불량×${P.defectSec},  ${shots}회 촬영`,
    terms: [['기본', base], [`촬영 ${shots}회`, shots * P.shotSec], [`불량 ${df}개소`, df * P.defectSec]] },
    `${base}s + ceil(길이/${P.shotLen})×${P.shotSec}s + 불량개소×${P.defectSec}s   [전장 RT ${s.rtType === '320kV' ? '320kV' : '450kV'}]`,
    [['길이(mm)', s.L, '계획서'], ['촬영 방식', s.rtType === '320kV' ? '320kV' : '450kV', '계획서'],
     ['1회 촬영 길이(mm)', P.shotLen, '기준정보'],
     ['촬영 횟수(회)', shots, `ceil(${nf(s.L)}/${P.shotLen})`],
     ['1회 촬영시간(s)', P.shotSec, '기준정보'],
     ['불량 개소(개)', df, s.defects != null ? '계획서/실적' : '기본값 0 (불량 미입력)'],
     ['불량 1개소 재촬영(s)', P.defectSec, '기준정보']],
    `${base} + ${shots}×${P.shotSec} + ${df}×${P.defectSec}`);
};

/* 19. 포장 */
STD.Packing = (s, _l, seq) => {
  const P = RSTD.Packing;
  const mk = P.markSec * (s.markSpec || 2) * (s.markEnd || 2);
  const extra = (seq && P.extraEvery > 0 && seq % P.extraEvery === 0) ? P.extraSec : 0;  // n본마다 추가 검사
  const sec = P.base + (P.refLen - s.L) / P.feedDiv + mk + extra;
  return withCalc({ sec, expr: `${P.base} + (${P.refLen}−L)/${P.feedDiv} + ${P.markSec}×마킹사양(${s.markSpec || 2})×관단(${s.markEnd || 2})${extra ? ` + ${P.extraSec}(${P.extraEvery}본째)` : ''}`,
    terms: [['기본', P.base], [`이송 (${P.refLen}−L)/${P.feedDiv}`, (P.refLen - s.L) / P.feedDiv], ['마킹', mk]]
      .concat(extra ? [[`${P.extraEvery}본째 추가검사`, extra]] : []) },
    `${P.base}s + (${P.refLen}−길이)/${P.feedDiv} + ${P.markSec}s×마킹사양수×관단수${extra ? ` + ${P.extraSec}s(${P.extraEvery}본마다 추가검사)` : ''}`,
    [['길이(mm)', s.L, '계획서'], ['기준 길이(mm)', P.refLen, '기준정보 — 이 길이에서 이송 가산 0'],
     ['마킹 사양 수(종)', s.markSpec || 2, s.markSpec != null ? '계획서' : '기본값 2종'],
     ['관단 수(개)', s.markEnd || 2, s.markEnd != null ? '계획서' : '기본값 2개(양단)'],
     ['마킹 1건 시간(s)', P.markSec, '기준정보'],
     ['누적 본 번호', seq == null ? '—' : seq, `${P.extraEvery}본마다 추가검사 ${P.extraSec}s`],
     ['추가검사 적용', extra ? '적용' : '미적용', extra ? `${seq} % ${P.extraEvery} = 0` : '해당 없음']],
    `${P.base} + (${P.refLen}−${nf(s.L)})/${P.feedDiv} + ${P.markSec}×${s.markSpec || 2}×${s.markEnd || 2}${extra ? ` + ${extra}` : ''}`);
};

/* --------------------------------------------------------------------
   설비 전환(Changeover) 시간 [초]  — PPT: "설비 전환 시간을 최소화하도록 스케줄링 필요"
   -------------------------------------------------------------------- */
/* 설비 전환시간 [초] — 기준정보(「전환시간」 탭)에서 고칠 수 있다.
   od/t/L = 직전 본과 **외경 / 두께 / 길이**가 달라졌을 때 드는 시간. 가장 큰 값 하나만 적용된다. */
const REF_CO_DEFAULT = {
  EdgeMiller:   { od: 0,    t: 1800, L: 0,    _l:'Edge Miller',    _n:'X-Tool 교체 30분 (25T 경계)' },
  PreBender:    { od: 1800, t: 900,  L: 0,    _l:'Pre Bender',     _n:'Upper/Lower Tool 교체' },
  PressBender:  { od: 3600, t: 0,    L: 0,    _l:'Press Bender',   _n:'상툴 1시간 / 하툴' },
  GapPress:     { od: 600,  t: 0,    L: 0,    _l:'Gap Press',      _n:'' },
  TackWelder:   { od: 300,  t: 300,  L: 0,    _l:'Tack Welder',    _n:'' },
  InsideWelder: { od: 600,  t: 900,  L: 0,    _l:'Inside Welder',  _n:'WPS 변경' },
  OutsideWelder:{ od: 600,  t: 900,  L: 0,    _l:'Outside Welder', _n:'WPS 변경' },
  FirstUT:      { od: 150,  t: 150,  L: 0,    _l:'1st-UT',         _n:'UT Calibration 2.5분' },
  Expander:     { od: 5400, t: 1800, L: 3600, _l:'Expander',       _n:'폴백값 — 실제는 공구 계층 룰(Drawbar/Head/Die) 사용' },
  EndFacing:    { od: 3600, t: 600,  L: 0,    _l:'End-Facing',     _n:'클램프 교체 60분 (외경 변화 시)' },
  OuterBead:    { od: 120,  t: 0,    L: 0,    _l:'Outer bead',     _n:'' },
  HydroTest:    { od: 3000, t: 0,    L: 0,    _l:'Hydraulic Tester',_n:'수압 면판 교체 40~60분' },
  FinalUT:      { od: 150,  t: 150,  L: 0,    _l:'Final-UT',       _n:'' },
  RT:           { od: 300,  t: 300,  L: 0,    _l:'RT',             _n:'' },
  Packing:      { od: 300,  t: 0,    L: 600,  _l:'포장',           _n:'' },
};
const CHANGEOVER = refClone(REF_CO_DEFAULT);
REF.co = CHANGEOVER;
/** 전환시간 반영. patch = { 공정: { od|t|L: 초 } } */
/* ★ 패치 키를 그대로 인덱싱하면 `__proto__` 로 **Object.prototype 이 오염**된다.
     그러면 모든 객체가 od/t/L 를 갖게 되어 `for…in` 을 쓰는 화면들이 줄줄이 터지고,
     초기화로도 되돌릴 수 없다. 자기 소유 키인지 반드시 확인한다. (2026-08-14 전수 감사) */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function setRefCo(patch) {
  for (const k in REF_CO_DEFAULT) Object.assign(CHANGEOVER[k], REF_CO_DEFAULT[k]);   // 항상 초기화 후 적용
  if (!patch || typeof patch !== 'object') return CHANGEOVER;
  for (const st in patch) {
    if (!own(patch, st) || !own(CHANGEOVER, st)) continue;
    const src = patch[st];
    if (!src || typeof src !== 'object') continue;
    for (const k of ['od', 't', 'L']) {
      if (!own(src, k)) continue;
      const v = src[k];
      if (typeof v === 'number' && isFinite(v) && v >= 0) CHANGEOVER[st][k] = v;
    }
  }
  return CHANGEOVER;
}
function refCoDiff() {
  const out = {};
  for (const st in CHANGEOVER) for (const k of ['od', 't', 'L'])
    if (CHANGEOVER[st][k] !== REF_CO_DEFAULT[st][k]) (out[st] = out[st] || {})[k] = CHANGEOVER[st][k];
  return out;
}
/* 확관 셋업 — 공구 계층 룰 (세아제강 운영 최적화 모델 specs.get_setup_time_val)
   드로바 교체 270분 > 헤드 교체 150분 > 다이 교체 90분 > 동일 0
   od/t 변화폭이 아니라 "장착 공구가 실제로 바뀌는가"로 판정한다. */
/* 확관 셋업 — 분 단위 기준정보에서 읽어 초로 환산한다 */
const EXP_SETUP = new Proxy({}, { get: (_, k) => {
  const E = RSTD.Expander;
  return ({ drawbar: E.setupDrawbar, head: E.setupHead, die: E.setupDie }[k] || 0) * 60;
} });
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
