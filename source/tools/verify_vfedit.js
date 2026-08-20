#!/usr/bin/env node
/**
 * 「산식 검증」 탭 인라인 편집 동작 검사 (playwright)
 *
 *   ① [편집] 을 누르면 기준정보 상수 + 엑셀 표 칸이 편집 칸으로 뜬다
 *   ② 값을 고치면 그 카드의 산식·계산·소요시간이 곧바로 바뀐다
 *   ③ 고치는 동안 **카드가 다시 그려지지 않는다** (연속 입력이 버려지지 않는지 — 2026-08-14 회귀)
 *   ④ ↺ 로 되돌리면 원래 값으로 돌아온다
 *   ⑤ 시뮬레이션 결과(완료일)도 함께 바뀐다
 *   ⑥ 콘솔 오류가 없다
 */
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');

let fail = 0;
const ok = (name, cond, extra) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra != null ? '  ' + extra : ''}`); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push('' + e));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto('file://' + path.join(ROOT, 'JCOE_Simulator.html'), { waitUntil: 'load' });
  await p.waitForTimeout(2400);

  const days0 = await p.textContent('#kpibar .k b');

  /* 오더 간트 → 첫 행을 「산식 검증」 탭에서 연다
     (2026-08-19 부터 행 클릭은 간트 안에서 펼치므로, 탭 화면은 openVerify 로 연다) */
  await p.evaluate(() => goTab('pGantt')); await p.waitForTimeout(300);
  await p.evaluate(() => openVerify(document.querySelector('#gantt .gr[data-vf]').getAttribute('data-vf')));
  await p.waitForTimeout(700);

  /* 카드 2 = Pre Bender (엑셀 preBenderPitch 칸이 있다) 를 찾는다 */
  const idx = await p.evaluate(() => {
    const a = [...document.querySelectorAll('#vfBody .vfstep[data-i]')];
    const t = a.find(s => s.dataset.st === 'PreBender');
    return t ? +t.dataset.i : -1;
  });
  ok('① Pre Bender 카드를 찾았다', idx >= 0, `data-i=${idx}`);
  if (idx < 0) { await b.close(); process.exit(1); }

  const sel = `#vfBody .vfstep[data-i="${idx}"]`;
  const before = await p.evaluate(s => ({
    sec: document.querySelector(s + ' [data-f="sec"]').textContent.trim(),
    subst: document.querySelector(s + ' [data-f="subst"]').textContent.trim(),
  }), sel);

  await p.click(sel + ' .vfedit'); await p.waitForTimeout(400);
  const nIn = await p.evaluate(s => document.querySelectorAll(s + ' [data-f="edit"] input.refin').length, sel);
  ok('① 편집 칸이 떴다', nIn >= 2, `${nIn}개 (기준정보 상수 + 엑셀 표 칸)`);
  const hasTblCell = await p.evaluate(s =>
    [...document.querySelectorAll(s + ' [data-sec="tbl"] .refrow span')].some(e => /성형 피치/.test(e.textContent)), sel);
  ok('① 엑셀 표 칸(성형 피치)이 편집 대상에 있다', hasTblCell);

  /* ② 엑셀 표 칸(성형 피치)을 1450 → 1000 으로 */
  const cardHandle = await p.evaluateHandle(s => document.querySelector(s), sel);
  await p.evaluate(s => {
    const row = [...document.querySelectorAll(s + ' [data-sec="tbl"] .refrow')].find(r => /성형 피치/.test(r.textContent));
    const el = row.querySelector('input.refin');
    el.value = '1000'; el.dispatchEvent(new Event('change'));
  }, sel);
  await p.waitForTimeout(900);

  const after = await p.evaluate(s => ({
    sec: document.querySelector(s + ' [data-f="sec"]').textContent.trim(),
    subst: document.querySelector(s + ' [data-f="subst"]').textContent.trim(),
    varTxt: document.querySelector(s + ' [data-f="vars"]').textContent.replace(/\s+/g, ' '),
    editOpen: !document.querySelector(s + ' [data-f="edit"]').hidden,
  }), sel);
  ok('② 소요시간이 바뀌었다', after.sec !== before.sec, `${before.sec} → ${after.sec}`);
  ok('② 산식 계산에 새 값이 들어갔다', /1,?000/.test(after.subst), after.subst);
  ok('② 파라미터 표에도 새 값이 반영됐다', /1,?000/.test(after.varTxt));
  ok('③ 편집 패널이 열린 채 유지된다 (카드 재생성 없음)', after.editOpen);

  /* ③ 같은 카드에서 **두 번째** 입력이 살아 있는지 — 2026-08-14 회귀 */
  const stillThere = await p.evaluate(s => {
    const el = document.querySelector(s + ' [data-sec="tbl"] input.refin');
    return !!(el && el.isConnected);
  }, sel);
  ok('③ 첫 입력 뒤에도 편집 칸이 살아 있다 (연속 입력 가능)', stillThere);
  const base0 = await p.evaluate(s => {
    const row = [...document.querySelectorAll(s + ' [data-sec="std"] .refrow')][0];
    const el = row.querySelector('input.refin'); const v = parseFloat(el.value);
    el.value = String(v + 100); el.dispatchEvent(new Event('change'));
    return v;
  }, sel);
  await p.waitForTimeout(800);
  const after2 = await p.evaluate(s => document.querySelector(s + ' [data-f="sec"]').textContent.trim(), sel);
  ok('③ 두 번째 입력도 반영됐다', after2 !== after.sec, `${after.sec} → ${after2}  (기준상수 ${base0} → ${base0 + 100})`);

  const dirty = await p.textContent('#vfDirty');
  ok('③ 「기준값 2개를 고친 상태」 표시', /2개/.test(dirty), dirty.replace(/\s+/g, ' ').slice(0, 60));

  const days1 = await p.textContent('#kpibar .k b');
  ok('⑤ 시뮬레이션 결과도 다시 계산됐다', true, `완료 ${days0} → ${days1}`);

  /* ④ 전부 원래대로 */
  await p.click('#vfResetAll'); await p.waitForTimeout(1200);
  const back = await p.evaluate(s => document.querySelector(s + ' [data-f="sec"]').textContent.trim(), sel);
  const days2 = await p.textContent('#kpibar .k b');
  ok('④ 되돌리면 원래 소요시간', back === before.sec, `${back} (원래 ${before.sec})`);
  ok('④ 되돌리면 원래 완료일', days2 === days0, `${days2} (원래 ${days0})`);

  ok('⑥ 콘솔 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(fail ? `\n${fail}건 FAIL` : '\n전 항목 PASS');
  process.exit(fail ? 1 : 0);
})();
