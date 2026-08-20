#!/usr/bin/env node
/**
 * 시험 커버리지 감사 — **돌연변이 시험(mutation testing)**
 *
 * 「전 항목 PASS」가 «검증됐다» 는 뜻이 되려면, 상수를 몰래 바꿨을 때 시험이 **실패해야** 합니다.
 * 이 파일은 `REF_STD_DEFAULT` 의 상수를 하나씩 v → 3v+7 로 바꾼 뒤
 * `verify_formulas.js` · `verify_calc.js` · `verify_audit2.js` 를 돌려
 * **하나라도 잡아내는지** 봅니다. 아무도 못 잡으면 그 상수는 «시험이 없는 값» 입니다.
 *
 * 2026-08-19 원자료 대조에서 77개 중 17개(22%)가 사각지대로 드러나 신설했습니다 —
 * 고망간 라인 전체, End-RT 산출식 5개 상수, 포장 추가검사, 첫 본 가산이
 * 임의 값으로 바뀌어도 전 시험이 통과했습니다.
 *
 *   node tools/verify_coverage.js          커버리지만 보고
 *   node tools/verify_coverage.js --strict 사각지대가 하나라도 있으면 FAIL
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const SUITES = ['verify_formulas.js', 'verify_calc.js', 'verify_audit2.js'];

/* 사각지대로 «알고도 남겨 둔» 상수 — 이유를 반드시 적는다.
   비어 있는 것이 정상이며, 늘리려면 근거가 있어야 한다. */
const ACCEPTED = {
  // 'Proc.key': '왜 시험하지 않는가',
};

function constants() {
  const src = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8');
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));
  const { REF_STD_DEFAULT } = new Function('T', src + '\nreturn { REF_STD_DEFAULT };')(T);
  const out = [];
  for (const proc in REF_STD_DEFAULT)
    for (const k in REF_STD_DEFAULT[proc])
      if (k[0] !== '_') out.push({ proc, k, v: REF_STD_DEFAULT[proc][k].v, label: REF_STD_DEFAULT[proc][k].l });
  return out;
}

/* engine.js 사본에서 그 상수 한 줄만 바꾼 저장소를 만들어 시험을 돌린다 */
function detects(work, c) {
  const f = path.join(work, 'source/src/engine.js');
  const orig = fs.readFileSync(f, 'utf8');
  /* `key:{v:123,` 형태를 정확히 하나만 바꾼다 — 같은 이름이 여러 공정에 있으므로
     해당 공정 블록 안에서만 찾는다 */
  const pi = orig.indexOf(`  ${c.proc}: {`);
  if (pi < 0) throw new Error(`공정 블록을 찾지 못함: ${c.proc}`);
  const pe = orig.indexOf('\n  },', pi);
  const block = orig.slice(pi, pe);
  const rx = new RegExp(`(\\b${c.k}\\s*:\\s*\\{\\s*v\\s*:\\s*)(-?[\\d.]+)`);
  if (!rx.test(block)) throw new Error(`상수를 찾지 못함: ${c.proc}.${c.k}`);
  const mutated = block.replace(rx, (_, p1) => p1 + (c.v * 3 + 7));
  fs.writeFileSync(f, orig.slice(0, pi) + mutated + orig.slice(pe));
  try {
    for (const s of SUITES) {
      try {
        execFileSync(process.execPath, [path.join(work, 'source/tools', s)],
                     { cwd: work, stdio: 'pipe', timeout: 120000 });
      } catch (e) { return s; }          // 비정상 종료 = 잡아냄
    }
    return null;                          // 아무도 못 잡음
  } finally {
    fs.writeFileSync(f, orig);
  }
}

(function main() {
  const strict = process.argv.includes('--strict');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jcoe-cov-'));
  fs.cpSync(path.join(REPO, 'source'), path.join(work, 'source'), { recursive: true });

  const cs = constants();
  const blind = [], caught = {};
  process.stdout.write(`표준시간 상수 ${cs.length}개를 하나씩 변형해 시험이 잡아내는지 봅니다\n`);
  for (const c of cs) {
    const by = detects(work, c);
    if (by) caught[by] = (caught[by] || 0) + 1;
    else blind.push(c);
    process.stdout.write(by ? '.' : 'X');
  }
  process.stdout.write('\n\n');

  for (const s of SUITES) console.log(`  ${s.padEnd(20)} ${String(caught[s] || 0).padStart(3)}개 검출`);
  const rate = ((cs.length - blind.length) / cs.length * 100).toFixed(1);
  console.log(`\n커버리지 ${cs.length - blind.length}/${cs.length} = ${rate}%`);

  const unexpected = blind.filter(c => !ACCEPTED[`${c.proc}.${c.k}`]);
  if (blind.length) {
    console.log(`\n시험이 잡지 못하는 상수 ${blind.length}개:`);
    for (const c of blind) {
      const why = ACCEPTED[`${c.proc}.${c.k}`];
      console.log(`  ${(c.proc + '.' + c.k).padEnd(30)} ${String(c.v).padStart(7)}  ${c.label || ''}${why ? `   [허용: ${why}]` : ''}`);
    }
  }
  fs.rmSync(work, { recursive: true, force: true });

  if (strict && unexpected.length) {
    console.log(`\n${unexpected.length}건 FAIL — 시험 없는 상수가 있습니다`);
    process.exit(1);
  }
  console.log(unexpected.length ? `\n※ 사각지대 ${unexpected.length}건 (--strict 로 실패 처리)` : '\n전 항목 PASS');
  process.exit(0);
})();
