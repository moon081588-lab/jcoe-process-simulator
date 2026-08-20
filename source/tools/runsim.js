/**
 * Node 에서 시뮬레이터를 불러오는 헬퍼.
 *   const { api, ORDERS } = require('./tools/runsim.js');
 *   const S = api.simulate(ORDERS, cfg);
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const src = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8') + '\n'
          + fs.readFileSync(path.join(ROOT, 'src/flow.js'), 'utf8');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));
const ORDERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/orders.json'), 'utf8'));

const api = new Function('T', 'ORDERS', src + `
  return { simulate, optimizeExpander, routeOf, expanderMode, STD, CHANGEOVER,
           DISPATCH_RULES, NODES, NODE, EDGES,
           toolInfo, expanderSetup, expanderStep, expanderN,
           setExpSetupMode, setExpanderNMode,
           importOptPlan, normMachine, rbCapable, forceRB, useRBLine, EXP_MACHINES };
`)(T, ORDERS);

module.exports = { api, ORDERS, T };

/* 직접 실행하면 배분 규칙별 요약을 출력 */
if (require.main === module) {
  const base = { startDate:'2026-03-02', shifts:2, netHoursPerShift:7.5, skipWeekend:false,
    useRB:true, useCP:false, processingFinalUT:false, holdSec:60, changeover:true,
    freeStationSec:300, eventCap:1e9, sameODConcurrency:true, useM3:false };
  console.log('규칙      Makespan  확관전환  총전환   확관가동  #1/#2본수     부하편차');
  let plan = null;
  for (const r of ['EAT','RR','SETUP','SPEC','OPT']) {
    const cfg = { ...base, dispatchRule: r };
    if (r === 'OPT') { plan = api.optimizeExpander(ORDERS, cfg, { iters: 24000 }); cfg.plan = plan; }
    const S = api.simulate(ORDERS, cfg);
    const e = S.stats.find(x => x.id === 'EXP');
    console.log(r.padEnd(8),
      (S.kpi.makespanH/24).toFixed(1)+'일   ',
      S.kpi.expSetupH.toFixed(1)+'h    ',
      S.kpi.totalSetupH.toFixed(0)+'h  ',
      S.kpi.expUtil.toFixed(1)+'%   ',
      e.units.map(u=>u.jobs).join('/').padEnd(12),
      S.kpi.expBalanceH.toFixed(1)+'h');
  }
}
