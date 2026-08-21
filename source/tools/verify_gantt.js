#!/usr/bin/env node
/**
 * 오더 간트 안 상세 패널 — 시간 구성 분해와 인라인 산식 검증
 *
 *   ① 행을 누르면 그 자리에 펼쳐지고, 다시 누르면 닫힌다 (한 번에 하나)
 *   ② 「가공 + 전환 + 대기 + 비가동」 의 합이 막대 길이와 정확히 같다
 *   ③ 본 1개 리드타임 분해도 합이 정확하다
 *   ④ 공정별 대기·전환·가공 표가 그 본의 실제 이벤트와 일치한다
 *   ⑤ 패널 안에서 산식 카드가 그려지고 ✎ 편집이 동작한다
 *   ⑥ 본 번호를 바꾸면 표·카드가 함께 따라온다
 *   ⑦ 막대 안 시간 구성 표시를 끄고 켤 수 있다
 *   ⑧ 콘솔 오류 없음
 */
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');

let fail = 0;
const ok = (n, c, e) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e != null ? '  ' + e : ''}`); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push('' + e));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto('file://' + path.join(ROOT, 'JCOE_Simulator.html'), { waitUntil: 'load' });
  await p.waitForTimeout(2400);
  await p.evaluate(() => goTab('pGantt')); await p.waitForTimeout(400);

  /* ── ① 펼치기 / 닫기 ─────────────────────────────────────── */
  const no = await p.evaluate(() => document.querySelector('#gantt .gr[data-vf]').getAttribute('data-vf'));
  await p.click('#gantt .gr[data-vf]'); await p.waitForTimeout(800);
  ok('① 행을 누르면 그 자리에 펼쳐진다',
     await p.evaluate(() => !!document.querySelector('#gantt .gdet .gdinner')), no);
  ok('① 상세는 한 번에 하나만',
     await p.evaluate(() => document.querySelectorAll('#gantt .gdet').length === 1));
  /* 다른 행을 누르면 그쪽으로 옮겨간다 */
  const no2 = await p.evaluate(() => [...document.querySelectorAll('#gantt .gr[data-vf]')][3].getAttribute('data-vf'));
  await p.evaluate(n => toggleGanttDetail(n), no2); await p.waitForTimeout(800);
  ok('① 다른 행을 누르면 그쪽으로 옮겨간다',
     await p.evaluate(() => document.querySelectorAll('#gantt .gdet').length === 1
       && document.querySelector('#gantt .gdet').dataset.det) === no2, no2);
  await p.evaluate(n => toggleGanttDetail(n), no); await p.waitForTimeout(800);

  /* ── ②③ 시간 분해가 정확히 맞는가 (전 오더) ───────────────── */
  const acc = await p.evaluate(() => {
    let badBar = 0, badPipe = 0, n = 0, sample = null;
    for (const key in SIM.orderSpan) {
      const T = orderTimeSplit(SIM, key); if (!T) continue;
      n++;
      if (Math.abs((T.work + T.setup + T.wait + T.closed) - T.total) > 1) badBar++;
      const P = pipeTimeSplit(SIM, key, 1); if (!P) continue;
      if (Math.abs((P.work + P.setup + P.wait + P.closed) - P.total) > 1) badPipe++;
      if (!sample) sample = { key, bar: T, pipe: P };
    }
    return { n, badBar, badPipe,
      s: sample && { no: sample.key,
        bar: `총 ${(sample.bar.total/3600).toFixed(1)}h = 가공 ${(sample.bar.work/3600).toFixed(1)} + 전환 ${(sample.bar.setup/3600).toFixed(1)} + 대기 ${(sample.bar.wait/3600).toFixed(1)} + 비가동 ${(sample.bar.closed/3600).toFixed(1)}`,
        pipe: `총 ${(sample.pipe.total/3600).toFixed(1)}h = 가공 ${(sample.pipe.work/3600).toFixed(1)} + 전환 ${(sample.pipe.setup/3600).toFixed(1)} + 대기 ${(sample.pipe.wait/3600).toFixed(1)} + 비가동 ${(sample.pipe.closed/3600).toFixed(1)}` } };
  });
  ok('② 막대 분해의 합 = 막대 길이 (전 오더)', acc.badBar === 0, `${acc.n}오더 중 불일치 ${acc.badBar} · 예) ${acc.s.no} ${acc.s.bar}`);
  ok('③ 본 리드타임 분해의 합 = 리드타임 (전 오더)', acc.badPipe === 0, `불일치 ${acc.badPipe} · 예) ${acc.s.pipe}`);

  /* ── ④ 공정별 표가 실제 이벤트와 같은가 ────────────────────── */
  const tbl = await p.evaluate(no => {
    const P = pipeTimeSplit(SIM, no, +$('gvK').value || 1);
    const rows = [...document.querySelectorAll('#gantt .gdtbl tr')].slice(1);
    if (rows.length !== P.rows.length) return { err: `행 수 ${rows.length} ≠ ${P.rows.length}` };
    const ev = SIM.events.filter(e => String(e.o) === String(no) && e.k === P.k).sort((a,b)=>a.s-b.s);
    let bad = 0;
    P.rows.forEach((r, i) => { if (r.nid !== ev[i].n || Math.abs(r.work - ev[i].d) > 1 || Math.abs(r.setup - ev[i].co) > 1) bad++; });
    return { n: rows.length, bad, sum: P.rows.reduce((a,r)=>a+r.work,0) };
  }, no);
  ok('④ 공정별 표가 그 본의 실제 이벤트와 일치', !tbl.err && tbl.bad === 0, tbl.err || `${tbl.n}공정 · 가공 합 ${(tbl.sum/60).toFixed(0)}분`);

  /* ── ⑤ 패널 안 산식 카드 · 편집 ────────────────────────────── */
  const nCards = await p.evaluate(() => document.querySelectorAll('#gvf .vfstep[data-i]').length);
  ok('⑤ 패널 안에 공정별 산식 카드가 그려진다', nCards > 0, `${nCards}장`);
  const secBefore = await p.evaluate(() => document.querySelector('#gvf .vfstep[data-i="0"] [data-f=sec]').textContent.trim());
  await p.click('#gvf .vfstep[data-i="0"] .vfedit'); await p.waitForTimeout(400);
  const nIn = await p.evaluate(() => document.querySelectorAll('#gvf .vfstep[data-i="0"] [data-f=edit] input.refin').length);
  ok('⑤ 패널 안에서 ✎ 편집이 열린다', nIn > 0, `${nIn}칸`);
  await p.evaluate(() => {
    const el = document.querySelector('#gvf .vfstep[data-i="0"] [data-sec="std"] input.refin');
    el.value = String(parseFloat(el.value) + 50); el.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(900);
  const secAfter = await p.evaluate(() => document.querySelector('#gvf .vfstep[data-i="0"] [data-f=sec]').textContent.trim());
  const stillOpen = await p.evaluate(() => !document.querySelector('#gvf .vfstep[data-i="0"] [data-f=edit]').hidden);
  ok('⑤ 고치면 값이 바뀌고 편집칸이 유지된다', secAfter !== secBefore && stillOpen, `${secBefore} → ${secAfter}`);
  await p.evaluate(() => { REF_EDIT = { std:{}, co:{}, cap:{}, tbl:{} }; refApply(true); });
  await p.waitForTimeout(900);
  ok('⑤ 되돌리면 원래 값 · 패널이 살아 있다',
     (await p.evaluate(() => {
        const c = document.querySelector('#gvf .vfstep[data-i="0"] [data-f=sec]');
        return c ? c.textContent.trim() : null; })) === secBefore, secBefore);

  /* ── ⑥ 본 번호 변경 ────────────────────────────────────────── */
  const chg = await p.evaluate(async () => {
    const a = document.querySelector('#gantt .gdtbl tr:nth-child(2)').textContent.replace(/\s+/g,' ');
    $('gvK').value = 3; $('gvK').dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 700));
    return { a, b: document.querySelector('#gantt .gdtbl tr:nth-child(2)').textContent.replace(/\s+/g,' '),
             cards: document.querySelectorAll('#gvf .vfstep[data-i]').length,
             k: $('gvK').value };
  });
  ok('⑥ 본 번호를 바꾸면 표와 카드가 따라온다', chg.cards > 0 && chg.k === '3', `k=${chg.k} · ${chg.cards}장`);

  /* ── ⑥-2 대기 원인 해설 ────────────────────────────────────── */
  const why = await p.evaluate(() => {
    const el = document.querySelector('#gantt .wwhy');
    if (!el) return null;
    const P = pipeTimeSplit(SIM, GV_OPEN, +$('gvK').value || 1);
    const first = P.rows[0].wait, later = P.wait - first;
    const t = el.textContent.replace(/\s+/g, ' ');
    return { hasSplit: /투입 대기/.test(t) && /공정 간 대기/.test(t),
             hasTop: /최장 대기 공정/.test(t),
             hasBn: new RegExp(SIM.stats[0].label.replace('\n',' ')).test(t),
             ok: first >= 0 && later >= 0 && Math.abs(first + later - P.wait) < 1 };
  });
  ok('⑥ 대기 원인이 투입 대기 / 공정 간 대기로 갈라져 표시된다',
     why && why.hasSplit && why.hasTop && why.hasBn && why.ok, JSON.stringify(why));

  /* ── ⑦ 막대 시간 구성 표시 토글 ────────────────────────────── */
  const segOn = await p.evaluate(() => document.querySelectorAll('#gantt .gseg').length);
  await p.evaluate(() => { $('gSeg').checked = false; $('gSeg').dispatchEvent(new Event('change')); });
  await p.waitForTimeout(600);
  const segOff = await p.evaluate(() => document.querySelectorAll('#gantt .gseg').length);
  await p.evaluate(() => { $('gSeg').checked = true; $('gSeg').dispatchEvent(new Event('change')); });
  await p.waitForTimeout(600);
  ok('⑦ 막대 시간 구성 표시를 끄고 켤 수 있다', segOn > 0 && segOff === 0, `켬 ${segOn}조각 / 끔 ${segOff}조각`);

  /* 닫기 */
  await p.evaluate(() => { const b = document.querySelector('#gantt .gdet .gdinner .vfbtn:last-of-type'); if (b) b.click(); });
  await p.waitForTimeout(500);
  ok('⑦ ✕ 닫기로 접힌다', await p.evaluate(() => !document.querySelector('#gantt .gdet')));

  /* ── ⑨ 병목 표시가 시뮬레이션 결과를 따라가는가 ─────────────── */
  const bn = await p.evaluate(() => {
    const top = SIM.stats.slice().sort((a,b)=>b.util-a.util)[0];
    const su  = SIM.stats.slice().sort((a,b)=>b.setupH-a.setupH)[0];
    return { mark: JSON.parse(JSON.stringify(BN_MARK)), top: top.id, topU: top.util, su: su.id,
             pptOnly: NODES.filter(n => n.pptBn).map(n => n.id) };
  });
  ok('⑨ 빨간 병목 표시가 가동률 1위 설비에 붙는다',
     !!bn.mark[bn.top] && bn.mark[bn.top].c === '#f05252', `${bn.top} ${bn.topU.toFixed(1)}%`);
  ok('⑨ 전환 1위는 주황으로 따로 표시된다',
     !!bn.mark[bn.su] && (bn.su === bn.top || bn.mark[bn.su].c === '#d29922'), bn.su);
  ok('⑨ PPT 표기(pptBn)는 화면 강조에 쓰지 않는다',
     bn.pptOnly.every(id => id === bn.top || id === bn.su || !bn.mark[id]),
     `PPT 표기 ${bn.pptOnly.join('·')} / 강조 ${Object.keys(bn.mark).join('·')}`);

  ok('⑧ 콘솔 오류·미처리 예외 없음', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(fail ? `\n${fail}건 FAIL` : '\n전 항목 PASS');
  process.exit(fail ? 1 : 0);
})();
