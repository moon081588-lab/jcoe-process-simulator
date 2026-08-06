/* =====================================================================
   조관계획서 (xlsx / xlsm / xls / csv) 로더
   PlanLoader.mount(el, { onApply(orders, meta), onReset(), defaults })
   ===================================================================== */
const PlanLoader = (() => {

/* ---------- 열 자동 인식 키워드 (앞쪽일수록 우선) ---------- */
const KEYS = {
  no:   ['판매오더','오더번호','오더 번호','order no','orderno','order','수주번호','수주','제번','작번','관리번호','lot no','lot','품번','no.','오더'],
  od:   ['외경','외 경','o.d','od','outer','대구경','호칭경','규격'],
  t:    ['두께','육후','살두께','wt','thk','thickness','t(mm)','t'],
  L:    ['길이','장','length','len','l(mm)','l(m)','정척','l'],
  /* 실제 계획서에는 수주수량·오더수량·계획수량·조관수량·포장수량이 모두 있다.
     운영 모델(`data_loader.py:22`)이 쓰는 것은 **계획수량** 이므로 이것을 최우선으로 둔다.
     종전에는 `수량` 이 1순위라 더 왼쪽에 있는 `수주수량`(115본)이 잡혀 계획량(55본)의 2배가 됐다. */
  qty:  ['계획수량','조관수량','생산수량','본수','투입본수','pcs',"q'ty",'qty','ea','수량','개수','본'],
  date: ['계획일','투입일','착수일','생산일','조관일','일자','날짜','계획','plan date','start','date'],
  due:  ['납기','요청일','출하일','납기일','due','delivery','출하'],
  /* 확관 최적화 운영 모델이 쓰는 두 열 — RB 강제 투입(Force_RB) 판정용 */
  bn:   ['병목 공정 작업장','병목공정','병목 공정','작업장','bottleneck','병목'],
  rawL: ['원재료내역','원재료 내역','원재료길이','자재내역','소재내역','원판내역','material desc'],
  /* 실제 조관계획서(76열)에 있는 열들 — 종전에는 대리변수로 추정하던 것을 직접 읽는다.
     세아제강 「1. 2025년 12월 포항공장 조관계획서.xlsx」 JCOE 시트 기준.
       재질   API-X80L2*CESAG / A516-60N*TAZ / A572-50 / SS400 …
       용도   송유관(=API 5L 라인파이프) / 압력배관용 / 구조용
       물종   JCOE / ERW  ← JCOE 시트에도 ERW 행이 섞여 있다 */
  mat:  ['재질','강종','material','grade','재질명'],
  use:  ['용도','제품용도','용 도','usage','service'],
  kind: ['물종','제품군','품종','product'],
};
const REQUIRED = ['od','t','L','qty'];
const FIELD_LABEL = { no:'오더번호', od:'외경', t:'두께', L:'길이', qty:'수량', date:'계획 투입일', due:'납기(선택)',
                      bn:'병목 공정(선택)', rawL:'원재료 내역(선택)',
                      mat:'재질(선택)', use:'용도(선택)', kind:'물종(선택)' };

/* 재질·용도로 API 5L(라인파이프) 여부 판정.
   실제 계획서에서 `용도 = 송유관` 28건과 `재질 = API-*` 28건이 정확히 일치한다. */
function isApi5L(mat, use) {
  const u = String(use == null ? '' : use).trim();
  if (u.includes('송유관') || /line\s*pipe/i.test(u)) return true;
  const m = String(mat == null ? '' : mat).trim().toUpperCase();
  if (/\b5L\b/.test(m)) return true;
  if (!/^API/.test(m)) return false;
  /* API 5CT(케이싱·튜빙: J55·K55·N80·L80·P110 …)는 라인파이프가 아니다 */
  return !/(J55|K55|N80|L80|P110|C90|T95|Q125|M65|H40|5CT)/.test(m);
}
/* 재질에서 고강도 판정 — API X70 이상. 재질 열이 없으면 두께 대리변수로 폴백한다. */
function gradeOf(mat, t) {
  const m = String(mat == null ? '' : mat).trim().toUpperCase();
  const x = m.match(/X\s?(\d{2,3})/);
  if (x) return (+x[1] >= 70) ? 'high' : 'normal';
  if (m) return 'normal';                 // 재질을 읽었는데 X 등급이 아니면 일반강
  return t > 25 ? 'high' : 'normal';      // 재질 열이 없을 때만 두께 대리변수
}

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[\s()[\]{}·・.,_/\\-]/g, '');
const isNum = v => typeof v === 'number' && isFinite(v);

function toNum(v) {
  if (isNum(v)) return v;
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function toDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    /* 자정 ±2분 안이면 달력일 경계로 스냅한다.
       SheetJS 의 cellDates 변환이 로컬 타임존(서울은 1899년 LMT +8:27:52)에서 52초 어긋나
       모든 날짜가 **전날 23:59** 로 떨어지던 문제를 흡수한다. */
    const d = new Date(v.getTime());
    const mins = d.getHours() * 60 + d.getMinutes();
    if (mins >= 1438) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); }
    else if (mins <= 2) { d.setHours(0, 0, 0, 0); }
    return d;
  }
  if (isNum(v)) {                                  // 엑셀 serial
    /* **로컬** 달력일 자정으로 만든다. UTC 로 만들면 아래 fmtDT 의 로컬 게터로 읽을 때 타임존만큼 밀린다. */
    if (v > 20000 && v < 80000) return new Date(1899, 11, 30 + Math.floor(v), 0, 0, 0, 0);
    return null;
  }
  if (!v) return null;
  const s = String(v).trim().replace(/[.]/g, '-').replace(/\//g, '-');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  if (m.length === 4) return new Date(+m[1], +m[2] - 1, +m[3]);
  const y = new Date().getFullYear();
  return new Date(y, +m[1] - 1, +m[2]);
}
const fmtDT = d => { const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/* 원재료내역 문자열에서 길이[mm] 추출.
   data_loader._extract_raw_length 와 같은 취지 — '...*12802' / '12.802M' / '25604mm' 등 */
/* 원재료내역 문자열 → 원판 길이[mm].
   'SLAB 914.0*9.3*25604' 같은 치수 토큰에서 뽑는다.
   HEAT NO / LOT / 자재코드처럼 길이가 아닌 숫자가 섞여도 잘못 잡지 않도록,
   ① 라벨 뒤 식별번호 제거 ② 단위(mm/m) 붙은 값 ③ 치수 토큰 중 mm 범위 최댓값 ④ 단독 숫자 순으로 본다. */
function extractRawLength(v) {
  if (v == null) return 0;
  if (isNum(v)) return v > 100 ? v : v * 1000;
  let s = String(v).replace(/,/g, '');
  s = s.replace(/\b(heat|lot|coil|charge|no|c\/?no|serial)\s*(no)?\.?\s*[:#]?\s*[A-Za-z]*\d+[A-Za-z0-9-]*/gi, ' ');
  const inMM = x => x >= 3000 && x <= 60000;

  // ① 단위가 명시된 값 (12.802M / 25604mm)
  let m, best = 0;
  const reU = /(\d+(?:\.\d+)?)\s*(mm|m)\b/gi;
  while ((m = reU.exec(s))) {
    const raw = parseFloat(m[1]);
    const x = m[2].toLowerCase() === 'm' && raw < 100 ? raw * 1000 : raw;
    if (inMM(x) && x > best) best = x;
  }
  if (best) return best;

  // ② 치수 토큰 전체에서 mm 범위 최댓값 (OD·두께는 이 범위에 거의 안 들어온다)
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(parseFloat);
  const mm = nums.filter(inMM);
  if (mm.length) return Math.max.apply(null, mm);

  // ③ 숫자가 하나뿐일 때만 m 로 해석 (여러 개면 두께·외경과 구분할 수 없어 포기)
  if (nums.length === 1 && nums[0] >= 3 && nums[0] <= 60) return nums[0] * 1000;
  return 0;
}

/* ---------- 헤더 행 탐지 ---------- */
function detectHeader(rows) {
  let best = { idx: 0, score: -1 };
  const scan = Math.min(rows.length, 25);
  for (let i = 0; i < scan; i++) {
    const r = rows[i] || [];
    let score = 0, filled = 0;
    for (const c of r) {
      if (c == null || c === '') continue;
      filled++;
      const n = norm(c);
      if (!n) continue;
      for (const f in KEYS) {
        if (KEYS[f].some(k => n === norm(k) || n.includes(norm(k)))) { score += 3; break; }
      }
      if (typeof c === 'string') score += 0.4;
    }
    if (filled < 3) continue;
    /* 아래 행에 숫자가 실제로 있는지 */
    const nx = rows[i + 1] || [];
    if (nx.filter(isNum).length >= 2) score += 2;
    if (score > best.score) best = { idx: i, score };
  }
  return best.idx;
}

/* ---------- 열 자동 매핑 ---------- */
function autoMap(headers, body) {
  const map = {};
  const used = new Set();
  for (const f of ['no', 'od', 't', 'L', 'qty', 'date', 'due', 'bn', 'rawL', 'mat', 'use', 'kind']) {
    let hit = -1, hitRank = 1e9;
    headers.forEach((h, ci) => {
      if (used.has(ci)) return;
      const n = norm(h);
      if (!n) return;
      KEYS[f].forEach((k, rank) => {
        const nk = norm(k);
        if (!nk) return;
        const exact = n === nk, part = n.includes(nk);
        if ((exact || part) && rank < hitRank) {
          /* 너무 짧은 키워드(t, l)는 완전일치만 인정 */
          if (nk.length <= 1 && !exact) return;
          hitRank = rank; hit = ci;
        }
      });
    });
    if (hit >= 0) { map[f] = hit; used.add(hit); }
  }
  /* 숫자 열 통계로 보완 — 매핑 못 찾은 필수 항목 추정 */
  const stats = colStats(body, headers.length);
  const guessBy = (f, test) => {
    if (map[f] != null) return;
    for (let c = 0; c < headers.length; c++) {
      if (used.has(c) || !stats[c] || stats[c].n < body.length * 0.3) continue;
      if (test(stats[c])) { map[f] = c; used.add(c); return; }
    }
  };
  guessBy('od',  s => s.med >= 150 && s.med <= 2000);
  guessBy('t',   s => s.med >= 5 && s.med <= 60);
  guessBy('L',   s => (s.med >= 4000 && s.med <= 25000) || (s.med >= 4 && s.med <= 25));   // mm 또는 m
  guessBy('qty', s => s.med >= 1 && s.med <= 2000 && s.allInt);
  return map;
}
function colStats(body, ncol) {
  const out = [];
  for (let c = 0; c < ncol; c++) {
    const v = body.map(r => toNum(r[c])).filter(x => x != null && isFinite(x));
    if (!v.length) { out.push(null); continue; }
    const s = v.slice().sort((a, b) => a - b);
    out.push({ n: v.length, med: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1],
               allInt: v.every(x => Math.abs(x - Math.round(x)) < 1e-9) });
  }
  return out;
}

/* ---------- 단위 자동 추정 ---------- */
function guessUnits(body, map) {
  const med = ci => { if (ci == null) return null;
    const v = body.map(r => toNum(r[ci])).filter(x => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null; };
  const odM = med(map.od), lM = med(map.L);
  return {
    od: odM != null && odM < 120 ? 'inch' : 'mm',
    L:  lM  != null && lM  < 60  ? 'm'    : 'mm',
  };
}

/* ---------- 오더 생성 ---------- */
function buildOrders(body, map, units, opt) {
  /* 스킵 안내 행번호는 **엑셀 실제 행번호** 여야 사용자가 찾을 수 있다 (헤더 오프셋 반영) */
  const rowBase = (opt && opt.rowBase) || 0;
  const orders = [], skipped = [];
  const seen = {};
  let seqDate = opt.startDate ? new Date(opt.startDate + 'T08:00:00') : null;

  body.forEach((r, i) => {
    const rowNo = rowBase + i + 1;
    const g = f => (map[f] == null ? null : r[map[f]]);
    let od = toNum(g('od')), t = toNum(g('t')), L = toNum(g('L')), qty = toNum(g('qty'));

    if (od == null && t == null && L == null && qty == null) return;    // 빈 행
    const miss = [];
    if (od == null) miss.push('외경 없음'); if (t == null) miss.push('두께 없음');
    if (L == null) miss.push('길이 없음');
    if (qty == null) miss.push('수량 없음'); else if (qty <= 0) miss.push(`수량 ${qty}`);
    if (miss.length) { skipped.push({ row: rowNo, why: miss.join(' · ') }); return; }

    if (units.od === 'inch') od = od * 25.4;
    if (units.L === 'm') L = L * 1000;
    qty = Math.round(qty);

    const rng = [];
    if (od < 200 || od > 2200) rng.push(`외경 ${od.toFixed(0)}mm`);
    if (t < 4 || t > 60) rng.push(`두께 ${t}mm`);
    if (L < 3000 || L > 30000) rng.push(`길이 ${(L / 1000).toFixed(2)}m`);
    if (rng.length) { skipped.push({ row: rowNo, why: '값 범위 이탈: ' + rng.join(', ') }); return; }

    /* 물종 열이 있으면 JCOE 가 아닌 행(ERW 등)은 제외한다 — JCOE 시트에도 섞여 있다 */
    const kind = g('kind');
    if (kind != null && String(kind).trim() && !/jcoe/i.test(String(kind))) {
      skipped.push({ row: rowNo, why: `물종 ${String(kind).trim()} (JCOE 아님)` }); return;
    }

    let no = g('no');
    no = (no == null || no === '') ? `R${rowNo}` : String(no).trim();
    if (seen[no]) { seen[no]++; no = `${no}-${seen[no]}`; } else seen[no] = 1;

    let d = toDate(g('date'));
    if (!d && seqDate) { d = new Date(seqDate); seqDate.setHours(seqDate.getHours() + 6); }
    if (!d) d = new Date(opt.startDate + 'T08:00:00');
    if (d.getHours() === 0 && d.getMinutes() === 0) d.setHours(8);

    const o = { no, od, t, L, qty, start: fmtDT(d) };
    const due = toDate(g('due'));
    if (due) o.due = fmtDT(due);
    /* 재질 · 용도 — 있으면 API 5L 과 고강도를 대리변수 없이 확정한다 */
    const mat = g('mat'), use = g('use');
    if (mat != null && String(mat).trim()) o.mat = String(mat).trim();
    if (use != null && String(use).trim()) o.use = String(use).trim();
    if (o.mat || o.use) { o.api5l = isApi5L(o.mat, o.use); o.grade = gradeOf(o.mat, t); }
    /* 병목 공정 작업장 (HT102 = 열처리 → RB 강제) */
    const bn = g('bn');
    if (bn != null && String(bn).trim() && String(bn).trim() !== '-') o.bottleneck = String(bn).trim();
    /* 원재료 내역에서 원판 길이 추출 → 원재료/제품 길이비 ≥ 1.8 이면 배척(더블 파이프) */
    const rl = extractRawLength(g('rawL'));
    if (rl) o.rawL = rl;
    orders.push(o);
  });

  orders.sort((a, b) => a.start.localeCompare(b.start));
  return { orders, skipped };
}

/* =====================================================================
   UI
   ===================================================================== */
const CSS = `
.pl-drop{border:2px dashed #30363d;border-radius:12px;padding:26px 18px;text-align:center;color:#8b949e;
  cursor:pointer;transition:.15s;background:#0f141b}
.pl-drop:hover,.pl-drop.over{border-color:#58a6ff;background:#0d1b2e;color:#c9d6e4}
.pl-drop b{display:block;color:#e6edf3;font-size:14px;margin-bottom:5px}
.pl-drop span{font-size:11.5px;line-height:1.7}
.pl-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:12px 0}
.pl-f{display:flex;flex-direction:column;gap:3px}
.pl-f label{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.4px}
.pl-f select,.pl-f input{background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;
  padding:5px 8px;font-size:12px;min-width:132px;font-family:inherit}
.pl-f.req select{border-color:#1f6feb66}
.pl-f.bad select{border-color:#da3633}
.pl-tag{font-size:9.5px;padding:1px 5px;border-radius:4px;background:#1f6feb22;color:#58a6ff;margin-left:5px}
.pl-warn{font-size:11.5px;background:#3a2a12e0;border-left:3px solid #d29922;border-radius:0 7px 7px 0;
  padding:9px 13px;margin:10px 0;color:#f0d69a;line-height:1.65;max-height:150px;overflow:auto}
.pl-err{background:#3a1d1de0;border-left-color:#da3633;color:#ffc9c4}
.pl-ok{background:#132a1ae0;border-left-color:#2ea043;color:#a5e6b6}
.pl-prev{max-height:280px;overflow:auto;border:1px solid #30363d;border-radius:9px;margin-top:10px}
.pl-prev table{width:100%;border-collapse:collapse;font-size:11.5px}
.pl-prev th{position:sticky;top:0;background:#1c2128;color:#8b949e;font-size:10px;text-transform:uppercase;
  padding:6px 9px;text-align:left;border-bottom:1px solid #30363d}
.pl-prev td{padding:5px 9px;border-bottom:1px solid #21262d}
.pl-prev td.n{text-align:right;font-variant-numeric:tabular-nums}
.pl-btn{background:#1f6feb;border:none;color:#fff;border-radius:7px;padding:7px 16px;font-size:12.5px;
  font-weight:600;cursor:pointer;font-family:inherit}
.pl-btn.g{background:#2a3444}
.pl-btn:disabled{opacity:.4;cursor:not-allowed}
.pl-src{font-size:11px;color:#8b949e;margin-top:8px}
.pl-src b{color:#e6edf3}
`;

function mount(el, opts) {
  if (!document.getElementById('pl-style')) {
    const st = document.createElement('style'); st.id = 'pl-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  el.innerHTML = `
    <div class="pl-drop" id="plDrop">
      <b>조관계획서 엑셀을 여기에 끌어다 놓으세요</b>
      <span>또는 클릭해서 파일 선택 &nbsp;·&nbsp; .xlsx / .xlsm / .xls / .csv 지원<br>
      열 이름은 자동 인식하고, 틀리면 아래에서 직접 지정할 수 있습니다</span>
      <input type="file" id="plFile" accept=".xlsx,.xlsm,.xls,.csv" style="display:none">
    </div>
    <div id="plCfg" style="display:none"></div>
    <div id="plMsg"></div>
    <div id="plPrev"></div>
    <div class="pl-row" id="plAct" style="display:none">
      <button class="pl-btn" id="plApply">이 계획서로 시뮬레이션</button>
      <button class="pl-btn g" id="plExport">orders.json 내보내기</button>
      <button class="pl-btn g" id="plReset">기본 데이터로 되돌리기</button>
    </div>
    <div class="pl-src" id="plSrc"></div>`;

  const $$ = id => el.querySelector('#' + id);
  const drop = $$('plDrop'), file = $$('plFile');
  let WB = null, ROWS = null, MAP = {}, UNITS = {}, HDR = 0, HEADERS = [], BUILT = null;

  drop.onclick = () => file.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
  file.onchange = e => { if (e.target.files[0]) load(e.target.files[0]); };

  function msg(kind, html) { $$('plMsg').innerHTML = html ? `<div class="pl-warn ${kind}">${html}</div>` : ''; }

  function load(f) {
    const rd = new FileReader();
    rd.onload = ev => {
      try {
        WB = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: true });
      } catch (err) { msg('pl-err', `파일을 읽지 못했습니다: ${err.message}`); return; }
      const names = WB.SheetNames;
      if (!names.length) { msg('pl-err', '시트가 없습니다.'); return; }
      /* JCOE 시트 우선, 없으면 행이 가장 많은 시트 */
      let pick = names.find(n => /jcoe/i.test(n));
      if (!pick) {
        let bestN = -1;
        for (const n of names) {
          const c = XLSX.utils.sheet_to_json(WB.Sheets[n], { header: 1, blankrows: false }).length;
          if (c > bestN) { bestN = c; pick = n; }
        }
      }
      $$('plSrc').innerHTML = `불러온 파일: <b>${f.name}</b> · 시트 ${names.length}개`;
      renderCfg(pick);
    };
    rd.readAsArrayBuffer(f);
  }

  function renderCfg(sheetName) {
    ROWS = XLSX.utils.sheet_to_json(WB.Sheets[sheetName], { header: 1, blankrows: false, defval: null });
    if (ROWS.length < 2) { msg('pl-err', `시트 「${sheetName}」에 데이터가 거의 없습니다. 다른 시트를 선택해 보세요.`); }
    HDR = detectHeader(ROWS);
    HEADERS = (ROWS[HDR] || []).map((h, i) => (h == null || h === '') ? `(${colName(i)}열)` : String(h).trim());
    const body = ROWS.slice(HDR + 1);
    MAP = autoMap(HEADERS, body);
    UNITS = guessUnits(body, MAP);

    const sel = (id, val, items, extra = '') =>
      `<select id="${id}" ${extra}>${items.map(o =>
        `<option value="${o.v}" ${String(o.v) === String(val) ? 'selected' : ''}>${o.t}</option>`).join('')}</select>`;
    const colOpts = [{ v: '', t: '— 없음 —' }].concat(HEADERS.map((h, i) => ({ v: i, t: `${colName(i)} · ${h}` })));

    $$('plCfg').style.display = 'block';
    $$('plCfg').innerHTML = `
      <div class="pl-row">
        <div class="pl-f"><label>시트</label>
          ${sel('plSheet', sheetName, WB.SheetNames.map(n => ({ v: n, t: n })))}</div>
        <div class="pl-f"><label>헤더 행</label>
          ${sel('plHdr', HDR, ROWS.slice(0, Math.min(ROWS.length, 25)).map((r, i) =>
            ({ v: i, t: `${i + 1}행 · ${(r || []).filter(x => x != null && x !== '').slice(0, 4).join(' | ').slice(0, 40)}` })))}</div>
      </div>
      <div class="pl-row">
        ${['no', 'od', 't', 'L', 'qty', 'date', 'due', 'bn', 'rawL'].map(f =>
          `<div class="pl-f ${REQUIRED.includes(f) ? 'req' : ''} ${REQUIRED.includes(f) && MAP[f] == null ? 'bad' : ''}" id="plF_${f}">
             <label>${FIELD_LABEL[f]}${REQUIRED.includes(f) ? ' *' : ''}</label>
             ${sel('plC_' + f, MAP[f] == null ? '' : MAP[f], colOpts)}</div>`).join('')}
      </div>
      <div class="pl-row">
        <div class="pl-f"><label>외경 단위</label>
          ${sel('plU_od', UNITS.od, [{ v: 'mm', t: 'mm' }, { v: 'inch', t: 'inch' }])}</div>
        <div class="pl-f"><label>길이 단위</label>
          ${sel('plU_L', UNITS.L, [{ v: 'mm', t: 'mm' }, { v: 'm', t: 'm' }])}</div>
        <div class="pl-f"><label>계획일 없을 때 시작일</label>
          <input type="date" id="plStart" value="${opts.startDate || '2026-03-02'}"></div>
      </div>`;

    $$('plSheet').onchange = e => renderCfg(e.target.value);
    $$('plHdr').onchange = e => { HDR = +e.target.value; reMap(); };
    ['no', 'od', 't', 'L', 'qty', 'date', 'due', 'bn', 'rawL'].forEach(f =>
      $$('plC_' + f).onchange = e => {
        MAP[f] = e.target.value === '' ? null : +e.target.value;
        /* 길이·외경 열을 직접 바꾸면 단위를 다시 추정한다.
           종전에는 로드 시점 값이 굳어 m 단위 계획서를 수동 지정해도 mm 로 읽혔다. */
        if (f === 'L' || f === 'od') {
          const u = guessUnits(ROWS.slice(HDR + 1), MAP);
          if (f === 'L') { UNITS.L = u.L; if ($$('plU_L')) $$('plU_L').value = u.L; }
          if (f === 'od') { UNITS.od = u.od; if ($$('plU_od')) $$('plU_od').value = u.od; }
        }
        refresh();
      });
    ['od', 'L'].forEach(u => $$('plU_' + u).onchange = e => { UNITS[u] = e.target.value; refresh(); });
    $$('plStart').onchange = refresh;
    refresh();
  }
  function reMap() {
    HEADERS = (ROWS[HDR] || []).map((h, i) => (h == null || h === '') ? `(${colName(i)}열)` : String(h).trim());
    const body = ROWS.slice(HDR + 1);
    MAP = autoMap(HEADERS, body); UNITS = guessUnits(body, MAP);
    renderCfg($$('plSheet').value);
  }

  function refresh() {
    const body = ROWS.slice(HDR + 1);
    const miss = REQUIRED.filter(f => MAP[f] == null);
    ['no', 'od', 't', 'L', 'qty', 'date', 'due'].forEach(f => {
      const d = $$('plF_' + f); if (!d) return;
      d.classList.toggle('bad', REQUIRED.includes(f) && MAP[f] == null);
    });
    if (miss.length) {
      msg('pl-err', `<b>필수 열을 찾지 못했습니다: ${miss.map(f => FIELD_LABEL[f]).join(', ')}</b><br>
        위 드롭다운에서 해당 열을 직접 지정해 주세요.`);
      $$('plPrev').innerHTML = ''; $$('plAct').style.display = 'none'; BUILT = null; return;
    }
    const r = buildOrders(body, MAP, UNITS, { startDate: $$('plStart').value, rowBase: HDR + 1 });
    BUILT = r;
    const qty = r.orders.reduce((a, o) => a + o.qty, 0);
    if (!r.orders.length) {
      const why = r.skipped.length
        ? `<br><b>건너뛴 행 ${r.skipped.length}건의 사유</b> — ` +
          r.skipped.slice(0, 12).map(x => `${x.row}행(${x.why})`).join(', ') +
          (r.skipped.length > 12 ? ` 외 ${r.skipped.length - 12}건` : '') +
          `<br>길이 값이 0.01m 처럼 나온다면 <b>길이 단위</b>를 m 으로 바꿔 보세요.`
        : '';
      msg('pl-err', '유효한 오더가 한 건도 없습니다. 헤더 행과 열 지정을 확인해 주세요.' + why);
      $$('plPrev').innerHTML = ''; $$('plAct').style.display = 'none'; return;
    }
    const skipHtml = r.skipped.length
      ? `<br><b>건너뛴 행 ${r.skipped.length}건</b> — ` +
        r.skipped.slice(0, 12).map(s => `${s.row}행(${s.why})`).join(', ') +
        (r.skipped.length > 12 ? ` 외 ${r.skipped.length - 12}건` : '')
      : '';
    msg(r.skipped.length ? '' : 'pl-ok',
      `<b>${r.orders.length}오더 / ${qty.toLocaleString()}본</b> 인식 —
       외경 ${Math.min(...r.orders.map(o => o.od)).toFixed(0)}~${Math.max(...r.orders.map(o => o.od)).toFixed(0)}mm ·
       두께 ${Math.min(...r.orders.map(o => o.t))}~${Math.max(...r.orders.map(o => o.t))}mm ·
       길이 ${(Math.min(...r.orders.map(o => o.L)) / 1000).toFixed(2)}~${(Math.max(...r.orders.map(o => o.L)) / 1000).toFixed(2)}m
       ${r.orders.some(o => o.due) ? '· 납기 포함' : ''}${skipHtml}`);

    $$('plPrev').innerHTML = `<div class="pl-prev"><table>
      <thead><tr><th>오더</th><th style="text-align:right">외경(mm)</th><th style="text-align:right">두께(mm)</th>
        <th style="text-align:right">길이(m)</th><th style="text-align:right">수량(본)</th><th>계획 투입</th>
        ${r.orders.some(o => o.due) ? '<th>납기</th>' : ''}</tr></thead>
      <tbody>${r.orders.slice(0, 200).map(o => `<tr>
        <td>${o.no}</td><td class="n">${o.od.toFixed(1)}</td><td class="n">${o.t}</td>
        <td class="n">${(o.L / 1000).toFixed(3)}</td><td class="n">${o.qty}</td><td>${o.start}</td>
        ${r.orders.some(x => x.due) ? `<td>${o.due || '—'}</td>` : ''}</tr>`).join('')}</tbody></table>
      ${r.orders.length > 200 ? `<div style="padding:6px 9px;color:#6e7681;font-size:11px">상위 200행만 표시</div>` : ''}
      </div>`;
    $$('plAct').style.display = 'flex';
  }

  $$('plApply').onclick = () => { if (BUILT && BUILT.orders.length) opts.onApply(BUILT.orders, { skipped: BUILT.skipped }); };
  $$('plReset').onclick = () => { opts.onReset(); msg('pl-ok', '기본 데이터(58오더 / 1,446본)로 되돌렸습니다.'); };
  $$('plExport').onclick = () => {
    if (!BUILT) return;
    const blob = new Blob([JSON.stringify(BUILT.orders, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'orders.json'; a.click();
  };
}
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }

return { mount, buildOrders, autoMap, detectHeader, guessUnits, colName };
})();
