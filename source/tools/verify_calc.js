#!/usr/bin/env node
/**
 * 산식 검증 화면(「산식 검증」 탭) 자체를 검증한다.
 *
 * 화면에 찍히는 세 줄
 *   ① 적용 산식 (tpl)          ② 파라미터 값 (vars)        ③ 산식 계산 (subst)
 * 중 ③ 은 "숫자를 대입한 식 = 결과" 형태다. 이 파일은 그 문자열을 **실제로 계산해서**
 * 시뮬레이터가 쓰는 값(sec)과 같은지 본다. 화면과 엔진이 어긋나면 여기서 FAIL 이 난다.
 *
 *   node tools/verify_calc.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tables.json'), 'utf8'));
const engine = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8');
const { STD } = new Function('T', engine + '\nreturn { STD };')(T);

/* 대표 사양 4종 × 라인 2종 × 본 번호 2종 */
const SPECS = [
  { _l:'OD914 t9.3 12.8m 일반',  od:914,  t:9.3,  L:12802, qty:70,  grade:'normal', api5l:true,  markSpec:2, markEnd:2, defects:0, holdSec:60, rtType:'450kV' },
  { _l:'OD762 t20.25 18.3m',     od:762,  t:20.25,L:18288, qty:270, grade:'normal', api5l:true,  markSpec:1, markEnd:2, defects:3, holdSec:90, rtType:'End-RT' },
  { _l:'OD1219 t31.8 고강도',    od:1219, t:31.8, L:12192, qty:20,  grade:'high',   api5l:false, markSpec:2, markEnd:1, defects:0, holdSec:60, rtType:'320kV' },
  { _l:'OD508 t9.5 고망간',      od:508,  t:9.5,  L:12000, qty:120, grade:'hiMn',   api5l:true,  markSpec:2, markEnd:2, defects:1, holdSec:60, rtType:'450kV' },
];

let fail = 0, n = 0;
const bad = (msg) => { fail++; console.log('FAIL  ' + msg); };

/* "…식… = 1234 s" → 식을 계산한 값 */
function evalSubst(subst) {
  const m = /^(.*)=\s*([\d.]+)\s*s$/.exec(subst);
  if (!m) return { err: 'subst 형식이 "… = N s" 가 아님' };
  const expr = m[1]
    .replace(/\s*\[[^\]]*\]\s*$/, '')          // 꼬리 설명 [18M 일반] 제거
    .replace(/(?<=\d),(?=\d\d\d\b)/g, '')      // 천 단위 구분표 제거 (max 의 인자 구분 쉼표는 남긴다)
    .replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/')
    .replace(/\bmax\(/g, 'Math.max(')
    .trim();
  try { return { v: eval(expr), want: +m[2], expr }; }
  catch (e) { return { err: `계산 불가 — ${e.message}  «${expr}»` }; }
}

for (const s of SPECS) {
  for (const line of ['12M', '18M']) {
    for (const seq of [1, 10]) {
      for (const k of Object.keys(STD)) {
        if (typeof STD[k] !== 'function') continue;
        const calls = k === 'Expander'
          ? [['M1'], ['M2'], ['RB'], ['BOTH']].map(m => [s, m[0], {}])
          : [[s, line, seq, seq]];
        for (const a of calls) {
          const tag = `${k}${k === 'Expander' ? `(${a[1]})` : ''} · ${s._l} · ${line} · ${seq}본째`;
          const r = STD[k].apply(null, a); n++;
          if (!r.tpl)   { bad(`${tag} — 적용 산식(tpl) 없음`); continue; }
          if (!r.vars)  { bad(`${tag} — 파라미터(vars) 없음`); continue; }
          if (!r.subst) { bad(`${tag} — 산식 계산(subst) 없음`); continue; }
          for (const v of r.vars) {
            if (!Array.isArray(v) || v.length < 2) bad(`${tag} — 파라미터 행 형식 오류 ${JSON.stringify(v)}`);
            else if (v[1] == null) bad(`${tag} — 파라미터 「${v[0]}」 값이 비어 있음`);
            else if (typeof v[1] === 'number' && !isFinite(v[1])) bad(`${tag} — 파라미터 「${v[0]}」 값이 ${v[1]}`);
          }
          const e = evalSubst(r.subst);
          if (e.err) { bad(`${tag} — ${e.err}`); continue; }
          if (Math.abs(Math.round(e.v) - e.want) > 1)
            bad(`${tag} — 표기된 결과 ${e.want} ≠ 실제 계산 ${e.v.toFixed(1)}  «${e.expr}»`);
          if (Math.abs(e.v - r.sec) > 1.5)
            bad(`${tag} — 화면 계산 ${e.v.toFixed(1)}s ≠ 엔진 값 ${r.sec.toFixed(1)}s  «${e.expr}»`);
        }
      }
    }
  }
}

/* ---- 엑셀 표 재정의(「산식 검증」 인라인 편집) 회귀 ---------------------- */
{
  const api = new Function('T', engine + '\nreturn { STD, setRefTbl, REF };')(T);
  const s = SPECS[0];
  const b = api.STD.PreBender(s, '12M');
  const cell = b.vars.find(v => v[3] && v[3].key);
  if (!cell) bad('표 재정의 — 편집 가능한 엑셀 표 칸이 vars 에 없다');
  else {
    n++;
    api.setRefTbl({ [cell[3].key]: cell[3].def * 2 });
    const c = api.STD.PreBender(s, '12M');
    if (Math.abs(c.sec - b.sec) < 1e-9) bad(`표 재정의 — ${cell[3].key} 를 2배로 했는데 결과가 안 바뀐다`);
    const cv = c.vars.find(v => v[0] === cell[0]);
    if (!cv || Math.abs(cv[1] - cell[3].def * 2) > 1e-9) bad('표 재정의 — 파라미터 표에 새 값이 안 보인다');
    const e = evalSubst(c.subst);
    if (e.err || Math.abs(e.v - c.sec) > 1.5) bad(`표 재정의 — 고친 뒤 산식 계산이 엔진 값과 어긋난다 (${e.err || e.v})`);
    api.setRefTbl({});
    if (Math.abs(api.STD.PreBender(s, '12M').sec - b.sec) > 1e-9) bad('표 재정의 — 되돌렸는데 원래 값이 아니다');
    /* 프로토타입 오염 방지 */
    api.setRefTbl({ __proto__: 9, constructor: 9 });
    if ({}.__proto__ !== Object.prototype || ({}).constructor !== Object) bad('표 재정의 — 프로토타입이 오염됐다');
    api.setRefTbl({});
    /* 숫자가 아닌 값은 무시 */
    api.setRefTbl({ [cell[3].key]: 'abc' });
    if (Math.abs(api.STD.PreBender(s, '12M').sec - b.sec) > 1e-9) bad('표 재정의 — 문자열이 값으로 먹혔다');
    api.setRefTbl({});
  }
}

console.log(`\n검사 ${n}건 / 불일치 ${fail}건`);
console.log(fail ? `\n${fail}건 FAIL` : '\n전 항목 PASS');
process.exit(fail ? 1 : 0);
