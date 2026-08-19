/* =====================================================================
   UI — 탭 / 캔버스 렌더러 / 애니메이션 / 계산기 / 간트 / 병목
   ===================================================================== */
const C = {
  bg:'#0d1117', panel:'#161b22', line:'#30363d', text:'#e6edf3', dim:'#8b949e',
  idle:'#238636', proc:'#1f6feb', setup:'#d29922', bneck:'#da3633', off:'#3d444d',
  accent:'#58a6ff', dec:'#8957e5', buf:'#1f6f6f', done:'#2ea043'
};
const fmtT = s => { const d = new Date(s*1000); const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmtDur = s => s>=3600 ? `${(s/3600).toFixed(2)}h` : s>=60 ? `${(s/60).toFixed(1)}분` : `${s.toFixed(0)}초`;
const $ = id => document.getElementById(id);

let SIM = null, CFG = null;

/* ================= 설정 ================= */
let PLAN = null, LAST_OPT = null;
/* 숫자 입력 검증 — 빈 값이면 0 이 되어 캘린더 가용시간이 0 → 시뮬레이션이 사실상 멈춘다 */
function numIn(id, def, min, max) {
  const el = $(id); if (!el) return def;
  let v = parseFloat(el.value);
  if (!Number.isFinite(v)) v = def;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  if (String(v) !== String(el.value)) el.value = v;
  return v;
}
const pct = (a, b) => (b > 0 ? (a / b * 100).toFixed(0) + '%' : '—');
const delta = (a, b, d = 0) => (b > 0 ? ((a - b) / b * 100).toFixed(d) + '%' : '—');
const esc = v => String(v == null ? '' : v)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function readCfg() {
  /* 확관 셋업/N 산출 방식은 엔진 전역 상태이므로 설정을 읽을 때 함께 반영 */
  setExpSetupMode(($('cfgExpSetup') || {}).value || 'tool');
  setExpanderNMode(($('cfgExpN') || {}).value || 'ortools');
  return {
    expSetupMode: ($('cfgExpSetup') || {}).value || 'tool',
    expNMode: ($('cfgExpN') || {}).value || 'ortools',
    api5lProxy: (($('cfgApi5l') || {}).value || 'proxy') !== 'none',
    dispatchRule: ($('optRule')||{}).value || 'EAT',
    sameODConcurrency: $('optSameOD') ? $('optSameOD').checked : true,
    useM3: false,   /* 확관 3호기 = R/B 라인. 별도 설비가 아니다 — 2026-08-06 세아제강 확정 */
    expRuleSet: ($('optRuleSet')||{}).value || 'ortools',
    rbMode: ($('optRbMode')||{}).value || 'force',
    rbShifts: +(($('optRbShift')||{}).value || 1),
    applyOptSeq: $('optApplySeq') ? $('optApplySeq').checked : true,
    plan: (($('optRule')||{}).value === 'IMPORT') ? IMP_PLAN : PLAN,
    startDate: $('cfgStart').value || '2026-03-02',
    deadline: $('cfgDeadline') && $('cfgDeadline').value ? $('cfgDeadline').value : null,
    dateMode: ($('cfgDateMode')||{}).value || 'sheet',
    dueAnalysis: $('cfgDueAnalysis') ? $('cfgDueAnalysis').checked : false,
    stdCalib: CALIB,
    planWarn: PLAN_WARN,
    rbPost: ($('cfgRbPost')||{}).value || 'shared',
    seqGapH: numIn('cfgSeqGap', 6, 0.5, 240),
    shifts: (($('cfgShifts')||{}).value === '2E') ? '2E' : (+(($('cfgShifts')||{}).value) || 2),
    netHoursPerShift: numIn('cfgNetH', 7.5, 0.5, 24),
    skipWeekend: $('cfgWeekend').checked,
    useRB: $('cfgRB').checked,
    useCP: $('cfgCP').checked,
    processingFinalUT: $('cfgPFUT').checked,
    holdSec: numIn('cfgHold', 60, 0, 36000),
    changeover: $('cfgCO').checked,
    freeStationSec: 300,
    eventCap: 1e9,
    seed: SEED,
    stochastic: readStoch(),
  };
}
let SEED = 1;
function readStoch(){
  if(!$('stOn')) return { on:false };
  return {
    on: $('stOn').checked,
    cvTime:+$('stCvT').value, cvSetup:+$('stCvS').value,
    pDefect:+$('stDef').value, pWeld:+$('stWeld').value, maxRework:+$('stMaxRw').value,
    mtbfH:+$('stMtbf').value, mttrH:+$('stMttr').value,
    repairSec:+$('stRep').value*60, reweldSec:+$('stRw').value*60, expIssueSec:+$('stEp').value*60,
  };
}
let PLAN_WARN = [];
function runSim() {
  PLAN_WARN = [];
  CFG = readCfg();
  const t = performance.now();
  SIM = simulate(ORDERS, CFG);
  SIM.events.sort((a,b)=>a.s-b.s);
  SIM.byR = SIM.events.slice().sort((a,b)=>a.r-b.r);
  /* 핵심 수치는 헤더 아래 요약바(renderKpiBar)가 크게 보여준다.
     여기는 기간·계산시간 같은 부가 정보만 남긴다. (2026-08-14) */
  $('simInfo').textContent =
    `${fmtT(SIM.t0)} → ${fmtT(SIM.tEnd)} · ${(performance.now()-t).toFixed(0)}ms`
    + (SIM.kpi.stochOn ? ` · 재작업 ${SIM.kpi.rework}본` : '')
    + (SIM.kpi.deadline ? ` · 마감 ${CFG.deadline} 달성률 ${pct(SIM.kpi.doneInPeriod, SIM.kpi.doneInPeriod+SIM.kpi.overflow)}` : '')
    + (CALIB ? ` · 실적 보정 ON` : '')
    /* 라우트 상한에 걸려 완주하지 못한 본수 — 종전에는 조용히 사라졌다 */
    + (SIM.kpi.routeAborted ? ` · ⚠ 미완주 ${SIM.kpi.routeAborted}본` : '')
    + (PLAN_WARN.length ? ` · ⚠ 스케줄 경고 ${PLAN_WARN.length}건` : '');
  animT = SIM.t0; evIdx = 0; completed = 0; logs.length = 0; doneSet.clear();
  for (const n of NODES) { nodeState[n.id] = { active:[], q:0, done:0 }; }
  buildStatPanel(); updateStatPanel(); renderBottleneck(); renderGantt(); renderEligWarn(); buildIOFilters(); renderIO(); draw();
  buildVfOrders();
  /* 시뮬레이션이 다시 돌면 간트 상세도 같이 갱신된다 (renderGantt 안에서) */
  if (!GV_OPEN) { VF_BOX = 'vfBody'; if($('vfBody')) { if(!VFS.no && $('vfOrder')) VFS.no = $('vfOrder').value; renderVerify(); } }
  renderKpiBar();
  if($('refKpi')) renderRefKpi();
  /* 3D 탭이 이미 떠 있으면 같은 결과로 갱신 — 두 화면이 어긋나지 않게 한다 */
  if (window.JCOE3D && JCOE3D.isMounted()) JCOE3D.update(SIM, CFG, PLAN_SRC);
  if($('mcHint')) renderStNote();
  if($('periodSum')) renderPeriod();
  if($('wizSteps')) renderWiz();
  if($('seek')) $('seek').value=0;
  $('logBody').innerHTML='<div class="lg">▶ 를 눌러 시뮬레이션을 재생하세요.</div>';
}

/* ================= 캔버스 ================= */
const cvs = $('cv'), ctx = cvs.getContext('2d');
let VW = 1600, VH = 900, scale = 1, offX = 0, offY = 0;
/* ── 화면 이동·확대 ────────────────────────────────────────────────
   종전에는 draw() 가 매 프레임 fit() 을 불러 scale·offX·offY 를 다시 계산했기 때문에
   **끌어도 즉시 원위치로 돌아가** 시점이 완전히 고정돼 있었다.
   기본 배치(baseScale/baseX/baseY)와 사용자 조작(VIEW)을 나눠서 둘 다 살린다. (2026-08-14) */
let baseScale = 1, baseX = 0, baseY = 0;
const VIEW = { z: 1, dx: 0, dy: 0 };
const VIEW_ZMIN = 0.5, VIEW_ZMAX = 6;

function applyView() {
  scale = baseScale * VIEW.z;
  offX = baseX - (VW * (scale - baseScale)) / 2 + VIEW.dx;
  offY = baseY - (VH * (scale - baseScale)) / 2 + VIEW.dy;
}
function fit() {
  const w = cvs.parentElement.clientWidth, h = cvs.parentElement.clientHeight;
  if (cvs.width !== Math.round(w * devicePixelRatio) || cvs.height !== Math.round(h * devicePixelRatio)) {
    cvs.width = w * devicePixelRatio; cvs.height = h * devicePixelRatio;
    cvs.style.width = w + 'px'; cvs.style.height = h + 'px';
  }
  baseScale = Math.min(w / VW, h / VH) * 0.97;
  baseX = (w - VW * baseScale) / 2; baseY = (h - VH * baseScale) / 2;
  applyView();
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
/** 커서 위치를 고정한 채 확대/축소 */
function viewZoomAt(mx, my, factor) {
  const z = Math.max(VIEW_ZMIN, Math.min(VIEW_ZMAX, VIEW.z * factor));
  if (z === VIEW.z) return;
  const wx = (mx - offX) / scale, wy = (my - offY) / scale;   // 커서 아래 도면 좌표
  const ns = baseScale * z;
  VIEW.dx = (mx - wx * ns) - baseX + (VW * (ns - baseScale)) / 2;
  VIEW.dy = (my - wy * ns) - baseY + (VH * (ns - baseScale)) / 2;
  VIEW.z = z; applyView(); updateViewHint();
}
function viewReset() { VIEW.z = 1; VIEW.dx = 0; VIEW.dy = 0; applyView(); updateViewHint(); }
function updateViewHint() {
  const el = $('cvZoom'); if (!el) return;
  el.textContent = Math.round(VIEW.z * 100) + '%';
  const r = $('cvReset'); if (r) r.style.opacity = (VIEW.z === 1 && !VIEW.dx && !VIEW.dy) ? .35 : 1;
}
const BW = 118, BH = 46, DW = 104, DH = 70;
function box(n) {
  if (n.kind === 'dec') return { x:n.x, y:n.y, w:DW, h:DH };
  return { x:n.x, y:n.y, w:BW, h:n.sub ? BH+((n.cap||1)>1?20:12) : BH+((n.cap||1)>1?9:0) };
}
function anchor(n, side) {
  const b = box(n);
  switch (side) {
    case 'l': return [b.x, b.y + b.h/2];
    case 'r': return [b.x + b.w, b.y + b.h/2];
    case 't': return [b.x + b.w/2, b.y];
    case 'b': return [b.x + b.w/2, b.y + b.h];
  }
}
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function diamond(x,y,w,h){ ctx.beginPath(); ctx.moveTo(x+w/2,y); ctx.lineTo(x+w,y+h/2);
  ctx.lineTo(x+w/2,y+h); ctx.lineTo(x,y+h/2); ctx.closePath(); }

function edgePath(e) {
  const [a,b,,mode,opt] = e, A = NODE[a], B = NODE[b];
  if (mode === 'C') return [anchor(A, opt.a), ...opt.pts, anchor(B, opt.b)];
  const ba = box(A), bb = box(B);
  const ac = [ba.x+ba.w/2, ba.y+ba.h/2], bc = [bb.x+bb.w/2, bb.y+bb.h/2];
  let p0, p1, mid = [];
  if (mode === 'h') {
    const right = bc[0] > ac[0];
    p0 = anchor(A, right?'r':'l'); p1 = anchor(B, right?'l':'r');
    if (Math.abs(p0[1]-p1[1]) > 4) { mid = [[ (p0[0]+p1[0])/2, p0[1] ], [ (p0[0]+p1[0])/2, p1[1] ]]; }
  } else if (mode === 'v') {
    const down = bc[1] > ac[1];
    p0 = anchor(A, down?'b':'t'); p1 = anchor(B, down?'t':'b');
    if (Math.abs(p0[0]-p1[0]) > 4) mid = [[p0[0],(p0[1]+p1[1])/2],[p1[0],(p0[1]+p1[1])/2]];
  } else if (mode === 'hv') {          // 가로 → 세로
    const right = bc[0] > ac[0];
    p0 = anchor(A, right?'r':'l'); p1 = anchor(B, bc[1]>ac[1]?'t':'b');
    mid = [[p1[0], p0[1]]];
  } else {                              // 'vh' 세로 → 가로
    const down = bc[1] > ac[1];
    p0 = anchor(A, down?'b':'t'); p1 = anchor(B, bc[0]>ac[0]?'l':'r');
    mid = [[p0[0], p1[1]]];
  }
  return [p0, ...mid, p1];
}
function drawArrow(pts, color, dash) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.setLineDash(dash||[]);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke(); ctx.setLineDash([]);
  const p=pts[pts.length-1], q=pts[pts.length-2];
  const a=Math.atan2(p[1]-q[1], p[0]-q[0]);
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(p[0],p[1]); ctx.lineTo(p[0]-9*Math.cos(a-0.4), p[1]-9*Math.sin(a-0.4));
  ctx.lineTo(p[0]-9*Math.cos(a+0.4), p[1]-9*Math.sin(a+0.4)); ctx.closePath(); ctx.fill();
}

const nodeState = {};
const EDGE_PATH = {};        // "A>B" -> pts
function edgeKey(a,b){ return a+'>'+b; }
function buildEdgeCache(){
  const adj = {};
  for (const e of EDGES){
    EDGE_PATH[edgeKey(e[0],e[1])] = edgePath(e);
    (adj[e[0]] = adj[e[0]] || []).push(e[1]);
  }
  /* 논리적 경로(분기·버퍼 노드를 경유하는 라우팅)를 이어붙여 캐시 */
  const procIds = NODES.filter(n=>n.kind==='proc').map(n=>n.id);
  for (const a of procIds) for (const b of procIds){
    if (a===b || EDGE_PATH[edgeKey(a,b)]) continue;
    const q=[[a,[]]], seen=new Set([a]);
    while(q.length){
      const [cur,path]=q.shift();
      if (path.length>4) continue;
      for (const nx of (adj[cur]||[])){
        const np=path.concat([[cur,nx]]);
        if (nx===b){ let pts=[]; np.forEach((seg,i)=>{ const sp=EDGE_PATH[edgeKey(seg[0],seg[1])]||[];
            pts = pts.concat(i? sp.slice(1) : sp); });
          EDGE_PATH[edgeKey(a,b)]=pts; q.length=0; break; }
        const nn=NODE[nx];
        if (nn && (nn.kind==='dec'||nn.kind==='buf') && !seen.has(nx)){ seen.add(nx); q.push([nx,np]); }
      }
    }
  }
}
function pointOn(pts, f){
  let total=0; const seg=[];
  for (let i=1;i<pts.length;i++){ const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]); seg.push(d); total+=d; }
  let want=Math.max(0,Math.min(1,f))*total;
  for (let i=0;i<seg.length;i++){
    if (want<=seg[i]||i===seg.length-1){ const r=seg[i]?want/seg[i]:0;
      return [pts[i][0]+(pts[i+1][0]-pts[i][0])*r, pts[i][1]+(pts[i+1][1]-pts[i][1])*r]; }
    want-=seg[i];
  }
  return pts[pts.length-1];
}
let hover = null;
function hitTest(mx,my){
  const x=(mx-offX)/scale, y=(my-offY)/scale;
  for (const n of NODES){ const b=box(n);
    if (x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h) return n; }
  return null;
}
let animT = 0, evIdx = 0, playing = false, speed = 600, completed = 0;
const _oc = {};
function orderColor(no){ if(!_oc[no]){ const i=Object.keys(_oc).length; _oc[no]=`hsl(${(i*53)%360},72%,62%)`; } return _oc[no]; }
const logs = [], doneSet = new Set(), flying = [];

function nodeColor(n) {
  const s = nodeState[n.id] || {active:[],q:0};
  if (n.kind==='dec') return C.dec;
  if (n.kind==='buf') return C.buf;
  if (!s.active.length) return s.q>=8 ? C.bneck : (offShiftNow() ? C.off : C.idle);
  if (s.active.some(a=>a.setup)) return C.setup;
  if (s.q >= 8) return C.bneck;
  return C.proc;
}
function offShiftNow() {
  if (!SIM) return false;
  const d = new Date(animT*1000), h = d.getHours()+d.getMinutes()/60;
  if (CFG.skipWeekend && (d.getDay()===0||d.getDay()===6)) return true;
  return !SIM.cal.wins.some(w=>h>=w[0]&&h<w[1]);
}

function draw() {
  fit();
  ctx.save(); ctx.translate(offX, offY); ctx.scale(scale, scale);
  ctx.fillStyle = C.bg; ctx.fillRect(-9999,-9999,99999,99999);

  /* 구역 배경 */
  const zones = [
    [45, 48, 1360, 240, '조관 (Forming) — JCOE', '#1f6feb'],
    [45, 296, 1520, 190, '확관 (Expansion) — 병목 공정', '#8957e5'],
    [45, 498, 1520, 372, '검사 · 보수 · 출하 (Inspection & Shipping)', '#238636'],
  ];
  for (const [x,y,w,h,t,c] of zones) {
    ctx.fillStyle = c+'14'; roundRect(x,y,w,h,10); ctx.fill();
    ctx.strokeStyle = c+'44'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle = c+'cc'; ctx.font='600 12px "Segoe UI",sans-serif';
    ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(t, x+10, y+7);
  }

  /* 엣지 */
  for (const e of EDGES) {
    const pts = edgePath(e);
    const bypass = /By-pass|재검사|재확관/.test(e[2]);
    drawArrow(pts, bypass ? '#6e7681' : '#484f58', bypass ? [5,4] : null);
    if (e[2]) {
      const m = pts[Math.floor(pts.length/2)];
      ctx.font='10px "Segoe UI",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      const w = ctx.measureText(e[2]).width+8;
      ctx.fillStyle = C.bg; ctx.fillRect(m[0]-w/2, m[1]-8, w, 15);
      ctx.fillStyle = bypass ? '#6e7681' : '#9198a1'; ctx.fillText(e[2], m[0], m[1]);
    }
  }


  /* 노드 */
  for (const n of NODES) {
    const b = box(n), col = nodeColor(n), s = nodeState[n.id]||{active:[],q:0,done:0};
    ctx.shadowColor = col+'66'; ctx.shadowBlur = s.active.length ? 14 : 0;
    if (n.kind==='dec') { diamond(b.x,b.y,b.w,b.h); }
    else roundRect(b.x,b.y,b.w,b.h,7);
    ctx.fillStyle = col + (n.kind==='dec' ? '33' : (s.active.length?'':'22'));
    if (n.kind!=='dec' && s.active.length) ctx.fillStyle = col;
    ctx.fill(); ctx.shadowBlur=0;
    ctx.strokeStyle = col; ctx.lineWidth = n.bottleneck?2.2:1.4; ctx.stroke();

    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle = (n.kind!=='dec' && s.active.length) ? '#fff' : C.text;
    const lines = n.label.split('\n');
    ctx.font = `600 ${n.kind==='dec'?10:11.5}px "Segoe UI","Malgun Gothic",sans-serif`;
    const cy = b.y + b.h/2 - (n.sub?5:0) - (lines.length-1)*6;
    lines.forEach((L,i)=>ctx.fillText(L, b.x+b.w/2, cy + i*12));
    if (n.sub) { ctx.font='9px "Segoe UI",sans-serif'; ctx.fillStyle= s.active.length?'#dbe9ff':C.dim;
      ctx.fillText(n.sub, b.x+b.w/2, b.y+b.h-(( n.cap||1)>1?19:11)); }

    /* 호기별 레인 (병렬 설비 구분) */
    if (n.kind==='proc') {
      const cap = n.cap||1;
      const lw = (b.w-8)/cap, ly = b.y+b.h-7;
      for (let i=0;i<cap;i++){
        const a = s.active.find(x=>x.u===i);
        const uc = a ? (a.setup?C.setup:C.proc) : (offShiftNow()?C.off:'#ffffff2e');
        ctx.fillStyle = uc;
        roundRect(b.x+4+i*lw+0.6, ly, lw-1.2, 4.6, 2); ctx.fill();
        if (cap>1 && lw>=13){
          ctx.fillStyle = a ? '#fff' : (s.active.length?'#dbe9ff99':C.dim);
          ctx.font='700 7.5px "Segoe UI",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
          ctx.fillText(n.id==='EXP'?('#'+(i+1)+'호기'):('#'+(i+1)), b.x+4+i*lw+lw/2, ly-1.4);
        }
      }
      ctx.textBaseline='middle';
      if (s.q>0){ ctx.fillStyle=s.q>5?C.bneck:'#6e7681'; roundRect(b.x+b.w-20,b.y-8,26,15,7); ctx.fill();
        ctx.fillStyle='#fff'; ctx.font='600 9px sans-serif'; ctx.fillText('Q'+s.q, b.x+b.w-7, b.y-0.5); }
      if (s.done>0){ ctx.fillStyle=C.dim; ctx.font='9px sans-serif'; ctx.textAlign='right';
        ctx.fillText(s.done.toLocaleString(), b.x+b.w-3, b.y+9); }
    }
  }

  /* 이동 중인 파이프 (후판/강관) */
  for (const f of flying) {
    ctx.fillStyle = f.color; ctx.globalAlpha = f.a;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(f.x-5,f.y-2.5,10,5,2.5) : ctx.rect(f.x-5,f.y-2.5,10,5);
    ctx.fill();
    ctx.globalAlpha=1;
  }

  /* 주석 */
  ctx.textAlign='left'; ctx.font='10px "Segoe UI",sans-serif'; ctx.fillStyle=C.dim;
  /* 주석은 현재 「확관 제약 기준」 을 따라간다 — 고정 문구로 두면 기준을 바꿔도 안 바뀐다 */
  const RS = expRules(CFG || {});
  const notes = [
    '* 태그 웰딩: 간이 용접, 본 수 = PCS = 후판 수      * SAW: 서브머지드 아크 용접',
    `RB 라인 투입 조건(전부 만족): ${RS.rb === 'ortools'
        ? 'RB 다이표 외경(24"~48") · 두께 9~25.4mm · 길이 12.8m 이하'
        : '두께 25T 이하 · 외경 24" 이하'}`,
    `확관 #1호기: ${RS.L1}m 초과 작업 불가 / #2호기 동시 작업 시 동일 외경만 가능`,
    `${RS.L2}m 초과 ~ ${RS.L1}m → #1호기만 가동  ·  ${RS.L1}m 초과 → #1·#2호기 가동`
      + (RS.m2Exclusive ? '  ·  외경 48"↑/22"↓ → #2호기 전용' : '  ·  외경 48"↑/22"↓ → #2호기 우선'),
    `기준: ${RS.label}   (「확관 최적화」 탭에서 전환)`,
    '제품군 ① 프로세싱 파이프(A671/A672) ② 라인 파이프(API 5L) — 열처리 공정 없음',
  ];
  notes.forEach((t,i)=>ctx.fillText(t, 1150, 640+i*16));

  /* 툴팁 */
  if (hover) {
    const st = SIM && SIM.stats.find(x=>x.id===hover.id);
    const L = [hover.label.replace('\n',' ') + (hover.sub? '  ('+hover.sub+')':'')];
    if (st){
      L.push(`설비 ${st.cap}대 · 처리 ${st.jobs.toLocaleString()}본`);
      L.push(`가공 ${st.busyH.toFixed(1)}h · 전환 ${st.setupH.toFixed(1)}h`);
      L.push(`가동률 ${st.util.toFixed(1)}%`);
      st.units.forEach(u=>L.push(`  ${u.id} : ${u.jobs}본 / ${(u.busyH+u.setupH).toFixed(1)}h`));
    } else if (hover.kind==='dec') L.push('분기 조건 (Decision)');
    else if (hover.kind==='buf') L.push('버퍼 · 최대 4,000톤 적재');
    else L.push('표준시간 측정 대상 외 공정');
    ctx.font='11px "Segoe UI",sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
    const w = Math.max(...L.map(t=>ctx.measureText(t).width))+20, h=L.length*16+14;
    const b0=box(hover); let tx=b0.x+b0.w+10, ty=b0.y;
    if (tx+w>VW) tx=b0.x-w-10; if (ty+h>VH) ty=VH-h;
    ctx.fillStyle='#0d1117ee'; roundRect(tx,ty,w,h,8); ctx.fill();
    ctx.strokeStyle=C.accent; ctx.lineWidth=1; ctx.stroke();
    L.forEach((t,i)=>{ ctx.fillStyle= i? C.dim : '#fff';
      ctx.font=(i?'11px':'600 12px')+' "Segoe UI",sans-serif'; ctx.fillText(t,tx+10,ty+8+i*16); });
  }
  ctx.restore();
}

/* ================= 애니메이션 ================= */
function stepAnim(dt) {
  if (!SIM) return;
  animT += dt * speed;
  if (animT > SIM.tEnd) { if(LOOP){ seekTo(SIM.t0); return; } animT = SIM.tEnd; playing = false; $('btnPlay').textContent='▶'; }
  const ev = SIM.events;
  for (const n of NODES){ const s0=nodeState[n.id]; s0.active=[]; s0.q=0; }
  /* 활성/대기 이벤트: 도착시각 기준 이진탐색 후 스캔 */
  let lo=0, hi=ev.length-1, st=ev.length;
  while (lo<=hi){ const m=(lo+hi)>>1; if (ev[m].s>=animT-864000){ st=m; hi=m-1; } else lo=m+1; }
  for (let i=Math.max(0,st-4000);i<ev.length && ev[i].cs<=animT;i++){
    const e=ev[i]; const s0=nodeState[e.n];
    if (e.e>animT) s0.active.push({u:e.u, setup: animT < e.s, o:e.o, k:e.k});
  }
  /* 대기열(도착 후 미착수) — r 정렬 배열에서 역방향 스캔 */
  flying.length = 0;
  const bR = SIM.byR;
  let l2=0, h2=bR.length-1, iR=bR.length;
  while (l2<=h2){ const m=(l2+h2)>>1; if (bR[m].r>animT){ iR=m; h2=m-1; } else l2=m+1; }
  const qidx = {};
  for (let i=iR-1;i>=0 && i>iR-9000;i--){
    const e=bR[i]; if (e.cs<=animT) continue;
    const s0=nodeState[e.n]; s0.q++;
    if (!e.p) continue;
    const pts = EDGE_PATH[edgeKey(e.p,e.n)]; if (!pts) continue;
    const j = (qidx[e.n]=(qidx[e.n]||0)+1);
    if (j>7) continue;
    const pt = pointOn(pts, Math.max(0.05, 0.9 - (j-1)*0.09));
    flying.push({x:pt[0], y:pt[1], a:0.9, color:orderColor(e.o)});
  }
  /* 완료/대기열 근사 */
  while (evIdx<ev.length && ev[evIdx].s<=animT) {
    const e=ev[evIdx];
    nodeState[e.n].done++;
    if (e.n==='PACK'){ completed++; }
    if (logs.length<300) {
      if (e.co > 0)
        logs.unshift(`${fmtT(e.cs)}  ⚙ 설비 전환  ${NODE[e.n].label.replace('\n',' ')}  ${(e.co/60).toFixed(0)}분  → 오더 ${e.o}`);
      else if (e.n==='PACK' && e.k%10===0)
        logs.unshift(`${fmtT(e.s)}  ✔ 포장 완료  오더 ${e.o} #${e.k}`);
      else if (e.n==='EXP' && e.k%25===0)
        logs.unshift(`${fmtT(e.s)}  ▸ 확관 #${e.u+1}호기 착수  오더 ${e.o} #${e.k}`);
    }
    evIdx++;
  }
  $('simClock').textContent = fmtT(animT);
  $('doneCnt').textContent = completed.toLocaleString();
  updateStatPanel();
  $('logBody').innerHTML = logs.slice(0,60).map(l=>`<div class="lg">${l}</div>`).join('');
}
let last=null;
function loop(ts){ if(last==null) last=ts; const dt=(ts-last)/1000; last=ts;
  /* syncSeek() 은 정의만 있고 **호출하는 곳이 하나도 없었다** — 재생 중 타임라인이 전혀
     움직이지 않아 지금 어느 시점을 보고 있는지 알 수 없었다. 3D 는 처음부터 이 일을 한다.
     (2026-08-19 전수 감사) */
  if (playing) { stepAnim(Math.min(dt,0.1)); syncSeek(); }
  draw(); requestAnimationFrame(loop); }

/* ================= 사이드 통계 ================= */
function statsByFlow(){
  const ord = NODES.map(n=>n.id);
  return SIM.stats.slice().sort((a,b)=>ord.indexOf(a.id)-ord.indexOf(b.id));
}
function buildStatPanel(){
  $('statBars').innerHTML = statsByFlow().map(s=>`
    <div class="sr"><span class="sn" title="${s.label}">${s.label.replace('\n',' ')}</span>
      <div class="sb"><div class="sf" id="sf_${s.id}"></div><span class="sv" id="sv_${s.id}">0%</span></div>
      <span class="sc">×${s.cap}</span></div>`).join('');
}
function updateStatPanel(){
  if (!SIM) return;
  if (animT <= SIM.t0 + 1) {          // 재생 전에는 전체 시뮬 평균 가동률 표시
    for (const s of SIM.stats){
      const el=$('sf_'+s.id); if(!el) continue;
      const u=Math.min(100,s.util);
      el.style.width=u.toFixed(0)+'%';
      el.style.background = u>=85?C.bneck:u>=60?C.setup:C.done;
      $('sv_'+s.id).textContent=u.toFixed(0)+'%';
    }
    $('simClock').textContent = fmtT(SIM.t0);
    return;
  }
  const win = Math.max(3600, Math.min(86400*3, animT - SIM.t0));
  const ev = SIM.events;
  /* 병목 탭과 정의를 맞춘다 — ① 전환시간 포함 ② 설비별 캘린더(R/B 라인은 1근) ③ **호기 1대** 기준.
     종전에는 전 호기를 합산해 1대 용량으로 나눠 병렬 설비가 대수만큼 부풀려졌고(슬러그 4대 → 4배),
     R/B 후속 3개 노드는 2근 캘린더를 분모로 써서 절반으로 표시됐다. */
  const busy = {};
  const add = (n, u, v) => { (busy[n] || (busy[n] = {}))[u] = (busy[n][u] || 0) + v; };
  let lo=0, hi=ev.length-1, st=ev.length;
  while (lo<=hi){ const m=(lo+hi)>>1; if (ev[m].e>=animT-win){ st=m; hi=m-1; } else lo=m+1; }
  for (let i=Math.max(0,st-2000);i<ev.length && ev[i].s<=animT;i++){
    const e=ev[i]; const a=Math.max(e.s,animT-win), b=Math.min(e.e,animT);
    if (b>a) add(e.n, e.u, b-a);
    if (e.co>0){ const ca=Math.max(e.s-e.co,animT-win), cb=Math.min(e.s,animT); if (cb>ca) add(e.n, e.u, cb-ca); }
  }
  const RB_NODES = new Set(['RB','RBEF','RBRT','PACKRB']);
  for (const s of SIM.stats){
    const dayCap = ((RB_NODES.has(s.id) ? SIM.calRB : SIM.cal) || SIM.cal).dayCap;
    const per = busy[s.id] || {};
    const top = Object.keys(per).length ? Math.max(...Object.values(per)) : 0;
    const u = Math.min(100, top/(win*(dayCap/86400))*100);
    const el=$('sf_'+s.id); if(!el) continue;
    el.style.width=u.toFixed(0)+'%';
    el.style.background = u>=85?C.bneck:u>=60?C.setup:C.done;
    $('sv_'+s.id).textContent=u.toFixed(0)+'%';
  }
}

/* ================= 표준시간 계산기 ================= */
/* 계산기 입력도 시뮬 설정과 같은 검증을 적용한다 — 길이를 비우면 0 이 되어
   "1본 1.55h · 확관 N 0회" 같은 그럴듯한 오답이 그대로 나왔다. */
function calcIn(id, def, lo, hi){
  const el = $(id); if (!el) return def;
  const v = parseFloat(el.value);
  if (!isFinite(v) || v < lo || v > hi) { el.value = def; return def; }
  return v;
}
const CALC_ORDER = [
  ['EdgeMiller','면취 (Edge Miller)'], ['PreBender','Pre Bender'], ['PressBender','Press Bender'],
  ['GapPress','Gap Press'], ['TackWelder','태그 웰딩'], ['InsideWelder','내면 SAW'],
  ['OuterBead','슬러그/비드 제거'], ['OutsideWelder','외면 SAW'], ['FirstUT','1차 U.T'],
  ['Expander','확관 (Expander)'], ['EndFacing','면취기 (End-Facing)'], ['HydroTest','수압'],
  ['FinalUT','Final U.T'], ['EndRT','관단 R/T (RT102)'], ['RT','전장 X-ray (RT101·RT105)'],
  ['CUT','관단탭 절단'], ['Packing','포장'],
];
/* 시뮬레이터 라우트에는 RT 노드가 둘이다 — 관단 R/T(XE, End-RT)와 전장 F-X ray.
   계산기는 전장 하나만 세어 **같은 제품인데 두 화면의 1본 총시간이 달랐다**(−400s).
   (2026-08-19 전수 감사) */
const CALC_ALIAS = { EndRT: { fn: 'RT', rtType: 'End-RT' } };
function calc(){
  const s = {
    od: calcIn('cOD', 914, 100, 3000), t: calcIn('cT', 9.3, 1, 100),
    L: calcIn('cL', 12.802, 0.5, 30) * 1000, qty: calcIn('cQ', 1, 1, 100000),
    grade: $('cGrade').value, api5l: $('cAPI').checked,
    markSpec:+$('cMS').value, markEnd:+$('cME').value, defects: calcIn('cDF', 0, 0, 50),
    holdSec: calcIn('cHold', 60, 0, 36000), rtType:$('cRT').value,
  };
  const line = s.L/1000 > 13 ? '18M':'12M';
  const mach = $('cExp').value;
  const rows = [];
  for (const [k,label] of CALC_ORDER){
    if (k==='GapPress' && s.t<=25) { rows.push({k,label,skip:'두께 25T 이하 → Gap Press 미투입'}); continue; }
    if (k==='FirstUT' && !(s.api5l||s.qty>=50)) { rows.push({k,label,skip:'단일오더 API 5L·50PCS 미만 → By-pass'}); continue; }
    if (k==='FinalUT' && !s.api5l) { rows.push({k,label,skip:'프로세싱 파이프 → 별도 요청 시에만 진행'}); continue; }
    /* 관단 R/T 는 API 5L 제품만 지난다 (라우팅 D5 와 같은 조건) */
    if (k==='EndRT' && !s.api5l) { rows.push({k,label,skip:'API 5L 아님 → 관단 R/T By-pass'}); continue; }
    /* 관단탭 절단은 표준시간 측정 대상이 아니지만 시뮬레이터 라우트에는 들어 있다.
       빼놓고 합계만 보여 주면 「산식 검증」과 1본 총시간이 달라 보인다. (2026-08-19 전수 감사) */
    if (k==='CUT') { rows.push({k,label,skip:`고정 ${CFG?CFG.freeStationSec:300}s — 표준시간 측정 대상 외 (시뮬레이터에는 포함)`}); continue; }
    const al = CALC_ALIAS[k];
    const r = k==='Expander' ? STD.Expander(s, mach)
            : al ? STD[al.fn]({...s, rtType: al.rtType}, line, 1)
            : STD[k](s, line, 1);
    rows.push({k,label,...r});
  }
  const act = rows.filter(r=>!r.skip);
  const max = Math.max(...act.map(r=>r.sec));
  const total = act.reduce((a,r)=>a+r.sec,0);
  const bn = act.find(r=>r.sec===max);
  const shiftSec = CFG ? CFG.netHoursPerShift*3600 : 27000;

  $('calcSum').innerHTML = `
    <div class="kpi"><b>${line}</b><span>투입 라인</span></div>
    <div class="kpi"><b>${fmtDur(total)}</b><span>1본 총 공정시간 (Net)</span></div>
    <div class="kpi bn"><b>${bn.label}</b><span>병목 공정 · ${fmtDur(bn.sec)}</span></div>
    <div class="kpi"><b>${(shiftSec/max).toFixed(1)} 본</b><span>Shift당 생산능력 (병목 기준)</span></div>
    <div class="kpi"><b>${(s.qty*max/3600).toFixed(1)} h</b><span>${s.qty}본 소요 (병목 기준)</span></div>
    <div class="kpi"><b>${expanderN(s,'M1')} / ${expanderN(s,'M2')} 회</b><span>확관 N (#1 / #2호기) · step ${expanderStep(s,'M1').step} / ${expanderStep(s,'M2').step}mm</span></div>
    ${(()=>{ const mk=(($('cExp')||{}).value)||'M2', d=expanderStep(s,mk), ti=d.tool;
        const nm={M1:'#1호기',M2:'#2호기',M3:'#3호기',RB:'RB 라인',BOTH:'#1·#2 동시'}[mk]||mk;
        const warn = ti.unknown ? '다이표에 없음 — 폴백 적용'
                   : ti.warn ? `두께 차 ${ti.tDiff.toFixed(1)}mm — 근사 매칭` : ti.label;
        return `<div class="kpi${ti.unknown||ti.warn?' bn':''}"><b>${ti.head?`H${ti.head} · ${ti.drawbar}`:'다이 없음'}</b>
          <span>${nm} 헤드/드로바 · ${warn}</span></div>`; })()}`;

  $('calcRows').innerHTML = rows.map(r=>{
    if (r.skip) return `<tr class="sk"><td>${r.label}</td><td colspan="4">${r.skip}</td></tr>`;
    const w = r.sec/max*100;
    return `<tr class="${r===bn?'bnrow':''}">
      <td>${r.label}${r===bn?' <span class="tag">병목</span>':''}</td>
      <td class="num">${r.sec.toFixed(1)}s</td>
      <td class="num">${(r.sec/60).toFixed(2)}분</td>
      <td class="bar"><div style="width:${w}%;background:${r===bn?C.bneck:C.accent}"></div></td>
      <td class="fx">${r.expr}</td></tr>`;
  }).join('');

  $('calcTerms').innerHTML = act.map(r=>`
    <div class="tc"><h4>${r.label} <span>${r.sec.toFixed(1)}s</span></h4>
      ${r.terms.map(t=>`<div class="tr2"><span>${t[0]}</span><b>${t[1].toFixed(1)}s</b></div>`).join('')}
    </div>`).join('');
}


/* ================= In / Out 시간표 ================= */
const STATION_LABEL = id => (NODE[id] ? NODE[id].label.replace('\n',' ') : id);
function unitLabel(nid, u, both){
  const n=NODE[nid]; if(!n) return '';
  if(nid==='EXP') return both ? '#1·#2 동시' : '#'+(u+1)+'호기';
  if((n.cap||1)>1) return '#'+(u+1);
  return '-';
}
function buildIOFilters(){
  const st=$('ioStation'); if(!st) return;
  const cur=st.value;
  let html='<option value="">전체 설비</option>';
  for(const n of NODES){
    if(n.kind!=='proc') continue;
    if(!SIM.stats.find(x=>x.id===n.id)) continue;
    html+=`<option value="${n.id}">${STATION_LABEL(n.id)}${(n.cap||1)>1?` (${n.cap}호기)`:''}</option>`;
    if((n.cap||1)>1) for(let i=0;i<n.cap;i++)
      html+=`<option value="${n.id}|${i}">&nbsp;&nbsp;└ ${STATION_LABEL(n.id)} ${unitLabel(n.id,i)}</option>`;
  }
  st.innerHTML=html; if(cur) st.value=cur;
  const od=$('ioOrder'); const cur2=od.value;
  od.innerHTML='<option value="">전체 오더</option>'+Object.keys(SIM.orderSpan)
    .map(no=>{const v=SIM.orderSpan[no];
      return `<option value="${esc(no)}">${esc(no)} · OD${v.od}×t${v.t}×${(v.L/1000).toFixed(1)}m · ${v.qty}본</option>`;}).join('');
  if(cur2) od.value=cur2;
}
let IO_ROWS=[];
function renderIO(){
  if(!SIM) return;
  const selRaw=$('ioStation').value, ordSel=$('ioOrder').value;
  const [selN, selU] = selRaw.split('|');
  const mode=$('ioUnit').value, limit=+$('ioLimit').value;
  let ev=SIM.events.filter(e=>NODE[e.n] && NODE[e.n].kind==='proc');
  if(selN) ev=ev.filter(e=>e.n===selN && (selU===undefined || e.u===+selU));
  if(ordSel) ev=ev.filter(e=>e.o===ordSel);

  let rows;
  if(mode==='pipe'){
    rows=ev.map(e=>({
      o:e.o, k:e.k, st:e.n, u:e.u, both:e.both,
      inT:e.r, start:e.s, out:e.e,
      wait:(e.s-e.r)/60, co:e.co/60, proc:e.d/60
    })).sort((a,b)=>a.inT-b.inT);
    $('ioHead').innerHTML=`<tr><th>오더</th><th>본#</th><th>설비</th><th>호기</th>
      <th>Input (도착)</th><th>착수</th><th>Output (완료)</th>
      <th style="text-align:right">대기(분)</th><th style="text-align:right">전환(분)</th><th style="text-align:right">가공(분)</th></tr>`;
    $('ioBody').innerHTML=rows.slice(0,limit).map(r=>`<tr>
      <td>${esc(r.o)}</td><td class="num">${r.k}</td><td>${STATION_LABEL(r.st)}</td><td>${unitLabel(r.st,r.u,r.both)}</td>
      <td>${fmtT(r.inT)}</td><td>${fmtT(r.start)}</td><td>${fmtT(r.out)}</td>
      <td class="num">${r.wait.toFixed(1)}</td><td class="num ${r.co>0?'hi2':''}">${r.co.toFixed(0)}</td><td class="num">${r.proc.toFixed(1)}</td></tr>`).join('');
  } else {
    const map={};
    for(const e of ev){
      const key=e.o+'|'+e.n+'|'+e.u;
      const m=map[key]||(map[key]={o:e.o,st:e.n,u:e.u,both:e.both,n:0,inT:Infinity,start:Infinity,out:-Infinity,wait:0,co:0,proc:0});
      m.n++; m.inT=Math.min(m.inT,e.r); m.start=Math.min(m.start,e.s); m.out=Math.max(m.out,e.e);
      m.wait+=(e.s-e.r); m.co+=e.co; m.proc+=e.d;
    }
    rows=Object.values(map).sort((a,b)=>a.inT-b.inT);
    $('ioHead').innerHTML=`<tr><th>오더</th><th>설비</th><th>호기</th><th style="text-align:right">본수</th>
      <th>Input (최초 도착)</th><th>착수</th><th>Output (최종 완료)</th>
      <th style="text-align:right">체류(h)</th><th style="text-align:right">가공(h)</th><th style="text-align:right">전환(분)</th><th style="text-align:right">평균 대기(분)</th></tr>`;
    $('ioBody').innerHTML=rows.slice(0,limit).map(r=>`<tr>
      <td>${esc(r.o)}</td><td>${STATION_LABEL(r.st)}</td><td>${unitLabel(r.st,r.u,r.both)}</td><td class="num">${r.n}</td>
      <td>${fmtT(r.inT)}</td><td>${fmtT(r.start)}</td><td>${fmtT(r.out)}</td>
      <td class="num">${((r.out-r.inT)/3600).toFixed(1)}</td><td class="num">${(r.proc/3600).toFixed(1)}</td>
      <td class="num ${r.co>0?'hi2':''}">${(r.co/60).toFixed(0)}</td><td class="num">${(r.wait/60/r.n).toFixed(1)}</td></tr>`).join('');
  }
  IO_ROWS=rows;
  const tw=rows.reduce((a,r)=>a+(mode==='pipe'?r.wait*60:r.wait),0);
  const tc=rows.reduce((a,r)=>a+(mode==='pipe'?r.co*60:r.co),0);
  const tp=rows.reduce((a,r)=>a+(mode==='pipe'?r.proc*60:r.proc),0);
  $('ioSum').innerHTML=`
    <div class="kpi"><b>${rows.length.toLocaleString()}</b><span>조회 행 수${rows.length>limit?` (상위 ${limit} 표시)`:''}</span></div>
    <div class="kpi"><b>${(tp/3600).toFixed(1)} h</b><span>가공 시간 합계</span></div>
    <div class="kpi"><b>${(tc/3600).toFixed(1)} h</b><span>설비 전환 합계</span></div>
    <div class="kpi"><b>${(tw/3600).toFixed(0)} h</b><span>누적 대기 (본×공정 합)</span></div>
    <div class="kpi"><b>${rows.length?(tw/60/rows.reduce((a,r)=>a+(r.n||1),0)).toFixed(1):0} 분</b><span>평균 대기 (본·공정당)</span></div>`;
}
function ioCsv(){
  const mode=$('ioUnit').value;
  const head = mode==='pipe'
    ? ['오더','본#','설비','호기','Input','착수','Output','대기(분)','전환(분)','가공(분)']
    : ['오더','설비','호기','본수','Input','착수','Output','체류(h)','가공(h)','전환(분)','평균대기(분)'];
  const lines=[head.join(',')];
  for(const r of IO_ROWS){
    lines.push(mode==='pipe'
      ? [r.o,r.k,STATION_LABEL(r.st),unitLabel(r.st,r.u,r.both),fmtT(r.inT),fmtT(r.start),fmtT(r.out),
         r.wait.toFixed(1),r.co.toFixed(0),r.proc.toFixed(1)].join(',')
      : [r.o,STATION_LABEL(r.st),unitLabel(r.st,r.u,r.both),r.n,fmtT(r.inT),fmtT(r.start),fmtT(r.out),
         ((r.out-r.inT)/3600).toFixed(1),(r.proc/3600).toFixed(1),(r.co/60).toFixed(0),(r.wait/60/r.n).toFixed(1)].join(','));
  }
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`JCOE_InOut_${mode}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

/* ================= 확관 배분 · 최적화 ================= */
/* 제약이 바뀌면 기존 최적화 해는 무효다. 배분 규칙이 OPT 로 남아 있으면
   pickExpander 에 'OPT' 분기가 없어 조용히 EAT 로 떨어지므로 규칙도 되돌린다. */
function invalidatePlan(){
  PLAN=null;
  /* OPT 뿐 아니라 IMPORT(외부 CP-SAT 스케줄)도 되돌린다 — 제약이 바뀌면 가져온 배정도 근거를 잃는다 */
  if($('optRule') && ($('optRule').value==='OPT' || $('optRule').value==='IMPORT')){
    $('optRule').value='EAT';
    if($('ruleDesc')) $('ruleDesc').textContent=DISPATCH_RULES.EAT.desc;
  }
  if($('optSum')) $('optSum').innerHTML=`<div class="kpi bn"><b>재실행 필요</b><span>제약이 바뀌어 이전 최적화 해는 무효입니다</span></div>`;
  if($('optSeq')) $('optSeq').innerHTML='';
  /* 규칙 비교표·반복 실행 결과도 이전 조건의 것이다 — 같이 지운다.
     종전에는 남아 있어서 조건을 바꾼 뒤에도 옛 조건의 Makespan 이 "현재 값" 처럼 보였다. */
  if($('cmpBody')) $('cmpBody').innerHTML='<tr><td colspan="9" style="color:#6e7681">조건이 바뀌었습니다. 「전체 규칙 비교 실행」을 다시 눌러 주세요.</td></tr>';
  if($('cmpNote')) $('cmpNote').innerHTML='';
  MC_LAST = null;
  ['mcSum','mcHist','mcTable','mcRules'].forEach(id=>{ if($(id)) $(id).innerHTML=''; });
  runSim();
}
function initOptTab(){
  $('optRule').innerHTML=Object.entries(DISPATCH_RULES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
  const upd=()=>{ $('ruleDesc').textContent=DISPATCH_RULES[$('optRule').value].desc; };
  $('optSameOD').onchange=invalidatePlan;
  if($('cfgRB')) $('cfgRB').onchange=invalidatePlan;
  /* 확관 N·셋업 산출식은 확관 가공시간·전환시간을 직접 바꾸므로 최적화 해도 함께 무효화해야 한다.
     종전에는 runSim() 만 돌아서, ③ 패널·위저드 3단계가 옛 해의 Cmax·전환시간을 계속 표시했다. */
  ['optRuleSet','optRbMode','optRbShift','cfgRbPost','cfgExpN','cfgExpSetup','cfgApi5l']
    .forEach(id=>{ if($(id)) $(id).onchange=invalidatePlan; });
  $('optRule').onchange=()=>{ upd(); renderImport(); }; upd();
  initImportTab();
  $('btnApplyRule').onclick=()=>{
    if($('optRule').value==='OPT' && !PLAN){ runOptimizer(); }
    runSim();
  };
  $('btnOpt').onclick=runOptimizer;
  $('btnCmp').onclick=runCompare;
  $('btnIO').onclick=renderIO;
  $('btnIOCsv').onclick=ioCsv;
  ['ioStation','ioOrder','ioUnit','ioLimit'].forEach(id=>$(id).onchange=renderIO);
}
function renderEligWarn(){
  const both=SIM.kpi.bothOrders, fixed=SIM.kpi.fixedOrders;
  const spans=SIM.orderSpan;
  const grp={both:{n:0,q:0}, fixed:{n:0,q:0}, free:{n:0,q:0}};
  for(const no in spans){
    const v=spans[no]; if(!v.route.includes('EXP')) continue;
    const k = both.includes(no)?'both' : fixed.includes(no)?'fixed':'free';
    grp[k].n++; grp[k].q+=v.qty;
  }
  const R = expRules(CFG || readCfg());
  /* Force_RB 는 병목공정(HT102)·원재료내역(배척 판정)에 의존한다.
     계획서에 두 열이 없으면 조용히 RB 물량 0 이 되므로 알려 준다. */
  const rbWarn = (() => {
    const cfg = CFG || readCfg();
    /* R/B 는 현장에서 거의 쓰지 않는다 (2026-08-14 세아제강).
       「적격 제품 전량」은 증산 What-if 시나리오이므로 그 사실을 화면에 알린다. */
    if ((cfg.rbMode || 'force') === 'capable')
      return `<div class="note" style="border-left-color:#d29922">
        <b>증산 What-if</b> — 세아제강 확인(2026-08-14) 기준 <b>R/B 라인은 현장에서 거의 가동하지 않습니다.</b>
        실적 로그(2026-07-16~22) 에도 EP102 실적이 0 건입니다. 이 모드의 결과는 현장 재현이 아니라
        「R/B 를 전면 가동하면 어떻게 되는가」에 대한 가정 시나리오로 읽으십시오.</div>`;
    if ((cfg.rbMode || 'force') !== 'force') return '';
    const hasBn = ORDERS.some(o => o.bottleneck), hasRaw = ORDERS.some(o => o.rawL > 0);
    if (hasBn || hasRaw) return '';
    return `<div class="warn"><b>RB 라인 투입이 「Force_RB 만」 인데 판정 근거가 없습니다.</b><br>
      현재 오더 데이터에 <b>병목 공정 작업장</b>(HT102=열처리)과 <b>원재료 내역</b>(배척 판정용) 열이 없어
      RB 통과 물량이 0본이 됩니다. 계획서·설정 탭에서 두 열이 포함된 조관계획서를 불러오거나,
      RB 라인 투입을 「적격 제품 전량 RB」 로 되돌리세요.</div>`;
  })();
  /* 어떤 사유로 단일 호기에 묶였는지는 제약 기준에 따라 달라진다 (길이 / 외경) */
  const fixedWhy = () => {
    const why = {};
    for(const no of fixed){
      const o = ORDERS.find(x=>String(x.no)===String(no)); if(!o) continue;
      const em = expanderMode(specOf(o, CFG||readCfg()), CFG||readCfg());
      const k = (em.why||'').includes('외경') ? `외경 48"↑/22"↓ → #2호기` : `${R.L2}m 초과 → #1호기`;
      why[k]=(why[k]||0)+1;
    }
    const ks=Object.keys(why);
    return ks.length ? ks.map(k=>`${k}${ks.length>1?` ${why[k]}건`:''}`).join(' · ') : '해당 없음';
  };
  $('eligWarn').innerHTML=rbWarn+`<div class="kpis" style="margin-bottom:4px">
    <div class="kpi"><b>${grp.free.n}오더 / ${grp.free.q.toLocaleString()}본</b><span>두 호기 다 가능 → <b style="color:#58a6ff;font-size:11px">배분 규칙 대상</b></span></div>
    <div class="kpi"><b>${grp.fixed.n}오더 / ${grp.fixed.q.toLocaleString()}본</b><span>단일 호기 전용 — ${fixedWhy()} (선택 여지 없음)</span></div>
    <div class="kpi"><b>${grp.both.n}오더 / ${grp.both.q.toLocaleString()}본</b><span>${R.L1}m 초과 → #1·#2 동시 가동${both.length?` (${esc(both.join(', '))})`:''}</span></div>
  </div>`;
  renderRuleDiff();
}

/* 두 제약 기준의 차이를 한눈에 — 확인 요청 자료로 쓰기 위한 표 */
function renderRuleDiff(){
  const el=$('ruleDiff'); if(!el) return;
  const cur=($('optRuleSet')||{}).value||'ortools';
  const base=readCfg();
  const sum=(rs)=>{
    const cfg={...base, expRuleSet:rs}, q={M1:0,M2:0,FREE:0,BOTH:0,RB:0};
    for(const o of ORDERS){
      /* 시뮬레이션과 같은 정규화(외경 절사·두께 반올림)를 적용해야 화면 분류와 실제가 일치한다 */
      const sp=specOf(o, cfg);
      let k;
      if(useRBLine(sp,cfg)) k='RB';
      else { const em=expanderMode(sp,cfg);
        k = em.mode==='BOTH'?'BOTH' : em.list.length>1?'FREE' : em.list[0]==='M1'?'M1':'M2'; }
      q[k]+=o.qty;
    }
    return q;
  };
  const R = EXP_RULESET[cur];
  const r1 = `L ≤ ${R.L1}m 단독 가능`;
  const r2 = `L ≤ ${R.L2}m 단독 가능` + (R.m2Exclusive ? ' · 48"↑/22"↓ 전용(hard)' : ' · 48"↑/22"↓ 우선(soft)');
  const r3 = `= RB 라인 (${R.rb==='ortools'?'다이표 외경 24"~48" · 9≤t≤25.4 · L≤12.8m':'t≤25T · OD≤24" · L≤12.8m'})`;
  if($('rmR1')) $('rmR1').textContent = r1;
  if($('rmR2')) $('rmR2').textContent = r2;
  if($('rmR3')) $('rmR3').textContent = r3;
  if($('bnR1')) $('bnR1').textContent = '→ 적용: ' + r1;
  if($('bnR2')) $('bnR2').textContent = '→ 적용: ' + r2;
  if($('bnR3')) $('bnR3').textContent = '→ 적용: ' + r3;
  if($('eligOk')) $('eligOk').innerHTML = cur === 'ortools'
    ? `<b>확관 최적화 운영 모델(specs.py) 기준 — 정본</b>을 적용 중입니다. #2호기 상한 ${R.L2}m, #1호기 상한 ${R.L1}m,
       외경 48"↑/22"↓ 는 #2호기 전용(hard), RB 는 다이표 외경(24"~48") · 두께 9~25.4mm.<br>
       <b>12.802m 제품은 #1·#2호기 모두 투입 가능</b>합니다 — 세아제강 실제 생산 로그에서 Expander #2호기 작업 이력이 확인되었습니다 (2026-08-06 세아제강 확인).`
    : `<b>구버전(PPT 공정 다이어그램 · 제약표) 기준</b>으로 보고 있습니다 — 대조용입니다.
       이 기준에서는 <b>${R.L2}m 초과 ~ ${R.L1}m 제품이 #1호기 전용</b>("Only #1 Expander 가동")이 되는데,
       실제 로그에서는 12.802m 제품이 #2호기에서 생산된 이력이 있어 <b>현장과 맞지 않습니다.</b>`;
  const a=sum('ppt'), b=sum('ortools');
  const row=(lbl,ka)=>`<tr><td>${lbl}</td><td class="num">${a[ka].toLocaleString()}</td><td class="num">${b[ka].toLocaleString()}</td></tr>`;
  el.innerHTML=`<div class="${cur==='ortools'?'ok':'warn'}" style="margin-bottom:10px">
    <b>확관 제약 — 정본 확정 (2026-08-06 세아제강 피드백)</b>
    <div style="margin-top:6px">PPT 자료와 운영 모델(ortools) 안의 <code>specs.py</code> 가 다르면 <b>specs.py 가 정본</b>입니다
      (PPT 제작 이후 계속 수정됐고, PPT 에는 생략된 내용도 있습니다).<br>
      12.802m 제품은 <b>#1·#2호기 모두 투입 가능</b>합니다 — 실제 생산 로그에 Expander #2호기 이력이 있습니다.</div>
    <table style="margin-top:8px"><thead><tr><th>항목</th><th>PPT 다이어그램·제약표 (구버전)</th><th>운영 모델 specs.py (정본)</th></tr></thead><tbody>
      <tr><td>#2호기 길이 상한</td><td>12.8m 이상 불가</td><td class="hi2">12.8384m 초과 불가</td></tr>
      <tr><td>#1호기 길이 상한</td><td>14m 이상 불가</td><td>14.021m 초과 불가</td></tr>
      <tr><td>외경 48"↑ / 22"↓</td><td>#2호기 <b>우선</b> 투입</td><td class="hi2">#2호기 <b>전용</b> (hard)</td></tr>
      <tr><td>RB 투입 조건</td><td>두께 25T 이하 &amp; 외경 24" 이하</td><td class="hi2">RB 다이표 외경(24"~48") &amp; 9≤t≤25.4</td></tr>
      <tr><td>RB 강제 투입</td><td>(제약표) 열처리 &amp; 배척 제품 우선</td><td>병목공정 HT102 · 원재료/제품 길이비 ≥ 1.8</td></tr>
      <tr><td>확관 횟수 N</td><td>(엑셀 표준시간 분석) N 항상 홀수</td><td class="hi2">#1 round(L/(step−150)) · #2 짝수 보정</td></tr>
    </tbody></table>
    <div style="margin-top:9px">현재 오더셋 <b>${ORDERS.reduce((x,o)=>x+o.qty,0).toLocaleString()}본</b>을 기준별로 분류하면:</div>
    <table style="margin-top:6px"><thead><tr><th>구분 (본)</th><th style="text-align:right">구버전 기준</th><th style="text-align:right">정본 기준</th></tr></thead><tbody>
      ${row('#1호기 전용','M1')}${row('#2호기 전용','M2')}${row('두 호기 다 가능 — 배분 규칙 대상','FREE')}${row('#1·#2 동시 가동','BOTH')}${row('RB 라인','RB')}
    </tbody></table>
    <div style="margin-top:9px">12.802m 제품(전체의 66%)이 정본 기준에서 <b>두 호기 다 가능</b>으로 바뀌면서 호기 편중이 사라집니다.
      구버전 기준에서 내렸던 “호기 부하 편차는 배분 규칙이 아니라 제품 길이 구성 때문” 이라는 진단은 <b>더 이상 유효하지 않습니다.</b><br>
      현재 적용 기준: <b>${cur==='ortools'?'운영 모델 specs.py (정본)':'PPT 다이어그램 · 제약표 (구버전 · 대조용)'}</b></div></div>`;
}

/* ================= 외부 최적화 스케줄 가져오기 (OR-Tools CP-SAT) ================= */
let IMP_PLAN = null, IMP_SRC = '';
function initImportTab(){
  const drop=$('impDrop'), inp=$('impFile');
  if(!drop||!inp) return;
  drop.onclick=()=>inp.click();
  drop.ondragover=e=>{ e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=e=>{ e.preventDefault(); drop.classList.remove('over');
    if(e.dataTransfer.files&&e.dataTransfer.files[0]) readImport(e.dataTransfer.files[0]); };
  inp.onchange=e=>{ if(e.target.files[0]) readImport(e.target.files[0]); };
  renderImport();
}
function readImport(file){
  const fr=new FileReader();
  const isJson=/\.json$/i.test(file.name);
  fr.onload=()=>{
    try{
      let rows;
      if(isJson){
        const j=JSON.parse(fr.result);
        rows=Array.isArray(j)?j:(j.rows||j.data||j.schedule);
        if(!rows) throw new Error('JSON 에서 배열을 찾지 못했습니다.');
      } else {
        const wb=XLSX.read(fr.result,{type:'array'});
        const sh=wb.Sheets[wb.SheetNames[0]];
        rows=XLSX.utils.sheet_to_json(sh,{header:1,raw:true,defval:null});
      }
      IMP_PLAN=importOptPlan(rows);
      IMP_SRC=file.name;
      $('optRule').value='IMPORT';
      $('ruleDesc').textContent=DISPATCH_RULES.IMPORT.desc;
      renderImport(); runSim();
    }catch(err){
      $('impInfo').innerHTML=`<div class="warn"><b>읽지 못했습니다</b><br>${esc(String(err.message||err))}</div>`;
    }
  };
  if(isJson) fr.readAsText(file); else fr.readAsArrayBuffer(file);
}
function renderImport(){
  const info=$('impInfo'), seqEl=$('impSeq'); if(!info) return;
  if(!IMP_PLAN){
    info.innerHTML=`<div class="note">확관 최적화 모델(<code>optimizer_grouped.solve_integrated_schedule</code>)이 만든 결과 DataFrame 을
      CSV/XLSX 로 저장해 올리면, <b>호기 배정과 투입 순서를 그대로</b> 시뮬레이션에 반영합니다.
      「최적화 엔진 스케줄(내장 SA)」 과 나란히 비교해 볼 수 있습니다.</div>`;
    if(seqEl) seqEl.innerHTML=''; return;
  }
  const P=IMP_PLAN, matched=P.seq.filter(no=>ORDERS.some(o=>String(o.no)===String(no))).length;
  const applied=($('optRule')||{}).value==='IMPORT';
  info.innerHTML=`<div class="kpis" style="margin:8px 0 4px">
      <div class="kpi"><b>${P.nOrders.toLocaleString()}</b><span>가져온 오더 (행 ${P.nRows.toLocaleString()}건)</span></div>
      <div class="kpi"><b>${matched} / ${P.nOrders}</b><span>현재 오더셋과 매칭</span></div>
      <div class="kpi"><b>${P.count.M1}/${P.count.M2}/${P.count.RB}/${P.count.BOTH}</b><span>#1 / #2 / RB / 동시</span></div>
      ${P.spanH?`<div class="kpi"><b>${(P.spanH/24).toFixed(1)}일</b><span>CP-SAT Makespan (${P.unit==='sec'?'초':'분'} 단위 해석)</span></div>`:''}
      <div class="kpi ${applied?'':'bn'}"><b>${applied?'적용 중':'미적용'}</b><span>${applied?esc(IMP_SRC):'배분 규칙을 「외부 최적화 스케줄」 로 바꾸세요'}</span></div>
    </div>
    ${matched===0?`<div class="warn"><b>매칭된 오더가 0건입니다.</b> 파일의 OrderNo(판매오더)와 시뮬레이터 오더번호 체계가 다릅니다.
      계획서 탭에서 같은 조관계획서를 먼저 불러오면 매칭됩니다.</div>`:''}
    ${P.warn.length?`<div class="warn"><b>경고 ${P.warn.length}건</b><br>${P.warn.slice(0,8).map(esc).join('<br>')}${P.warn.length>8?'<br>…':''}</div>`:''}`;
  if(seqEl){
    const byM={};
    P.detail.forEach(d=>{ (byM[d.m]=byM[d.m]||[]).push(d); });
    seqEl.innerHTML=Object.keys(byM).sort().map(m=>`<div class="uc" style="margin-top:8px">
      <h4>${m==='BOTH'?'#1·#2 동시':m==='RB'?'RB 라인':'확관 '+m.replace('M','#')+'호기'}
        <span>${byM[m].length}건</span></h4>
      <div style="font-size:10.5px;color:#8b949e;line-height:1.7;word-break:break-all">
        ${byM[m].slice(0,60).map(d=>d.no).join(' → ')}${byM[m].length>60?' → …':''}</div></div>`).join('');
  }
}
function runOptimizer(){
  const cfg=readCfg();
  const w={cmax:+$('wCmax').value, setup:+$('wSetup').value, bal:+$('wBal').value};
  const iters=+$('optIters').value;
  const t=performance.now();
  PLAN = optimizeExpander(ORDERS, cfg, {weights:w, iters});
  const ms=performance.now()-t;
  if(!PLAN){ $('optSum').innerHTML='<div class="kpi"><b>—</b><span>확관 대상 오더 없음</span></div>'; return; }
  LAST_OPT={ms};
  $('optRule').value='OPT';
  $('ruleDesc').textContent=DISPATCH_RULES.OPT.desc;
  runSim();
  renderOptResult(ms);
}
function optKpiHtml(ms){
  const P=PLAN;
  return `
    <div class="kpi"><b>${P.nJobs}</b><span>확관 대상 오더 (작업 j)</span></div>
    <div class="kpi"><b>${P.nFree} / ${P.nFixed} / ${P.nBoth}</b><span>선택가능 / 단일호기 전용 / 동시가동</span></div>
    <div class="kpi"><b>${P.cmaxH.toFixed(1)} h</b><span>확관 Makespan (Cmax)</span></div>
    <div class="kpi bn"><b>${P.setupH.toFixed(1)} h</b><span>확관 전환시간 Σs<sub>ij</sub></span></div>
    <div class="kpi"><b>${P.balH.toFixed(1)} h</b><span>호기간 부하 편차</span></div>
    <div class="kpi"><b>${P.machines.map((m,i)=>`#${i+1} ${(P.loadH[m]||0).toFixed(0)}h`).join(' / ')}</b><span>호기별 부하</span></div>
    <div class="kpi"><b>${(ms||0).toFixed(0)} ms</b><span>SA ${P.iters.toLocaleString()}회 탐색</span></div>`;
}
function renderOptResultInto(id, ms){
  const el=$(id); if(!el||!PLAN) return;
  el.innerHTML = optKpiHtml(ms != null ? ms : (LAST_OPT && LAST_OPT.ms));
}
function renderOptResult(ms){
  if(!PLAN){ return; }
  const P=PLAN;
  $('optSum').innerHTML = optKpiHtml(ms);
  const byM={}; P.machines.forEach(m=>byM[m]=[]);
  P.detail.forEach(d=>{ if(d.m==='BOTH'){ byM.M1.push(d); byM.M2.push(d); } else byM[d.m].push(d); });
  const colorOf=no=>{ const v=SIM.orderSpan[no]; return v?`hsl(${(Math.round(v.od/25.4)*17)%360},62%,55%)`:'#666'; };
  $('optSeq').innerHTML='<div class="mseq">'+P.machines.map(m=>{
    const rows=byM[m], tot=rows.reduce((a,r)=>a+r.p+r.setup,0)||1;
    return `<div class="mcard"><h5>확관 #${m[1]}호기 <span>${rows.length}오더 · ${(tot/3600).toFixed(1)}h · 전환 ${(rows.reduce((a,r)=>a+r.setup,0)/3600).toFixed(1)}h</span></h5>
      <div class="mseqbar">${rows.map(r=>
        `<div style="width:${r.setup/tot*100}%;background:#d29922" title="전환 ${(r.setup/60).toFixed(0)}분"></div>
         <div style="width:${r.p/tot*100}%;background:${colorOf(r.no)}" title="${esc(r.no)} ${(r.p/3600).toFixed(1)}h"></div>`).join('')}</div>
      ${rows.map((r,i)=>{const v=SIM.orderSpan[r.no]||{};
        return `<div class="mrow"><span><i style="background:${colorOf(r.no)}"></i>${i+1}. ${esc(r.no)}
          ${r.m==='BOTH'?'<span style="color:#ff9a92;font-size:9.5px">[#1·#2 동시]</span>':''}
          &nbsp;<span style="color:#6e7681">OD${v.od}×t${v.t}×${((v.L||0)/1000).toFixed(1)}m</span></span>
          <b>${(r.p/3600).toFixed(1)}h${r.setup>0?` <span style="color:#e3b341">+전환 ${(r.setup/60).toFixed(0)}분</span>`:''}</b></div>`;}).join('')}
    </div>`;
  }).join('')+'</div>';
}
/* ---- 사후분석: 규칙별 비교 ---- */
function runCompare(){
  const base=readCfg();
  if(!PLAN) PLAN=optimizeExpander(ORDERS, base, {weights:{cmax:+$('wCmax').value,setup:+$('wSetup').value,bal:+$('wBal').value}, iters:+$('optIters').value});
  const rows=[];
  for(const r of ruleKeys()){
    const cfg={...base, dispatchRule:r, plan: r==='IMPORT' ? IMP_PLAN : PLAN};
    const S=simulate(ORDERS,cfg);
    const e=S.stats.find(x=>x.id==='EXP');
    rows.push({r, label:DISPATCH_RULES[r].label,
      mk:S.kpi.makespanH, exp:S.kpi.expSetupH, tot:S.kpi.totalSetupH, util:S.kpi.expUtil,
      u1:e&&e.units[0]?e.units[0].jobs:0, u2:e&&e.units[1]?e.units[1].jobs:0,
      u3:e&&e.units[2]?e.units[2].jobs:0, bal:S.kpi.expBalanceH});
  }
  const baseRow=rows.find(x=>x.r==='EAT'), maxExp=Math.max(...rows.map(x=>x.exp));
  const bestExp=Math.min(...rows.map(x=>x.exp)), bestMk=Math.min(...rows.map(x=>x.mk));
  $('cmpBody').innerHTML=rows.map(x=>{
    const d=(a,b)=>{const p=(a-b)/b*100; return p<-0.5?`<span class="imp">${p.toFixed(1)}%</span>`:p>0.5?`<span class="wors">+${p.toFixed(1)}%</span>`:'—';};
    return `<tr class="${x.r===$('optRule').value?'bnrow':''}">
      <td>${x.label}</td>
      <td class="num">${(x.mk/24).toFixed(1)}일 ${x.mk===bestMk?'★':''}<br><span style="color:#6e7681;font-size:10px">${d(x.mk,baseRow.mk)}</span></td>
      <td class="num"><b>${x.exp.toFixed(1)}</b> ${x.exp===bestExp?'★':''}<br><span style="color:#6e7681;font-size:10px">${d(x.exp,baseRow.exp)}</span></td>
      <td class="num">${x.tot.toFixed(0)}</td>
      <td class="num">${x.util.toFixed(1)}%</td>
      <td class="num">${x.u1.toLocaleString()}</td><td class="num">${x.u2.toLocaleString()}${x.u3?` / ${x.u3}`:''}</td>
      <td class="num">${x.bal.toFixed(1)}</td>
      <td class="bar"><div style="width:${maxExp?x.exp/maxExp*100:0}%;background:${x.exp===bestExp?C.done:x.exp>maxExp*0.8?C.bneck:C.accent}"></div></td></tr>`;
  }).join('');
  const opt=rows.find(x=>x.r==='OPT'), eat=baseRow;
  $('cmpNote').innerHTML=`<div class="note">
    <b>해석</b> — 최적화 엔진 적용 시 확관 설비 전환시간이 <b>${eat.exp.toFixed(1)}h → ${opt.exp.toFixed(1)}h
    (${delta(opt.exp, eat.exp)})</b>, 호기간 부하 편차가
    <b>${eat.bal.toFixed(1)}h → ${opt.bal.toFixed(1)}h</b> 로 개선됩니다.
    Makespan 개선폭(${delta(opt.mk, eat.mk, 1)})이 상대적으로 작은 이유는
    현재 계획의 전체 병목이 확관이 아니라 <b>${SIM.stats[0].label.replace('\n',' ')}(가동률 ${SIM.stats[0].util.toFixed(0)}%)</b> 이기 때문입니다.
    확관 최적화의 실질 효과는 <b>전환 손실 감소 · 재공(WIP) 감소 · 호기 부하 균형</b>에서 나타납니다.</div>`;
}

/* ================= 간트 ================= */
function renderGantt(){
  const spans = Object.entries(SIM.orderSpan).sort((a,b)=>a[1].s-b[1].s);
  const t0=SIM.t0, tE=SIM.tEnd, span=tE-t0;
  const days = Math.ceil(span/86400);
  let hdr='';
  for(let d=0;d<days;d++){ const dt=new Date((t0+d*86400)*1000);
    hdr+=`<div class="gd${[0,6].includes(dt.getDay())?' we':''}" style="left:${d/days*100}%;width:${100/days}%">${dt.getMonth()+1}/${dt.getDate()}</div>`; }
  const colorOf = od => `hsl(${(Math.round(od/25.4)*17)%360},62%,55%)`;
  const dl = SIM.kpi.deadline;
  const dlPct = dl ? (dl-t0)/span*100 : null;
  const on = dl!=null && dlPct<=100;
  const marks    = on ? `<div class="gover" style="left:${dlPct}%;right:0"></div><div class="gdl nolbl" style="left:${dlPct}%"></div>` : '';
  const marksHdr = on ? `<div class="gover" style="left:${dlPct}%;right:0"></div><div class="gdl" style="left:${dlPct}%"></div>` : '';
  const seg = $('gSeg') ? $('gSeg').checked : true;
  const rows = spans.map(([no,v])=>{
    const late = (dl && v.e>dl) || (v.tardyH!=null && v.tardyH>0);
    const T = seg ? orderTimeSplit(SIM, no) : null;
    const tt = esc(`${no}\n${fmtT(v.s)} → ${fmtT(v.e)}\n${((v.e-v.s)/3600).toFixed(1)}h`)
      + (T ? esc(`\n가공 ${(T.work/3600).toFixed(1)}h · 전환 ${(T.setup/3600).toFixed(1)}h`
                + `\n대기 ${(T.wait/3600).toFixed(1)}h · 비가동 ${(T.closed/3600).toFixed(1)}h`) : '')
      + (v.due?esc(`\n납기 ${v.due}${v.tardyH>0?` (${(v.tardyH/24).toFixed(1)}일 지연)`:' (준수)'}`):'');
    /* 막대 안을 가공(진한 색)·전환(주황)으로 칠한다 — 나머지가 대기·비가동이다 */
    let inner = '';
    if (T && T.total > 0) {
      const pos = (a,b)=>({l:(a-T.s)/T.total*100, w:Math.max(0.15,(b-a)/T.total*100)});
      inner = mergeThin(T.workSpans, T.total).map(([a,b])=>{const q=pos(a,b);
          return `<i class="gseg w" style="left:${q.l}%;width:${q.w}%"></i>`;}).join('')
        + mergeThin(T.setupSpans, T.total).map(([a,b])=>{const q=pos(a,b);
          return `<i class="gseg s" style="left:${q.l}%;width:${Math.max(0.35,q.w)}%"></i>`;}).join('');
    }
    return `<div class="gr" data-vf="${esc(no)}" title="클릭 → 이 오더의 시간 구성과 산식을 아래에 펼칩니다">
      <div class="gl"><b>${esc(no)}</b>${late?' <span style="color:#ff7b72;font-size:9px">지연</span>':''}
        <span>OD${v.od} × t${v.t} × ${(v.L/1000).toFixed(1)}m · ${v.qty}본 · ${v.line}</span></div>
      <div class="gvbtn">${GV_OPEN===String(no)?'▼ 닫기':'▸ 펼치기'}</div>
      <div class="gt">${marks}
        <div class="gb${late?' late':''}${seg?' seg':''}" style="left:${(v.s-t0)/span*100}%;width:${Math.max(0.4,(v.e-v.s)/span*100)}%;background:${colorOf(v.od)}"
          title="${tt}">${inner}</div>
      </div></div>`
      + (GV_OPEN===String(no) ? `<div class="gdet" data-det="${esc(no)}"></div>` : '');
  }).join('');
  $('gantt').innerHTML = `<div class="ghdr"><div class="gl">오더 / 사양</div><div class="gvbtn">상세</div><div class="gt">${marksHdr}${hdr}</div></div>${rows}`;
  $('gantt').querySelectorAll('.gr[data-vf]').forEach(el =>
    el.addEventListener('click', () => toggleGanttDetail(el.getAttribute('data-vf'))));
  if (GV_OPEN) renderGanttDetail();
  if ($('gLegend')) $('gLegend').style.display = seg ? '' : 'none';
}
/* 막대 안 조각이 수백 개가 되지 않게, 전체의 0.4% 미만으로 벌어진 틈은 이어 붙인다 */
function mergeThin(spans, total){
  if (!spans || !spans.length) return [];
  const gap = total * 0.004;
  const out = [spans[0].slice()];
  for (let i=1;i<spans.length;i++){
    const last = out[out.length-1];
    if (spans[i][0] - last[1] <= gap) last[1] = Math.max(last[1], spans[i][1]);
    else out.push(spans[i].slice());
  }
  return out.slice(0, 400);
}

/* ================= 간트 안 상세 패널 =================
   "페이지가 따로 있어 불편하다" → 오더 간트에서 그 행 바로 아래에 펼친다.
   ① 막대가 무엇으로 채워져 있는지 (가공 / 전환 / 대기 / 비가동)
   ② 본 1개 리드타임의 같은 분해 + 공정별 대기·전환·가공
   ③ 공정별 적용 산식 · 파라미터 · 계산 (편집 포함)
   (2026-08-19) */
let GV_OPEN = null;
function toggleGanttDetail(no){
  no = String(no);
  if (GV_OPEN === no) { GV_OPEN = null; VF_BOX = 'vfBody'; VF_SHAPE = ''; VF_OPEN.clear(); renderGantt(); return; }
  GV_OPEN = no;
  VFS.no = no; VFS.k = 1; VFS.seq = ''; VFS.mach = '';
  VF_OPEN.clear(); VF_SHAPE = '';
  renderGantt();
  const el = $('gantt').querySelector(`.gr[data-vf="${CSS.escape(no)}"]`);
  if (el) el.scrollIntoView({ block:'nearest' });
}
const hSec = (v) => v >= 3600 ? (v/3600).toFixed(1)+'h' : Math.round(v/60)+'분';
function splitBar(T, keys){
  const seg = keys.map(k => ({ k:k[0], l:k[1], v:T[k[0]]||0, c:k[2] })).filter(x => x.v > 0);
  const tot = seg.reduce((a,x)=>a+x.v,0) || 1;
  return `<div class="tsbar">${seg.map(x=>
      `<i style="width:${x.v/tot*100}%;background:${x.c}" title="${esc(x.l)} ${hSec(x.v)} (${(x.v/tot*100).toFixed(0)}%)"></i>`).join('')}</div>
    <div class="tslg">${seg.map(x=>
      `<span><i style="background:${x.c}"></i>${esc(x.l)} <b>${hSec(x.v)}</b> ${(x.v/tot*100).toFixed(0)}%</span>`).join('')}</div>`;
}
const TS_KEYS = [['work','가공','#2ea043'],['setup','전환(공구·다이 교체)','#d29922'],
                 ['wait','대기(앞 공정·설비 점유)','#8b949e'],['closed','비가동(교대 종료·주말)','#30363d']];
function renderGanttDetail(){
  const box = $('gantt') && $('gantt').querySelector(`.gdet[data-det="${CSS.escape(GV_OPEN||'')}"]`);
  if (!box) return;
  const no = GV_OPEN;
  const T = orderTimeSplit(SIM, no);
  const P = pipeTimeSplit(SIM, no, VFS.k);
  const v = SIM.orderSpan[no];
  if (!T || !v) { box.innerHTML = '<div class="note">이 오더의 실행 기록이 없습니다.</div>'; return; }
  const qty = v.qty;
  const procRows = P ? P.rows.map(r => {
    const n = NODE[r.nid] || { label:r.nid };
    return `<tr><td>${esc(n.label.replace(/\n/g,' '))}</td>
      <td class="v" style="color:#8b949e">${r.wait>0?hSec(r.wait):'—'}</td>
      <td class="v" style="color:#d29922">${r.setup>0?hSec(r.setup):'—'}</td>
      <td class="v" style="color:#7ee787">${hSec(r.work)}</td>
      <td class="src">${fmtT(r.s).slice(5,16)} → ${fmtT(r.e).slice(11,16)}</td></tr>`;
  }).join('') : '';
  box.innerHTML = `<div class="gdinner">
    <div class="gdhd"><b>${esc(no)}</b>
      <span class="vfsub">OD${v.od} × t${v.t} × ${(v.L/1000).toFixed(3)}m · ${qty}본 · ${esc(v.line)} · ${fmtT(T.s)} → ${fmtT(T.e)}</span>
      <button class="vfbtn" id="gvBig">산식 검증 탭에서 크게 보기 ▸</button>
      <button class="vfbtn" id="gvClose">✕ 닫기</button></div>

    <div class="gdgrid">
      <div class="gdcard">
        <div class="vfcap">이 막대(${hSec(T.total)})가 무엇으로 채워져 있나 — 오더 전체</div>
        ${splitBar(T, TS_KEYS)}
        <div class="vfwarn" style="color:var(--dim)">
          «가공» 은 이 오더의 파이프 중 <b>하나라도</b> 설비에 물려 있던 시간입니다(${T.pipes}본이 겹쳐 흐릅니다).
          «대기» 는 공장이 도는데 이 오더가 아무 설비도 못 잡은 시간 — 앞 공정이 안 끝났거나 설비가 다른 오더에 물린 경우입니다.
          네 값의 합은 막대 길이와 정확히 같습니다.${T.calRB?' (R/B 근무조 기준)':''}
        </div>
      </div>
      <div class="gdcard">
        <div class="vfcap">본 1개가 겪는 시간 — <b>${P?P.k:1}번째 본</b> (${P?hSec(P.total):'—'})</div>
        ${P ? splitBar(P, TS_KEYS) : '<div class="vfform">기록 없음</div>'}
        <div class="vfwarn" style="color:var(--dim)">
          한 본이 첫 공정에 도착해 포장까지 끝나는 데 걸린 실제 시간입니다.
          표준시간(가공)은 ${P?hSec(P.work):'—'} 인데 실제 리드타임이 ${P?hSec(P.total):'—'} 인 이유가 여기 다 있습니다.
        </div>
      </div>
    </div>

    <div class="gdcard" style="margin-top:10px">
      <div class="gdrow">
        <div class="vfcap" style="margin:0">공정별 — 대기 · 전환 · 가공 (${P?P.k:1}번째 본)</div>
        <label class="gdk">본 번호 <input type="number" id="gvK" value="${P?P.k:1}" min="1" max="${qty}" step="1"></label>
        <label class="gdk">확관 호기 <select id="gvMach">
          <option value="">실제 배정</option><option value="M1">#1호기</option><option value="M2">#2호기</option>
          <option value="BOTH">#1·#2 동시</option><option value="RB">R/B 라인</option></select></label>
      </div>
      <table class="vfp gdtbl"><tr><td><b>공정</b></td><td class="v"><b>대기</b></td><td class="v"><b>전환</b></td>
        <td class="v"><b>가공</b></td><td class="src"><b>실행 구간</b></td></tr>${procRows}</table>
    </div>

    <div class="vfcap" style="margin:14px 0 6px">공정별 적용 산식 · 파라미터 · 계산 <span style="color:var(--dim);font-weight:400">— 카드의 ✎ 편집으로 그 자리에서 값을 고칠 수 있습니다</span></div>
    <div id="gvf"></div>
  </div>`;
  if ($('gvMach')) $('gvMach').value = VFS.mach || '';
  $('gvClose').onclick = (e) => { e.stopPropagation(); toggleGanttDetail(no); };
  $('gvBig').onclick   = (e) => { e.stopPropagation(); VF_BOX='vfBody'; openVerify(no); };
  $('gvK').onchange    = () => { VFS.k = Math.max(1, Math.round(+$('gvK').value || 1)); refreshGanttDetail(); };
  $('gvMach').onchange = () => { VFS.mach = $('gvMach').value; refreshGanttDetail(); };
  box.querySelector('.gdinner').addEventListener('click', e => e.stopPropagation());
  VF_BOX = 'gvf';
  VFS.no = no;
  renderVerify(true);
}
/* 본 번호·호기만 바뀌었을 때 — 간트 전체를 다시 그리지 않는다 */
function refreshGanttDetail(){ VF_OPEN.clear(); VF_SHAPE = ''; renderGanttDetail(); }

/* ================= 산식 검증 =================
   "어떤 식에 어떤 파라미터가 들어가 이 값이 나왔는가" 를 공정별로 전부 펼친다.
   오더 간트에서 행을 클릭하면 이 탭이 그 오더로 열린다. */
function vfOrderList(){
  const seen = new Set(); const out = [];
  for (const o of ORDERS) { const no = String(o.no); if (seen.has(no)) continue; seen.add(no); out.push(o); }
  return out;
}
function buildVfOrders(keep){
  const sel = $('vfOrder'); if(!sel) return;
  const cur = keep != null ? String(keep) : sel.value;
  sel.innerHTML = vfOrderList().map(o =>
    `<option value="${esc(o.no)}">${esc(o.no)} — OD${Math.trunc(o.od)} × t${o.t} × ${(o.L/1000).toFixed(2)}m · ${o.qty}본</option>`).join('');
  if (cur && sel.querySelector(`option[value="${CSS.escape(cur)}"]`)) sel.value = cur;
}
/* 시뮬레이션이 **이 오더의 k번째 본을** 실제로 어떻게 흘렸는지 꺼낸다.
   ★ 오더 단위가 아니라 **본 단위**여야 한다.
     · 확관 호기는 오더 안에서 갈린다 (기본 오더셋 58개 중 29개가 #1·#2 혼재)
     · 포장의 「n본마다 추가 검사」는 전역 누적 본 번호(e.g)로 정해진다
   종전에는 오더의 첫 본 것을 오더 전체에 썼고, 대사표도 노드별 **평균**과 비교해서
   변동성을 꺼도 42/58 오더가 "어긋남" 색으로 표시됐다. (2026-08-19 전수 감사) */
function vfActual(no, k){
  const none = { machine:null, co:null, evSec:null, g:null, pipes:0, kMax:0, machines:[] };
  if (!SIM || !SIM.events) return none;
  const ev = SIM.events.filter(e => String(e.o) === String(no));
  if (!ev.length) return none;
  const co = {};
  let kMax = 0;
  const machines = new Set();
  for (const e of ev) {
    co[e.n] = (co[e.n] || 0) + e.co;
    if (e.k > kMax) kMax = e.k;
    if (e.n === 'EXP' || e.n === 'RB') machines.add(e.mach);
  }
  /* k 번째 본의 이벤트만 뽑는다 — 재작업으로 같은 노드를 두 번 지났으면 **첫 통과**를 쓴다
     (verifyOrder 도 명목 경로 1회만 재현한다) */
  const kk = Math.max(1, Math.min(kMax, Math.round(k || 1)));
  const mine = ev.filter(e => e.k === kk);
  const evSec = {};
  for (const e of mine) if (evSec[e.n] == null) evSec[e.n] = e.d;
  const expEv = mine.find(e => e.n === 'EXP' || e.n === 'RB');
  const anyEv = mine[0];
  return {
    machine: expEv ? expEv.mach : null,
    g: anyEv && anyEv.g != null ? anyEv.g : null,      // 이 본의 전역 누적 번호
    co, evSec, pipes: mine.length, kMax,
    machines: [...machines],
  };
}
function openVerify(no){
  VF_BOX = 'vfBody';
  VFS.no = String(no); VFS.k = 1; VFS.seq = ''; VFS.mach = '';
  VF_OPEN.clear(); VF_SHAPE = '';
  buildVfOrders(no);
  if ($('vfOrder')) $('vfOrder').value = String(no);
  if ($('vfK')) $('vfK').value = 1;
  if ($('vfSeq')) $('vfSeq').value = '';
  if ($('vfMach')) $('vfMach').value = '';
  goTab('pVf');
  renderVerify(true);
}

/* 열려 있는 편집 패널 — 값을 고쳐 다시 계산될 때 **카드를 새로 만들지 않기 위해** 기억한다.
   (기준정보 탭에서 겪은 것과 같은 문제: innerHTML 로 통째로 다시 그리면 방금 누른 입력칸이
    사라져 두 번째 입력부터 조용히 버려진다. 2026-08-14 전수 감사 ①) */
const VF_OPEN = new Set();
let VF_LAST = null;                     // 마지막으로 계산한 verifyOrder 결과
/* ★ 화면이 두 곳(「산식 검증」 탭 · 오더 간트 안 상세 패널)이라 **상태를 DOM 이 아니라 여기서** 갖는다.
   종전에는 vfCompute 가 $('vfOrder') 같은 입력칸을 직접 읽어, 다른 화면에서는 쓸 수 없었다. */
const VFS = { no: null, k: 1, seq: '', mach: '' };
let VF_BOX = 'vfBody';                  // 카드를 그릴 컨테이너 id
let VF_SHAPE = '';                      // 마지막으로 그린 공정 구성 (nid 시퀀스)

/** 지금 화면에 그려진 카드와 같은 조건으로 다시 계산한다.
    본 번호를 바꾸면 **그 본의 실제 호기·전역 순번**을 시뮬레이션에서 가져온다. */
function vfCompute(){
  if (!CFG || !VFS.no) return null;
  const k = Math.max(1, Math.round(isFinite(VFS.k) ? VFS.k : 1));
  const act = vfActual(VFS.no, k);
  /* 전역 누적 본 번호: 비워 두면(=자동) 시뮬레이션 값을 그대로 쓴다.
     사용자가 숫자를 넣으면 그 값을 쓴다(민감도 확인용). */
  const seqRaw = String(VFS.seq || '').trim();
  const seqAuto = seqRaw === '';
  const seqNum = Math.max(1, Math.round(parseFloat(seqRaw) || 1));
  const V = verifyOrder(VFS.no, CFG, {
    k,
    seqGlobal: seqAuto ? (act.g != null ? act.g : k) : seqNum,
    machine: VFS.mach || act.machine || null,
    co: act.co,
  });
  if (V) {
    V._act = act; V._manualMach = !!VFS.mach; V._seqAuto = seqAuto;
    VFS.k = V.k;                                     // 범위 밖 입력은 여기서 보정된다
    /* 보정한 값을 입력칸에 되먹인다 — 칸에는 999 가 남고 계산은 70본으로 되던 문제 */
    if ($('vfK') && String(V.k) !== $('vfK').value) $('vfK').value = V.k;
    if ($('gvK') && String(V.k) !== $('gvK').value) $('gvK').value = V.k;
    if ($('vfSeq') && seqAuto) $('vfSeq').placeholder = `자동 ${V.seqGlobal}`;
  }
  return V;
}
const VF_MACH_LBL = {M1:'#1호기', M2:'#2호기', M3:'#3호기', BOTH:'#1·#2 동시', RB:'R/B 라인'};

/* ---- 조각 렌더러 — 전체 다시 그리기와 제자리 갱신이 **같은 함수**를 쓴다 ---- */
function vfParamRows(st){
  if (!st.vars.length) return '<tr><td colspan="3" style="color:var(--dim)">파라미터 없음 (고정 시간)</td></tr>';
  return st.vars.map(v => {
    const ed = v[3];
    const num = typeof v[1] === 'number' ? (Number.isInteger(v[1]) ? v[1].toLocaleString() : v[1]) : v[1];
    const chg = ed && ed.key && REF_EDIT.tbl[ed.key] != null;
    return `<tr><td>${esc(v[0])}</td>
      <td class="v"${chg ? ' style="color:#e3b341"' : ''}>${esc(num)}${chg ? ' *' : ''}</td>
      <td class="src">${esc(v[2] || '')}</td></tr>`;
  }).join('');
}
function vfTermRows(st){
  if (!st.terms || !st.terms.length) return '';
  return st.terms.map(t => `<tr><td>${esc(t[0])}</td><td class="v">${typeof t[1]==='number'?Math.round(t[1]).toLocaleString():esc(t[1])} s</td></tr>`).join('');
}
function vfSecHtml(st){
  return `${Math.round(st.sec).toLocaleString()} s <span style="font-size:10px;color:var(--dim)">(${(st.sec/60).toFixed(1)}분)</span>`;
}
function vfNoteHtml(st){
  return (st.calib ? `<div class="vfwarn">⚠ 실적 보정 계수 ×${st.calib.toFixed(3)} 적용 → ${Math.round(st.sec)} s</div>` : '')
       + (st.co ? `<div class="vfwarn" style="color:var(--dim)">이 오더의 설비 전환시간 합계 ${(st.co/60).toFixed(1)}분 (표준시간과 별도로 스케줄에 더해짐)</div>` : '');
}
function vfSumHtml(V){
  const kk=(v,l,cls)=>`<div class="kpi ${cls||''}"><b>${v}</b><span>${esc(l)}</span></div>`;
  const machLbl = VF_MACH_LBL[V.machine] || V.machine || '—';
  return kk(`<span style="font-size:15px">OD${V.spec.od} × t${V.spec.t}</span>`, `${(V.spec.L/1000).toFixed(3)}m · ${V.qty}본 · ${V.line} 라인`)
    + kk(`${(V.totalSec/60).toFixed(1)}분`, `1본 총 표준시간 (${Math.round(V.totalSec).toLocaleString()}초)`)
    + kk(`<span style="font-size:15px">${esc(V.bottleneck ? V.bottleneck.label.replace(/\n/g,' ') : '—')}</span>`, `최장 공정 ${V.bottleneck?(V.bottleneck.sec/60).toFixed(1):'—'}분`, 'bn')
    + kk(`<span style="font-size:15px">${esc(machLbl)}</span>`,
        '확관 배정' + (V._manualMach ? ' (수동 지정)'
          : V._act.machine ? ` (${V.k}번째 본 실제 배정${V._act.machines.length > 1 ? ` · 이 오더는 ${V._act.machines.map(m=>VF_MACH_LBL[m]||m).join('·')} 혼재` : ''})`
          : ' (추정)'))
    + kk(`${V.steps.length}개`, '통과 공정');
}
/* 대사표 — **같은 본(k)의 이벤트**와 1:1 로 맞춘다.
   종전에는 「1본의 산식 결과」 vs 「그 오더 전 본의 노드별 평균」을 비교해서,
   변동성·보정을 다 꺼도 58개 중 42개 오더가 "어긋남" 색으로 표시됐다. (2026-08-19 전수 감사) */
function vfReconHtml(V){
  const act = V._act;
  if (!act || !act.evSec) return '';
  let diff = 0;
  const rows = V.steps.map(st => {
    const a = act.evSec[st.nid];
    if (a == null) return '';
    const d = (a - st.sec) / (st.sec || 1) * 100;
    if (Math.abs(d) >= 0.5) diff++;
    return `<tr><td>${esc(st.label.replace(/\n/g,' '))}</td><td class="v">${Math.round(st.sec).toLocaleString()}</td><td class="v">${Math.round(a).toLocaleString()}</td><td class="v" style="color:${Math.abs(d)<0.5?'var(--dim)':'#f0a252'}">${d>=0?'+':''}${d.toFixed(1)}%</td></tr>`;
  }).join('');
  return `<table class="vfp"><tr><td><b>공정</b></td><td class="v"><b>산식(s)</b></td><td class="v"><b>시뮬 실행(s)</b></td><td class="v"><b>차이</b></td></tr>${rows}</table>`
    + `<div class="vfwarn" style="color:${diff ? '#f0a252' : 'var(--dim)'}">${diff
        ? `${diff}개 공정이 다릅니다 — 변동성(로그정규 CV) 또는 실적 보정이 켜져 있다는 뜻입니다. 둘 다 끄면 전부 0% 가 됩니다.`
        : '전 공정 일치 — 이 화면의 산식이 시뮬레이션이 실제로 쓴 값과 같습니다.'}</div>`;
}

/** 값만 제자리에서 갱신한다 — 편집 패널·입력 포커스는 건드리지 않는다.
    호출 전에 vfSameShape() 로 공정 구성이 같은지 확인해야 한다. */
function vfPatch(pre){
  const V = pre || vfCompute(); if (!V) return;
  VF_LAST = V;
  const box = $(VF_BOX) || $('vfBody'); if (!box) return;
  if ($('vfSum') && VF_BOX === 'vfBody') $('vfSum').innerHTML = vfSumHtml(V);
  V.steps.forEach((st, i) => {
    const card = box.querySelector(`.vfstep[data-i="${i}"]`); if (!card) return;
    const set = (f, html) => { const el = card.querySelector(`[data-f="${f}"]`); if (el) el.innerHTML = html; };
    set('sec', vfSecHtml(st));
    set('tpl', esc(st.tpl));
    set('vars', vfParamRows(st));
    set('subst', esc(st.subst));
    set('terms', vfTermRows(st));
    set('note', vfNoteHtml(st));
    /* 같은 상수를 두 카드가 가리킬 수 있다(관단 R/T·F-X ray 는 둘 다 RT).
       한쪽에서 고치면 다른 쪽 편집칸도 같이 움직여야 한다. */
    if (VF_OPEN.has(i)) vfSyncEditInputs(card, st);
  });
  const rc = box.querySelector('[data-f="recon"]');
  if (rc) rc.innerHTML = vfReconHtml(V);
  vfMarkEdited();
}
/** 상단에 「원래 값과 다름」 표시 */
function vfMarkEdited(){
  const el = $('vfDirty'); if (!el) return;
  const n = refCount();
  /* 버튼은 **항상 만들어 두고** 숨기기만 한다 — 있다 없다 하는 id 는 정적 검사(verify_static ②)에서
     "존재하지 않는 참조" 로 잡히고, 무엇보다 클릭 핸들러를 매번 다시 걸어야 해서 사고가 난다. */
  el.innerHTML = (n
      ? `<b style="color:#e3b341">기준값 ${n}개를 고친 상태</b>입니다 — 시뮬레이션 결과도 이 값으로 다시 계산됐습니다.`
      : '기준값을 고치지 않은 원래 상태입니다.')
    + `<button id="vfResetAll" class="vfbtn"${n ? '' : ' style="display:none"'}>전부 원래대로</button>`
    + `<button id="vfExport2" class="vfbtn"${n ? '' : ' style="display:none"'}>JSON 내보내기</button>`;
  if ($('vfResetAll')) $('vfResetAll').onclick = () => {
    if (!confirm('기준정보·엑셀 표 수정값을 전부 원래대로 되돌립니다. 진행할까요?')) return;
    REF_EDIT = { std:{}, co:{}, cap:{}, tbl:{} };
    refApply(true); renderVerify(true);
  };
  if ($('vfExport2')) $('vfExport2').onclick = refExport;
}

/** 화면에 그려진 카드 구성과 새로 계산한 공정 구성이 같은가.
    ★ 이걸 안 보면, 설정을 바꿔 공정이 하나 늘었을 때 카드 제목은 그대로인 채
      값만 한 칸씩 밀려 **「면취 공정」 자리에 Calibration Press 의 300초**가 찍힌다.
      (2026-08-19 전수 감사 — 실제로 재현됨) */
function vfSameShape(box, V){
  const cards = box.querySelectorAll('.vfstep[data-i]');
  if (cards.length !== V.steps.length) return false;
  for (let i = 0; i < cards.length; i++)
    if (cards[i].dataset.nid !== V.steps[i].nid) return false;
  return true;
}
function renderVerify(force){
  const box = $(VF_BOX) || $('vfBody'); if(!box) return;
  /* 편집 패널이 열려 있고 **공정 구성이 그대로일 때만** 숫자만 갈아 끼운다.
     구성이 바뀌었으면 편집 패널을 잃더라도 반드시 다시 그린다 — 틀린 값을 보여주는 것보다 낫다. */
  if (!force && VF_OPEN.size && box.querySelector('.vfstep')) {
    const V0 = vfCompute();
    if (V0 && vfSameShape(box, V0)) return vfPatch(V0);
  }
  if (!CFG) { box.innerHTML = '<div class="note">먼저 「계획 실행」에서 시뮬레이션을 한 번 돌려 주세요.</div>'; return; }
  if ($('vfOrder') && !$('vfOrder').options.length) buildVfOrders();
  if (!VFS.no) { box.innerHTML = '<div class="note">오더가 없습니다.</div>'; return; }
  const V = vfCompute();
  if (!V) { box.innerHTML = '<div class="note">해당 오더를 찾을 수 없습니다.</div>'; return; }
  /* 다시 그리더라도 **열어 둔 편집 패널은 그대로 열어 준다.**
     간트 안에서 값을 고치면 runSim → renderGantt 로 패널이 통째로 다시 만들어지는데,
     그때마다 편집칸이 닫히면 연속 편집이 불가능하다. 공정 구성이 같을 때만 복원한다. */
  const shape = V.steps.map(x => x.nid).join('>') + '@' + V.no;
  const reopen = (shape === VF_SHAPE) ? new Set(VF_OPEN) : new Set();
  VF_SHAPE = shape;
  VF_LAST = V; VF_OPEN.clear();
  if ($('vfK')) $('vfK').max = V.qty;
  const inTab = VF_BOX === 'vfBody';
  if (inTab && $('vfSum')) $('vfSum').innerHTML = vfSumHtml(V);

  const rowsHtml = V.steps.map((st, i) => `<div class="vfstep" data-i="${i}" data-nid="${esc(st.nid)}" data-st="${esc(st.st||'')}">
      <div class="vfhd"><div class="vfno">${i+1}</div>
        <div><b>${esc(st.label.replace(/\n/g,' '))}</b>${st.sub?` <span class="vfsub">${esc(st.sub)}</span>`:''}${st.machine?` <span class="vfsub">· ${esc(VF_MACH_LBL[V.machine]||V.machine)}</span>`:''}</div>
        <button class="vfbtn vfedit" data-i="${i}">✎ 편집</button>
        <div class="vfsec" data-f="sec">${vfSecHtml(st)}</div></div>
      <div class="vfbody">
        <div class="vfcap">적용 산식</div>
        <div class="vfform" data-f="tpl">${esc(st.tpl)}</div>
        <div class="vfgrid">
          <div><div class="vfcap">파라미터 값 (이 제품)</div><table class="vfp" data-f="vars">${vfParamRows(st)}</table></div>
          <div><div class="vfcap">산식 계산</div><div class="vfform res" data-f="subst">${esc(st.subst)}</div>
            ${st.terms && st.terms.length ? `<div class="vfcap" style="margin-top:9px">항목별 분해</div><table class="vfp" data-f="terms">${vfTermRows(st)}</table>` : '<span data-f="terms"></span>'}
            <div data-f="note">${vfNoteHtml(st)}</div></div>
        </div>
        <div class="vfedbox" data-f="edit" hidden></div>
      </div></div>`).join('');

  const recon = (inTab && V._act && V._act.evSec) ? `<div class="vfstep"><div class="vfhd"><b>시뮬레이션 실행값과 대사</b>
        <span class="vfsub">${esc(V.no)} 의 <b>${V.k}번째 본</b>이 실제로 각 공정에 머문 시간 vs 위 산식 결과 (${V._act.pipes}개 공정)</span></div>
      <div class="vfbody"><div data-f="recon">${vfReconHtml(V)}</div></div></div>` : '';

  /* #vfDirty 는 「산식 검증」 탭에만 둔다 — 간트 안에 또 만들면 id 가 중복된다 */
  const head = inTab ? `<div class="note" style="margin:0 0 12px">
      <b>${esc(V.no)}</b> · 오더 내 <b>${V.k}번째 본</b> (전역 누적 ${V.seqGlobal}본째) 기준입니다.
      표준시간은 <b>가동률을 고려하지 않은 Net Time</b>이며, 설비 전환시간·대기시간은 여기에 포함되지 않습니다.
      <div id="vfDirty" style="margin-top:6px"></div>
    </div>` : '';
  box.innerHTML = head + rowsHtml + recon;
  box.querySelectorAll('.vfedit').forEach(b => b.onclick = (e) => { e.stopPropagation(); vfToggleEdit(+b.dataset.i); });
  box.querySelectorAll('.vfstep').forEach(c => c.addEventListener('click', e => e.stopPropagation()));
  reopen.forEach(i => { if (V.steps[i]) vfToggleEdit(i); });
  if (inTab) vfMarkEdited();
}

/** 열려 있는 편집칸의 표시값을 현재 엔진값으로 맞춘다.
    같은 상수를 두 카드가 가리키거나(관단 R/T·F-X ray = 둘 다 RT),
    「기준정보」 탭에서 값이 바뀐 경우에 필요하다. (2026-08-19 전수 감사) */
function vfSyncEditInputs(card, st){
  const box = card.querySelector('[data-f="edit"]'); if (!box || box.hidden) return;
  box.querySelectorAll('input.refin[data-ref]').forEach(el => {
    const r = el.dataset.ref.split('\u241F');
    let cur, def;
    if (r[0] === 'std') { cur = REF.std[r[1]][r[2]].v; def = REF_STD_DEFAULT[r[1]][r[2]].v; }
    else { def = +r[2]; cur = REF_EDIT.tbl[r[1]] != null ? REF_EDIT.tbl[r[1]] : def; }
    if (String(cur) !== el.value) { el.value = cur; el.dataset.last = cur; }
    const chg = Math.abs(cur - def) > 1e-9;
    el.classList.toggle('chg', chg);
    const u = document.getElementById(el.id + 'u'); if (u) u.classList.toggle('on', chg);
  });
}

/* ---- [편집] — 이 공정에 쓰인 값을 그 자리에서 고친다 --------------------
   두 종류를 한곳에 모은다.
     ① 기준정보 상수 — 산식에 그대로 박혀 있는 값 (348s, /215.6 …)  → REF.std
     ② 엑셀 표에서 조회된 값 — 이 제품이 실제로 짚은 **그 칸 하나**    → REF.tbl
   ②는 종전에 어디서도 고칠 수 없었다(「기준정보」 탭은 행 수만 보여 줬다).
   계획서에서 온 값(길이·두께·외경)과 파생값은 여기서 고치지 않는다 — 계획서를 고쳐야 한다. */
function vfToggleEdit(i){
  const card = ($(VF_BOX) || $('vfBody')).querySelector(`.vfstep[data-i="${i}"]`); if (!card) return;
  const box = card.querySelector('[data-f="edit"]');
  const btn = card.querySelector('.vfedit');
  if (!box.hidden) { box.hidden = true; VF_OPEN.delete(i); btn.textContent = '✎ 편집'; btn.classList.remove('on'); return; }
  box.hidden = false; VF_OPEN.add(i); btn.textContent = '✕ 닫기'; btn.classList.add('on');
  vfBuildEdit(i, box);
}
function vfBuildEdit(i, box){
  const st = VF_LAST && VF_LAST.steps[i]; if (!st) return;
  const proc = st.st;

  /* ① 기준정보 상수 */
  let stdHtml = '';
  if (proc && REF.std[proc]) {
    const G = REF.std[proc], D = REF_STD_DEFAULT[proc];
    stdHtml = Object.keys(G).filter(k => k[0] !== '_').map(k =>
      `<div class="refrow"><span title="${esc(G[k].l)}">${esc(G[k].l)}</span>
        ${refInput(G[k].v, D[k].v, v => { refSet('std', proc, k, v); renderVerify(); },
          { min: REF_STD_LO(proc, k), max: REF_STD_MAX(proc, k), ref: `std\u241F${proc}\u241F${k}` })}
        <i>${esc(G[k].u || '')}</i></div>`).join('');
  }

  /* ② 이 제품이 짚은 엑셀 표 칸 */
  const cells = st.vars.filter(v => v[3] && v[3].key);
  const tblHtml = cells.map(v => {
    const ed = v[3];
    const cur = REF_EDIT.tbl[ed.key] != null ? REF_EDIT.tbl[ed.key] : ed.def;
    /* 하한은 «기본값의 1/1000». 0·음수는 물론, 1e-9 같은 값으로 완료일이 100만 일이 되는 것도 막는다.
       (종전 하한 1e-9 은 사실상 하한이 아니었다 — 2026-08-19 전수 감사) */
    return `<div class="refrow"><span title="${esc(v[2])}">${esc(v[0])}</span>
      ${refInput(cur, ed.def, nv => { refSetTbl(ed.key, nv); renderVerify(); },
        { min: Math.abs(ed.def) / 1000, max: Math.abs(ed.def) * 1000, ref: `tbl\u241F${ed.key}\u241F${ed.def}` })}
      <i class="vfsrc">${esc(ed.key.split('|')[0])}</i></div>`;
  }).join('');

  /* 못 고치는 값 — 왜 못 고치는지 밝힌다 */
  const fixed = st.vars.filter(v => !(v[3] && v[3].key)).map(v => v[0]);

  box.innerHTML =
    (stdHtml ? `<div class="vfcap">기준정보 상수 — 산식에 박힌 값 (「기준정보」 탭과 같은 값입니다)</div>
       <div class="refgrid" data-sec="std">${stdHtml}</div>` : '')
  + (tblHtml ? `<div class="vfcap" style="margin-top:11px">엑셀 표에서 조회된 값 — 이 제품이 짚은 칸만</div>
       <div class="refgrid" data-sec="tbl">${tblHtml}</div>` : '')
  + (!stdHtml && !tblHtml ? '<div class="vfwarn" style="color:var(--dim)">이 공정에는 고칠 수 있는 상수가 없습니다 (고정 시간).</div>' : '')
  + (fixed.length ? `<div class="vfwarn" style="color:var(--dim);margin-top:9px">
       고칠 수 없는 값 — ${esc(fixed.join(' · '))}<br>
       계획서에서 읽은 값이거나 위 값들로부터 계산되는 값입니다. 계획서를 고치면 따라 바뀝니다.</div>` : '')
  + `<div class="vfwarn" style="color:var(--dim);margin-top:7px">
       고치면 <b>시뮬레이션 전체가 곧바로 다시 계산</b>됩니다. ↺ 로 그 값만 되돌릴 수 있고,
       바꾼 내용은 「기준정보」 탭의 <b>내보내기</b>로 JSON 한 장에 저장됩니다.</div>`;
  refBind();
}
/* ================= 병목 분석 ================= */
/* 병목 유형 판정 — 성격이 다른 병목을 구분해서 보여준다 */
function bnType(x){
  if (x.setupShare >= 15) return { k:'setup', t:'전환 병목', c:C.setup };
  if (x.imbalance >= 20) return { k:'elig', t:'제약 병목', c:'#8957e5' };
  if (x.util >= 55) return { k:'proc', t:'가공 병목', c:C.bneck };
  return { k:'ok', t:'여유', c:C.done };
}
function renderBottleneck(){
  const s = SIM.stats;
  const max = Math.max(...s.map(x=>x.util));
  $('bnTable').innerHTML = s.map(x=>{
    const ty = bnType(x);
    return `<tr class="${x.util>=80?'hi':x.util>=55?'mid':''}">
      <td>${x.label.replace('\n',' ')}</td>
      <td class="num">${x.cap}</td><td class="num adv">${x.jobs.toLocaleString()}</td>
      <td class="num adv">${x.busyH.toFixed(1)}</td>
      <td class="num adv ${x.setupH>10?'hi2':''}">${x.setupH.toFixed(1)}</td>
      <td class="num adv ${x.setupShare>=15?'hi2':''}">${x.setupShare.toFixed(1)}%</td>
      <td class="bar"><div style="width:${Math.min(100,x.util/max*100)}%;background:${x.util>=80?C.bneck:x.util>=55?C.setup:C.done}"></div></td>
      <td class="num"><b>${x.util.toFixed(1)}%</b>${x.cap>1?`<br><span style="color:#6e7681;font-size:9.5px">${x.unitUtil.map(v=>v.toFixed(0)+'%').join(' / ')}</span>`:''}</td>
      <td><span class="tag" style="background:${ty.c};color:#fff">${ty.t}</span></td></tr>`;
  }).join('');

  const top = s[0];
  /* 전환·제약 병목 카드는 값이 0 이면 지목하지 않는다 — 전환시간을 끄면 "JCOE 포장이 전환 병목 0.0h" 가 나왔다 */
  const setupTop = s.slice().sort((a,b)=>b.setupH-a.setupH).filter(x=>x.setupH>0.05)[0];
  const eligTop = s.slice().sort((a,b)=>b.imbalance-a.imbalance).filter(x=>x.imbalance>1)[0];
  const totSetup = s.reduce((a,x)=>a+x.setupH,0);
  const exp = s.find(x=>x.id==='EXP') || {imbalance:0, setupH:0, util:0, unitUtil:[0,0]};
  $('bnCall').innerHTML = `
    <div class="kpi bn"><b>${top.label.replace('\n',' ')}</b><span>가공 병목 · 대당 가동률 ${top.util.toFixed(1)}%</span></div>
    ${setupTop?`<div class="kpi" style="border-color:#d2992266;background:#d2992214"><b style="color:#e3b341">${setupTop.label.replace('\n',' ')}</b><span>전환 병목 · ${setupTop.setupH.toFixed(1)}h (전체 전환의 ${pct(setupTop.setupH, totSetup)})</span></div>`:''}
    ${eligTop?`<div class="kpi" style="border-color:#8957e566;background:#8957e514"><b style="color:#a77bff">${eligTop.label.replace('\n',' ')}</b><span>제약 병목 · 호기 편차 ${eligTop.imbalance.toFixed(0)}%p</span></div>`:'<div class="kpi"><b>없음</b><span>제약 병목 — 호기 편중이 유의하지 않습니다</span></div>'}
    <div class="kpi"><b>${totSetup.toFixed(0)} h</b><span>총 설비 전환 시간</span></div>`;

  /* 대표 규격 1본 유효 CT 를 실제 산출식으로 다시 계산해 보여준다 (고정 문구 금지) */
  const ctSample = () => {
    const rep = ORDERS.slice().sort((a,b)=>b.qty-a.qty)[0];
    if(!rep) return '';
    /* 시뮬 본체와 같은 specOf 를 써야 재질·API 5L 판정이 어긋나지 않는다 */
    const sp = specOf(rep, CFG||readCfg());
    const line = rep.L/1000 > 13 ? '18M' : '12M';
    const list = [['포장', STD.Packing(sp,line,1).sec], ['수압', STD.HydroTest(sp).sec],
                  ['슬러그 제거', STD.OuterBead(sp).sec], ['면취기', STD.EndFacing(sp).sec],
                  ['확관 #1호기', STD.Expander(sp,'M1').sec]].sort((a,b)=>b[1]-a[1]);
    const expRank = list.findIndex(x=>x[0].startsWith('확관')) + 1;
    return `대표 규격 <b>OD${rep.od}×t${rep.t}×${(rep.L/1000).toFixed(3)}m</b>(${rep.qty}본) 기준 1본 소요는 `
      + list.map(x=>`${x[0]} ${x[1].toFixed(0)}초`).join(' · ')
      + ` 로, <b>확관은 ${expRank}위</b>입니다. 순수 가공 속도만 보면 확관이 가장 느린 공정은 아닙니다.`;
  };
  /* 단일 호기 전용 물량 비중도 제약 기준에 따라 달라지므로 매번 계산 */
  const eligShare = () => {
    const cfg = CFG || readCfg();
    let fixedQ = 0, tot = 0;
    for(const o of ORDERS){
      const sp={no:o.no,od:o.od,t:o.t,L:o.L,qty:o.qty};
      const sv=SIM.orderSpan[o.no]; if(!sv || !sv.route.includes('EXP')) continue;
      tot += o.qty;
      const em = expanderMode(sp,cfg);
      if(em.mode==='SINGLE' && em.list.length===1) fixedQ += o.qty;
    }
    return tot ? `현재 제약 기준에서 단일 호기 전용 물량은 <b>${fixedQ.toLocaleString()}본 (확관 통과분의 ${(fixedQ/tot*100).toFixed(0)}%)</b> 입니다.` : '';
  };
  /* 종전에는 이 해설이 항상 펼쳐져 병목 분석 탭 상단 1/3 을 먹었다.
     한 줄 결론만 보이고 근거는 접는다. (2026-08-14) */
  $('bnWhy').innerHTML = `<details class="note">
    <summary>병목은 세 종류 — 가공(${esc(top.label.replace('\n',' '))}) · 전환(${setupTop?esc(setupTop.label.replace('\n',' ')):'—'}) · 제약(호기 편차 ${exp.imbalance.toFixed(0)}%p)<span class="more">왜 그런가요?</span></summary>
    <div class="notebody">
    <b style="color:#ff7b72">① 가공 병목</b> — <b>${top.label.replace('\n',' ')} ${top.util.toFixed(0)}%</b>.
    1본당 소요가 길고 설비가 ${top.cap}대뿐이라 물리적으로 가장 느립니다.
    ${ctSample()}<br><br>
    <b style="color:#e3b341">② 전환 병목</b> — ${setupTop?`<b>${setupTop.label.replace('\n',' ')} ${setupTop.setupH.toFixed(0)}h</b>,
    전체 설비 전환의 ${pct(setupTop.setupH, totSetup)}가 여기서 발생합니다. 다이·헤드 교체 때문에 규격이 바뀔 때마다 멈춥니다.`:'전환시간이 반영되지 않아 판정할 수 없습니다.'}
    <b>PPT가 말한 “확관 병목”은 이쪽</b>입니다 — “타 공정 대비 긴 설비 전환 시간이 전체 공정의 병목을 유발”.<br><br>
    <b style="color:#a77bff">③ 제약 병목</b> — 확관 호기 간 가동률 차이 <b>${exp.imbalance.toFixed(0)}%p</b>
    (${exp.unitUtil.map(v=>v.toFixed(0)+'%').join(' / ')}).
    ${eligShare()}
    대수 평균으로 보면 낮아 보이지만 <b>가장 바쁜 호기만 보면 상위권</b>입니다.<br><br>
    정리하면 <b>납기를 좌우하는 것은 포장·슬러그 제거 같은 가공 병목</b>이고,
    <b>확관은 전환·제약 병목</b>이라 개선 수단이 다릅니다. 앞은 설비 증설이나 사이클타임 단축,
    뒤는 <b>오더 시퀀싱(같은 규격 묶기)과 호기 배분</b>으로 풉니다 — 「확관 최적화」 탭이 그 도구입니다.
    </div></details>`;

  $('bnUnits').innerHTML = s.filter(x=>x.cap>1).map(x=>`
    <div class="uc"><h4>${x.label.replace('\n',' ')} (${x.cap} units)</h4>
      ${x.units.map((u,i)=>`<div class="tr2"><span>${x.id==='EXP'?('확관 #'+(i+1)+'호기'):u.id}</span>
        <b>${u.jobs.toLocaleString()}본 · ${(u.busyH+u.setupH).toFixed(1)}h · ${u.util.toFixed(0)}%</b></div>`).join('')}
    </div>`).join('');
}

/* ================= 계획 기간 ================= */
function initPeriod(){
  const upd=()=>{ $('fGap').style.display = $('cfgDateMode').value==='seq' ? 'flex':'none'; };
  $('cfgDateMode').onchange=()=>{ upd(); runSim(); };
  $('btnPeriod').onclick=runSim;
  $('btnPeriodClear').onclick=()=>{ $('cfgDeadline').value=''; runSim(); };
  $('cfgStart').onchange=runSim; $('cfgDeadline').onchange=runSim; $('cfgSeqGap').onchange=runSim;
  if($('cfgDueAnalysis')) $('cfgDueAnalysis').onchange=runSim;
  upd();
}
function renderPeriod(){
  const k=SIM.kpi, total=k.doneInPeriod+k.overflow;
  const first=Object.values(SIM.orderSpan).reduce((a,v)=>Math.min(a,v.s),Infinity);
  $('periodHint').innerHTML = `실제 소요 <b style="color:#e6edf3">${fmtT(SIM.t0)} → ${fmtT(SIM.tEnd)}</b> (${(SIM.horizonH/24).toFixed(1)}일)`;
  if(!k.deadline){
    $('periodSum').innerHTML = `<div class="kpi"><b>${(SIM.horizonH/24).toFixed(1)} 일</b><span>전체 소요 — 마감일을 넣으면 기간 내 달성률이 표시됩니다</span></div>`
      + (k.due.withDue ? dueCard() : '');
    return;
  }
  const rate = total ? k.doneInPeriod/total*100 : 0;
  $('periodSum').innerHTML = `
    <div class="kpi ${rate<100?'bn':''}"><b>${rate.toFixed(1)} %</b><span>기간 내 달성률 (마감 ${CFG.deadline})</span></div>
    <div class="kpi"><b>${k.doneInPeriod.toLocaleString()} 본</b><span>마감일까지 포장 완료</span></div>
    <div class="kpi ${k.overflow?'bn':''}"><b>${k.overflow.toLocaleString()} 본</b><span>기간 초과 이월</span></div>
    <div class="kpi"><b>${k.periodDays.toFixed(1)} 일</b><span>지정 기간</span></div>
    <div class="kpi"><b>${(SIM.horizonH/24).toFixed(1)} 일</b><span>실제 소요</span></div>` + dueCard();
}
function dueCard(){
  const d=SIM.kpi.due; if(!d.withDue) return '';
  return `<div class="kpi ${d.late?'bn':''}"><b>${d.late} / ${d.withDue}</b><span>납기 지연 오더 ${d.late?`· 최대 ${(d.maxTardyH/24).toFixed(1)}일`:''}</span></div>`;
}

/* ================= 재생 컨트롤 ================= */
let LOOP = false, seeking = false;
function seekTo(t){
  if(!SIM) return;
  animT = Math.max(SIM.t0, Math.min(SIM.tEnd, t));
  evIdx = 0; completed = 0; logs.length = 0;
  for (const n of NODES) nodeState[n.id] = { active:[], q:0, done:0 };
  const ev = SIM.events;
  while (evIdx < ev.length && ev[evIdx].s <= animT) {
    const e = ev[evIdx];
    nodeState[e.n].done++;
    if (e.n === 'PACK') completed++;
    evIdx++;
  }
  stepAnim(0);
}
function syncSeek(){
  if(!SIM || seeking) return;
  const f = (animT - SIM.t0) / Math.max(1, SIM.tEnd - SIM.t0);
  $('seek').value = Math.round(f*1000);
}
function newSeed(){
  SEED = (Math.floor(Math.random()*2147483646)+1);
  runSim();
  if(!SIM.kpi.stochOn)
    $('logBody').innerHTML='<div class="lg">변동성이 꺼져 있어 결과가 동일합니다 — 「반복 실행」 탭에서 변동성을 켜 주세요.</div>';
}

/* ================= 계획서 로더 연동 ================= */
let PLAN_SRC = null;
function applyOrders(list, meta, srcLabel){
  ORDERS = list;
  PLAN = null; LAST_OPT = null;                   // 최적화 해는 데이터가 바뀌면 무효
  PLAN_SRC = srcLabel || null;
  _oc && Object.keys(_oc).forEach(k=>delete _oc[k]);
  $('optSum').innerHTML=''; $('optSeq').innerHTML='';
  $('cmpBody').innerHTML='<tr><td colspan="9" style="color:#6e7681">데이터가 바뀌었습니다. 「전체 규칙 비교 실행」을 다시 눌러 주세요.</td></tr>';
  $('cmpNote').innerHTML='';
  /* 반복 실행(몬테카를로) 결과도 이전 계획서의 것이다 — 같이 지운다 */
  MC_LAST = null;
  ['mcSum','mcHist','mcTable','mcRules'].forEach(id=>{ if($(id)) $(id).innerHTML=''; });
  if ($('optRule').value==='OPT') $('optRule').value='EAT';
  runSim(); calc();
}
function initPlanLoader(){
  const el=$('planLoader'); if(!el||typeof PlanLoader==='undefined') return;
  PlanLoader.mount(el, {
    startDate: $('cfgStart').value,
    onApply:(list,meta)=>{
      const first=list[0] && list[0].start ? list[0].start.slice(0,10) : null;
      if(first) $('cfgStart').value=first;
      applyOrders(list, meta, '업로드 계획서');
      /* 위저드 안에 있으므로 탭을 옮기지 않는다 — 2·3단계로 그대로 이어진다 */
      const w=$('wizSteps'); if(w) w.scrollIntoView({behavior:'smooth', block:'start'});
    },
    onReset:()=>{
      const d0=ORDERS_DEFAULT[0] && ORDERS_DEFAULT[0].start ? ORDERS_DEFAULT[0].start.slice(0,10) : '2026-03-02';
      $('cfgStart').value=d0;
      applyOrders(ORDERS_DEFAULT.slice(), null, null);
    },
  });
}

/* ================= 계획 실행 위저드 (업로드 → 최적화 → 시뮬레이션) ================= */
let WIZ_BASE = null;                  /* 최적화 직전(현 규칙) 결과 — 개선폭 비교용 */
function goTab(p){ const t=document.querySelector(`.tab[data-p="${p}"]`); if(t) t.click(); }
function initWizard(){
  if(!$('wizSteps')) return;
  /* 이미 OPT 로 돌아가는 중이면 「현 규칙」 결과가 없다 → EAT 로 한 번 돌려 기준을 만든다.
     종전에는 최적화를 먼저 돌린 뒤 위저드를 쓰면 「전후 비교」가 영영 빈칸으로 남았다.
     (2026-08-19 전수 감사) */
  const keepBase = () => {
    const s = snapKpi();
    if (s && s.rule !== 'OPT') { WIZ_BASE = s; return; }
    if (WIZ_BASE) return;
    try {
      const S = simulate(ORDERS, { ...readCfg(), dispatchRule: 'EAT', plan: null });
      WIZ_BASE = { rule: 'EAT', mk: S.kpi.makespanH, setup: S.kpi.expSetupH, bal: S.kpi.expBalanceH };
    } catch (e) { /* 기준선을 못 만들면 비교만 생략한다 */ }
  };
  $('wizRunAll').onclick = () => {
    keepBase();
    runOptimizer();                    /* 내부에서 optRule=OPT 설정 + runSim() 까지 수행 */
    renderWiz();
  };
  $('wizOpt').onclick  = () => { keepBase(); runOptimizer(); renderWiz(); };
  $('wizSim').onclick  = () => { runSim(); renderWiz(); };
  $('wizGoOpt').onclick  = () => goTab('pOpt');
  $('wizGoCfg').onclick  = () => goTab('pCfg');
  $('wizGoFlow').onclick = () => goTab('pFlow');
  $('wizGoBn').onclick   = () => goTab('pBn');
  if($('cfgGoWiz')) $('cfgGoWiz').onclick = () => goTab('pWiz');
  renderWiz();
}
function snapKpi(){
  if(!SIM) return null;
  return { rule:($('optRule')||{}).value||'EAT', mk:SIM.kpi.makespanH, setup:SIM.kpi.expSetupH,
           bal:SIM.kpi.expBalanceH };
}
function renderWiz(){
  if(!$('wizSteps') || !SIM) return;
  const cfg   = CFG || readCfg();
  const R     = expRules(cfg);
  const rule  = ($('optRule')||{}).value || 'EAT';
  const qty   = ORDERS.reduce((a,o)=>a+o.qty,0);
  const optOn = !!PLAN && rule === 'OPT';

  const step = (n, title, val, cls) =>
    `<div class="wstep ${cls}"><div class="wn">${cls==='done'?'✓ ':''}${n}단계</div><div class="wt">${title}</div><div class="wv">${val}</div></div>`;
  $('wizSteps').innerHTML =
    step(1,'계획서', `${PLAN_SRC ? esc(PLAN_SRC) : '기본 데이터'} · <b>${ORDERS.length}오더 / ${qty.toLocaleString()}본</b>`, 'done')
  + step(2,'제약 · 조건', `${esc(R.label)}<br>배분 규칙: ${esc(DISPATCH_RULES[rule].label)}`, 'done')
  + step(3,'최적화 엔진', optOn
        ? `해 적용중 · 확관 Cmax ${PLAN.cmaxH.toFixed(1)}h · 전환 ${PLAN.setupH.toFixed(1)}h`
        : (PLAN ? '해는 있으나 배분 규칙이 다릅니다' : '아직 실행하지 않았습니다'), optOn?'done':'need')
  + step(4,'시뮬레이션', `${(SIM.kpi.makespanH/24).toFixed(1)}일 · 확관 전환 ${SIM.kpi.expSetupH.toFixed(1)}h`, 'done');

  $('wizCond').innerHTML =
    `<div class="kpi"><b>${esc(R.label.replace(/\s*\(.*\)$/,''))}</b><span>확관 제약 기준 — #1 ≤ ${R.L1}m · #2 ≤ ${R.L2}m</span></div>
     <div class="kpi"><b>${cfg.expNMode==='ortools'?'운영 모델 N식':'엑셀 N식'}</b><span>확관 횟수 산출 근거</span></div>
     <div class="kpi"><b>${cfg.shifts}교대 × ${cfg.netHoursPerShift}h</b><span>가용 시간${cfg.skipWeekend?' · 주말 비가동':''}</span></div>
     <div class="kpi"><b>${cfg.startDate}</b><span>계획 시작일${cfg.deadline?` · 마감 ${cfg.deadline}`:''}</span></div>
     <div class="kpi"><b>${esc(DISPATCH_RULES[rule].label)}</b><span>확관 배분 규칙</span></div>`;

  const k = SIM.kpi;
  const top = SIM.stats.slice().sort((a,b)=>b.util-a.util)[0];
  $('wizSimSum').innerHTML =
    `<div class="kpi"><b>${(k.makespanH/24).toFixed(1)}일</b><span>Makespan (${fmtT(SIM.tEnd)} 완료)</span></div>
     <div class="kpi bn"><b>${top?top.label:'—'} ${top?top.util.toFixed(0)+'%':''}</b><span>1위 병목 설비</span></div>
     <div class="kpi"><b>${k.expSetupH.toFixed(1)}h</b><span>확관 전환시간</span></div>
     <div class="kpi"><b>${k.expBalanceH.toFixed(1)}h</b><span>확관 호기 부하 편차</span></div>
     <div class="kpi"><b>${k.expUtil.toFixed(1)}%</b><span>확관 가동률 (최다 1대)</span></div>`
   + (k.deadline ? `<div class="kpi"><b>${pct(k.doneInPeriod, k.doneInPeriod+k.overflow)}</b><span>마감 ${esc(cfg.deadline||'')} 내 달성률</span></div>` : '');

  if(PLAN && rule==='OPT') renderOptResultInto('wizOptSum');
  else $('wizOptSum').innerHTML =
    `<div class="kpi bn"><b>미실행</b><span>「전체 자동 실행」 또는 「최적화 엔진만 실행」을 눌러 주세요</span></div>`;

  const B=WIZ_BASE;
  $('wizDelta').innerHTML = (B && optOn && B.rule!=='OPT')
    ? `<div class="note"><b>최적화 전후</b> — 배분 규칙 「${esc(DISPATCH_RULES[B.rule].label)}」 대비:
        Makespan ${(B.mk/24).toFixed(1)}일 → <b>${(k.makespanH/24).toFixed(1)}일</b> (${delta(k.makespanH,B.mk)}) ·
        확관 전환 ${B.setup.toFixed(1)}h → <b>${k.expSetupH.toFixed(1)}h</b> (${delta(k.expSetupH,B.setup)}) ·
        호기 부하 편차 ${B.bal.toFixed(1)}h → <b>${k.expBalanceH.toFixed(1)}h</b> (${delta(k.expBalanceH,B.bal)})</div>`
    : '';
}


/* ================= 반복 실행 (몬테카를로) ================= */
let MC_LAST = null;
function initMCTab(){
  /* 종전에는 빈 핸들러라 「변동성 사용」 을 켜도 안내 문구가 갱신되지 않았다 */
  ['stOn','stCvT','stCvS','stDef','stWeld','stMaxRw','stMtbf','stMttr','stRep','stRw','stEp']
    .forEach(id=>{ if($(id)) $(id).onchange=renderStNote; });
  $('btnStApply').onclick=()=>{ runSim(); document.querySelector('.tab[data-p="pFlow"]').click(); };
  $('btnStDice').onclick=()=>{ SEED=Math.floor(Math.random()*2147483646)+1; runSim(); renderStNote(); };
  $('btnMC').onclick=runMC;
  renderStNote();
}
function renderStNote(){
  if(!SIM) return;
  $('mcHint').innerHTML = SIM.kpi.stochOn
    ? `현재 seed <b style="color:#58a6ff">${SIM.kpi.seed}</b> · 이번 실행 재작업 ${SIM.kpi.rework}본 · 고장 ${SIM.kpi.breakdowns}회`
    : '변동성이 꺼져 있습니다. 위 「변동성 사용」을 켜야 실행할 때마다 다른 결과가 나옵니다.';
}
function runMC(){
  const n = +$('mcN').value;
  const allRules = $('mcAllRules').checked;
  const cfg = readCfg();
  if(!cfg.stochastic.on){
    $('mcSum').innerHTML = `<div class="kpi bn"><b>변동성 꺼짐</b><span>모든 실행이 동일합니다 — 위에서 켜 주세요</span></div>`;
    $('mcHist').innerHTML=''; $('mcTable').innerHTML=''; $('mcRules').innerHTML=''; return;
  }
  $('btnMC').disabled=true; $('mcProgWrap').style.display='block';
  if(allRules && !PLAN){
    $('mcHint').textContent='최적화 엔진 해를 먼저 계산하는 중…';
    PLAN = optimizeExpander(ORDERS, cfg, {weights:{cmax:+$('wCmax').value,setup:+$('wSetup').value,bal:+$('wBal').value},
                                          iters:+$('optIters').value});
    cfg.plan = PLAN;
  }
  const rules = allRules ? ruleKeys() : [cfg.dispatchRule];
  const results = {};
  let ri = 0;
  const next = () => {
    if(ri >= rules.length){
      $('btnMC').disabled=false; $('mcProgWrap').style.display='none';
      MC_LAST = results; renderMC(results, rules, n); return;
    }
    const r = rules[ri];
    monteCarlo(ORDERS, {...cfg, dispatchRule:r, plan: r==='IMPORT' ? IMP_PLAN : PLAN},  n,
      (i,tot)=>{ $('mcProg').style.width = ((ri+i/tot)/rules.length*100).toFixed(1)+'%';
                 $('mcHint').innerHTML = `실행 중… ${DISPATCH_RULES[r].label} ${i}/${tot}`; },
      res => { results[r]=res; ri++; next(); });
  };
  next();
}
function histogram(sum, unit, digits, label){
  const v = sum.values; if(!v.length) return '';
  const lo = sum.min, hi = sum.max, span = (hi-lo)||1, B = 22;
  const bins = new Array(B).fill(0);
  v.forEach(x=>bins[Math.min(B-1, Math.floor((x-lo)/span*B))]++);
  const mx = Math.max(...bins);
  const cls = i => { const c = lo+(i+0.5)/B*span;
    return c<=sum.p10?'':c>=sum.p90?'hi':(c>=sum.p10&&c<=sum.p90?'mid':''); };
  return `<div class="hist"><h4>${label}<span>${sum.n}회 실행</span></h4>
    <div class="hbars">${bins.map((b,i)=>
      `<div class="${cls(i)}" style="height:${(b/mx*100).toFixed(1)}%" title="${(lo+i/B*span).toFixed(digits)}~${(lo+(i+1)/B*span).toFixed(digits)}${unit} : ${b}회"></div>`).join('')}</div>
    <div class="haxis"><span>${lo.toFixed(digits)}${unit}</span><span>${hi.toFixed(digits)}${unit}</span></div>
    <div class="hpct">
      <span>P10 <b>${sum.p10.toFixed(digits)}${unit}</b></span>
      <span>중앙값 P50 <b>${sum.p50.toFixed(digits)}${unit}</b></span>
      <span>P90 <b>${sum.p90.toFixed(digits)}${unit}</b></span>
      <span>평균 <b>${sum.mean.toFixed(digits)}${unit}</b> ± ${sum.sd.toFixed(digits)}</span>
      <span>최소~최대 <b>${lo.toFixed(digits)}~${hi.toFixed(digits)}${unit}</b></span></div></div>`;
}
function renderMC(results, rules, n){
  const cur = results[rules[0]];
  const R = results[readCfg().dispatchRule] || cur;
  $('mcHint').innerHTML = `완료 — 규칙 ${rules.length}종 × ${n}회`;
  const spread = R.makespanD.p90 - R.makespanD.p10;
  $('mcSum').innerHTML = `
    <div class="kpi"><b>${R.makespanD.p50.toFixed(1)} 일</b><span>완료 소요 중앙값 (P50)</span></div>
    <div class="kpi bn"><b>${R.makespanD.p90.toFixed(1)} 일</b><span>보수적 계획 기준 (P90)</span></div>
    <div class="kpi"><b>± ${(spread/2).toFixed(1)} 일</b><span>P10~P90 폭 — 계획 불확실성</span></div>
    <div class="kpi"><b>${R.rework.p50.toFixed(0)} 본</b><span>재작업 발생 (중앙값)</span></div>
    <div class="kpi"><b>${R.thru.p50.toFixed(0)} 본/일</b><span>일 평균 산출</span></div>
    <div class="kpi"><b>${R.downtimeH.p50.toFixed(0)} h</b><span>설비 고장 정지 (중앙값)</span></div>`;
  $('mcHist').innerHTML =
      histogram(R.makespanD, '일', 1, '완료 소요일 분포')
    + histogram(R.expSetupH, 'h', 0, '확관 설비 전환시간 분포')
    + histogram(R.rework, '본', 0, '재작업 발생 본수 분포');
  $('mcTable').innerHTML = `<h4 class="sh">지표별 분포</h4><div class="tblwrap"><table>
    <thead><tr><th>지표</th><th style="text-align:right">P10</th><th style="text-align:right">P50</th>
      <th style="text-align:right">P90</th><th style="text-align:right">평균</th><th style="text-align:right">표준편차</th>
      <th style="text-align:right">최소</th><th style="text-align:right">최대</th></tr></thead><tbody>
    ${[['완료 소요(일)',R.makespanD,1],['확관 전환(h)',R.expSetupH,1],['총 전환(h)',R.totalSetupH,0],
       ['확관 가동률(%)',R.expUtil,1],['재작업(본)',R.rework,0],['고장 정지(h)',R.downtimeH,1],
       ['일 산출(본/일)',R.thru,1]].map(([lb,o,d])=>`<tr><td>${lb}</td>
      <td class="num">${o.p10.toFixed(d)}</td><td class="num"><b>${o.p50.toFixed(d)}</b></td>
      <td class="num">${o.p90.toFixed(d)}</td><td class="num">${o.mean.toFixed(d)}</td>
      <td class="num">${o.sd.toFixed(d)}</td><td class="num">${o.min.toFixed(d)}</td>
      <td class="num">${o.max.toFixed(d)}</td></tr>`).join('')}</tbody></table></div>`;

  if(rules.length>1){
    const best = Math.min(...rules.map(r=>results[r].makespanD.p50));
    const bestS = Math.min(...rules.map(r=>results[r].expSetupH.p50));
    $('mcRules').innerHTML = `<h4 class="sh">배분 규칙별 분포 비교 — 변동성을 감안해도 차이가 유의한가</h4>
      <div class="tblwrap"><table><thead><tr><th>배분 규칙</th>
        <th style="text-align:right">완료일 P50</th><th style="text-align:right">P10~P90</th>
        <th style="text-align:right">확관 전환 P50</th><th style="text-align:right">± 편차</th>
        <th style="text-align:right">재작업 P50</th></tr></thead><tbody>
      ${rules.map(r=>{const o=results[r];
        return `<tr class="${o.makespanD.p50===best?'bnrow':''}">
          <td>${DISPATCH_RULES[r].label}</td>
          <td class="num"><b>${o.makespanD.p50.toFixed(1)}일</b>${o.makespanD.p50===best?' ★':''}</td>
          <td class="num">${o.makespanD.p10.toFixed(1)}~${o.makespanD.p90.toFixed(1)}</td>
          <td class="num">${o.expSetupH.p50.toFixed(1)}h${o.expSetupH.p50===bestS?' ★':''}</td>
          <td class="num">± ${o.expSetupH.sd.toFixed(1)}</td>
          <td class="num">${o.rework.p50.toFixed(0)}</td></tr>`;}).join('')}
      </tbody></table></div>
      <div class="note">규칙 간 차이가 <b>P10~P90 폭보다 작다면</b> 그 차이는 변동성에 묻힙니다.
        전환시간처럼 폭이 좁은 지표에서 규칙 차이가 크게 벌어질수록 개선 효과가 확실합니다.</div>`;
  } else $('mcRules').innerHTML='';
}

/* ================= 실적 검증 탭 =================
   machine_prod_log 스냅샷 실적 CSV → 설비별 실적 · 표준시간 대조 · 실적 오더셋 */
let PLOG = null;
let CALIB = null;            // 실적 보정 계수 { 공정명: 0<계수<1 } — 켜져 있을 때만 설정
const lgDT = ts => { if(ts==null) return '—'; const d=new Date(ts*1000), p=n=>String(n).padStart(2,'0');
  return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const lgMS = s => s==null ? '—' : (s>=3600 ? `${(s/3600).toFixed(2)}h` : `${(s/60).toFixed(1)}m`);

function initLogTab(){
  const f=$('lgFile'); if(!f) return;
  f.onchange=e=>{
    const file=e.target.files && e.target.files[0]; if(!file) return;
    const rd=new FileReader();
    rd.onload=()=>{
      try { PLOG = loadProdLog(String(rd.result)); }
      catch(err){ PLOG = { error: String(err && err.message || err) }; }
      renderLog();
    };
    rd.readAsText(file, 'utf-8');
  };
  $('lgClear').onclick=()=>{ PLOG=null; CALIB=null; if($('lgCalib')) $('lgCalib').checked=false;
                             $('lgFile').value=''; renderLog(); runSim(); calc(); };
  if($('lgCalib')) $('lgCalib').onchange=()=>{ applyCalib(); };
  $('lgUse').onclick=()=>{
    if(!PLOG || PLOG.error || !PLOG.orders.length){ alert('먼저 실적 로그를 올려 주세요.'); return; }
    const d0=new Date(PLOG.span.from*1000), p=n=>String(n).padStart(2,'0');
    $('cfgStart').value=`${d0.getFullYear()}-${p(d0.getMonth()+1)}-${p(d0.getDate())}`;
    if($('cfgDateMode')) $('cfgDateMode').value='sheet';
    if($('cfgDueAnalysis')) $('cfgDueAnalysis').checked=false;
    applyOrders(PLOG.orders.map(o=>({ ...o })), { src:'실적 로그' }, '실적 로그');
    renderLog();
    goTab('pBn');
  };
  renderLog();
}

/* 실적 보정 on/off → 계수를 다시 뽑고 전체 재시뮬레이션 */
function applyCalib(){
  const on = $('lgCalib') && $('lgCalib').checked;
  if(on && PLOG && !PLOG.error){
    CALIB = prodlogCalibration(PLOG, {...readCfg(), stdCalib:null});
    if(!Object.keys(CALIB).length) CALIB = null;
  } else CALIB = null;
  runSim(); calc(); renderCalibSum();
}
function renderCalibSum(){
  const el=$('lgCalibSum'); if(!el) return;
  if(!CALIB){
    el.innerHTML = (PLOG && !PLOG.error && $('lgCalib') && $('lgCalib').checked)
      ? `<div class="kpi"><b>보정 대상 없음</b><span>모든 공정에서 실적 ≥ 표준 — 내릴 근거가 있는 공정이 없습니다</span></div>` : '';
    return;
  }
  el.innerHTML = Object.entries(CALIB).sort((a,b)=>a[1]-b[1]).map(([st,f])=>
      `<div class="kpi bn"><b>×${f.toFixed(2)}</b><span>${esc(st)} 표준시간 보정</span></div>`).join('')
    + (SIM ? `<div class="kpi"><b>${SIM.kpi.makespanH.toFixed(1)} h</b><span>보정 후 Makespan</span></div>`
           + `<div class="kpi"><b>${esc((SIM.stats[0]||{}).label||'—')} ${((SIM.stats[0]||{}).util||0).toFixed(1)}%</b><span>보정 후 1위 병목</span></div>` : '');
}

function renderLog(){
  if(!$('lgWC')) return;
  /* 로그를 해제하거나 읽기에 실패해도 아래 표·요약이 **이전 파일의 것으로 남아 있었다.**
     어떤 경로로 나가든 먼저 비운다. (2026-08-14 전수 감사) */
  const clearLogPanels = () => {
    for (const id of ['lgKpi','lgWC','lgVerify','lgOrders','lgCalibSum'])
      if ($(id)) $(id).innerHTML = '';
  };
  if(!PLOG){
    clearLogPanels(); $('lgErr').innerHTML='';
    $('lgWC').innerHTML='<tr><td colspan="10" style="color:#6e7681">실적 로그 CSV 를 올려 주세요.</td></tr>';
    $('lgVerify').innerHTML='<tr><td colspan="10" style="color:#6e7681">—</td></tr>';
    $('lgOrders').innerHTML='<tr><td colspan="9" style="color:#6e7681">—</td></tr>';
    return;
  }
  if(PLOG.error){
    clearLogPanels();
    $('lgErr').innerHTML=`<div class="note" style="color:#ff7b72">읽지 못했습니다 — ${esc(PLOG.error)}
      <br><span style="color:#8b949e">이전에 올린 로그의 표는 지웠습니다.</span></div>`;
    return;
  }
  $('lgErr').innerHTML='';
  const L=PLOG;
  $('lgKpi').innerHTML=
     `<div class="kpi"><b>${L.rows.length.toLocaleString()}</b><span>스냅샷 행</span></div>`
   + `<div class="kpi"><b>${L.orders.length}</b><span>작업지시(WO)</span></div>`
   + `<div class="kpi"><b>${L.totalPack.toLocaleString()} 본</b><span>포장 완료 (실적)</span></div>`
   + `<div class="kpi"><b>${L.span.hours.toFixed(0)} h</b><span>${lgDT(L.span.from)} ~ ${lgDT(L.span.to)}</span></div>`
   + `<div class="kpi ${L.unmapped.length?'bn':''}"><b>${L.wcStat.length}</b><span>설비 코드${L.unmapped.length?` · 미매핑 ${L.unmapped.length}`:''}</span></div>`;

  $('lgWC').innerHTML=L.wcStat.map(w=>`<tr>
    <td><b>${esc(w.wc)}</b> ${esc(w.label)}</td>
    <td>${esc(w.op||'')}</td>
    <td class="num">${w.qty.toLocaleString()}</td>
    <td class="num">${w.rows.toLocaleString()}</td>
    <td>${lgDT(w.first)} ~ ${lgDT(w.last)}</td>
    <td class="num">${w.medGapSec==null?'—':`${w.medGapSec.toFixed(0)}s (${lgMS(w.medGapSec)})`}</td>
    <td>${w.node ? esc(w.node)+(w.approx?' <span class="hi2">근사 매핑</span>':'') : '<span style="color:#ff7b72">미모델링</span>'}</td></tr>`).join('');

  /* 로그에 없는 시뮬레이터 설비 — 실적으로 검증되지 않는 공정 */
  const inLog=new Set(L.wcStat.map(w=>w.node).filter(Boolean));
  const missing=NODES.filter(n=>n.kind==='proc' && n.st && !n.free && !inLog.has(n.id));
  if(missing.length) $('lgWC').innerHTML += `<tr><td colspan="7" style="color:#d29922">
    로그에 실적이 없는 시뮬레이터 공정 — ${missing.map(n=>esc(n.label)).join(' · ')} (이번 주에 가동 기록이 없거나 집계 대상이 아님)</td></tr>`;

  const V=verifyProdLog(L, readCfg());
  $('lgVerify').innerHTML = V.length ? V.map(v=>{
    const r=v.ratio;
    const idle = v.idleShare;
    const judge = r==null ? '—'
      : r < 1    ? '<span style="color:#ff7b72">표준시간이 실적보다 느림 — 확인 필요</span>'
      : r < 1.35 ? '<span style="color:#ff7b72">여유 거의 없음 — 병목</span>'
      : r < 2    ? '<span style="color:#d29922">여유 적음</span>'
      : r < 3    ? '대기·전환 포함 (정상)'
      :            '<span style="color:#6e7681">대기 비중 큼 (병목 하류)</span>';
    return `<tr><td><b>${esc(v.wc)}</b> ${esc(v.label)}</td><td>${esc(v.st)}</td>
      <td class="num">${v.qty.toLocaleString()}</td><td class="num">${v.nGap}</td>
      <td class="num">${v.actualSec.toFixed(0)}</td>
      <td class="num" style="color:#6e7681">${v.paceSec==null?'—':v.paceSec.toFixed(0)}</td>
      <td class="num">${v.stdSec.toFixed(0)}</td>
      <td class="num">${r==null?'—':r.toFixed(2)}</td>
      <td class="num">${idle==null?'—':(idle*100).toFixed(0)+'%'}</td><td>${judge}</td></tr>`;
  }).join('') : '<tr><td colspan="10" style="color:#6e7681">비교 가능한 설비가 없습니다.</td></tr>';

  $('lgOrders').innerHTML=L.orders.map(o=>`<tr>
    <td>${esc(o.no)}</td><td style="font-size:11px">${esc(o.mat)}</td>
    <td class="num">${o.od}</td><td class="num">${o.t}</td><td class="num">${(o.L/1000).toFixed(3)}</td>
    <td class="num">${o.packQty||'—'}</td><td class="num">${o.maxQty}</td>
    <td>${o.heat?'<span style="color:#d29922">C2 · 열처리</span>':'—'}</td>
    <td style="font-size:11px">${o.wcs.length}개</td></tr>`).join('')
    /* ★ 업로드한 CSV 의 WO 번호를 그대로 innerHTML 에 넣고 있었다 —
       WO_NO 에 <img onerror=...> 를 넣은 CSV 로 스크립트가 실행됐다. 반드시 escape 한다. */
    + (L.badSpec.length ? `<tr><td colspan="9" style="color:#ff7b72">규격 파싱 실패 WO — ${L.badSpec.map(esc).join(', ')}</td></tr>` : '');

  renderCalibSum();
}

/* 비교·반복 실행 대상 규칙 — 가져온 스케줄이 없으면 IMPORT 는 제외 */
function ruleKeys(){ return Object.keys(DISPATCH_RULES).filter(r => r!=='IMPORT' || IMP_PLAN); }

/* ================= 부트 ================= */
const CO_BACKUP = JSON.stringify(CHANGEOVER);
function boot(){
  /* 「분석 ▾」 드롭다운 열고 닫기 */
  if($('tabMoreBtn')) $('tabMoreBtn').onclick=(e)=>{ e.stopPropagation(); $('tabMore').classList.toggle('open'); };
  document.addEventListener('click', e=>{
    if($('tabMore') && !$('tabMore').contains(e.target)) $('tabMore').classList.remove('open');
  });
  document.querySelectorAll('.tab[data-p]').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
    document.querySelectorAll('.pane').forEach(x=>x.classList.remove('on'));
    t.classList.add('on'); $(t.dataset.p).classList.add('on');
    /* 드롭다운 안의 탭을 골랐으면 버튼에 그 이름을 띄워 어디 있는지 보이게 한다 */
    if($('tabMore')){
      const inMenu = t.closest('.tabmenu');
      $('tabMoreBtn').textContent = inMenu ? t.textContent : '분석';
      $('tabMoreBtn').classList.toggle('on', !!inMenu);
      $('tabMore').classList.remove('open');
    }
    if (t.dataset.p==='pFlow') fit();
    /* 간트로 돌아오면 펼쳐 둔 상세 패널이 다시 카드의 목적지가 된다 */
    if (t.dataset.p==='pGantt' && GV_OPEN && SIM && $('gvf')) {
      VF_BOX = 'gvf'; VF_OPEN.clear(); VF_SHAPE = ''; VFS.no = GV_OPEN;
      renderVerify(true);
    }
    /* 「산식 검증」 탭을 직접 열면 카드 목적지를 탭 쪽으로 되돌린다
       (간트 안 상세를 펼쳐 둔 채로 탭을 눌렀을 때 빈 화면이 되지 않게 한다) */
    if (t.dataset.p==='pVf' && SIM) {
      VF_BOX = 'vfBody'; VF_OPEN.clear(); VF_SHAPE = '';
      if (!VFS.no && $('vfOrder')) { buildVfOrders(); VFS.no = $('vfOrder').value; }
      if ($('vfOrder') && VFS.no) $('vfOrder').value = VFS.no;
      if ($('vfK')) $('vfK').value = VFS.k;
      if ($('vfMach')) $('vfMach').value = VFS.mach || '';
      renderVerify(true);
    }
    /* 3D 는 처음 열 때 한 번만 초기화하고(three.js 장면 구성 비용이 크다),
       그 뒤로는 2D 가 계산한 SIM 을 그대로 받아 그린다. */
    if (t.dataset.p==='p3D' && window.JCOE3D) {
      if (JCOE3D.mount()) { JCOE3D.update(SIM, CFG, PLAN_SRC); JCOE3D.resize(); }
    }
  });
  $('btnPlay').onclick=()=>{ playing=!playing; $('btnPlay').textContent=playing?'❚❚':'▶'; };
  /* 종전에는 내부 변수만 되돌리고 화면 갱신을 안 해서, 정지 상태로 ↺ 를 누르면
     시계·완료 본수·가동률 막대·시크바가 전부 옛 시점 그대로 남았다 (loop 은 playing 일 때만
     stepAnim 을 부른다). 3D 처럼 seekTo() 로 시작 시점을 실제로 다시 그린다. (2026-08-19 전수 감사) */
  $('btnReset').onclick=()=>{ if(!SIM) return; seekTo(SIM.t0); syncSeek(); };
  $('spd').oninput=e=>{ speed=[60,600,3600,18000,86400][+e.target.value]; $('spdL').textContent=
    ['1분/s','10분/s','1시간/s','5시간/s','1일/s'][+e.target.value]; };
  /* 표의 「자세히」 토글 — 기본은 핵심 열만 (2026-08-14) */
  if($('bnAdv')){
    const sync=()=>$('bnTbl').classList.toggle('hideadv', !$('bnAdv').checked);
    $('bnAdv').onchange=sync; sync();
  }
  $('btnRun').onclick=runSim;
  $('btnCalc').onclick=calc;
  if($('gSeg')) $('gSeg').onchange = () => { if(SIM) renderGantt(); };
  ['vfOrder','vfK','vfSeq','vfMach'].forEach(id=>{ if($(id)) $(id).addEventListener('change', ()=>{
    VF_BOX = 'vfBody';
    if ($('vfOrder')) VFS.no = $('vfOrder').value;
    if (id === 'vfOrder') { VFS.k = 1; VFS.seq = ''; if ($('vfK')) $('vfK').value = 1; if ($('vfSeq')) $('vfSeq').value = ''; }
    VFS.k = Math.max(1, Math.round(parseFloat($('vfK') ? $('vfK').value : 1) || 1));
    VFS.seq = $('vfSeq') ? $('vfSeq').value : '';
    VFS.mach = $('vfMach') ? $('vfMach').value : '';
    renderVerify(true);
  }); });
  document.querySelectorAll('#pCalc input,#pCalc select').forEach(el=>el.oninput=calc);
  /* ── 공정 흐름 화면 끌어서 이동 · 휠로 확대 (2026-08-14) ── */
  let dragV = null;
  cvs.addEventListener('pointerdown', e=>{
    if (e.button !== 0 && e.button !== 1) return;
    dragV = { x:e.clientX, y:e.clientY, moved:false };
    cvs.setPointerCapture(e.pointerId); cvs.style.cursor='grabbing';
  });
  const endDrag = e=>{ if(!dragV) return; dragV=null;
    try{ cvs.releasePointerCapture(e.pointerId); }catch(_){}
    cvs.style.cursor = hover?'pointer':'grab'; };
  cvs.addEventListener('pointerup', endDrag);
  cvs.addEventListener('pointercancel', endDrag);
  cvs.onmousemove = e=>{ const r=cvs.getBoundingClientRect();
    if (dragV) {
      VIEW.dx += e.clientX - dragV.x; VIEW.dy += e.clientY - dragV.y;
      dragV.x = e.clientX; dragV.y = e.clientY; dragV.moved = true;
      applyView(); updateViewHint(); return;
    }
    hover = hitTest(e.clientX-r.left, e.clientY-r.top);
    cvs.style.cursor = hover?'pointer':'grab'; };
  cvs.onmouseleave = ()=>{ hover=null; };
  cvs.addEventListener('wheel', e=>{ e.preventDefault();
    const r = cvs.getBoundingClientRect();
    viewZoomAt(e.clientX-r.left, e.clientY-r.top, e.deltaY < 0 ? 1.18 : 1/1.18);
  }, { passive:false });
  cvs.addEventListener('dblclick', viewReset);
  if ($('cvReset')) $('cvReset').onclick = viewReset;
  updateViewHint();
  window.onresize=()=>{ fit(); if(SIM) renderGantt(); if(window.JCOE3D) JCOE3D.resize(); };
  for (const n of NODES) nodeState[n.id]={active:[],q:0,done:0};
  fit(); buildEdgeCache(); initOptTab(); initPlanLoader(); initMCTab(); initPeriod(); initWizard(); initLogTab();
  $('seek').oninput=e=>{ seeking=true; seekTo(SIM.t0+(SIM.tEnd-SIM.t0)*(+e.target.value/1000)); seeking=false; };
  $('loopChk').onchange=e=>LOOP=e.target.checked;
  $('btnDice').onclick=newSeed;
  /* 재계산은 invalidatePlan() 안에서 runSim() 이 이미 수행한다. 여기서는 계산기 탭만 갱신. */
  ['cfgExpSetup','cfgExpN','cfgApi5l'].forEach(id=>{ if($(id)) $(id).addEventListener('change', calc); });
  runSim(); calc(); initRefTab(); requestAnimationFrame(loop);
}

/* ====================================================================
   기준정보 탭 — 현장에서 코드·빌드 없이 숫자를 고치는 화면
   --------------------------------------------------------------------
   · 설비 대수 / 전환시간 / 표준시간 상수를 화면에서 직접 편집
   · 고치면 즉시 재시뮬 → 완료일·병목 변화가 바로 옆에 나온다
   · 원본과 다른 칸은 노란색 + 되돌리기(↺)
   · JSON 한 장으로 내보내고 불러온다 (메일로 주고받기 · 다음에 그대로 복원)
   ==================================================================== */
let REF_EDIT = { std:{}, co:{}, cap:{}, tbl:{} };   // 기본값과 다른 것만 담는다

/* 표준시간 상수의 하한.
   **분모로 쓰이는 값이 0 이 되면** 소요시간이 Infinity 가 되어 완료일이 146만 일로 튀고
   병목 가동률이 Infinity% 로 표시된다. 음수 상수도 가동시간을 음수로 만든다.
   → 분모·속도·주기류는 0 초과, 나머지는 0 이상만 허용한다. (2026-08-14 전수 감사) */
/* 이름 정규식으로 잡던 것을 **실제로 분모로 쓰이는 키 목록**으로 바꿨다.
   종전 정규식은 분모가 아닌 7개(Packing.extraEvery·refLen, PreBender.perStroke, FirstUT.cutLen,
   Expander.marginRB/marginM1/marginM1Small)까지 잡아 **정상값 0 을 넣을 수 없게** 했다.
   특히 Packing.extraEvery 는 engine 이 `> 0` 으로 «추가검사 안 함» 을 명시적으로 지원한다.
   (2026-08-19 전수 감사) */
const REF_DENOM_KEYS = new Set([
  'EdgeMiller.feedDiv', 'PreBender.pitchDiv', 'PressBender.lenDiv', 'PressBender.odDiv',
  'GapPress.lenDiv', 'GapPress.segLen', 'OuterBead.feedDiv', 'FirstUT.feedDiv',
  'Expander.m1FeedDiv', 'FinalUT.scanDiv', 'RT.shotLen', 'RT.endDivA', 'RT.endDivB',
  'Packing.feedDiv',
]);
function REF_STD_MIN(proc, key) {
  return REF_DENOM_KEYS.has(proc + '.' + key) ? 1e-6 : 0;
}
/* 상한 — 분모를 하한 근처로 밀어 완료일이 100만 일이 되는 것을 막는다.
   기본값의 1000배·1/1000 을 벗어나면 오타로 본다. */
function REF_STD_MAX(proc, key) {
  const d = REF_STD_DEFAULT[proc] && REF_STD_DEFAULT[proc][key];
  return (d && d.v > 0) ? d.v * 1000 : null;
}
function REF_STD_LO(proc, key) {
  const d = REF_STD_DEFAULT[proc] && REF_STD_DEFAULT[proc][key];
  if (REF_DENOM_KEYS.has(proc + '.' + key)) return (d && d.v > 0) ? d.v / 1000 : 1e-6;
  return 0;
}
let REF_BASE = null;                        // 아무것도 안 고친 상태의 시뮬 결과 (영향 비교용)

/** 편집값을 엔진에 밀어 넣고 다시 계산한다.
    ★ 표를 **다시 그리지 않는다.**
      종전에는 값 하나를 고칠 때마다 renderRef() 가 innerHTML 로 표 전체를 새로 만들었다.
      그러면 사용자가 Tab 이나 클릭으로 옮겨 가려던 다음 칸이 그 순간 사라져
      **두 번째 입력부터 조용히 버려졌다** (포커스가 body 로 날아감).
      이제 갱신이 필요한 것만 제자리에서 고친다 — KPI · 미리보기 · 변경 표시. */
function refApply(full = false) {
  setRefStd(REF_EDIT.std);
  setRefCo(REF_EDIT.co);
  setRefCap(REF_EDIT.cap);
  setRefTbl(REF_EDIT.tbl);
  /* 확관 최적화 해가 실제로 있을 때만 무효화한다.
     종전에는 값 하나만 고쳐도 invalidatePlan() 이 배분 규칙을 OPT→EAT 로 되돌려 놓고,
     그 때문에 생긴 makespan 변화가 마치 편집 때문인 것처럼 보였다. 그리고 runSim() 이 두 번 돌았다. */
  const hadPlan = !!PLAN;
  if (hadPlan) invalidatePlan(); else { runSim(); calc(); }
  if (hadPlan) calc();
  /* 「기준정보」 탭을 보고 있지 않다면 표를 다시 그려도 포커스를 뺏을 일이 없다.
     종전에는 「산식 검증」에서 고친 값이 기준정보 입력칸에 영영 반영되지 않아,
     거기서 ↺ 를 누르면 **자기 편집이 조용히 지워졌다.** (2026-08-19 전수 감사) */
  const refPaneOpen = $('pRef') && $('pRef').classList.contains('on');
  if (full || !refPaneOpen) renderRef(); else { renderRefKpi(); renderRefPreviews(); refMarkDirty(); }
  if (hadPlan && $('refPlanWarn'))
    $('refPlanWarn').textContent = '※ 확관 최적화 해는 상수가 바뀌어 무효가 됐고, 배분 규칙이 EAT 로 되돌아갔습니다.';
}

/** 표준시간 상수 탭의 미리보기 줄만 다시 계산한다 (입력칸은 건드리지 않는다) */
function renderRefPreviews() {
  if (!$('refStdWrap')) return;
  document.querySelectorAll('#refStdWrap .refgrp').forEach(g => {
    const proc = g.dataset.proc, el = g.querySelector('.refprev');
    if (!el || !REF_PREVIEW_FN[proc]) return;
    try {
      const r = REF_PREVIEW_FN[proc]();
      el.innerHTML = `미리보기 <b>${r.sec.toFixed(1)}s</b> &nbsp;·&nbsp; ${esc(r.expr)}`;
      el.style.color = '';
    } catch (e) {
      el.textContent = '미리보기 계산 오류: ' + (e.message || e); el.style.color = '#ff7b72';
    }
  });
}

function refMarkDirty() {
  if (!$('refDirty')) return;
  const n = refCount();
  $('refDirty').textContent = n ? `변경 ${n}개 — 내보내기로 저장하십시오` : '변경 없음';
  $('refDirty').style.color = n ? '#d29922' : '#6e7681';
}
function refCount() {
  let n = 0;
  for (const p in REF_EDIT.std) n += Object.keys(REF_EDIT.std[p]).length;
  for (const p in REF_EDIT.co)  n += Object.keys(REF_EDIT.co[p]).length;
  n += Object.keys(REF_EDIT.cap).length;
  n += Object.keys(REF_EDIT.tbl).length;
  return n;
}
/** 엑셀 표 셀 하나 덮어쓰기/해제 (「산식 검증」 인라인 편집).
    v === null 이면 원표 값으로 되돌린다. */
function refSetTbl(key, v) {
  const prev = REF_EDIT.tbl[key];
  if (v === null) delete REF_EDIT.tbl[key]; else REF_EDIT.tbl[key] = v;
  refApply();
  const why = refInsane();
  if (why) {
    if (prev === undefined) delete REF_EDIT.tbl[key]; else REF_EDIT.tbl[key] = prev;
    refApply(true);
    alert(`그 값을 넣으면 ${why} 되돌렸습니다.`);
  }
}
/* ★ 종전 방어 `!isFinite(SIM.kpi.makespanH)` 는 **한 번도 발동하지 않는 죽은 코드**였다.
   flow.js 가 orderSpan 에서 비유한 종료시각을 걸러내고 makespan 을 내기 때문에
   kpi.makespanH 는 언제나 유한하다. 실제로는 완료일이 192만 일이 되는데도 경고가 없었다.
   → 공정 소요가 비유한·음수인지, 완료일이 기준선 대비 터무니없이 커졌는지로 판정한다.
   (2026-08-19 전수 감사) */
function refInsane() {
  if (!SIM) return null;
  if (!isFinite(SIM.kpi.makespanH) || SIM.kpi.makespanH <= 0) return '계산 결과가 무한대가 되어';
  for (const st of SIM.stats) {
    if (!isFinite(st.busyH) || st.busyH < 0) return `${st.label} 의 가동시간이 음수·무한대가 되어`;
    if (!isFinite(st.util) || st.util < 0) return `${st.label} 의 가동률이 음수·무한대가 되어`;
  }
  const base = REF_BASE && REF_BASE.days > 0 ? REF_BASE.days : null;
  const days = SIM.kpi.makespanH / 24;
  if (base && days > base * 100) return `완료일이 ${Math.round(days).toLocaleString()}일(원래의 ${Math.round(days / base)}배)이 되어`;
  return null;
}

/** 값 하나 설정/해제.  v === null 이면 기본값으로 되돌린다.
    적용 결과가 유한하지 않으면(Infinity·NaN) 되돌리고 알린다 — 하한 규칙이 못 잡는 조합 대비. */
function refSet(group, a, b, v) {
  const G = REF_EDIT[group];
  const prev = G[a] ? G[a][b] : undefined;
  if (v === null) { if (G[a]) { delete G[a][b]; if (!Object.keys(G[a]).length) delete G[a]; } }
  else { (G[a] = G[a] || {})[b] = v; }
  refApply();
  const why = refInsane();
  if (why) {
    if (prev === undefined) { if (G[a]) { delete G[a][b]; if (!Object.keys(G[a]).length) delete G[a]; } }
    else (G[a] = G[a] || {})[b] = prev;
    refApply(true);
    alert(`그 값을 넣으면 ${why} 되돌렸습니다.`);
  }
}
function refSetCap(id, v) {
  if (v === null) delete REF_EDIT.cap[id]; else REF_EDIT.cap[id] = v;
  refApply();
}

/* ---- 편집 칸 하나 만들기 ----------------------------------------------
   opts.min / opts.max / opts.int 로 허용 범위를 준다. 범위를 벗어나면
   **되돌리고 이유를 알려준다** — 종전에는 조용히 무시하면서 화면에는 입력값이 남아
   "포장 25대" 로 보이는데 실제로는 1대로 계산되는 상태가 만들어졌다. */
function refInput(cur, def, onChange, opts) {
  opts = opts || {};
  const chg = Math.abs(cur - def) > 1e-9;
  const id = 'ri' + (refInput._n = (refInput._n || 0) + 1);
  const html = `<input id="${id}" class="refin${chg ? ' chg' : ''}" type="number" step="${opts.int ? 1 : 'any'}"
            value="${cur}"${opts.width ? ` style="width:${opts.width}px"` : ''}${opts.ref ? ` data-ref="${esc(opts.ref)}"` : ''} title="기본값 ${def}">
          <button id="${id}u" class="undo${chg ? ' on' : ''}" title="기본값 ${def} 로 되돌리기">↺</button>`;
  /* 화면에 붙은 직후 바인딩한다 (표를 다시 그리지 않으므로 한 번만 걸린다) */
  refInput._pending.push(() => {
    const el = $(id), u = $(id + 'u'); if (!el) return;
    const paint = (v) => {
      const c = Math.abs(v - def) > 1e-9;
      el.classList.toggle('chg', c); if (u) u.classList.toggle('on', c);
    };
    el.onchange = () => {
      let v = parseFloat(el.value);
      if (!isFinite(v)) { el.value = el.dataset.last || cur; return; }
      if (opts.int) v = Math.round(v);
      if ((opts.min != null && v < opts.min) || (opts.max != null && v > opts.max)) {
        alert(`${opts.min ?? '-∞'} ~ ${opts.max ?? '∞'} 범위의 값만 넣을 수 있습니다.`);
        el.value = el.dataset.last || cur; return;
      }
      el.value = v; el.dataset.last = v; paint(v);
      onChange(Math.abs(v - def) < 1e-9 ? null : v);
    };
    if (u) u.onclick = () => { el.value = def; el.dataset.last = def; paint(def); onChange(null); };
    el.dataset.last = cur;
  });
  return html;
}
refInput._pending = [];
/** refInput 이 만든 칸들을 화면에 붙인 뒤 한 번에 바인딩한다 */
function refBind() { const q = refInput._pending; refInput._pending = []; q.forEach(f => f()); }

/* ---- KPI 줄 ----------------------------------------------------------- */
/** 변경이 하나도 없을 때의 결과를 기준선으로 계속 갱신한다.
    종전에는 부팅 때 한 번만 잡아 둬서, 교대·계획서를 바꾼 뒤 기준정보를 고치면
    「+18.9일 악화」처럼 **부호까지 반대로** 표시됐다. (2026-08-14 전수 감사) */
/** 지금 기준선이 어떤 조건에서 잡힌 것인지 — 오더셋·교대·규칙이 바뀌면 다시 잡아야 한다 */
function refFingerprint() {
  if (!CFG) return '';
  return [ORDERS.length, ORDERS.reduce((a, o) => a + o.qty, 0), CFG.shifts, CFG.netHoursPerShift,
          CFG.dispatchRule, CFG.useRB, CFG.useCP, CFG.rbMode, CFG.rbPost, CFG.useM3,
          CFG.skipWeekend, CFG.startDate, PLAN_SRC || ''].join('|');
}
/* ★ 종전에는 `refCount()===0` 일 때만 기준선을 다시 잡았다. 그래서 **아무 효과 없는 편집**이
   하나라도 남아 있으면(예: 계산에 쓰이지 않는 표 키) 기준선이 그 시점에 얼어붙고,
   그 뒤 계획서를 바꾸면 그 차이가 「기준정보 편집 덕분」인 것처럼 ±일로 표시됐다.
   → 조건(오더셋·교대·규칙)이 달라졌으면 편집이 남아 있어도 기준선을 버린다. (2026-08-19 전수 감사) */
function refRebase() {
  if (!SIM) return;
  const fp = refFingerprint();
  if (refCount() === 0) { REF_BASE = { days: SIM.kpi.makespanH / 24, top: SIM.stats[0] && SIM.stats[0].label, fp }; return; }
  if (REF_BASE && REF_BASE.fp !== fp) REF_BASE = null;      // 조건이 달라졌다 → 비교 불가
}
/* ── 결과 요약바 — 어느 탭에 있든 헤더 아래에 항상 보인다 ──────────────
   종전에는 완료일·병목이 우상단 11px 회색 글씨에만 있어서, 가장 중요한 숫자가
   가장 안 보였다. (2026-08-14) */
function renderKpiBar(){
  const el=$('kpibar'); if(!el||!SIM) return;
  const b=SIM.stats[0];
  const days=SIM.kpi.makespanH/24;
  const qty=ORDERS.reduce((a,o)=>a+o.qty,0);
  const util=b?b.util:0;
  const k=(v,l,cls)=>`<div class="k ${cls||''}"><b>${v}</b><span>${esc(l)}</span></div>`;
  el.innerHTML =
      k(days.toFixed(1)+'일', `완료까지 — ${fmtT(SIM.tEnd).slice(0,10)}`)
    + k(`${esc(b?b.label:'—')} ${util.toFixed(0)}%`, '1위 병목', util>=90?'bn':util>=70?'warn':'')
    + k(SIM.kpi.expSetupH.toFixed(1)+'h', '확관 전환 손실', SIM.kpi.expSetupH>60?'warn':'')
    + k(qty.toLocaleString()+'본', `${ORDERS.length}오더`)
    + (CALIB ? k('ON','실적 보정','warn') : '')
    + (SIM.kpi.routeAborted ? k(SIM.kpi.routeAborted+'본','⚠ 미완주','bn') : '')
    + `<div class="k note2">${PLAN_SRC?esc(PLAN_SRC)+' · ':''}${SIM.kpi.stochOn?`변동 seed ${SIM.kpi.seed} · `:''}${esc(DISPATCH_RULES[CFG.dispatchRule]?DISPATCH_RULES[CFG.dispatchRule].label.replace(/\s*\(.*\)/,''):'')}</div>`;
}

function renderRefKpi() {
  if (!$('refKpi') || !SIM) return;
  refRebase();
  const n = refCount();
  const d = (SIM.kpi.makespanH / 24);
  const b = SIM.stats[0];
  let delta = '';
  if (REF_BASE && n) {
    const dd = d - REF_BASE.days;
    delta = `<div class="kpi ${dd > 0 ? 'bn' : ''}"><b>${dd >= 0 ? '+' : ''}${dd.toFixed(1)}일</b><span>원래 대비 (${REF_BASE.days.toFixed(1)}일 → ${d.toFixed(1)}일)</span></div>`;
  }
  $('refKpi').innerHTML =
      `<div class="kpi"><b>${d.toFixed(1)}일</b><span>완료까지</span></div>`
    + `<div class="kpi bn"><b>${esc(b.label)} ${b.util.toFixed(1)}%</b><span>1위 병목</span></div>`
    + delta
    + `<div class="kpi"><b>${n}개</b><span>기본값과 다른 항목</span></div>`;
  $('refDirty').textContent = n ? `변경 ${n}개 — 내보내기로 저장하십시오` : '변경 없음';
  $('refDirty').style.color = n ? '#d29922' : '#6e7681';
}

/* ---- ① 설비 대수 ------------------------------------------------------ */
function renderRefCap() {
  const st = {}; for (const x of (SIM ? SIM.stats : [])) st[x.id] = x;
  $('refCapBody').innerHTML = NODES.filter(n => n.kind === 'proc').map(n => {
    const def = n.id === 'EXP' ? (CFG.useM3 ? 3 : 2) : (n.cap || 1);
    const cur = REF_EDIT.cap[n.id] || def;
    const s = st[n.id];
    const fixed = n.id === 'EXP';
    const cell = fixed
      ? `<span style="color:#6e7681">${def} (설정 탭에서 지정)</span>`
      : refInput(cur, def, v => refSetCap(n.id, v), { width: 60, int: true, min: 1, max: 20 });
    const util = s ? s.util : 0;
    const col = util > 90 ? '#ff7b72' : util > 70 ? '#e3b341' : '#6e7681';
    return `<tr${util > 90 ? ' class="bnrow"' : ''}>
      <td><b>${esc(n.label)}</b></td><td style="color:#6e7681">${esc(n.st || '—')}</td>
      <td class="num">${cell}</td><td class="num" style="color:#6e7681">${def}</td>
      <td class="num" style="color:${col}">${s ? util.toFixed(1) + '%' : '—'}</td>
      <td style="color:#6e7681;font-size:11px">${util > 90 ? '병목 — 1대 늘리면 효과 큼' : util > 70 ? '여유 적음' : ''}</td>
      <td></td></tr>`;
  }).join('');
  refBind();
}

/* ---- ② 전환시간 ------------------------------------------------------- */
function renderRefCo() {
  $('refCoBody').innerHTML = Object.keys(REF_CO_DEFAULT).map(k => {
    const D = REF_CO_DEFAULT[k], C = CHANGEOVER[k];
    const cell = (f) => refInput(C[f], D[f], v => refSet('co', k, f, v), { width: 70, min: 0, max: 86400 });
    return `<tr><td><b>${esc(D._l)}</b></td>
      <td class="num">${cell('od')}</td><td class="num">${cell('t')}</td><td class="num">${cell('L')}</td>
      <td style="color:#6e7681;font-size:11px">${esc(D._n || '')}</td><td></td></tr>`;
  }).join('');
  refBind();
}

/* ---- ③ 표준시간 상수 -------------------------------------------------- */
const REF_PREVIEW_SPEC = { od:914, t:9.3, L:12802, qty:70, grade:'normal', api5l:true,
  markSpec:2, markEnd:2, defects:0, holdSec:60, rtType:'450kV' };
const REF_PREVIEW_FN = {
  EdgeMiller: () => STD.EdgeMiller(REF_PREVIEW_SPEC, '12M', 5, 5),
  PreBender:  () => STD.PreBender(REF_PREVIEW_SPEC, '12M'),
  PressBender:() => STD.PressBender(REF_PREVIEW_SPEC, '12M'),
  GapPress:   () => STD.GapPress({ ...REF_PREVIEW_SPEC, t:31.2, grade:'high' }),
  TackWelder: () => STD.TackWelder(REF_PREVIEW_SPEC, '12M'),
  InsideWelder:() => STD.InsideWelder(REF_PREVIEW_SPEC, '12M'),
  OutsideWelder:() => STD.OutsideWelder(REF_PREVIEW_SPEC, '12M'),
  FirstUT:    () => STD.FirstUT(REF_PREVIEW_SPEC),
  Expander:   () => STD.Expander(REF_PREVIEW_SPEC, 'M1'),
  EndFacing:  () => STD.EndFacing(REF_PREVIEW_SPEC),
  OuterBead:  () => STD.OuterBead(REF_PREVIEW_SPEC),
  HydroTest:  () => STD.HydroTest(REF_PREVIEW_SPEC),
  FinalUT:    () => STD.FinalUT(REF_PREVIEW_SPEC),
  RT:         () => STD.RT(REF_PREVIEW_SPEC),
  Packing:    () => STD.Packing(REF_PREVIEW_SPEC, '12M', 5),
};
function renderRefStd() {
  $('refStdWrap').innerHTML = Object.keys(REF_STD_DEFAULT).map(proc => {
    const G = REF.std[proc], D = REF_STD_DEFAULT[proc];
    const rows = Object.keys(G).filter(k => k[0] !== '_').map(k =>
      `<div class="refrow"><span title="${esc(G[k].l)}">${esc(G[k].l)}</span>
         ${refInput(G[k].v, D[k].v, v => refSet('std', proc, k, v),
            { min: REF_STD_LO(proc, k), max: REF_STD_MAX(proc, k), ref: `std\u241F${proc}\u241F${k}` })}
         <i>${esc(G[k].u || '')}</i></div>`).join('');
    let prev = '';
    try {
      const r = REF_PREVIEW_FN[proc] ? REF_PREVIEW_FN[proc]() : null;
      if (r) prev = `<div class="refprev">미리보기 <b>${r.sec.toFixed(1)}s</b> &nbsp;·&nbsp; ${esc(r.expr)}</div>`;
    } catch (e) { prev = `<div class="refprev" style="color:#ff7b72">미리보기 계산 오류: ${esc(String(e.message || e))}</div>`; }
    return `<div class="refgrp" data-proc="${esc(proc)}"><h4>${esc(G._label)} <small>엑셀 ${esc(G._src)}</small></h4>
      <div class="refgrid">${rows}</div>${prev}</div>`;
  }).join('');
  refBind();
}

/* ---- ④ 룩업 표 (보기 전용) ------------------------------------------- */
const REF_TBL_DESC = {
  tackWeld:'태그 웰딩 속도 (두께 구간 → mm/s)', insideWeld:'내면 SAW 속도·패스 (WPS)',
  outsideWeld:'외면 SAW 속도·패스 (WPS)', utCut:'관단탭 절단 속도', emSpeed:'Edge Miller 고속 Setting',
  emFeed:'Edge Miller 메인 피딩기 전진거리', pressX1:'Press Bender X1 Side Press 횟수 (인치별)',
  endFacing:'End-Facing 저속 절삭시간 (인치 × 두께)', endFacingTC:'End-Facing 보조 상수',
  hydroFill:'수압 충수시간 (인치별)', hydroConst:'수압 고정 상수 (2차압빼기·에어벤트)',
  preBenderPitch:'Pre Bender 피치 (두께별)', expanderDie:'확관 다이표 — 엑셀 Expander(1호기)',
  packingMarking:'포장 마킹 상수', dieSpec:'확관 다이 스펙 (M1 107 · M2 68 · RB 37행) — specs.py 정본',
};
function renderRefTbl() {
  /* 표 자체는 여기서 통째로 고치지 않는다 — 「산식 검증」 탭에서 **그 제품이 짚은 칸**만 고친다.
     여기서는 어느 표의 몇 칸이 고쳐졌는지만 보여 준다. (2026-08-19) */
  const edited = {};
  for (const key in REF_EDIT.tbl) edited[key.split('|')[0]] = (edited[key.split('|')[0]] || 0) + 1;
  $('refTblBody').innerHTML = Object.keys(T).map(k => {
    const v = T[k];
    const n = Array.isArray(v) ? v.length
      : (v && typeof v === 'object' ? Object.values(v).reduce((a, x) => a + (Array.isArray(x) ? x.length : 1), 0) : 1);
    const e = edited[k] || 0;
    return `<tr><td><b>${esc(k)}</b></td><td style="color:#6e7681">${esc(REF_TBL_DESC[k] || '')}</td>
      <td class="num">${n.toLocaleString()}${e ? ` <span style="color:#e3b341">· ${e}칸 수정</span>` : ''}</td></tr>`;
  }).join('');
}

function renderRef() {
  if (!$('refKpi')) return;
  renderRefKpi(); renderRefCap(); renderRefCo(); renderRefStd(); renderRefTbl();
}

/* ---- 내보내기 · 불러오기 ---------------------------------------------- */
function refExport() {
  const doc = {
    _포맷: 'JCOE 시뮬레이터 기준정보',
    _버전: 1,
    _저장시각: new Date().toISOString().slice(0, 19).replace('T', ' '),
    _설명: '이 파일을 시뮬레이터 「기준정보」 탭에서 불러오면 같은 상태가 됩니다. 기본값과 다른 항목만 담겨 있습니다.',
    설비대수: REF_EDIT.cap,
    전환시간: REF_EDIT.co,
    표준시간상수: REF_EDIT.std,
    /* 「산식 검증」 탭에서 그 자리에서 고친 엑셀 표 칸.
       키는 `표이름|행|열` (범위표) · `표이름|인치` (인치표) · `표이름|키` (상수) 형식이다. */
    엑셀표재정의: REF_EDIT.tbl,
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `JCOE_기준정보_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}
/** 불러온 JSON 을 **검증해서** REF_EDIT 모양으로 바꾼다. 못 쓰는 항목은 사유와 함께 걸러낸다. */
function refSanitize(d) {
  const bad = [];
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  /* `__proto__` · `constructor` 같은 키를 그대로 인덱싱하면 Object.prototype 이 오염된다.
     자기 소유 키만 받아들인다. (2026-08-14 전수 감사) */
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const RISKY = new Set(['__proto__', 'constructor', 'prototype']);
  const num = (v) => typeof v === 'number' && isFinite(v);
  const out = { std:{}, co:{}, cap:{}, tbl:{} };

  const cap = d.설비대수 ?? d.cap;
  if (cap != null) {
    if (!plain(cap)) bad.push('설비대수 형식이 올바르지 않습니다');
    else for (const id in cap) {
      if (!own(cap, id) || RISKY.has(id)) { bad.push(`설비대수: 쓸 수 없는 키 ${id}`); continue; }
      const v = Math.round(+cap[id]);
      if (id === 'EXP') bad.push('설비대수: 확관(EXP) 은 #1·#2호기 + R/B 라인 구성이 고정이라 바꿀 수 없습니다');
      else if (!NODE[id] || NODE[id].kind !== 'proc') bad.push(`설비대수: 없는 설비 ${id}`);
      else if (!isFinite(v) || v < 1 || v > 20) bad.push(`설비대수 ${id}: 1~20 범위 밖 (${cap[id]})`);
      else out.cap[id] = v;
    }
  }
  const co = d.전환시간 ?? d.co;
  if (co != null) {
    if (!plain(co)) bad.push('전환시간 형식이 올바르지 않습니다');
    else for (const st in co) {
      if (!own(co, st) || RISKY.has(st)) { bad.push(`전환시간: 쓸 수 없는 키 ${st}`); continue; }
      if (!plain(co[st])) { bad.push(`전환시간: ${st} 형식 오류`); continue; }
      if (!own(REF_CO_DEFAULT, st)) { bad.push(`전환시간: 없는 공정 ${st}`); continue; }
      for (const k of ['od','t','L']) {
        if (co[st][k] === undefined) continue;
        const v = +co[st][k];
        if (!num(v) || v < 0) bad.push(`전환시간 ${st}.${k}: 0 이상 숫자만 (${co[st][k]})`);
        else (out.co[st] = out.co[st] || {})[k] = v;
      }
    }
  }
  const std = d.표준시간상수 ?? d.std;
  if (std != null) {
    if (!plain(std)) bad.push('표준시간상수 형식이 올바르지 않습니다');
    else for (const proc in std) {
      if (!own(std, proc) || RISKY.has(proc)) { bad.push(`표준시간상수: 쓸 수 없는 키 ${proc}`); continue; }
      if (!plain(std[proc])) { bad.push(`표준시간상수: ${proc} 형식 오류`); continue; }
      if (!own(REF_STD_DEFAULT, proc)) { bad.push(`표준시간상수: 없는 공정 ${proc}`); continue; }
      for (const k in std[proc]) {
        if (!own(std[proc], k) || RISKY.has(k)) { bad.push(`표준시간상수 ${proc}.${k}: 쓸 수 없는 키`); continue; }
        if (!own(REF_STD_DEFAULT[proc], k)) { bad.push(`표준시간상수 ${proc}.${k}: 없는 항목`); continue; }
        const v = +std[proc][k];
        if (!num(v) || v < REF_STD_MIN(proc, k)) bad.push(`표준시간상수 ${proc}.${k}: 값 오류 (${std[proc][k]})`);
        else (out.std[proc] = out.std[proc] || {})[k] = v;
      }
    }
  }
  /* 엑셀 표 재정의 — 키가 실제로 존재하는 칸을 가리키는지까지 확인한다.
     (없는 표·없는 행을 그대로 받으면 조용히 무시돼 "고쳤는데 안 바뀐다" 가 된다) */
  const tbl = d.엑셀표재정의 ?? d.tbl;
  if (tbl != null) {
    if (!plain(tbl)) bad.push('엑셀표재정의 형식이 올바르지 않습니다');
    else for (const key in tbl) {
      if (!own(tbl, key) || RISKY.has(key)) { bad.push(`엑셀표재정의: 쓸 수 없는 키 ${key}`); continue; }
      /* `+v` 강제변환을 쓰면 null·false·"" 가 전부 0 이 되어 통과한다 — 타입부터 본다 */
      if (typeof tbl[key] !== 'number' || !isFinite(tbl[key])) {
        bad.push(`엑셀표재정의 ${key}: 숫자만 넣을 수 있습니다 (${JSON.stringify(tbl[key])})`); continue; }
      const v = tbl[key];
      /* 표 값은 속도·거리·시간·횟수라 0 이하가 될 수 없다.
         종전에는 0 하나로 완료일이 192만 일이 됐다. (2026-08-19 전수 감사) */
      if (v <= 0) { bad.push(`엑셀표재정의 ${key}: 0 보다 커야 합니다 (${v})`); continue; }
      if (!refTblCellExists(key)) { bad.push(`엑셀표재정의: 실제로 조회에 쓰이지 않는 칸입니다 — ${key}`); continue; }
      const def = refTblCellDefault(key);
      if (def != null && def > 0 && (v < def / 1000 || v > def * 1000)) {
        bad.push(`엑셀표재정의 ${key}: 원래 값 ${def} 의 1/1000~1000배 범위를 벗어났습니다 (${v})`); continue; }
      out.tbl[key] = v;
    }
  }
  return { out, bad };
}
/** `표이름|…` 키가 **엔진이 실제로 조회하는 칸**을 가리키는지.
    판정은 엔진(refTblKeyValid)에 맡긴다 — 화면과 엔진이 다른 규칙을 쓰면
    "저장은 됐는데 계산은 안 바뀌는" 먹통 재정의가 생긴다. (2026-08-19 전수 감사) */
function refTblCellExists(key) { return refTblKeyValid(key); }
/** 그 칸의 원표 값 */
function refTblCellDefault(key) {
  const seg = String(key).split('|');
  const tab = T[seg[0]]; if (tab == null) return null;
  if (seg.length === 3) return Array.isArray(tab) && tab[+seg[1]] != null ? tab[+seg[1]][seg[2]] : null;
  if (seg.length === 2) return typeof tab[seg[1]] === 'number' ? tab[seg[1]] : null;
  return null;
}
function refImportFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    /* ★ **원자적으로** 적용한다.
       종전에는 REF_EDIT 를 먼저 덮어쓰고 엔진에 밀어 넣는 도중 예외가 나면
       표준시간은 이미 바뀐 채로 전환시간·설비대수는 안 바뀐 **반쯤 적용된 상태**가 됐고,
       그 뒤로는 편집도 되돌리기도 전부 예외를 던져 새로고침 말고는 방법이 없었다. */
    const prev = JSON.parse(JSON.stringify(REF_EDIT));
    let d;
    try { d = JSON.parse(rd.result); }
    catch (e) { alert('JSON 을 읽지 못했습니다: ' + (e.message || e)); return; }
    const { out, bad } = refSanitize(d);
    try {
      REF_EDIT = out;
      refApply(true);
      if ($('vfBody')) renderVerify(true);
    } catch (e) {
      REF_EDIT = prev; refApply(true);
      alert('기준정보를 적용하지 못해 이전 상태로 되돌렸습니다: ' + (e.message || e));
      return;
    }
    const n = refCount();
    alert(`기준정보를 불러왔습니다 — ${n}개 항목 적용.`
      + (bad.length ? `\n\n걸러낸 항목 ${bad.length}개:\n· ` + bad.slice(0, 10).join('\n· ')
          + (bad.length > 10 ? `\n… 외 ${bad.length - 10}개` : '') : ''));
  };
  rd.readAsText(file);
}

function initRefTab() {
  if (!$('refKpi')) return;
  REF_BASE = { days: SIM.kpi.makespanH / 24, top: SIM.stats[0] && SIM.stats[0].label };
  document.querySelectorAll('#refTabs .stab').forEach(t => t.onclick = () => {
    document.querySelectorAll('#refTabs .stab').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('#pRef .rpane').forEach(x => x.classList.remove('on'));
    t.classList.add('on'); $(t.dataset.r).classList.add('on');
  });
  $('refRevert').onclick = () => {
    if (!refCount()) return;
    if (!confirm('고친 값을 전부 원래대로 되돌립니다. 계속할까요?')) return;
    REF_EDIT = { std:{}, co:{}, cap:{}, tbl:{} }; refApply(true);
    if ($('vfBody')) renderVerify(true);
  };
  $('refExport').onclick = refExport;
  $('refImport').onchange = e => { if (e.target.files[0]) refImportFile(e.target.files[0]); e.target.value = ''; };
  renderRef();
}
