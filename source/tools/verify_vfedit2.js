#!/usr/bin/env node
/**
 * 2026-08-19 전수 감사 회귀 방지 (브라우저)
 *
 *   ① 편집 패널이 열린 채 공정 구성이 바뀌어도 카드와 값이 어긋나지 않는다
 *   ② 분모 값을 터무니없이 낮추면 경고하고 되돌린다 (완료일 100만 일 방지)
 *   ③ 「산식 검증」 편집이 「기준정보」 탭 입력칸에 반영된다
 *   ④ 같은 공정이 두 번 나오는 오더에서 두 편집칸이 함께 움직인다
 *   ⑤ 본 번호를 바꾸면 그 본의 실제 호기·전역 순번이 따라온다 (대사표 전 공정 일치)
 *   ⑥ 상단 선택기 범위 밖 입력이 입력칸에 보정돼 되돌아온다
 *   ⑦ 2D 리셋이 화면을 실제로 되돌리고, 재생 중 타임라인이 움직인다
 */
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');

let fail = 0;
const ok = (n, c, e) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e != null ? '  ' + e : ''}`); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [], dialogs = [];
  p.on('pageerror', e => errs.push('' + e));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto('file://' + path.join(ROOT, 'JCOE_Simulator.html'), { waitUntil: 'load' });
  await p.waitForTimeout(2400);

  /* 「산식 검증」 탭 쪽 화면을 연다 (간트 안 상세 패널은 verify_gantt.js 가 본다) */
  const openFirst = async () => {
    await p.evaluate(() => goTab('pGantt')); await p.waitForTimeout(250);
    await p.evaluate(() => openVerify(document.querySelector('#gantt .gr[data-vf]').getAttribute('data-vf')));
    await p.waitForTimeout(600);
  };
  const cards = () => p.evaluate(() => [...document.querySelectorAll('#vfBody .vfstep[data-i]')]
    .map(c => ({ nid: c.dataset.nid, name: c.querySelector('.vfhd b').textContent,
                 sec: c.querySelector('[data-f=sec]').textContent.trim() })));

  /* ── ① 공정 구성 변화 ─────────────────────────────────────── */
  await openFirst();
  const before = await cards();
  await p.click('#vfBody .vfstep[data-i="0"] .vfedit'); await p.waitForTimeout(250);
  await p.evaluate(() => { const e = $('cfgCP'); e.checked = true; e.dispatchEvent(new Event('change')); $('btnRun').click(); });
  await p.waitForTimeout(1800);
  await p.evaluate(() => goTab('pVf')); await p.waitForTimeout(500);
  const after = await cards();
  const sumN = await p.evaluate(() => [...document.querySelectorAll('#vfSum .kpi b')].pop().textContent);
  ok('① 공정이 늘면 카드도 늘어난다', after.length === before.length + 1, `${before.length} → ${after.length}`);
  ok('① 요약의 공정 수와 카드 수가 같다', String(after.length) === sumN.replace('개',''), `카드 ${after.length} / 요약 ${sumN}`);
  const cp = after.find(c => c.nid === 'CP');
  ok('① 새 공정(Calibration Press) 카드가 실제로 생겼다', !!cp, cp && cp.name);
  /* 밀림 검사 — 이름과 nid 가 짝이 맞는가 */
  const shifted = await p.evaluate(() => {
    const V = verifyOrder($('vfOrder').value, CFG, { k: +$('vfK').value || 1 });
    return [...document.querySelectorAll('#vfBody .vfstep[data-i]')]
      .filter((c, i) => !V.steps[i] || c.dataset.nid !== V.steps[i].nid).length;
  });
  ok('① 카드 순서가 계산 결과와 정확히 일치 (한 칸 밀림 없음)', shifted === 0, `어긋난 카드 ${shifted}개`);
  const packCard = after[after.length - 1];
  ok('① 마지막 공정(포장)이 사라지지 않는다', packCard.nid === 'PACK', `${packCard.nid} ${packCard.sec}`);
  await p.evaluate(() => { const e = $('cfgCP'); e.checked = false; e.dispatchEvent(new Event('change')); $('btnRun').click(); });
  await p.waitForTimeout(1600);

  /* ── ② 폭주 방어 ─────────────────────────────────────────── */
  await openFirst();
  const days0 = await p.textContent('#kpibar .k b');
  const emIdx = await p.evaluate(() => +[...document.querySelectorAll('#vfBody .vfstep[data-i]')]
    .find(c => c.dataset.st === 'EdgeMiller').dataset.i);
  await p.click(`#vfBody .vfstep[data-i="${emIdx}"] .vfedit`); await p.waitForTimeout(300);
  dialogs.length = 0;
  await p.evaluate(i => {
    const row = [...document.querySelectorAll(`#vfBody .vfstep[data-i="${i}"] [data-sec="tbl"] .refrow`)]
      .find(r => /고속값/.test(r.textContent));
    const el = row.querySelector('input.refin'); el.value = '0.001'; el.dispatchEvent(new Event('change'));
  }, emIdx);
  await p.waitForTimeout(900);
  const days1 = await p.textContent('#kpibar .k b');
  ok('② 분모를 1/1000 미만으로 낮추면 경고하고 되돌린다', dialogs.length > 0 && days1 === days0,
     `경고 ${dialogs.length}건 · 완료 ${days0} → ${days1}`);
  const util = await p.evaluate(() => Math.max(...SIM.stats.map(s => s.util)));
  ok('② 가동률이 100% 를 넘지 않는다', util <= 100.5, `최대 ${util.toFixed(1)}%`);

  /* ── ③ 기준정보 탭 동기화 ────────────────────────────────── */
  await p.evaluate(i => {
    const row = [...document.querySelectorAll(`#vfBody .vfstep[data-i="${i}"] [data-sec="std"] .refrow`)]
      .find(r => /기본 \(12M\)/.test(r.textContent));
    const el = row.querySelector('input.refin'); el.value = '400'; el.dispatchEvent(new Event('change'));
  }, emIdx);
  await p.waitForTimeout(900);
  const refTab = await p.evaluate(() => {
    goTab('pRef');
    const g = [...document.querySelectorAll('#refStdWrap .refgrp')].find(x => x.dataset.proc === 'EdgeMiller');
    const row = [...g.querySelectorAll('.refrow')].find(r => /기본 \(12M\)/.test(r.textContent));
    const el = row.querySelector('input.refin');
    return { v: el.value, chg: el.classList.contains('chg') };
  });
  ok('③ 산식 검증에서 고친 값이 기준정보 탭에도 보인다', refTab.v === '400' && refTab.chg, JSON.stringify(refTab));
  await p.evaluate(() => { REF_EDIT = { std:{}, co:{}, cap:{}, tbl:{} }; refApply(true); renderVerify(true); });
  await p.waitForTimeout(900);

  /* ── ④ 같은 공정 두 카드 동기화 ──────────────────────────── */
  const two = await p.evaluate(() => {
    const o = [...document.querySelectorAll('#vfOrder option')].map(x => x.value);
    for (const no of o) {
      const V = verifyOrder(no, CFG, { k: 1 });
      const rt = V.steps.map((s, i) => [s.st, i]).filter(x => x[0] === 'RT');
      if (rt.length >= 2) return { no, a: rt[0][1], c: rt[1][1] };
    }
    return null;
  });
  if (two) {
    await p.evaluate(no => { openVerify(no); }, two.no); await p.waitForTimeout(700);
    await p.click(`#vfBody .vfstep[data-i="${two.a}"] .vfedit`);
    await p.click(`#vfBody .vfstep[data-i="${two.c}"] .vfedit`); await p.waitForTimeout(300);
    await p.evaluate(i => {
      const el = document.querySelector(`#vfBody .vfstep[data-i="${i}"] [data-sec="std"] input.refin`);
      el.value = String(parseFloat(el.value) + 100); el.dispatchEvent(new Event('change'));
    }, two.a);
    await p.waitForTimeout(900);
    const both = await p.evaluate(o => [o.a, o.c].map(i => {
      const el = document.querySelector(`#vfBody .vfstep[data-i="${i}"] [data-sec="std"] input.refin`);
      return { v: el.value, chg: el.classList.contains('chg') };
    }), two);
    ok('④ 같은 상수를 가리키는 두 편집칸이 함께 움직인다',
       both[0].v === both[1].v && both[0].chg && both[1].chg, JSON.stringify(both));
    await p.evaluate(() => { REF_EDIT = { std:{}, co:{}, cap:{}, tbl:{} }; refApply(true); renderVerify(true); });
    await p.waitForTimeout(800);
  } else ok('④ 같은 공정이 두 번 나오는 오더를 찾았다', false, '없음');

  /* ── ⑤ 본 번호 → 실제 호기·전역 순번 ────────────────────── */
  const mixOrder = await p.evaluate(() => {
    const by = {};
    for (const e of SIM.events) if (e.n === 'EXP' || e.n === 'RB') (by[e.o] = by[e.o] || new Set()).add(e.mach);
    for (const k in by) if (by[k].size > 1) return k;
    return null;
  });
  await p.evaluate(no => openVerify(no), mixOrder); await p.waitForTimeout(700);
  let allMatch = true, detail = [];
  for (const k of [1, 2, 3]) {
    await p.evaluate(k => { $('vfK').value = k; $('vfK').dispatchEvent(new Event('change')); }, k);
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#vfBody [data-f="recon"] tr')].slice(1);
      const bad = rows.filter(tr => { const t = tr.children[3].textContent.trim(); return t !== '+0.0%' && t !== '-0.0%'; });
      return { n: rows.length, bad: bad.length, mach: [...document.querySelectorAll('#vfSum .kpi b')][3].textContent };
    });
    detail.push(`k=${k} ${r.mach} 불일치 ${r.bad}/${r.n}`);
    if (r.bad > 0) allMatch = false;
  }
  ok('⑤ 본 번호별로 대사표가 전 공정 0% (호기·전역순번이 실제와 같다)', allMatch, detail.join(' | '));

  /* ── ⑥ 선택기 범위 밖 입력 보정 ─────────────────────────── */
  const clamp = await p.evaluate(async () => {
    const qty = +[...document.querySelectorAll('#vfOrder option')].find(o => o.selected).textContent.match(/(\d+)본/)[1];
    $('vfK').value = '99999'; $('vfK').dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    const hi = $('vfK').value;
    $('vfK').value = '0'; $('vfK').dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    return { qty, hi, lo: $('vfK').value };
  });
  ok('⑥ 범위 밖 본 번호가 입력칸에 보정돼 되돌아온다',
     clamp.hi === String(clamp.qty) && clamp.lo === '1', JSON.stringify(clamp));

  /* ── ⑦ 2D 리셋·타임라인 ─────────────────────────────────── */
  await p.evaluate(() => goTab('pFlow')); await p.waitForTimeout(400);
  await p.evaluate(() => { $('seek').value = 700; $('seek').dispatchEvent(new Event('input')); });
  await p.waitForTimeout(400);
  await p.evaluate(() => $('btnReset').click()); await p.waitForTimeout(400);
  const rst = await p.evaluate(() => ({ clock: $('simClock').textContent, done: $('doneCnt').textContent, seek: $('seek').value }));
  ok('⑦ 2D ↺ 가 시계·완료본수·타임라인을 실제로 되돌린다',
     rst.done === '0' && rst.seek === '0', JSON.stringify(rst));
  await p.evaluate(() => { $('spd').value = 4; $('spd').dispatchEvent(new Event('input')); $('btnPlay').click(); });
  await p.waitForTimeout(2500);
  const moved = await p.evaluate(() => +$('seek').value);
  await p.evaluate(() => $('btnPlay').click());
  ok('⑦ 재생 중 타임라인이 따라 움직인다', moved > 0, `seek = ${moved}`);

  /* ── 3D ↺ ────────────────────────────────────────────────── */
  await p.evaluate(() => goTab('p3D')); await p.waitForTimeout(1500);
  await p.evaluate(() => { $('v3_seek').value = 800; $('v3_seek').dispatchEvent(new Event('input')); });
  await p.waitForTimeout(500);
  await p.evaluate(() => $('v3_btnReset').click()); await p.waitForTimeout(500);
  const r3 = await p.evaluate(() => ({ done: $('v3_doneCnt').textContent, seek: $('v3_seek').value }));
  ok('⑦ 3D ↺ 뒤 완료 본수가 0 으로 돌아온다', r3.done === '0' && r3.seek === '0', JSON.stringify(r3));

  ok('⑧ 콘솔 오류·미처리 예외 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(fail ? `\n${fail}건 FAIL` : '\n전 항목 PASS');
  process.exit(fail ? 1 : 0);
})();
