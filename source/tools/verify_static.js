#!/usr/bin/env node
/**
 * 정적/런타임 위생 검사
 *
 *   node tools/verify_static.js
 *
 * 2026-08-14 「3D 가동률이 전부 0%」 버그가 **런타임에 생성된 id 중복**(sf_EM12)이었는데
 * 눈으로는 안 보였습니다. 그래서 아래를 자동으로 검사합니다.
 *
 *   ① 페이지를 실제로 띄우고 모든 탭을 열어 본 뒤, 문서 전체에서 id 중복을 찾는다
 *      (템플릿으로 만들어지는 id 까지 잡힌다)
 *   ② 소스에 문자열로 박힌 $('id') 참조 중 실제로 존재하지 않는 것을 찾는다
 *   ③ 콘솔 오류·미처리 예외가 하나라도 나면 실패
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(__dirname, '..');

let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra != null ? '  ' + extra : ''}`);
};

/* ---- 소스에서 $('...') 문자열 참조 수집 ------------------------------- */
function literalIds(file, prefix = '') {
  const s = fs.readFileSync(path.join(SRC, file), 'utf8');
  const out = new Set();
  /* $() 로 부르는 것만 접두어를 붙인다 — scene3d.js 의 $() 가 v3_ 를 붙이기 때문.
     document.getElementById() 를 직접 쓰는 곳은 접두어가 붙지 않는다. */
  for (const m of s.matchAll(/\$\('([A-Za-z_][\w-]*)'\)/g)) out.add(prefix + m[1]);
  for (const m of s.matchAll(/getElementById\('([A-Za-z_][\w-]*)'\)/g)) out.add(m[1]);
  return out;
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1680, height: 960 } });
  const errs = [];
  p.on('pageerror', e => errs.push('예외: ' + e));
  p.on('console', m => { if (m.type() === 'error') errs.push('콘솔: ' + m.text()); });

  await p.goto('file://' + path.join(ROOT, 'JCOE_Simulator.html'), { waitUntil: 'load' });
  await p.waitForTimeout(3000);

  /* 모든 탭을 한 번씩 열어 패널을 전부 그린다 */
  const tabs = await p.$$eval('.tab', ts => ts.map(t => t.dataset.p));
  for (const t of tabs) {
    await p.click(`.tab[data-p="${t}"]`);
    await p.waitForTimeout(t === 'p3D' ? 3500 : 500);
  }
  /* 실적 로그도 올려서 그 탭의 표까지 그린다 */
  const log = path.join(SRC, 'testdata', 'machine_prod_log_sample.csv');
  if (fs.existsSync(log)) {
    await p.click('.tab[data-p="pLog"]');
    await p.setInputFiles('#lgFile', log);
    await p.waitForTimeout(2000);
  }
  console.log(`탭 ${tabs.length}개를 모두 열었습니다: ${tabs.join(', ')}\n`);

  /* ---- ① 런타임 id 중복 ---------------------------------------------- */
  const dups = await p.evaluate(() => {
    const seen = {}, dup = {};
    for (const el of document.querySelectorAll('[id]')) {
      const k = el.id;
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > 1) dup[k] = seen[k];
    }
    return dup;
  });
  const nDup = Object.keys(dups).length;
  ok('① 문서 전체에 id 중복이 없다', nDup === 0,
     nDup ? JSON.stringify(dups).slice(0, 400) : '(모든 탭을 연 상태에서 검사)');

  /* ---- ② 존재하지 않는 id 참조 --------------------------------------- */
  const want = new Set([
    ...literalIds('src/ui.js'),
    ...literalIds('src3d/scene3d.js', 'v3_'),   // 3D 는 $() 가 v3_ 를 붙인다
  ]);
  const have = new Set(await p.evaluate(() => [...document.querySelectorAll('[id]')].map(e => e.id)));
  /* 동적으로 만들어졌다 사라지는 것들은 제외 */
  /* 상호작용 중에만 만들어졌다 사라지는 id 는 제외한다 */
  const dynamic = /^(sf_|sv_|v3_sf_|v3_sv_|v3_infoX$|ri\d)/;
  const missing = [...want].filter(id => !have.has(id) && !dynamic.test(id));
  ok('② 소스가 참조하는 id 가 모두 존재한다', missing.length === 0,
     missing.length ? missing.join(', ') : `${want.size}개 참조 확인`);

  /* ---- ③ 콘솔 오류 --------------------------------------------------- */
  ok('③ 콘솔 오류·미처리 예외 없음', errs.length === 0, errs.slice(0, 5).join(' | '));

  await b.close();
  console.log(fail ? `\n${fail}건 FAIL` : '\n전 항목 PASS');
  process.exit(fail ? 1 : 0);
})();
