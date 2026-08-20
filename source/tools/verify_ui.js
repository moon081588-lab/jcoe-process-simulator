const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');   // 저장소 루트 — HTML 이 여기에 있습니다
(async () => {
  const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
  let fail=0;
  // ---- 2D ----
  const p = await b.newPage({viewport:{width:1680,height:980}});
  const e2=[]; p.on('pageerror',e=>e2.push(''+e)); p.on('console',m=>{if(m.type()==='error')e2.push(m.text());});
  await p.goto('file://'+path.join(ROOT,'JCOE_Simulator.html'),{waitUntil:'load'});
  await p.waitForTimeout(2200);
  /* 「분석 ▾」 드롭다운 안의 탭은 숨어 있으므로 goTab() 으로 연다 (2026-08-14 탭 재구성) */
  for (const t of ['pWiz','pFlow','pCalc','pIO','pOpt','pGantt','pBn','pCfg']) {
    await p.evaluate(id => goTab(id), t); await p.waitForTimeout(350);
  }
  await p.evaluate(() => goTab('pOpt')); await p.waitForTimeout(400);
  console.log('제약 요약:', (await p.textContent('#eligWarn')).trim().replace(/\s+/g,' ').slice(0,150));
  // 확관 3호기 = R/B 라인으로 확정되어 별도 설비 토글은 제거됨 (2026-08-06)
  await p.selectOption('#optRbMode','capable'); await p.waitForTimeout(1200);
  console.log('  R/B 적격 전량 투입:', await p.evaluate(()=>{
    const g=id=>{const x=SIM.stats.find(y=>y.id===id);return x?x.jobs:0;};
    return `RB ${g('RB')}본 · R/B면취 ${g('RBEF')} · R/B RT ${g('RBRT')} · 배척포장 ${g('PACKRB')} · JCOE포장 ${g('PACK')}`; }));
  await p.selectOption('#optRbMode','force'); await p.waitForTimeout(1200);
  await p.uncheck('#optSameOD'); await p.waitForTimeout(900);
  console.log('  동일외경 제약 해제 확관전환:', await p.evaluate(()=>SIM.kpi.expSetupH.toFixed(1)+'h'));
  await p.check('#optSameOD'); await p.waitForTimeout(900);
  // 규칙별 적용
  for (const r of ['SETUP','SPEC','RR','EAT']) {
    await p.selectOption('#optRule', r); await p.click('#btnApplyRule'); await p.waitForTimeout(700);
    const k = await p.evaluate(()=>({rule:SIM.rule, exp:SIM.kpi.expSetupH, mk:SIM.kpi.makespanH}));
    console.log('  rule', k.rule, 'expSetup', k.exp.toFixed(1)+'h', 'makespan', (k.mk/24).toFixed(1)+'일');
  }
  await p.click('#btnOpt'); await p.waitForTimeout(1600);
  console.log('  OPT', await p.evaluate(()=>SIM.kpi.expSetupH.toFixed(1)+'h / '+(SIM.kpi.makespanH/24).toFixed(1)+'일'));
  await p.click('#btnCmp'); await p.waitForTimeout(2500);
  const cmpRows = await p.evaluate(()=>document.querySelectorAll('#cmpBody tr').length);
  console.log('  비교표 행수', cmpRows);
  // IO 탭: 호기 필터
  await p.evaluate(() => goTab('pIO')); await p.waitForTimeout(400);
  await p.selectOption('#ioStation','EXP|1'); await p.selectOption('#ioUnit','pipe'); await p.waitForTimeout(700);
  const ioRows = await p.evaluate(()=>({n:IO_ROWS.length, allM2:IO_ROWS.every(r=>r.u===1&&r.st==='EXP')}));
  console.log('  IO 확관#2호기 행수', ioRows.n, '필터정확', ioRows.allM2);
  // CSV
  const csvOk = await p.evaluate(()=>{ try{ ioCsv(); return true; }catch(e){ return String(e); } });
  console.log('  CSV', csvOk);
  // ---- 계획 실행 위저드 (원클릭) ----
  await p.evaluate(() => goTab('pWiz')); await p.waitForTimeout(500);
  console.log('  위저드 단계:', (await p.textContent('#wizSteps')).replace(/\s+/g,' ').trim().slice(0,200));
  await p.click('#wizRunAll'); await p.waitForTimeout(2500);
  console.log('  원클릭 후 규칙:', await p.evaluate(()=>({rule:document.getElementById('optRule').value, plan:!!PLAN,
      mk:(SIM.kpi.makespanH/24).toFixed(1)+'일', exp:SIM.kpi.expSetupH.toFixed(1)+'h'})));
  console.log('  위저드 결과 KPI:', (await p.textContent('#wizSimSum')).replace(/\s+/g,' ').trim().slice(0,160));
  console.log('  최적화 KPI 렌더:', (await p.textContent('#wizOptSum')).replace(/\s+/g,' ').trim().slice(0,120));
  console.log('  전후 비교:', (await p.textContent('#wizDelta')).replace(/\s+/g,' ').trim().slice(0,180));
  await p.screenshot({path:'/tmp/v_wiz.png', fullPage:false});
  // 기본 제약 기준이 운영 모델(정본)인지
  console.log('  기본 제약/N:', await p.evaluate(()=>({rs:document.getElementById('optRuleSet').value,
      n:document.getElementById('cfgExpN').value})));
  console.log('2D errors:', e2.slice(0,6)); if(e2.length) fail++;
  await p.evaluate(() => goTab('pFlow')); await p.waitForTimeout(400);
  /* 화면 이동·확대 — 2026-08-14 이전에는 draw() 가 매 프레임 fit() 을 불러
     끌어도 즉시 원위치라 시점이 완전히 고정돼 있었다. */
  await p.evaluate(() => goTab('pFlow')); await p.waitForTimeout(400);
  const cvb = await p.$eval('#cv', e => { const r = e.getBoundingClientRect();
    return { x:r.x, y:r.y, w:r.width, h:r.height }; });
  await p.mouse.move(cvb.x + cvb.w*0.4, cvb.y + cvb.h*0.4); await p.mouse.down();
  await p.mouse.move(cvb.x + cvb.w*0.6, cvb.y + cvb.h*0.6, { steps:6 }); await p.mouse.up();
  await p.waitForTimeout(250);
  const panned = await p.evaluate(() => ({ dx: Math.round(VIEW.dx), dy: Math.round(VIEW.dy) }));
  console.log('2D 끌어서 이동:', JSON.stringify(panned));
  if (!(panned.dx > 20 && panned.dy > 20)) { console.log('  FAIL: 2D 화면이 끌리지 않는다'); fail++; }
  await p.mouse.move(cvb.x + cvb.w*0.4, cvb.y + cvb.h*0.4);
  await p.mouse.wheel(0, -400); await p.waitForTimeout(250);
  const zoomed = await p.evaluate(() => +VIEW.z.toFixed(2));
  console.log('2D 휠 확대:', zoomed);
  if (!(zoomed > 1.05)) { console.log('  FAIL: 2D 휠 확대가 안 된다'); fail++; }
  await p.evaluate(() => viewReset());
  const reset = await p.evaluate(() => VIEW.z === 1 && !VIEW.dx && !VIEW.dy);
  if (!reset) { console.log('  FAIL: 2D 원위치가 안 된다'); fail++; }

  await p.screenshot({path:'/tmp/v_2d.png'});
  await p.close();
  // ---- 3D 공장 탭 (2026-08-14 부터 같은 파일 안에 있다) ----
  const q = await b.newPage({viewport:{width:1680,height:960}});
  const e3=[]; q.on('pageerror',e=>e3.push(''+e)); q.on('console',m=>{if(m.type()==='error')e3.push(m.text());});
  await q.goto('file://'+path.join(ROOT,'JCOE_Simulator.html'),{waitUntil:'load'});
  await q.waitForTimeout(3000);
  await q.evaluate(() => goTab('p3D')); await q.waitForTimeout(4000);
  const mounted = await q.evaluate(()=>window.JCOE3D && JCOE3D.isMounted());
  console.log('3D mount:', mounted); if(!mounted) fail++;
  console.log('3D info:', (await q.textContent('#v3_simInfo')).trim());

  /* 공정별 가동률 막대가 실제로 값을 보여주는가.
     2D 사이드 패널도 같은 id(sf_EM12 …)로 막대를 만들어서, 3D 막대 id 에 v3_ 접두어가 빠지면
     id 가 중복되어 전부 0% 로 보인다 (2026-08-14 통합 직후 실제로 발생). */
  const bars = await q.$$eval('#v3_statBars .sv', els => els.map(e => parseFloat(e.textContent) || 0));
  const nz = bars.filter(v => v > 0).length;
  console.log(`3D 가동률 막대: ${bars.length}개 중 ${nz}개가 0% 초과 (최대 ${Math.max(...bars).toFixed(0)}%)`);
  if (!(bars.length > 10 && nz > 5)) { console.log('  FAIL: 3D 가동률이 표시되지 않는다'); fail++; }

  /* 2D 에서 조건을 바꾸면 3D 가 **같은 결과**를 받아야 한다.
     종전에는 3D 가 별도 파일에서 자체 시뮬을 돌려 두 화면이 어긋날 수 있었다. */
  await q.evaluate(() => goTab('pCfg')); await q.waitForTimeout(300);
  await q.selectOption('#cfgShifts','3');
  await q.click('#btnRun'); await q.waitForTimeout(2500);   // 설정 탭은 「시뮬레이션 실행」을 눌러야 반영된다
  const d2 = await q.evaluate(()=>+(SIM.kpi.makespanH/24).toFixed(2));
  await q.evaluate(() => goTab('p3D')); await q.waitForTimeout(1500);
  const t3 = (await q.textContent('#v3_simInfo')).trim();
  const d3 = parseFloat((t3.match(/\(([\d.]+)일\)/)||[])[1]);
  console.log(`3근 전환 — 2D ${d2}일 / 3D ${d3}일`);
  if (!(Math.abs(d3-d2) < 0.05)) { console.log('  FAIL: 2D·3D 결과 불일치'); fail++; }
  if (!(d2 < 20)) { console.log('  FAIL: 3근 전환이 반영되지 않았다 (2근 24.4일 → 3근 16.4일 이어야 함)'); fail++; }

  await q.screenshot({path:'/tmp/v_3d.png'});
  console.log('3D errors:', e3.slice(0,6)); if(e3.length) fail++;
  await b.close();
  process.exitCode = fail;
})();
