#!/usr/bin/env node
/**
 * 실적 로그(machine_prod_log) 파서·검증 회귀 테스트
 *
 *   node tools/verify_prodlog.js <machine_prod_log.csv>
 *
 * CSV 를 주지 않으면 파서 단위 테스트만 돌립니다.
 * CSV 를 주면 설비별 실적 · 표준시간 대조 표를 출력하고,
 * 「스냅샷 실적을 오더셋으로 삼은 시뮬레이션」까지 한 번 돌려 봅니다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const src = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8') + '\n'
          + fs.readFileSync(path.join(ROOT, 'src/flow.js'), 'utf8') + '\n'
          + fs.readFileSync(path.join(ROOT, 'src/prodlog.js'), 'utf8');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));

const api = new Function('T', src + `
  return { simulate, routeOf, STD, NODES, NODE, loadProdLog, verifyProdLog, prodlogCalibration,
           plogSpec, plogParseCSV };
`)(T);

let failed = 0;
const ok = (name, cond, extra) => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

/* ---- 자재내역 파싱 ---------------------------------------------------- */
const s1 = api.plogSpec('원Z483C2X70M BBE 1067x19.6tx12.192M A45');
ok('자재내역 → 외경 1067', s1 && s1.od === 1067);
ok('자재내역 → 두께 19.6',  s1 && s1.t === 19.6);
ok('자재내역 → 길이 12192', s1 && s1.L === 12192);
ok('C2 강관기호 → 열처리',   s1 && s1.heat === true);

const s2 = api.plogSpec('NX52L2 BBE 762x9.5tx12.802M A44 140');
ok('C2 없음 → 열처리 아님',  s2 && s2.heat === false);
ok('편척 아님',              s2 && s2.partial === false);
const s3 = api.plogSpec('편NX52L2 BBE 762x9.5tx12.344M A44 140');
ok('편척 판정',              s3 && s3.partial === true);
ok('규격 없는 문자열 → null', api.plogSpec('ABC DEF') === null);

/* ---- qty_delta 를 쓰지 않는다: 스냅샷 유실 구간 재현 ------------------ */
const csv = [
  'poll_time,REAL_WC_ID,REAL_WC_DESC,OPERATION_NM,WO_NO,MATERIAL_DESC,WORK_DATE,SHIFT,LAST_TIME,PROD_QTY_cum,qty_delta',
  '2026-07-20 15:01:14,PK113,포장,포장 공정,1,NX52L2 BBE 762x9.5tx12.802M A44,2026-07-20,2,2026-07-20 15:01:05,2,2',
  '2026-07-20 16:10:16,PK113,포장,포장 공정,1,NX52L2 BBE 762x9.5tx12.802M A44,2026-07-20,2,2026-07-20 16:09:56,8,8',
  '2026-07-20 23:01:34,PK113,포장,포장 공정,1,NX52L2 BBE 762x9.5tx12.802M A44,2026-07-20,3,2026-07-20 23:01:08,3,3',
].join('\n');
const L = api.loadProdLog(csv);
ok('교대별 최대누적 합 = 8+3 = 11', L.wcStat[0].qty === 11, `got=${L.wcStat[0].qty}`);
ok('Σqty_delta(13) 를 쓰지 않는다', L.wcStat[0].qty !== 13);
ok('WO 1건',                       L.orders.length === 1);
ok('수량 = 포장 실적',              L.orders[0].qty === 11, `got=${L.orders[0].qty}`);

/* ---- 실제 파일이 주어지면 요약 출력 ---------------------------------- */
const file = process.argv[2];
if (file && fs.existsSync(file)) {
  const R = api.loadProdLog(fs.readFileSync(file, 'utf8'));
  if (R.error) { console.log('\n[error]', R.error); process.exit(1); }
  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(`행 ${R.rows.length} · WO ${R.orders.length} · 포장 실적 ${R.totalPack}본 · ${R.span.hours.toFixed(1)}h`);
  console.log('\n설비                          본수   실적본당      시뮬노드');
  for (const w of R.wcStat)
    console.log(`${(w.wc + ' ' + w.label).padEnd(28)} ${String(w.qty).padStart(5)}  `
      + `${(w.medGapSec == null ? '—' : w.medGapSec.toFixed(0) + 's').padStart(9)}  ${w.node || '미모델링'}`);

  const V = api.verifyProdLog(R, { holdSec: 60 });
  console.log('\n표준시간 대조                   실적(s)  표준(s)   비율');
  for (const v of V)
    console.log(`${(v.wc + ' ' + v.label).padEnd(28)} ${v.actualSec.toFixed(0).padStart(7)}`
      + ` ${v.stdSec.toFixed(0).padStart(8)} ${(v.ratio).toFixed(2).padStart(6)}`);

  const baseCfg = {
    startDate: R.span.from ? new Date(R.span.from * 1000).toISOString().slice(0, 10) : '2026-07-16',
    dateMode: 'sheet', dueAnalysis: false, shifts: 3, netHoursPerShift: 7.5,
    changeover: true, useCP: false, rbMode: 'force', rbPost: 'shared',
    expRuleSet: 'ortools', dispatchRule: 'EAT', holdSec: 60, freeStationSec: 300,
    eventCap: 1e9, seed: 1,
  };
  const cal = api.prodlogCalibration(R, baseCfg);
  console.log('\n실적 보정 계수 (실적 < 표준인 공정만, min(1, 실적/표준))');
  for (const [st, f] of Object.entries(cal).sort((a, b) => a[1] - b[1]))
    console.log(`  ${st.padEnd(14)} ×${f.toFixed(3)}`);

  const runs = [['보정 없음', null], ['실적 보정', cal]];
  console.log('\n                본수  Makespan   1위 병목');
  for (const [label, c] of runs) {
    const S = api.simulate(R.orders, { ...baseCfg, stdCalib: c });
    const packed = Object.values(S.orderSpan).reduce((a, v) => a + v.qty, 0);
    const top = S.stats.slice(0, 3).map(x => `${x.label} ${x.util.toFixed(1)}%`).join(' / ');
    console.log(`  ${label.padEnd(10)} ${String(packed).padStart(5)}  ${S.kpi.makespanH.toFixed(1).padStart(7)}h   ${top}`);
  }
  console.log(`  (실적 로그 구간 ${R.span.hours.toFixed(1)}h)`);
} else if (file) {
  console.log(`\n[skip] 파일이 없습니다: ${file}`);
}

console.log(failed ? `\n${failed}건 FAIL` : '\n전 항목 PASS');
process.exit(failed ? 1 : 0);
