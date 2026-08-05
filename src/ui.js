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
  setExpanderNMode(($('cfgExpN') || {}).value || 'excel');
  return {
    expSetupMode: ($('cfgExpSetup') || {}).value || 'tool',
    expNMode: ($('cfgExpN') || {}).value || 'excel',
    dispatchRule: ($('optRule')||{}).value || 'EAT',
    sameODConcurrency: $('optSameOD') ? $('optSameOD').checked : true,
    useM3: $('optM3') ? $('optM3').checked : false,
    expRuleSet: ($('optRuleSet')||{}).value || 'ppt',
    rbMode: ($('optRbMode')||{}).value || 'capable',
    rbShifts: +(($('optRbShift')||{}).value || 1),
    applyOptSeq: $('optApplySeq') ? $('optApplySeq').checked : true,
    plan: (($('optRule')||{}).value === 'IMPORT') ? IMP_PLAN : PLAN,
    startDate: $('cfgStart').value || '2026-03-02',
    deadline: $('cfgDeadline') && $('cfgDeadline').value ? $('cfgDeadline').value : null,
    dateMode: ($('cfgDateMode')||{}).value || 'plan',
    seqGapH: numIn('cfgSeqGap', 6, 0.5, 240),
    shifts: +$('cfgShifts').value || 2,
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
function runSim() {
  CFG = readCfg();
  const t = performance.now();
  SIM = simulate(ORDERS, CFG);
  SIM.events.sort((a,b)=>a.s-b.s);
  SIM.byR = SIM.events.slice().sort((a,b)=>a.r-b.r);
  $('simInfo').textContent =
    `${ORDERS.length}오더 / ${ORDERS.reduce((a,o)=>a+o.qty,0).toLocaleString()}본 · `
    + `${fmtT(SIM.t0)} → ${fmtT(SIM.tEnd)} (${(SIM.horizonH/24).toFixed(1)}일) · ${(performance.now()-t).toFixed(0)}ms`
    + (PLAN_SRC ? ` · ${PLAN_SRC}` : '')
    + (SIM.kpi.stochOn ? ` · 변동 seed ${SIM.kpi.seed} · 재작업 ${SIM.kpi.rework}본` : '')
    + (SIM.kpi.deadline ? ` · 마감 ${CFG.deadline} 달성률 ${pct(SIM.kpi.doneInPeriod, SIM.kpi.doneInPeriod+SIM.kpi.overflow)}` : '');
  animT = SIM.t0; evIdx = 0; completed = 0; logs.length = 0; doneSet.clear();
  for (const n of NODES) { nodeState[n.id] = { active:[], q:0, done:0 }; }
  buildStatPanel(); updateStatPanel(); renderBottleneck(); renderGantt(); renderEligWarn(); buildIOFilters(); renderIO(); draw();
  if($('mcHint')) renderStNote();
  if($('periodSum')) renderPeriod();
  if($('seek')) $('seek').value=0;
  $('logBody').innerHTML='<div class="lg">▶ 를 눌러 시뮬레이션을 재생하세요.</div>';
}

/* ================= 캔버스 ================= */
const cvs = $('cv'), ctx = cvs.getContext('2d');
let VW = 1600, VH = 900, scale = 1, offX = 0, offY = 0;
function fit() {
  const w = cvs.parentElement.clientWidth, h = cvs.parentElement.clientHeight;
  cvs.width = w * devicePixelRatio; cvs.height = h * devicePixelRatio;
  cvs.style.width = w + 'px'; cvs.style.height = h + 'px';
  scale = Math.min(w / VW, h / VH) * 0.97;
  offX = (w - VW * scale) / 2; offY = (h - VH * scale) / 2;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
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
      st.units.forEach(u=>L.push(`  ${u.id} : ${u.jobs}본 / ${u.busyH.toFixed(1)}h`));
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
  if (playing) stepAnim(Math.min(dt,0.1)); draw(); requestAnimationFrame(loop); }

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
  const busy = {};
  let lo=0, hi=ev.length-1, st=ev.length;
  while (lo<=hi){ const m=(lo+hi)>>1; if (ev[m].e>=animT-win){ st=m; hi=m-1; } else lo=m+1; }
  for (let i=Math.max(0,st-2000);i<ev.length && ev[i].s<=animT;i++){
    const e=ev[i]; const a=Math.max(e.s,animT-win), b=Math.min(e.e,animT);
    if (b>a) busy[e.n]=(busy[e.n]||0)+(b-a);
  }
  for (const s of SIM.stats){
    const u = Math.min(100, (busy[s.id]||0)/(win*s.cap*(SIM.cal.dayCap/86400))*100);
    const el=$('sf_'+s.id); if(!el) continue;
    el.style.width=u.toFixed(0)+'%';
    el.style.background = u>=85?C.bneck:u>=60?C.setup:C.done;
    $('sv_'+s.id).textContent=u.toFixed(0)+'%';
  }
}

/* ================= 표준시간 계산기 ================= */
const CALC_ORDER = [
  ['EdgeMiller','면취 (Edge Miller)'], ['PreBender','Pre Bender'], ['PressBender','Press Bender'],
  ['GapPress','Gap Press'], ['TackWelder','태그 웰딩'], ['InsideWelder','내면 SAW'],
  ['OuterBead','슬러그/비드 제거'], ['OutsideWelder','외면 SAW'], ['FirstUT','1차 U.T'],
  ['Expander','확관 (Expander)'], ['EndFacing','면취기 (End-Facing)'], ['HydroTest','수압'],
  ['FinalUT','Final U.T'], ['RT','X-ray (RT)'], ['Packing','포장'],
];
function calc(){
  const s = {
    od: +$('cOD').value, t: +$('cT').value, L: +$('cL').value*1000, qty:+$('cQ').value,
    grade: $('cGrade').value, api5l: $('cAPI').checked,
    markSpec:+$('cMS').value, markEnd:+$('cME').value, defects:+$('cDF').value,
    holdSec:+$('cHold').value, rtType:$('cRT').value,
  };
  const line = s.L/1000 > 13 ? '18M':'12M';
  const mach = $('cExp').value;
  const rows = [];
  for (const [k,label] of CALC_ORDER){
    if (k==='GapPress' && s.t<=25) { rows.push({k,label,skip:'두께 25T 이하 → Gap Press 미투입'}); continue; }
    if (k==='FirstUT' && !(s.api5l||s.qty>=50)) { rows.push({k,label,skip:'단일오더 API 5L·50PCS 미만 → By-pass'}); continue; }
    if (k==='FinalUT' && !s.api5l) { rows.push({k,label,skip:'프로세싱 파이프 → 별도 요청 시에만 진행'}); continue; }
    const r = k==='Expander' ? STD.Expander(s, mach) : STD[k](s, line, 1);
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
      return `<option value="${esc(no)}">${no} · OD${v.od}×t${v.t}×${(v.L/1000).toFixed(1)}m · ${v.qty}본</option>`;}).join('');
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
      <td>${r.o}</td><td class="num">${r.k}</td><td>${STATION_LABEL(r.st)}</td><td>${unitLabel(r.st,r.u,r.both)}</td>
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
      <td>${r.o}</td><td>${STATION_LABEL(r.st)}</td><td>${unitLabel(r.st,r.u,r.both)}</td><td class="num">${r.n}</td>
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
  if($('optRule') && $('optRule').value==='OPT'){
    $('optRule').value='EAT';
    if($('ruleDesc')) $('ruleDesc').textContent=DISPATCH_RULES.EAT.desc;
  }
  if($('optSum')) $('optSum').innerHTML=`<div class="kpi bn"><b>재실행 필요</b><span>제약이 바뀌어 이전 최적화 해는 무효입니다</span></div>`;
  if($('optSeq')) $('optSeq').innerHTML='';
  runSim();
}
function initOptTab(){
  $('optRule').innerHTML=Object.entries(DISPATCH_RULES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
  const upd=()=>{ $('ruleDesc').textContent=DISPATCH_RULES[$('optRule').value].desc; };
  $('optSameOD').onchange=invalidatePlan;
  $('optM3').onchange=invalidatePlan;
  if($('cfgRB')) $('cfgRB').onchange=invalidatePlan;
  ['optRuleSet','optRbMode','optRbShift'].forEach(id=>{ if($(id)) $(id).onchange=invalidatePlan; });
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
    if ((cfg.rbMode || 'capable') !== 'force') return '';
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
      const em = expanderMode({no:o.no,od:o.od,t:o.t,L:o.L,qty:o.qty}, CFG||readCfg());
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
  const cur=($('optRuleSet')||{}).value||'ppt';
  const base=readCfg();
  const sum=(rs)=>{
    const cfg={...base, expRuleSet:rs}, q={M1:0,M2:0,FREE:0,BOTH:0,RB:0};
    for(const o of ORDERS){
      const sp={no:o.no,od:o.od,t:o.t,L:o.L,qty:o.qty,bottleneck:o.bottleneck,rawL:o.rawL};
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
  if($('eligOk')) $('eligOk').innerHTML = cur === 'ppt'
    ? `위 제약을 그대로 풀면 다이어그램 주석과 일치합니다 — <b>${R.L2}m 초과 ~ ${R.L1}m 제품은 #2·#3호기가 불가하므로 “Only #1 Expander 가동”</b>,
       <b>${R.L1}m 초과 제품은 어느 호기도 단독 불가하므로 “#1·#2 Expander 동시 가동”</b> (소요시간 = max(#1, #2)).`
    : `<b>확관 최적화 운영 모델 기준</b>을 적용 중입니다 — #2호기 상한 ${R.L2}m, #1호기 상한 ${R.L1}m,
       외경 48"↑/22"↓ 는 #2호기 전용(hard), RB 는 다이표 외경(24"~48") · 두께 9~25.4mm.
       이 기준에서는 다이어그램 주석 “12.8M~14M 제품 Only #1 Expander 가동” 이 성립하지 않습니다 — 아래 비교표를 확인하세요.`;
  const a=sum('ppt'), b=sum('ortools');
  const row=(lbl,ka)=>`<tr><td>${lbl}</td><td class="num">${a[ka].toLocaleString()}</td><td class="num">${b[ka].toLocaleString()}</td></tr>`;
  el.innerHTML=`<div class="warn" style="margin-bottom:10px">
    <b>두 자료의 확관 제약이 서로 다릅니다 — 세아제강 확인 필요</b>
    <table style="margin-top:8px"><thead><tr><th>항목</th><th>공정 다이어그램·제약표</th><th>확관 최적화 운영 모델</th></tr></thead><tbody>
      <tr><td>#2호기 길이 상한</td><td>12.8m 이상 불가</td><td class="hi2">12.8384m 초과 불가</td></tr>
      <tr><td>#1호기 길이 상한</td><td>14m 이상 불가</td><td>14.021m 초과 불가</td></tr>
      <tr><td>외경 48"↑ / 22"↓</td><td>#2호기 <b>우선</b> 투입</td><td class="hi2">#2호기 <b>전용</b> (hard)</td></tr>
      <tr><td>RB 투입 조건</td><td>두께 25T 이하 &amp; 외경 24" 이하</td><td class="hi2">RB 다이표 외경(24"~48") &amp; 9≤t≤25.4</td></tr>
      <tr><td>RB 강제 투입</td><td>(제약표) 열처리 &amp; 배척 제품 우선</td><td>병목공정 HT102 · 원재료/제품 길이비 ≥ 1.8</td></tr>
    </tbody></table>
    <div style="margin-top:9px">현재 오더셋 <b>${ORDERS.reduce((x,o)=>x+o.qty,0).toLocaleString()}본</b>을 기준별로 분류하면:</div>
    <table style="margin-top:6px"><thead><tr><th>구분 (본)</th><th style="text-align:right">다이어그램 기준</th><th style="text-align:right">운영 모델 기준</th></tr></thead><tbody>
      ${row('#1호기 전용','M1')}${row('#2호기 전용','M2')}${row('두 호기 다 가능 — 배분 규칙 대상','FREE')}${row('#1·#2 동시 가동','BOTH')}${row('RB 라인','RB')}
    </tbody></table>
    <div style="margin-top:9px">12.802m 제품(전체의 66%)이 <b>12.8m 기준에서는 #1호기 전용</b>, <b>12.8384m 기준에서는 두 호기 다 가능</b>으로 갈립니다.
      호기 부하 편중이 여기서 통째로 결정되므로, 실제 상한이 어느 쪽인지가 이 모델에서 가장 영향이 큰 미확인 항목입니다.
      현재 적용 기준: <b>${cur==='ortools'?'확관 최적화 운영 모델':'공정 다이어그램 · 제약표'}</b></div></div>`;
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
      $('impInfo').innerHTML=`<div class="warn"><b>읽지 못했습니다</b><br>${String(err.message||err)}</div>`;
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
      <div class="kpi ${applied?'':'bn'}"><b>${applied?'적용 중':'미적용'}</b><span>${applied?IMP_SRC:'배분 규칙을 「외부 최적화 스케줄」 로 바꾸세요'}</span></div>
    </div>
    ${matched===0?`<div class="warn"><b>매칭된 오더가 0건입니다.</b> 파일의 OrderNo(판매오더)와 시뮬레이터 오더번호 체계가 다릅니다.
      계획서 탭에서 같은 조관계획서를 먼저 불러오면 매칭됩니다.</div>`:''}
    ${P.warn.length?`<div class="warn"><b>경고 ${P.warn.length}건</b><br>${P.warn.slice(0,8).join('<br>')}${P.warn.length>8?'<br>…':''}</div>`:''}`;
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
function renderOptResult(ms){
  if(!PLAN){ return; }
  const P=PLAN;
  $('optSum').innerHTML=`
    <div class="kpi"><b>${P.nJobs}</b><span>확관 대상 오더 (작업 j)</span></div>
    <div class="kpi"><b>${P.nFree} / ${P.nFixed} / ${P.nBoth}</b><span>선택가능 / #1전용 / 동시가동</span></div>
    <div class="kpi"><b>${P.cmaxH.toFixed(1)} h</b><span>확관 Makespan (Cmax)</span></div>
    <div class="kpi bn"><b>${P.setupH.toFixed(1)} h</b><span>총 설비 전환시간 Σs<sub>ij</sub></span></div>
    <div class="kpi"><b>${P.balH.toFixed(1)} h</b><span>호기간 부하 편차</span></div>
    <div class="kpi"><b>${P.machines.map((m,i)=>`#${i+1} ${(P.loadH[m]||0).toFixed(0)}h`).join(' / ')}</b><span>호기별 부하</span></div>
    <div class="kpi"><b>${(ms||0).toFixed(0)} ms</b><span>SA ${P.iters.toLocaleString()}회 탐색</span></div>`;
  const byM={}; P.machines.forEach(m=>byM[m]=[]);
  P.detail.forEach(d=>{ if(d.m==='BOTH'){ byM.M1.push(d); byM.M2.push(d); } else byM[d.m].push(d); });
  const colorOf=no=>{ const v=SIM.orderSpan[no]; return v?`hsl(${(Math.round(v.od/25.4)*17)%360},62%,55%)`:'#666'; };
  $('optSeq').innerHTML='<div class="mseq">'+P.machines.map(m=>{
    const rows=byM[m], tot=rows.reduce((a,r)=>a+r.p+r.setup,0)||1;
    return `<div class="mcard"><h5>확관 #${m[1]}호기 <span>${rows.length}오더 · ${(tot/3600).toFixed(1)}h · 전환 ${(rows.reduce((a,r)=>a+r.setup,0)/3600).toFixed(1)}h</span></h5>
      <div class="mseqbar">${rows.map(r=>
        `<div style="width:${r.setup/tot*100}%;background:#d29922" title="전환 ${(r.setup/60).toFixed(0)}분"></div>
         <div style="width:${r.p/tot*100}%;background:${colorOf(r.no)}" title="${r.no} ${(r.p/3600).toFixed(1)}h"></div>`).join('')}</div>
      ${rows.map((r,i)=>{const v=SIM.orderSpan[r.no]||{};
        return `<div class="mrow"><span><i style="background:${colorOf(r.no)}"></i>${i+1}. ${r.no}
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
  const rows = spans.map(([no,v])=>{
    const late = (dl && v.e>dl) || (v.tardyH!=null && v.tardyH>0);
    const tt = `${no}\n${fmtT(v.s)} → ${fmtT(v.e)}\n${((v.e-v.s)/3600).toFixed(1)}h`
      + (v.due?`\n납기 ${v.due}${v.tardyH>0?` (${(v.tardyH/24).toFixed(1)}일 지연)`:' (준수)'}`:'');
    return `<div class="gr">
      <div class="gl"><b>${no}</b>${late?' <span style="color:#ff7b72;font-size:9px">지연</span>':''}
        <span>OD${v.od} × t${v.t} × ${(v.L/1000).toFixed(1)}m · ${v.qty}본 · ${v.line}</span></div>
      <div class="gt">${marks}
        <div class="gb${late?' late':''}" style="left:${(v.s-t0)/span*100}%;width:${Math.max(0.4,(v.e-v.s)/span*100)}%;background:${colorOf(v.od)}"
          title="${tt}"></div>
      </div></div>`;}).join('');
  $('gantt').innerHTML = `<div class="ghdr"><div class="gl">오더 / 사양</div><div class="gt">${marksHdr}${hdr}</div></div>${rows}`;
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
      <td class="num">${x.cap}</td><td class="num">${x.jobs.toLocaleString()}</td>
      <td class="num">${x.busyH.toFixed(1)}</td>
      <td class="num ${x.setupH>10?'hi2':''}">${x.setupH.toFixed(1)}</td>
      <td class="num ${x.setupShare>=15?'hi2':''}">${x.setupShare.toFixed(1)}%</td>
      <td class="bar"><div style="width:${Math.min(100,x.util/max*100)}%;background:${x.util>=80?C.bneck:x.util>=55?C.setup:C.done}"></div></td>
      <td class="num"><b>${x.util.toFixed(1)}%</b>${x.cap>1?`<br><span style="color:#6e7681;font-size:9.5px">${x.unitUtil.map(v=>v.toFixed(0)+'%').join(' / ')}</span>`:''}</td>
      <td><span class="tag" style="background:${ty.c};color:#fff">${ty.t}</span></td></tr>`;
  }).join('');

  const top = s[0];
  const setupTop = s.slice().sort((a,b)=>b.setupH-a.setupH)[0];
  const eligTop = s.slice().sort((a,b)=>b.imbalance-a.imbalance)[0];
  const totSetup = s.reduce((a,x)=>a+x.setupH,0);
  const exp = s.find(x=>x.id==='EXP') || {imbalance:0, setupH:0, util:0, unitUtil:[0,0]};
  $('bnCall').innerHTML = `
    <div class="kpi bn"><b>${top.label.replace('\n',' ')}</b><span>가공 병목 · 대당 가동률 ${top.util.toFixed(1)}%</span></div>
    <div class="kpi" style="border-color:#d2992266;background:#d2992214"><b style="color:#e3b341">${setupTop.label.replace('\n',' ')}</b><span>전환 병목 · ${setupTop.setupH.toFixed(1)}h (전체 전환의 ${pct(setupTop.setupH, totSetup)})</span></div>
    <div class="kpi" style="border-color:#8957e566;background:#8957e514"><b style="color:#a77bff">${eligTop.label.replace('\n',' ')}</b><span>제약 병목 · 호기 편차 ${eligTop.imbalance.toFixed(0)}%p</span></div>
    <div class="kpi"><b>${totSetup.toFixed(0)} h</b><span>총 설비 전환 시간</span></div>
    <div class="kpi"><b>${(SIM.horizonH/24).toFixed(1)} 일</b><span>전체 계획 소요</span></div>`;

  /* 대표 규격 1본 유효 CT 를 실제 산출식으로 다시 계산해 보여준다 (고정 문구 금지) */
  const ctSample = () => {
    const rep = ORDERS.slice().sort((a,b)=>b.qty-a.qty)[0];
    if(!rep) return '';
    const sp = {no:rep.no, od:rep.od, t:rep.t, L:rep.L, qty:rep.qty, grade:rep.t>25?'high':'normal',
                api5l:rep.qty>=50, markSpec:2, markEnd:2, defects:0, holdSec:(CFG||readCfg()).holdSec, rtType:'450kV'};
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
  $('bnWhy').innerHTML = `<div class="note">
    <b>병목이 확관 한 곳이 아닌 이유</b> — 성격이 다른 세 가지 병목이 동시에 존재합니다.<br><br>
    <b style="color:#ff7b72">① 가공 병목</b> — <b>${top.label.replace('\n',' ')} ${top.util.toFixed(0)}%</b>.
    1본당 소요가 길고 설비가 ${top.cap}대뿐이라 물리적으로 가장 느립니다.
    ${ctSample()}<br><br>
    <b style="color:#e3b341">② 전환 병목</b> — <b>${setupTop.label.replace('\n',' ')} ${setupTop.setupH.toFixed(0)}h</b>,
    전체 설비 전환의 ${pct(setupTop.setupH, totSetup)}가 여기서 발생합니다. 다이·헤드 교체 때문에 규격이 바뀔 때마다 멈춥니다.
    <b>PPT가 말한 “확관 병목”은 이쪽</b>입니다 — “타 공정 대비 긴 설비 전환 시간이 전체 공정의 병목을 유발”.<br><br>
    <b style="color:#a77bff">③ 제약 병목</b> — 확관 호기 간 가동률 차이 <b>${exp.imbalance.toFixed(0)}%p</b>
    (${exp.unitUtil.map(v=>v.toFixed(0)+'%').join(' / ')}).
    ${eligShare()}
    대수 평균으로 보면 낮아 보이지만 <b>가장 바쁜 호기만 보면 상위권</b>입니다.<br><br>
    정리하면 <b>납기를 좌우하는 것은 포장·슬러그 제거 같은 가공 병목</b>이고,
    <b>확관은 전환·제약 병목</b>이라 개선 수단이 다릅니다. 앞은 설비 증설이나 사이클타임 단축,
    뒤는 <b>오더 시퀀싱(같은 규격 묶기)과 호기 배분</b>으로 풉니다 — 「확관 최적화」 탭이 그 도구입니다.</div>`;

  $('bnUnits').innerHTML = s.filter(x=>x.cap>1).map(x=>`
    <div class="uc"><h4>${x.label.replace('\n',' ')} (${x.cap} units)</h4>
      ${x.units.map((u,i)=>`<div class="tr2"><span>${x.id==='EXP'?('확관 #'+(i+1)+'호기'):u.id}</span>
        <b>${u.jobs.toLocaleString()}본 · ${u.busyH.toFixed(1)}h · ${u.util.toFixed(0)}%</b></div>`).join('')}
    </div>`).join('');
}

/* ================= 계획 기간 ================= */
function initPeriod(){
  const upd=()=>{ $('fGap').style.display = $('cfgDateMode').value==='seq' ? 'flex':'none'; };
  $('cfgDateMode').onchange=()=>{ upd(); runSim(); };
  $('btnPeriod').onclick=runSim;
  $('btnPeriodClear').onclick=()=>{ $('cfgDeadline').value=''; runSim(); };
  $('cfgStart').onchange=runSim; $('cfgDeadline').onchange=runSim; $('cfgSeqGap').onchange=runSim;
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
      document.querySelector('.tab[data-p="pFlow"]').click();
    },
    onReset:()=>{
      const d0=ORDERS_DEFAULT[0] && ORDERS_DEFAULT[0].start ? ORDERS_DEFAULT[0].start.slice(0,10) : '2026-03-02';
      $('cfgStart').value=d0;
      applyOrders(ORDERS_DEFAULT.slice(), null, null);
    },
  });
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

/* 비교·반복 실행 대상 규칙 — 가져온 스케줄이 없으면 IMPORT 는 제외 */
function ruleKeys(){ return Object.keys(DISPATCH_RULES).filter(r => r!=='IMPORT' || IMP_PLAN); }

/* ================= 부트 ================= */
const CO_BACKUP = JSON.stringify(CHANGEOVER);
function boot(){
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
    document.querySelectorAll('.pane').forEach(x=>x.classList.remove('on'));
    t.classList.add('on'); $(t.dataset.p).classList.add('on');
    if (t.dataset.p==='pFlow') fit();
  });
  $('btnPlay').onclick=()=>{ playing=!playing; $('btnPlay').textContent=playing?'❚❚':'▶'; };
  $('btnReset').onclick=()=>{ animT=SIM.t0; evIdx=0; completed=0; logs.length=0;
    for (const n of NODES) nodeState[n.id]={active:[],q:0,done:0}; };
  $('spd').oninput=e=>{ speed=[60,600,3600,18000,86400][+e.target.value]; $('spdL').textContent=
    ['1분/s','10분/s','1시간/s','5시간/s','1일/s'][+e.target.value]; };
  $('btnRun').onclick=runSim;
  $('btnCalc').onclick=calc;
  document.querySelectorAll('#pCalc input,#pCalc select').forEach(el=>el.oninput=calc);
  cvs.onmousemove = e=>{ const r=cvs.getBoundingClientRect();
    hover = hitTest(e.clientX-r.left, e.clientY-r.top);
    cvs.style.cursor = hover?'pointer':'default'; };
  cvs.onmouseleave = ()=>{ hover=null; };
  window.onresize=()=>{ fit(); if(SIM) renderGantt(); };
  for (const n of NODES) nodeState[n.id]={active:[],q:0,done:0};
  fit(); buildEdgeCache(); initOptTab(); initPlanLoader(); initMCTab(); initPeriod();
  $('seek').oninput=e=>{ seeking=true; seekTo(SIM.t0+(SIM.tEnd-SIM.t0)*(+e.target.value/1000)); seeking=false; };
  $('loopChk').onchange=e=>LOOP=e.target.checked;
  $('btnDice').onclick=newSeed;
  ['cfgExpSetup','cfgExpN'].forEach(id=>{ if($(id)) $(id).onchange=()=>{ runSim(); calc(); }; });
  runSim(); calc(); requestAnimationFrame(loop);
}
