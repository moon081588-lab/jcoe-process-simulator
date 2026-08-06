const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
  let fail=0;
  // ---- 2D ----
  const p = await b.newPage({viewport:{width:1680,height:980}});
  const e2=[]; p.on('pageerror',e=>e2.push(''+e)); p.on('console',m=>{if(m.type()==='error')e2.push(m.text());});
  await p.goto('file://'+process.cwd()+'/dist/JCOE_Simulator.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  for (const t of ['pWiz','pFlow','pCalc','pIO','pOpt','pGantt','pBn','pCfg']) {
    await p.click(`.tab[data-p="${t}"]`); await p.waitForTimeout(350);
  }
  await p.click('.tab[data-p="pOpt"]'); await p.waitForTimeout(400);
  console.log('제약 요약:', (await p.textContent('#eligWarn')).trim().replace(/\s+/g,' ').slice(0,150));
  await p.check('#optM3'); await p.waitForTimeout(900);
  console.log('  3호기 포함:', await p.evaluate(()=>SIM.stats.find(x=>x.id==='EXP').units.map(u=>u.jobs).join('/')));
  await p.uncheck('#optM3'); await p.waitForTimeout(900);
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
  await p.click('.tab[data-p="pIO"]'); await p.waitForTimeout(400);
  await p.selectOption('#ioStation','EXP|1'); await p.selectOption('#ioUnit','pipe'); await p.waitForTimeout(700);
  const ioRows = await p.evaluate(()=>({n:IO_ROWS.length, allM2:IO_ROWS.every(r=>r.u===1&&r.st==='EXP')}));
  console.log('  IO 확관#2호기 행수', ioRows.n, '필터정확', ioRows.allM2);
  // CSV
  const csvOk = await p.evaluate(()=>{ try{ ioCsv(); return true; }catch(e){ return String(e); } });
  console.log('  CSV', csvOk);
  // ---- 계획 실행 위저드 (원클릭) ----
  await p.click('.tab[data-p="pWiz"]'); await p.waitForTimeout(500);
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
  await p.click('.tab[data-p="pFlow"]'); await p.waitForTimeout(400);
  await p.screenshot({path:'/tmp/v_2d.png'});
  await p.close();
  // ---- 3D ----
  const q = await b.newPage({viewport:{width:1680,height:960}});
  const e3=[]; q.on('pageerror',e=>e3.push(''+e)); q.on('console',m=>{if(m.type()==='error')e3.push(m.text());});
  await q.goto('file://'+process.cwd()+'/dist/JCOE_3D.html',{waitUntil:'load'});
  await q.waitForTimeout(3000);
  console.log('3D info:', await q.textContent('#simInfo'));
  await q.selectOption('#cfgRule','OPT'); await q.waitForTimeout(2000);
  console.log('3D OPT:', await q.textContent('#simInfo'));
  await q.selectOption('#cfgRule','SETUP'); await q.waitForTimeout(1200);
  console.log('3D SETUP:', await q.textContent('#simInfo'));
  await q.screenshot({path:'/tmp/v_3d.png'});
  console.log('3D errors:', e3.slice(0,6)); if(e3.length) fail++;
  await b.close();
  process.exitCode = fail;
})();
