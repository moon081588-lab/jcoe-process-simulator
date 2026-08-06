/* =====================================================================
   JCOE 3D — 공정 흐름도의 입체화
   2D 다이어그램 좌표(1600×900)를 그대로 3D 월드에 투영.
     world.x = (x2d - 800)/12      world.z = (y2d - 460)/12
   ===================================================================== */
const $ = id => document.getElementById(id);
const fmtT = s => { const d=new Date(s*1000), p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/* --------------------------------------------------------------------
   3D 전용 레이아웃 — 2D 다이어그램 좌표를 그대로 쓰지 않고 재배치한다.
   · 모든 흐름을 좌 → 우 로 통일하고, 행(aisle)을 넉넉히 벌린다
   · 각 설비 앞(+Z)에 전용 적치장(bay)을 두어 대기 물량이 어느 공정 것인지 명확히
   [row, col] — x = (col - 3.5) × COL_X,  z = ROW_Z0 + row × ROW_DZ
   -------------------------------------------------------------------- */
const COL_X = 14.5, ROW_DZ = 19, ROW_Z0 = -57;
const POS3 = {
  EM12:[0,0], PB12:[0,1], PR12:[0,2],
  EM18:[1,0], PB18:[1,1], PR18:[1,2],
  D1:[0.5,3],  GAP:[0.5,4],
  TACK:[2,0], ISAW:[2,1], SLUG:[2,2], OSAW:[2,3], CUT:[2,4], D2:[2,5], UT1:[2,6],
  BUF:[3,0], D3:[3,1], RB:[3,2], EXP:[3,3], D4:[3,4], CP:[3,5], EF:[3,6], HYD:[3,7],
  D5:[4,0], FUT:[4,1], XE:[4,2], FX:[4,3], D6:[4,4], PACK:[4,5],
  RP:[5,2], D7:[5,3], RW:[5,4], EP:[5,5],
};
const AISLES = [
  { row:0,   label:'조관 12M 라인',                     color:0x1f6feb, cs:'#4d94ff', c0:-0.7, c1:2.7 },
  { row:1,   label:'조관 18M 라인',                     color:0x1f6feb, cs:'#4d94ff', c0:-0.7, c1:2.7 },
  { row:2,   label:'용접 · 절단 (SAW)',                 color:0x2f9e9e, cs:'#5fd4d4', c0:-0.7, c1:6.7 },
  { row:3,   label:'확관 (Expansion) — 병목 공정',      color:0x8957e5, cs:'#a77bff', c0:-0.7, c1:7.7 },
  { row:4,   label:'검사 · 출하',                       color:0x238636, cs:'#3fbf5c', c0:-0.7, c1:5.7 },
  { row:5,   label:'보수 · 재작업',                     color:0xb06020, cs:'#e0913f', c0:1.3,  c1:5.7 },
];
const px3 = col => (col - 3.5) * COL_X;
const pz3 = row => ROW_Z0 + row * ROW_DZ;
function nodePos(id){ const p = POS3[id] || [3,3]; return { x: px3(p[1]), z: pz3(p[0]) }; }
const NW = 10.4, ND = 5.0;                          // 설비 폭 / 깊이
const BAY_OFF = 8.2, BAY_W = 12.4, BAY_D = 6.6;     // 적치장 위치·크기
/* 하위 호환용 (야드 좌표 계산에 쓰던 함수) */
const wx = x => (x - 800) / 12;
const wz = y => (y - 460) / 12;

const COL = {
  idle:0x2ea043, proc:0x2b7fff, setup:0xe3b341, bneck:0xf05252, off:0x4a5260,
  dec:0x9b6dff, buf:0x2fa6a6, body:0x6b7684, dark:0x39414f, deck:0x2a3140,
  accent:0x58a6ff
};

let scene, camera, renderer, raycaster, pickables = [];
let SIM=null, CFG=null, animT=0, evIdx=0, playing=false, speed=3600, completed=0, started=0;
const nodeState={}, logs=[], node3d={}, EDGE_CURVE={}, EDGE_PATH={};
let pipePool=[], pipeUsed=0, selected=null;

/* ---------------- 카메라 컨트롤 (자체 구현) ---------------- */
const cam = { tx:-2, ty:2, tz:-5, dist:122, yaw:Math.PI/2, pitch:0.62 };
function applyCam(){
  const cp=Math.cos(cam.pitch), sp=Math.sin(cam.pitch);
  camera.position.set(
    cam.tx + cam.dist*cp*Math.cos(cam.yaw),
    cam.ty + cam.dist*sp,
    cam.tz + cam.dist*cp*Math.sin(cam.yaw));
  camera.lookAt(cam.tx, cam.ty, cam.tz);
}
function initControls(dom){
  let drag=null, px=0, py=0;
  dom.addEventListener('pointerdown', e=>{ drag = (e.button===2||e.shiftKey)?'pan':'orbit'; px=e.clientX; py=e.clientY; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointerup',   e=>{ drag=null; try{dom.releasePointerCapture(e.pointerId);}catch(_){} });
  dom.addEventListener('pointermove', e=>{
    if(!drag) return;
    const dx=e.clientX-px, dy=e.clientY-py; px=e.clientX; py=e.clientY;
    if(drag==='orbit'){
      cam.yaw += dx*0.006;
      cam.pitch = Math.max(0.08, Math.min(1.52, cam.pitch + dy*0.005));
    } else {
      const k=cam.dist*0.0016;
      cam.tx -= (dx*Math.sin(cam.yaw) - dy*Math.cos(cam.yaw))*k*0.9;
      cam.tz += (dx*Math.cos(cam.yaw) + dy*Math.sin(cam.yaw))*k*0.9;
    }
    applyCam();
  });
  dom.addEventListener('wheel', e=>{ e.preventDefault();
    cam.dist = Math.max(18, Math.min(260, cam.dist * (1 + Math.sign(e.deltaY)*0.09))); applyCam(); }, {passive:false});
  dom.addEventListener('contextmenu', e=>e.preventDefault());
}
const VIEWS = {
  all:   {tx:-2,  ty:2, tz:-5,  dist:122, yaw:Math.PI/2, pitch:0.62},
  top:   {tx:-2,  ty:0, tz:-5,  dist:126, yaw:Math.PI/2, pitch:1.47},
  form:  {tx:-30, ty:0, tz:-46, dist:60,  yaw:Math.PI/2-0.12, pitch:0.55},
  exp:   {tx:2,   ty:0, tz:2,   dist:70,  yaw:Math.PI/2+0.10, pitch:0.52},
  insp:  {tx:-12, ty:0, tz:26,  dist:70,  yaw:Math.PI/2-0.08, pitch:0.52},
};
function goView(k){ const v=VIEWS[k]; Object.assign(cam, v); applyCam(); }

/* ---------------- 라벨 스프라이트 ---------------- */
function labelSprite(text, sub, w){
  const cv=document.createElement('canvas'), S2=3;
  const lines=text.split('\n');
  cv.width=340*S2; cv.height=(sub?96:72)*S2;
  const c=cv.getContext('2d'); c.scale(S2,S2);
  c.fillStyle='rgba(13,17,23,0.82)';
  c.beginPath(); c.roundRect(6,6,328,(sub?84:60),12); c.fill();
  c.strokeStyle='rgba(88,166,255,0.45)'; c.lineWidth=1.5; c.stroke();
  c.textAlign='center'; c.textBaseline='middle';
  c.fillStyle='#ffffff'; c.font='700 27px "Malgun Gothic","Segoe UI",sans-serif';
  lines.forEach((l,i)=>c.fillText(l,170, (sub?32:36) + (i-(lines.length-1)/2)*29));
  if(sub){ c.fillStyle='#8b949e'; c.font='19px "Malgun Gothic","Segoe UI",sans-serif'; c.fillText(sub,170,72); }
  const tex=new THREE.CanvasTexture(cv); tex.colorSpace=THREE.SRGBColorSpace;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
  const ww = w||10.5; sp.scale.set(ww, ww*(sub?96:72)/340, 1);
  sp.renderOrder = 20;
  return sp;
}
function zoneLabel(text, color){
  const cv=document.createElement('canvas'); cv.width=1024; cv.height=96;
  const c=cv.getContext('2d');
  c.textAlign='left'; c.textBaseline='middle';
  c.fillStyle=color; c.font='700 52px "Malgun Gothic","Segoe UI",sans-serif';
  c.fillText(text, 8, 52);
  const tex=new THREE.CanvasTexture(cv); tex.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(1024/46, 96/46),
    new THREE.MeshBasicMaterial({map:tex, transparent:true, depthWrite:false}));
  m.rotation.x=-Math.PI/2; return m;
}

/* 호기별 Z 오프셋 */
function unitZ(n){
  const cap=n.cap||1; if(cap<=1) return [0];
  const sp = cap===2 ? 5.2 : 3.5;
  return Array.from({length:cap},(_,i)=>(i-(cap-1)/2)*sp);
}
/* ---------------- 설비 형상 빌더 ---------------- */
const MAT = {};
function mat(color, opts){ const k=color+JSON.stringify(opts||{});
  if(!MAT[k]) MAT[k]=new THREE.MeshStandardMaterial(Object.assign({color, roughness:0.62, metalness:0.35}, opts));
  return MAT[k]; }
function bx(w,h,d,color,x,y,z,o){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color,o));
  m.position.set(x||0,y||0,z||0); m.castShadow=true; m.receiveShadow=true; return m; }
function cy(r1,r2,h,color,x,y,z,rot){ const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,20), mat(color));
  m.position.set(x||0,y||0,z||0); if(rot) m.rotation.set(rot[0]||0,rot[1]||0,rot[2]||0); m.castShadow=true; return m; }

function rollerBed(g, len, y){
  const bed = bx(len, 0.5, ND*0.78, COL.dark, 0, y||0.55, 0); g.add(bed);
  for(let i=-Math.floor(len/2)+1; i<len/2; i+=1.5)
    g.add(cy(0.28,0.28,ND*0.72, 0x8b95a5, i, (y||0.55)+0.42, 0, [Math.PI/2,0,0]));
}
function gantry(g, w, h, color){
  g.add(bx(0.7, h, 0.7, COL.body, -w/2, h/2, 0));
  g.add(bx(0.7, h, 0.7, COL.body,  w/2, h/2, 0));
  g.add(bx(w+1.2, 0.8, 1.4, color, 0, h, 0));
}
/* 각 공정별 형상 */
const SHAPE = {
  EdgeMiller(g,c){ rollerBed(g, NW, 0.5);
    g.add(bx(NW*0.5, 1.6, ND*0.95, COL.body, 0, 1.6, 0));
    [-1,1].forEach(s=>g.add(cy(1.0,1.0,0.55,0xb9c2d0, s*NW*0.22, 2.7, 0, [0,0,Math.PI/2])));
    g.add(bx(NW*0.55,0.5,1.2,c,0,3.2,0)); },
  PreBender(g,c){ rollerBed(g,NW,0.5); gantry(g,NW*0.55,3.4,c);
    g.add(bx(NW*0.4,1.0,2.2,COL.body,0,2.4,0)); },
  PressBender(g,c){ rollerBed(g,NW,0.5); gantry(g,NW*0.62,4.0,c);
    g.add(bx(NW*0.5,1.5,2.6,COL.body,0,2.6,0));
    g.add(bx(NW*0.3,0.6,1.6,0xd0d6e0,0,1.9,0)); },
  GapPress(g,c){ rollerBed(g,NW,0.5); gantry(g,NW*0.5,3.6,c);
    [-1,1].forEach(s=>g.add(cy(0.55,0.55,1.8,0xb9c2d0, s*NW*0.3, 1.7, 0)));
    g.add(bx(NW*0.35,1.0,2.0,COL.body,0,2.3,0)); },
  Weld(g,c){ rollerBed(g,NW,0.5); gantry(g,NW*0.5,3.2,c);
    g.add(bx(1.6,1.1,1.6,COL.body,0,2.6,0));
    g.add(cy(0.14,0.06,1.3,0xffd76a,0,1.6,0));
    g.add(cy(0.55,0.55,0.5,0xd0d6e0,-1.6,3.5,0,[0,0,Math.PI/2])); },
  Conveyor(g,c){ rollerBed(g,NW,0.5);
    g.add(cy(0.75,0.75,ND*0.8,c, NW*0.12, 1.5, 0, [Math.PI/2,0,0]));
    g.add(bx(NW*0.3,0.4,ND*0.9,COL.dark,NW*0.12,2.3,0)); },
  Scan(g,c){ rollerBed(g,NW,0.5);
    const t=new THREE.Mesh(new THREE.TorusGeometry(2.1,0.4,10,22), mat(c));
    t.position.set(0,2.1,0); t.rotation.y=Math.PI/2; g.add(t);
    g.add(bx(1.8,2.6,ND*0.7,COL.body,-NW*0.34,1.3,0)); },
  Expander(g,c){ rollerBed(g,NW,0.5);
    g.add(bx(NW*0.72,2.2,ND*1.05,COL.body,0,1.7,0));
    g.add(cy(0.5,0.5,NW*0.9,0xd0d6e0,0,1.9,0,[0,0,Math.PI/2]));   // 드로바
    [-1,1].forEach(s=>g.add(cy(1.35,1.35,1.1,c, s*NW*0.26, 1.9, 0, [0,0,Math.PI/2])));
    g.add(bx(NW*0.8,0.45,1.4,c,0,3.1,0)); },
  Lathe(g,c){ rollerBed(g,NW,0.5);
    g.add(bx(NW*0.3,2.0,ND*0.95,COL.body,-NW*0.28,1.6,0));
    g.add(cy(1.3,1.3,0.9,c,-NW*0.1,1.7,0,[0,0,Math.PI/2]));
    g.add(bx(NW*0.3,2.0,ND*0.95,COL.body, NW*0.28,1.6,0));
    g.add(cy(1.3,1.3,0.9,c, NW*0.1,1.7,0,[0,0,Math.PI/2])); },
  Vessel(g,c){ rollerBed(g,NW,0.5);
    g.add(cy(1.7,1.7,NW*0.7,c,0,2.0,0,[0,0,Math.PI/2]));
    [-1,1].forEach(s=>g.add(cy(1.9,1.9,0.7,COL.body, s*NW*0.38, 2.0, 0, [0,0,Math.PI/2])));
    g.add(bx(1.0,1.6,1.0,COL.dark,0,3.6,0)); },
  Pack(g,c){ rollerBed(g,NW,0.5); gantry(g,NW*0.5,3.0,c);
    for(let i=0;i<3;i++) for(let j=0;j<=i;j++)
      g.add(cy(0.42,0.42,NW*0.55, 0xa9b3c4, (j-i/2)*0.95, 1.35+ (2-i)*0.8, 0, [0,0,Math.PI/2]));
  },
  Buffer(g,c){ g.add(bx(NW*1.05,0.4,ND*1.15,COL.deck,0,0.2,0));
    [-1,1].forEach(s=>{ g.add(bx(0.5,3.2,0.5,COL.body, s*NW*0.46, 1.6, -ND*0.4));
                        g.add(bx(0.5,3.2,0.5,COL.body, s*NW*0.46, 1.6,  ND*0.4)); });
    for(let i=0;i<4;i++) for(let j=0;j<=i;j++)
      g.add(cy(0.4,0.4,NW*0.85, c, (j-i/2)*0.92, 0.85+(3-i)*0.78, 0, [0,0,Math.PI/2]));
  },
  Free(g,c){ g.add(bx(NW*0.9,0.4,ND*0.95,COL.deck,0,0.2,0));
    g.add(bx(NW*0.55,1.8,ND*0.7,COL.body,0,1.3,0));
    g.add(bx(NW*0.35,0.4,1.2,c,0,2.4,0)); },
};
const SHAPE_OF = {
  EdgeMiller:'EdgeMiller', PreBender:'PreBender', PressBender:'PressBender', GapPress:'GapPress',
  TackWelder:'Weld', InsideWelder:'Weld', OutsideWelder:'Weld', OuterBead:'Conveyor',
  FirstUT:'Scan', FinalUT:'Scan', RT:'Scan', Expander:'Expander',
  EndFacing:'Lathe', HydroTest:'Vessel', Packing:'Pack',
};

/* ---------------- 씬 구성 ---------------- */
function buildScene(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e15);
  scene.fog = new THREE.Fog(0x0a0e15, 165, 320);

  camera = new THREE.PerspectiveCamera(46, 1, 0.5, 800);
  const wrap = $('c3d');
  renderer = new THREE.WebGLRenderer({antialias:true, canvas:$('gl')});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.HemisphereLight(0x9ec5ff, 0x0b0f16, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 1.5);
  dl.position.set(40, 90, 30); dl.castShadow=true;
  dl.shadow.mapSize.set(2048,2048);
  const d=95; Object.assign(dl.shadow.camera,{left:-d,right:d,top:d,bottom:-d,near:1,far:260});
  dl.shadow.camera.updateProjectionMatrix();
  scene.add(dl);
  scene.add(new THREE.DirectionalLight(0x6d8cff, 0.45).translateX(-60).translateY(40).translateZ(-50));

  /* 바닥 */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(210,190),
    new THREE.MeshStandardMaterial({color:0x141a24, roughness:0.95, metalness:0.0}));
  floor.rotation.x=-Math.PI/2; floor.position.y=-0.02; floor.receiveShadow=true; scene.add(floor);
  const grid = new THREE.GridHelper(210, 42, 0x2b3444, 0x1c2331);
  grid.position.y=0; scene.add(grid);

  /* 아일(공정 라인) 바닥 띠 */
  for(const a of AISLES){
    const x0=px3(a.c0)-NW*0.5, x1=px3(a.c1)+NW*0.5;
    const w=x1-x0, d=ND+BAY_OFF+BAY_D*0.5+3.4;
    const zc=pz3(a.row)+ (BAY_OFF+BAY_D*0.5-ND*0.5)/2;
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,0.16,d),
      new THREE.MeshStandardMaterial({color:a.color, transparent:true, opacity:0.11, roughness:1}));
    m.position.set((x0+x1)/2, 0.03, zc); scene.add(m);
    const e=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w,0.16,d)),
      new THREE.LineBasicMaterial({color:a.color, transparent:true, opacity:0.5}));
    e.position.copy(m.position); scene.add(e);
    const lb=zoneLabel(a.label, a.cs); lb.position.set(x0+11.6, 0.15, zc-d/2+1.6); scene.add(lb);
    /* 흐름 방향 화살표 (바닥 데칼) */
    for(let i=0;i<Math.floor(w/13);i++){
      const ar=new THREE.Mesh(new THREE.ConeGeometry(0.85,2.4,3),
        new THREE.MeshBasicMaterial({color:a.color, transparent:true, opacity:0.4}));
      ar.rotation.set(-Math.PI/2,0,-Math.PI/2);
      ar.position.set(x0+6+i*13, 0.12, zc+d/2-1.6); scene.add(ar);
    }
  }

  /* 연결선 (튜브 컨베이어) — 3D 좌표에서 직접 라우팅 */
  for(const e of EDGES){
    const curve = routeCurve(e[0], e[1]);
    if(!curve) continue;
    EDGE_CURVE[e[0]+'>'+e[1]] = curve;
    const bypass = /By-pass|재검사|재확관/.test(e[2]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 44, bypass?0.09:0.17, 8, false),
      new THREE.MeshStandardMaterial({color: bypass?0x5a6472:0x7d8899, roughness:0.5, metalness:0.5,
        transparent:bypass, opacity:bypass?0.5:1}));
    tube.castShadow=!bypass; scene.add(tube);
    if(!bypass){
      const n=Math.max(4, Math.floor(curve.getLength()/2.4));
      const rg=new THREE.CylinderGeometry(0.3,0.3,1.5,10), rm=mat(0x59647a);
      const im=new THREE.InstancedMesh(rg, rm, n); const M=new THREE.Matrix4(), q=new THREE.Quaternion();
      for(let i=0;i<n;i++){ const t0=(i+0.5)/n; const p=curve.getPointAt(t0), tg=curve.getTangentAt(t0);
        q.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(-tg.z,0,tg.x).normalize());
        M.compose(new THREE.Vector3(p.x,0.85,p.z), q, new THREE.Vector3(1,1,1)); im.setMatrixAt(i,M); }
      im.castShadow=true; scene.add(im);
    }
    if(e[2]){
      const mid = curve.getPointAt(0.5);
      const sp = labelSprite(e[2],'',Math.min(9, 2.2+e[2].length*0.4));
      sp.position.set(mid.x, 3.4, mid.z); sp.material.opacity=0.9; scene.add(sp);
    }
  }

  /* 노드 */
  for(const n of NODES){
    const g = new THREE.Group();
    const P = nodePos(n.id);
    g.position.set(P.x, 0, P.z);
    let statusMesh=null, lamp=null, units=null, h=3.2;
    if(n.kind==='dec'){
      const oc=new THREE.Mesh(new THREE.OctahedronGeometry(1.9),
        new THREE.MeshStandardMaterial({color:COL.dec, emissive:COL.dec, emissiveIntensity:0.35,
          roughness:0.3, metalness:0.4, transparent:true, opacity:0.9}));
      oc.position.y=2.6; oc.castShadow=true; g.add(oc);
      g.add(bx(2.2,0.25,2.2,COL.deck,0,0.12,0));
      statusMesh=oc; h=4.9;
    } else if(n.kind==='buf'){
      SHAPE.Buffer(g, COL.buf); h=4.6;
    } else {
      const shp = n.free ? 'Free' : (SHAPE_OF[n.st] || 'Free');
      h = shp==='Free'?2.9 : shp==='PressBender'?4.6 : 4.2;
      const cap = n.cap||1;
      units = [];
      const zs = unitZ(n);
      const zsc = cap>2 ? 0.5 : (cap===2 ? 0.78 : 1);
      for(let i=0;i<cap;i++){
        const ug=new THREE.Group(); ug.position.z=zs[i]; ug.scale.z=zsc;
        SHAPE[shp](ug, COL.idle);
        const sm = ug.children.find(c=>c.material && c.material.color && c.material.color.getHex()===COL.idle) || null;
        if(sm) sm.material = sm.material.clone();                        // 캐시 공유 방지
        const lp = new THREE.Mesh(new THREE.SphereGeometry(0.4,14,10),
          new THREE.MeshStandardMaterial({color:COL.idle, emissive:COL.idle, emissiveIntensity:1.2}));
        lp.position.set(NW*0.42, h+0.2, 0); lp.scale.z=1/zsc; ug.add(lp);
        g.add(ug);
        units.push({ g:ug, statusMesh:sm, lamp:lp, z:zs[i] });
        if(cap>1){                                                        // 호기 번호
          const tag = labelSprite(n.id==='EXP' ? ('#'+(i+1)+'호기') : ('#'+(i+1)), '', 3.4);
          tag.position.set(-NW*0.52, 1.9, zs[i]); g.add(tag);
        }
      }
      statusMesh = units[0].statusMesh; lamp = units[0].lamp;
      if(n.bottleneck){
        const r=new THREE.Mesh(new THREE.TorusGeometry(NW*0.66,0.09,8,44),
          new THREE.MeshBasicMaterial({color:0xf05252, transparent:true, opacity:0.7}));
        r.rotation.x=-Math.PI/2; r.position.y=0.1; r.scale.z = (cap>1? (Math.abs(zs[0])*2+ND*zsc)/ (NW*1.32) *1.6 : 1); g.add(r);
      }
    }
    const sp = labelSprite(n.label, n.sub||'', 10.6);
    sp.position.set(0, h+2.3, 0); g.add(sp);
    /* 클릭 판정용 투명 박스 */
    const hit = new THREE.Mesh(new THREE.BoxGeometry(NW*1.05, h+1, ND*1.2),
      new THREE.MeshBasicMaterial({visible:false}));
    hit.position.y=(h+1)/2; hit.userData.node=n; g.add(hit); pickables.push(hit);
    /* ---- 전용 적치장(bay) + 대기량 게이지 ---- */
    let bay=null, gauge=null, gaugeBase=null;
    if(n.kind==='proc' || n.kind==='buf'){
      bay=new THREE.Group(); bay.position.set(0,0,BAY_OFF);
      const pad=new THREE.Mesh(new THREE.BoxGeometry(BAY_W,0.14,BAY_D),
        new THREE.MeshStandardMaterial({color:0x2ea043, transparent:true, opacity:0.16, roughness:1}));
      pad.position.y=0.07; bay.add(pad);
      const ring=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BAY_W,0.14,BAY_D)),
        new THREE.LineBasicMaterial({color:0x2ea043, transparent:true, opacity:0.75}));
      ring.position.y=0.07; bay.add(ring);
      /* 연석 */
      [-1,1].forEach(sd=>{ const c=bx(BAY_W,0.35,0.3,COL.deck,0,0.18,sd*BAY_D/2); bay.add(c); });
      /* 설비와 적치장을 잇는 짧은 연결 표시 */
      bay.add(bx(0.35,0.12,BAY_OFF-BAY_D/2-ND*0.5,0x59647a,0,0.06,-(BAY_OFF-BAY_D/2-ND*0.5)/2 - BAY_D/2));
      /* WIP 게이지 (막대) */
      gaugeBase=new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.9,0.4,12), mat(COL.deck));
      gaugeBase.position.set(-BAY_W/2-1.6, 0.2, 0); bay.add(gaugeBase);
      gauge=new THREE.Mesh(new THREE.BoxGeometry(1.25,1,1.25),
        new THREE.MeshStandardMaterial({color:0x2ea043, emissive:0x2ea043, emissiveIntensity:0.5}));
      gauge.position.set(-BAY_W/2-1.6, 0.4, 0); gauge.scale.y=0.01; bay.add(gauge);
      g.add(bay);
    }
    scene.add(g);
    node3d[n.id]={g, statusMesh, lamp, units, sp, h, badge:null, bay, gauge, bayPad:bay?bay.children[0]:null,
                  bayRing:bay?bay.children[1]:null};
  }

  buildStockMeshes();
  buildYards();
  raycaster = new THREE.Raycaster();
  applyCam();
}

/* ================================================================
   자재(부품) 인스턴스 — 후판 / 성형중(U·O) / 강관
   ================================================================ */
const STOCK = {};
const PL_LEN = NW*0.72;                         // 자재 길이(파이프 축 = X)
function buildStockMeshes(){
  const defs = {
    plate: { geo: new THREE.BoxGeometry(PL_LEN, 0.24, 1.85),            n: 1400, col:0x93a3b8 },
    open:  { geo: (()=>{ const g=new THREE.CylinderGeometry(0.95,0.95,PL_LEN,16,1,true,0,Math.PI);
               g.rotateZ(Math.PI/2); return g; })(),                     n: 500,  col:0xa8b6c6 },
    pipe:  { geo: (()=>{ const g=new THREE.CylinderGeometry(0.62,0.62,PL_LEN,16); g.rotateZ(Math.PI/2); return g; })(),
                                                                          n: 2200, col:0xb6c4d4 },
  };
  for(const k in defs){
    const d=defs[k];
    const m=new THREE.InstancedMesh(d.geo,
      new THREE.MeshStandardMaterial({color:d.col, roughness:0.42, metalness:0.72,
        side: k==='open'?THREE.DoubleSide:THREE.FrontSide}), d.n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow=true; m.receiveShadow=true; m.count=0; m.frustumCulled=false;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(d.n*3), 3);
    scene.add(m); STOCK[k]={mesh:m, used:0, cap:d.n};
  }
}
const _M=new THREE.Matrix4(), _Q=new THREE.Quaternion(), _V=new THREE.Vector3(), _S=new THREE.Vector3(1,1,1), _C=new THREE.Color();
function resetStock(){ for(const k in STOCK) STOCK[k].used=0; }
function putStock(kind,x,y,z,hue,sat,lig,scl){
  const S0=STOCK[kind]; if(!S0||S0.used>=S0.cap) return;
  _V.set(x,y,z); _S.set(scl||1,scl||1,scl||1);
  _M.compose(_V,_Q,_S); S0.mesh.setMatrixAt(S0.used,_M);
  _C.setHSL(hue,sat,lig); S0.mesh.setColorAt(S0.used,_C);
  S0.used++;
}
function flushStock(){
  for(const k in STOCK){ const S0=STOCK[k];
    S0.mesh.count=S0.used; S0.mesh.instanceMatrix.needsUpdate=true;
    if(S0.mesh.instanceColor) S0.mesh.instanceColor.needsUpdate=true; }
}
/* 공정별 자재 형태 */
const STOCK_KIND = {
  EM12:'plate', EM18:'plate', PB12:'plate', PB18:'plate',
  PR12:'open',  PR18:'open',  GAP:'open',   TACK:'open',
};
const kindAt = id => STOCK_KIND[id] || 'pipe';

/* 설비 앞 적치 (대기 자재) — 앞쪽(+Z)으로 쌓임 */
function stackAt(node, n, kind, hue, onSelf){
  if(n<=0) return;
  const o=node3d[node.id]; if(!o) return;
  const ox=o.g.position.x, oz=o.g.position.z + (onSelf ? 0 : BAY_OFF);
  if(kind==='plate'){                       // 후판: 적치장 안에 켜켜이
    const max=Math.min(n, 60);
    for(let i=0;i<max;i++){
      const lay=i%12, row=Math.floor(i/12)%3, blk=Math.floor(i/36);
      putStock('plate', ox+blk*0.4, 0.30+lay*0.26, oz-2.0+row*2.0, hue,0.10,0.58+lay*0.006);
    }
  } else {                                  // 강관: 3단 피라미드 (총량은 게이지가 보완)
    const per=4, lay=3, max=Math.min(n, per*lay);
    for(let i=0;i<max;i++){
      const L=Math.floor(i/per), c=i%per;
      putStock(kind, ox, 0.70+L*1.02, oz + (c-(per-1)/2)*1.36 + (L%2)*0.68, hue,0.11,0.60);
    }
  }
}

/* 설비 위에서 가공 중인 자재 (진행률에 따라 이동) */
function onMachine(node, frac, kind, hue, slot, cap){
  const o=node3d[node.id], g=o.g;
  const uz = (o.units && o.units[slot]) ? o.units[slot].z : 0;
  const zsc = (o.units && o.units[slot]) ? (o.units[slot].g.scale.z||1) : 1;
  putStock(kind, g.position.x + (frac-0.5)*NW*0.55, 1.42, g.position.z + uz, hue,0.42,0.72, 1.12);
}

/* ================================================================
   원자재 야드 / 완제품 야드
   ================================================================ */
const YARD = { raw:{x:0,z:0}, fin:{x:0,z:0} };
function buildYards(){
  const mkAt=(X,Z,label,col)=>{
    const p={x:X, z:Z};
    const pad=new THREE.Mesh(new THREE.BoxGeometry(18,0.18,16),
      new THREE.MeshStandardMaterial({color:col, transparent:true, opacity:0.16, roughness:1}));
    pad.position.set(p.x,0.05,p.z); scene.add(pad);
    const ed=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(18,0.18,16)),
      new THREE.LineBasicMaterial({color:col, transparent:true, opacity:0.6}));
    ed.position.copy(pad.position); scene.add(ed);
    const sp=labelSprite(label,'',9.2); sp.position.set(p.x, 7.4, p.z); scene.add(sp);
    return p;
  };
  YARD.raw = mkAt(px3(-1.45), pz3(0), '원자재 야드\n(후판)', 0x6b7684);
  YARD.fin = mkAt(px3(6.9), pz3(5), '완제품 야드\n(출하 대기)', 0x2ea043);
}
function drawYard(pos, count, kind, hue){
  if(count<=0) return 1;
  /* 패드 18×16 안에 들어가는 최대 글리프 수 */
  const capG = kind==='plate' ? (16*4*2) : (6*8*2);
  const unit = Math.max(1, Math.ceil(count/capG));
  const g = Math.min(capG, Math.ceil(count/unit));
  for(let i=0;i<g;i++){
    if(kind==='plate'){
      const lay=i%16, row=Math.floor(i/16)%4, blk=Math.floor(i/64);
      putStock('plate', pos.x-3.9+blk*7.8, 0.32+lay*0.26, pos.z-3.4+row*2.25, hue,0.09,0.56+lay*0.006);
    } else {
      const L=Math.floor(i/6)%8, c=i%6, blk=Math.floor(i/48);
      putStock('pipe', pos.x-3.9+blk*7.8, 0.72+L*1.04,
        pos.z-3.4+(c-2.5)*1.34+(L%2)*0.67, hue,0.10,0.60);
    }
  }
  return unit;
}

/* --------------------------------------------------------------------
   3D 경로 라우팅 — 같은 행이면 직선, 행이 다르면 앞으로 빠졌다가 이동
   -------------------------------------------------------------------- */
function routeCurve(a, b){
  const A=NODE[a], B=NODE[b]; if(!A||!B) return null;
  const pa=nodePos(a), pb=nodePos(b);
  const half=id => (NODE[id] && NODE[id].kind==='dec') ? 3.0 : NW*0.5;
  const y=1.15, v=[];
  const sameRow = Math.abs(pa.z-pb.z) < 1;
  if(sameRow){
    const dir = pb.x>pa.x ? 1 : -1;
    v.push(new THREE.Vector3(pa.x+dir*half(a), y, pa.z));
    v.push(new THREE.Vector3(pb.x-dir*half(b), y, pb.z));
  } else {
    /* 앞쪽 통로(적치장 뒤)를 지나 이동 */
    const lane = Math.max(pa.z, pb.z) - ROW_DZ*0.42;
    const dir = pb.x>=pa.x ? 1 : -1;
    v.push(new THREE.Vector3(pa.x, y, pa.z + (pb.z>pa.z ? ND*0.5 : -ND*0.5)));
    v.push(new THREE.Vector3(pa.x, y, lane));
    v.push(new THREE.Vector3(pb.x, y, lane));
    v.push(new THREE.Vector3(pb.x, y, pb.z + (pb.z>pa.z ? -ND*0.5 : ND*0.5)));
  }
  return new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0.06);
}
/* 라우팅(분기·버퍼 경유) 논리 경로 → 커브 */
function buildLogicalCurves(){
  const adj={}; for(const e of EDGES) (adj[e[0]]=adj[e[0]]||[]).push(e[1]);
  const procIds = NODES.filter(n=>n.kind==='proc').map(n=>n.id);
  for(const a of procIds) for(const b of procIds){
    const key=a+'>'+b; if(a===b||EDGE_CURVE[key]) continue;
    const q=[[a,[]]], seen=new Set([a]); let found=null;
    while(q.length && !found){
      const [cur,path]=q.shift(); if(path.length>4) continue;
      for(const nx of (adj[cur]||[])){
        const np=path.concat([nx]);
        if(nx===b){ found=np; break; }
        const nn=NODE[nx];
        if(nn&&(nn.kind==='dec'||nn.kind==='buf')&&!seen.has(nx)){ seen.add(nx); q.push([nx,np]); }
      }
    }
    if(!found) continue;
    let pts=[]; let prev=a;
    for(const nx of found){
      const c=EDGE_CURVE[prev+'>'+nx] || routeCurve(prev,nx);
      if(c){ const g=c.getPoints(10); pts = pts.concat(pts.length?g.slice(1):g); }
      prev=nx;
    }
    if(pts.length<2) continue;
    EDGE_CURVE[key]=new THREE.CatmullRomCurve3(pts,false,'catmullrom',0.06);
  }
}

/* ---------------- 시뮬레이션 연동 ---------------- */
let PLAN3 = null, SEED = 1, LOOP = false, seeking = false;
function readCfg(){ return {
  startDate: ($('cfgStart')&&$('cfgStart').value) || (ORDERS[0]&&ORDERS[0].start?ORDERS[0].start.slice(0,10):'2026-03-02'),
  deadline: ($('cfgDeadline')&&$('cfgDeadline').value) || null,
  dateMode: ($('cfgDateMode')||{}).value || 'plan',
  seqGapH: +(($('cfgSeqGap')||{}).value || 6),
  shifts:+$('cfgShifts').value, netHoursPerShift:7.5,
  skipWeekend:false, useRB:$('cfgRB').checked, useCP:false, processingFinalUT:false,
  holdSec:60, changeover:$('cfgCO').checked, freeStationSec:300, eventCap:1e9,
  dispatchRule: ($('cfgRule')||{}).value || 'EAT', sameODConcurrency:true, useM3:false,
  seed: SEED, stochastic: { on: $('stOn') ? $('stOn').checked : false, mtbfH: 200 },
  applyOptSeq:true, plan:PLAN3 }; }
const CO_BACKUP = JSON.stringify(CHANGEOVER);
function runSim(){
  CFG=readCfg();
  if(CFG.dispatchRule==='OPT' && !PLAN3){ PLAN3=optimizeExpander(ORDERS, CFG, {iters:24000}); CFG.plan=PLAN3; }
  if(!CFG.changeover) for(const k in CHANGEOVER) CHANGEOVER[k]={od:0,t:0,L:0};
  else Object.assign(CHANGEOVER, JSON.parse(CO_BACKUP));
  SIM = simulate(ORDERS, CFG);
  SIM.events.sort((a,b)=>a.s-b.s);
  SIM.byR = SIM.events.slice().sort((a,b)=>a.r-b.r);
  animT=SIM.t0; evIdx=0; completed=0; started=0; logs.length=0;
  if($('seek')) $('seek').value=0;
  for(const n of NODES) nodeState[n.id]={active:[],q:0,done:0};
  $('simInfo').textContent = `${ORDERS.length}오더 / ${ORDERS.reduce((a,o)=>a+o.qty,0).toLocaleString()}본 · `
    + `${fmtT(SIM.t0)} → ${fmtT(SIM.tEnd)} (${(SIM.horizonH/24).toFixed(1)}일) · 확관 전환 ${SIM.kpi.expSetupH.toFixed(1)}h`
    + (PLAN_SRC ? ` · ${PLAN_SRC}` : '')
    + (SIM.kpi.stochOn ? ` · 변동 seed ${SIM.kpi.seed} · 재작업 ${SIM.kpi.rework}본` : '')
    + (SIM.kpi.deadline ? ` · 마감 달성 ${(SIM.kpi.doneInPeriod/Math.max(1,SIM.kpi.doneInPeriod+SIM.kpi.overflow)*100).toFixed(0)}%` : '');
  if($('periodHint')){
    const k=SIM.kpi;
    $('periodHint').innerHTML = `실제 소요 <b>${fmtT(SIM.t0)} → ${fmtT(SIM.tEnd)}</b> (${(SIM.horizonH/24).toFixed(1)}일)`
      + (k.deadline ? ` · 마감일까지 <b>${k.doneInPeriod.toLocaleString()}본</b> 완료, <b>${k.overflow.toLocaleString()}본</b> 이월` : '');
  }
  buildStat(); updateStat(); refreshVisual();
}
const _oc={};
function orderHue(no){ if(_oc[no]===undefined) _oc[no]=(Object.keys(_oc).length*53)%360; return _oc[no]; }

function step(dt){
  if(!SIM) return;
  animT += dt*speed;
  if(animT>SIM.tEnd){ if(LOOP){ seekTo(SIM.t0); return; } animT=SIM.tEnd; playing=false; $('btnPlay').textContent='▶'; }
  const ev=SIM.events;
  for(const n of NODES){ const s=nodeState[n.id]; s.active=[]; s.q=0; }
  let lo=0,hi=ev.length-1,st=ev.length;
  while(lo<=hi){ const m=(lo+hi)>>1; if(ev[m].s>=animT-864000){st=m;hi=m-1;} else lo=m+1; }
  for(let i=Math.max(0,st-4000);i<ev.length && ev[i].cs<=animT;i++){
    const e=ev[i];
    if(e.e>animT){
      nodeState[e.n].active.push({u:e.u, setup:animT<e.s, o:e.o, s:e.s, e2:e.e, both:e.both});
      if(e.both) nodeState[e.n].active.push({u:e.u===0?1:0, setup:animT<e.s, o:e.o, s:e.s, e2:e.e, both:true, mirror:true});
    }
  }
  /* 대기 자재 집계 */
  const bR=SIM.byR; let l2=0,h2=bR.length-1,iR=bR.length;
  while(l2<=h2){ const m=(l2+h2)>>1; if(bR[m].r>animT){iR=m;h2=m-1;} else l2=m+1; }
  _qHue={};
  for(let i=iR-1;i>=0 && i>iR-12000;i--){
    const e=bR[i]; if(e.cs<=animT) continue;
    nodeState[e.n].q++;
    if(_qHue[e.n]===undefined) _qHue[e.n]=orderHue(e.o)/360;
  }

  while(evIdx<ev.length && ev[evIdx].s<=animT){
    const e=ev[evIdx]; nodeState[e.n].done++;
    if(e.n==='EM12'||e.n==='EM18') started++;
    if(e.n==='PACK') completed++;
    if(logs.length<200){
      if(e.co>0) logs.unshift(`${fmtT(e.cs)}  ⚙ 설비 전환 ${NODE[e.n].label.replace('\n',' ')} ${(e.co/60).toFixed(0)}분 → 오더 ${e.o}`);
      else if(e.n==='PACK'&&e.k%10===0) logs.unshift(`${fmtT(e.s)}  ✔ 포장 완료 오더 ${e.o} #${e.k}`);
      else if(e.n==='EXP'&&e.k%25===0) logs.unshift(`${fmtT(e.s)}  ▸ 확관 #${e.u+1}호기 착수 오더 ${e.o} #${e.k}`);
    }
    evIdx++;
  }
  $('simClock').textContent=fmtT(animT);
  $('doneCnt').textContent=completed.toLocaleString();
  if(!seeking&&$('seek')) $('seek').value=Math.round((animT-SIM.t0)/Math.max(1,SIM.tEnd-SIM.t0)*1000);
  $('logBody').innerHTML=logs.slice(0,40).map(l=>`<div class="lg">${l}</div>`).join('');
  updateStat(); refreshVisual();
}
function offShift(){ if(!SIM) return false;
  const d=new Date(animT*1000), h=d.getHours()+d.getMinutes()/60;
  return !SIM.cal.wins.some(w=>h>=w[0]&&h<w[1]); }
function bayColor(q){ return q>=15?0xf05252 : q>=6?0xe3b341 : q>0?0x2b7fff : 0x2ea043; }
function updateBays(){
  for(const n of NODES){
    const o=node3d[n.id]; if(!o||!o.bay) continue;
    const st=nodeState[n.id]||{q:0};
    let q=st.q;
    if(n.id==='EXP'||n.id==='RB') q=Math.min(q, AT_MACHINE_Q);
    const c=bayColor(q);
    if(o.bayPad){ o.bayPad.material.color.setHex(c); o.bayPad.material.opacity = q?0.26:0.14; }
    if(o.bayRing){ o.bayRing.material.color.setHex(c); o.bayRing.material.opacity = q?0.95:0.6; }
    if(o.gauge){
      const hh = Math.max(0.02, Math.min(1, q/25)) * 11;
      o.gauge.scale.y = hh; o.gauge.position.y = 0.4 + hh/2;
      o.gauge.material.color.setHex(c); o.gauge.material.emissive.setHex(c);
      o.gauge.material.emissiveIntensity = q?0.9:0.25;
    }
  }
}
function refreshVisual(){
  const off=offShift();
  drawStock();
  updateBays();
  for(const n of NODES){
    const o=node3d[n.id], s=nodeState[n.id]||{active:[],q:0};
    if(!o||n.kind==='dec'||n.kind==='buf'||!o.units) continue;
    const busy = s.q>=8;
    o.units.forEach((U,i)=>{
      const a = s.active.find(x=>x.u===i);
      let c = a ? (a.setup?COL.setup:COL.proc) : (busy?COL.bneck : (off?COL.off:COL.idle));
      const zs = 1/(U.g.scale.z||1);
      if(U.lamp){ U.lamp.material.color.setHex(c); U.lamp.material.emissive.setHex(c);
        U.lamp.material.emissiveIntensity = a?1.9:0.75;
        U.lamp.scale.set(a?1.35:1, a?1.35:1, (a?1.35:1)*zs); }
      if(U.statusMesh && U.statusMesh.material){
        U.statusMesh.material.color.setHex(c);
        if(U.statusMesh.material.emissive){ U.statusMesh.material.emissive.setHex(c);
          U.statusMesh.material.emissiveIntensity = a?0.55:0.12; }
      }
    });
  }
}

/* ---------------- 자재 렌더링 & 배지 ---------------- */
const AT_MACHINE_Q = 8;                 // 설비 앞에 직접 쌓아 보여줄 최대 수
function drawStock(){
  if(!SIM) return;
  resetStock();
  let bufN = 0, bufHue = 0.35;
  for(const n of NODES){
    if(n.kind!=='proc') continue;
    const st=nodeState[n.id]; if(!st) continue;
    const kind=kindAt(n.id), hue=(qHueOf(n.id));
    /* 확관 대기분은 10번 문(Buffer)에 적치 */
    let q=st.q;
    if(n.id==='EXP'||n.id==='RB'){ const over=Math.max(0,q-AT_MACHINE_Q); bufN+=over; bufHue=hue; q-=over; }
    stackAt(n, q, kind, hue);
    /* 설비 위 가공 중 자재 */
    const cap=n.cap||1;
    st.active.forEach((a)=>{
      const fr = a.setup ? 0 : Math.max(0, Math.min(1,(animT-a.s)/Math.max(1,a.e2-a.s)));
      onMachine(n, fr, kind, orderHue(a.o)/360, a.u, cap);
    });
  }
  /* Buffer 랙 */
  if(bufN>0){ const b=NODE['BUF']; stackAt(b, bufN, 'pipe', bufHue, true); }
  nodeState['BUF'].q = bufN;
  /* 야드 */
  const total=ORDERS.reduce((a,o)=>a+o.qty,0);
  YARD.rawUnit = drawYard(YARD.raw, Math.max(0,total-started), 'plate', 0.58);
  YARD.finUnit = drawYard(YARD.fin, completed, 'pipe', 0.33);
  flushStock();
  updateBadges();
}
let _qHue={};
function qHueOf(id){ return _qHue[id]!==undefined?_qHue[id]:0.35; }

/* HTML 배지 오버레이 (대기 수량 / 야드 재고) */
const badgeEls={};
function initBadges(){
  const box=$('badges');
  const add=(k,cls)=>{ const d=document.createElement('div'); d.className='bdg '+(cls||''); box.appendChild(d); badgeEls[k]=d; };
  for(const n of NODES) if(n.kind==='proc'||n.kind==='buf') add(n.id);
  add('__raw','yard'); add('__fin','yard fin');
}
const _pv=new THREE.Vector3();
function project(x,y,z){
  _pv.set(x,y,z).project(camera);
  const w=renderer.domElement.clientWidth, h=renderer.domElement.clientHeight;
  return {x:(_pv.x*0.5+0.5)*w, y:(-_pv.y*0.5+0.5)*h, vis:_pv.z<1};
}
function setBadge(k, x,y,z, txt, cls){
  const d=badgeEls[k]; if(!d) return;
  if(!txt){ d.style.display='none'; return; }
  const p=project(x,y,z);
  if(!p.vis){ d.style.display='none'; return; }
  const W=renderer.domElement.clientWidth, H=renderer.domElement.clientHeight;
  d.style.display='block';
  d.style.left=Math.max(56, Math.min(W-56, p.x))+'px';
  d.style.top=Math.max(12, Math.min(H-12, p.y))+'px';
  d.textContent=txt; d.className='bdg '+(cls||'');
}
function updateBadges(){
  for(const n of NODES){
    if(n.kind!=='proc'&&n.kind!=='buf') continue;
    const st=nodeState[n.id]||{q:0}; const g=node3d[n.id].g;
    let q=st.q;
    if(n.id==='EXP'||n.id==='RB') q=Math.min(q, AT_MACHINE_Q);
    const lbl = n.kind==='buf' ? (q>0?('적재 '+q+'본'):'') : (q>0?('대기 '+q):'');
    setBadge(n.id, g.position.x, 1.4, g.position.z+BAY_OFF+BAY_D/2+1.6, lbl,
      n.kind==='buf' ? 'buf' : (q>=15?'hot':q>=6?'warm':''));
  }
  const total=ORDERS.reduce((a,o)=>a+o.qty,0);
  const ru=YARD.rawUnit||1, fu=YARD.finUnit||1;
  setBadge('__raw', YARD.raw.x, 0.4, YARD.raw.z+9.4,
    `후판 재고 ${(total-started).toLocaleString()}매` + (ru>1?`  (1단 = ${ru}매)`:''), 'yard');
  setBadge('__fin', YARD.fin.x, 0.4, YARD.fin.z+9.4,
    `출하 대기 ${completed.toLocaleString()}본` + (fu>1?`  (1단 = ${fu}본)`:''), 'yard fin');
}

/* ---------------- 사이드 패널 ---------------- */
function statsByFlow(){ const o=NODES.map(n=>n.id);
  return SIM.stats.slice().sort((a,b)=>o.indexOf(a.id)-o.indexOf(b.id)); }
function buildStat(){
  $('statBars').innerHTML = statsByFlow().map(s=>`<div class="sr"><span class="sn">${s.label.replace('\n',' ')}</span>
    <div class="sb"><div class="sf" id="sf_${s.id}"></div><span class="sv" id="sv_${s.id}">0%</span></div>
    <span class="sc">×${s.cap}</span></div>`).join('');
}
function updateStat(){
  if(!SIM) return;
  const useOverall = animT<=SIM.t0+1;
  const win=Math.max(3600, Math.min(86400*3, animT-SIM.t0));
  const busy={};
  if(!useOverall){ const ev=SIM.events;
    let lo=0,hi=ev.length-1,st=ev.length;
    while(lo<=hi){const m=(lo+hi)>>1; if(ev[m].e>=animT-win){st=m;hi=m-1;} else lo=m+1;}
    for(let i=Math.max(0,st-2000);i<ev.length&&ev[i].s<=animT;i++){
      const e=ev[i], a=Math.max(e.s,animT-win), b=Math.min(e.e,animT);
      if(b>a) busy[e.n]=(busy[e.n]||0)+(b-a); } }
  for(const s of SIM.stats){
    const el=$('sf_'+s.id); if(!el) continue;
    const u = useOverall ? Math.min(100,s.util)
      : Math.min(100,(busy[s.id]||0)/(win*s.cap*(SIM.cal.dayCap/86400))*100);
    el.style.width=u.toFixed(0)+'%';
    el.style.background = u>=85?'#f05252':u>=60?'#e3b341':'#2ea043';
    $('sv_'+s.id).textContent=u.toFixed(0)+'%';
  }
  if(useOverall) $('simClock').textContent=fmtT(SIM.t0);
}

/* ---------------- 클릭 → 설비 정보 ---------------- */
function pick(mx,my){
  const r=renderer.domElement.getBoundingClientRect();
  const v=new THREE.Vector2(((mx-r.left)/r.width)*2-1, -((my-r.top)/r.height)*2+1);
  raycaster.setFromCamera(v, camera);
  const hit=raycaster.intersectObjects(pickables,false)[0];
  selected = hit ? hit.object.userData.node : null;
  showInfo();
}
function showInfo(){
  const p=$('infoPanel');
  if(!selected){ p.classList.remove('on'); return; }
  const n=selected, st=SIM&&SIM.stats.find(x=>x.id===n.id), s=nodeState[n.id]||{q:0,done:0,active:[]};
  let html=`<h4>${n.label.replace('\n',' ')}<button id="infoX">✕</button></h4>`;
  if(n.sub) html+=`<div class="isub">${n.sub}</div>`;
  if(st){
    html+=`<div class="ir"><span>설비 대수</span><b>${st.cap}대</b></div>
      <div class="ir"><span>누적 처리</span><b>${st.jobs.toLocaleString()}본</b></div>
      <div class="ir"><span>가공 시간</span><b>${st.busyH.toFixed(1)}h</b></div>
      <div class="ir"><span>설비 전환</span><b>${st.setupH.toFixed(1)}h (${(st.setupH/(st.busyH+st.setupH)*100||0).toFixed(1)}%)</b></div>
      <div class="ir"><span>전체 가동률</span><b>${st.util.toFixed(1)}%</b></div>
      <div class="ir"><span>현재 가동 / 대기</span><b>${s.active.length} / ${s.q}</b></div>`;
    if(st.units.length>1) html+=st.units.map((u,i)=>`<div class="ir sm"><span>${n.id==='EXP'?('확관 #'+(i+1)+'호기'):u.id}</span><b>${u.jobs}본 · ${u.busyH.toFixed(1)}h</b></div>`).join('');
    if(n.id==='EXP'){
      html+=`<div class="ir"><span>배분 규칙</span><b>${DISPATCH_RULES[CFG.dispatchRule].label}</b></div>`;
      html+=`<div class="ifx"><b>공정 제약</b><br>#1호기 14m 이상 불가 · #2호기 12.8m 이상 불가<br>
        <span>12.8~14m → #1호기 전용 · 14m 초과 → #1·#2 동시 가동(소요=max)</span></div>`;
    }
    if(n.st){
      const A={od:914,t:9.3,L:12802,qty:70,grade:'normal',api5l:true,markSpec:2,markEnd:2,defects:0,holdSec:60,rtType:'450kV'};
      const r = n.st==='Expander' ? STD.Expander(A, n.machine||'M2') : STD[n.st](A,'12M',1);
      html+=`<div class="ifx"><b>표준시간 산출식</b><br>${r.expr}<br><span>기준 OD914×t9.3×12.8m → ${r.sec.toFixed(1)}s</span></div>`;
    }
  } else if(n.kind==='dec') html+=`<div class="ifx">분기 조건 (Decision Node)</div>`;
  else if(n.kind==='buf') html+=`<div class="ifx">버퍼 · 최대 4,000톤 적재</div>`;
  else html+=`<div class="ifx">표준시간 측정 대상 외 공정</div>`;
  p.innerHTML=html; p.classList.add('on');
  $('infoX').onclick=()=>{ selected=null; p.classList.remove('on'); };
}

/* ---------------- 재생 컨트롤 ---------------- */
function seekTo(t){
  if(!SIM) return;
  animT=Math.max(SIM.t0,Math.min(SIM.tEnd,t));
  evIdx=0; completed=0; started=0; logs.length=0;
  for(const n of NODES) nodeState[n.id]={active:[],q:0,done:0};
  const ev=SIM.events;
  while(evIdx<ev.length && ev[evIdx].s<=animT){
    const e=ev[evIdx];
    nodeState[e.n].done++;
    if(e.n==='EM12'||e.n==='EM18') started++;
    if(e.n==='PACK') completed++;
    evIdx++;
  }
  step(0);
}

/* ---------------- 계획서 로더 ---------------- */
let PLAN_SRC = null;
function applyOrders(list, srcLabel){
  ORDERS = list; PLAN3 = null; PLAN_SRC = srcLabel || null;
  Object.keys(_oc).forEach(k=>delete _oc[k]);
  if($('cfgRule').value==='OPT') $('cfgRule').value='EAT';
  runSim();
  $('planModal').classList.remove('on');
}
function initPlanLoader(){
  const el=$('planLoader'); if(!el||typeof PlanLoader==='undefined') return;
  PlanLoader.mount(el, {
    startDate:'2026-03-02',
    onApply:list=>{ if(list[0]&&list[0].start) $('cfgStart').value=list[0].start.slice(0,10);
                    applyOrders(list,'업로드 계획서'); },
    onReset:()=>applyOrders(ORDERS_DEFAULT.slice(), null),
  });
  $('btnPlan').onclick=()=>$('planModal').classList.add('on');
  $('pmClose').onclick=()=>$('planModal').classList.remove('on');
}

/* ---------------- 루프 & 부트 ---------------- */
function resize(){
  const w=$('c3d').clientWidth, h=$('c3d').clientHeight;
  renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
}
let last=null;
function loop(ts){
  if(last==null) last=ts; const dt=(ts-last)/1000; last=ts;
  if(playing) step(Math.min(dt,0.1)); else if(SIM) updateBadges();
  renderer.render(scene,camera);
  requestAnimationFrame(loop);
}
function boot(){
  buildScene(); buildLogicalCurves(); initBadges(); initControls(renderer.domElement);
  resize(); window.addEventListener('resize', resize);
  renderer.domElement.addEventListener('click', e=>pick(e.clientX,e.clientY));
  $('btnPlay').onclick=()=>{ playing=!playing; $('btnPlay').textContent=playing?'❚❚':'▶'; };
  $('btnReset').onclick=()=>{ animT=SIM.t0; evIdx=0; completed=0; started=0; logs.length=0;
    for(const n of NODES) nodeState[n.id]={active:[],q:0,done:0};
    updateStat(); refreshVisual(); };
  $('spd').oninput=e=>{ speed=[600,3600,18000,86400,259200][+e.target.value];
    $('spdL').textContent=['10분/s','1시간/s','5시간/s','1일/s','3일/s'][+e.target.value]; };
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>goView(b.dataset.view));
  $('cfgRule').innerHTML=Object.entries(DISPATCH_RULES).map(([k,v])=>
    `<option value="${k}">${v.label.replace(/\s*\(.*\)/,'')}</option>`).join('');
  $('cfgShifts').onchange=runSim; $('cfgRB').onchange=runSim; $('cfgCO').onchange=runSim;
  $('cfgRule').onchange=runSim;
  $('stOn').onchange=runSim;
  $('seek').oninput=e=>{ seeking=true; seekTo(SIM.t0+(SIM.tEnd-SIM.t0)*(+e.target.value/1000)); seeking=false; };
  $('loopChk').onchange=e=>LOOP=e.target.checked;
  $('btnDice').onclick=()=>{ SEED=Math.floor(Math.random()*2147483646)+1; runSim(); };
  const updGap=()=>{ $('fGap').style.display = $('cfgDateMode').value==='seq'?'flex':'none'; };
  $('cfgDateMode').onchange=()=>{ updGap(); runSim(); }; updGap();
  ['cfgStart','cfgDeadline','cfgSeqGap'].forEach(id=>$(id).onchange=runSim);
  $('btnPeriod').onclick=()=>{ runSim(); $('planModal').classList.remove('on'); };
  initPlanLoader();
  runSim(); requestAnimationFrame(loop);
}
