/* ====================================================================
   실적 로그 (machine_prod_log) 로더 · 표준시간 검증
   2026-08-14 세아제강 제공 — 「일정 시간마다 스냅샷으로 DB 생산실적이 바뀔 때
   그 시각과 누적 개수를 같이 가져온」 데이터. 조관계획서는 없다.

   열 구성
     poll_time      스냅샷을 뜬 시각 (수집기 기준)
     REAL_WC_ID     설비 코드 (EP103 = 확관 1호기 …)
     REAL_WC_DESC   설비명
     OPERATION_NM   공정명
     WO_NO          작업지시 번호 (= 오더)
     MATERIAL_DESC  자재 내역 — 여기서 외경·두께·길이를 뽑는다
     WORK_DATE      작업일 (교대 기준일)
     SHIFT          근무조 1 / 2 / 3
     LAST_TIME      그 시점까지의 **마지막 완료 시각** ← 실질적인 공정 완료 타임스탬프
     PROD_QTY_cum   누적 생산 수량
     qty_delta      증분

   ★ 중요 — 데이터 해석 규칙 (2026-08-14 실측으로 확인)
     1) PROD_QTY_cum 은 **(설비 · WO · WORK_DATE · SHIFT) 단위로 리셋**된다.
        전체 파일에서 단순 누적으로 읽으면 안 된다.
     2) qty_delta 는 **신뢰할 수 없다**. 직전 스냅샷을 놓친 구간에서
        delta = cum 으로 찍혀 있다 (예: cum 8 → delta 8, cum 31 → delta 31).
        PK113 을 예로 들면 Σqty_delta = 660 본이지만
        Σmax(PROD_QTY_cum) per (WO·일·근) = 363 본이다.
        → 본수는 **교대별 최대 누적의 합**으로 센다.
     3) 오더별 실제 **착수** 시각은 없다. LAST_TIME(완료 시각)만 있으므로
        착수는 "직전 완료" 로 근사하거나, 완료 간격(cycle)으로 표준시간을 검증한다.
   ==================================================================== */

/* 설비 코드 → 시뮬레이터 노드 매핑.  node:null 이면 시뮬레이터 미모델링 공정 */
const PLOG_WC = {
  EM101: { node:'EM12', label:'12M Edge Miller' },
  EM102: { node:'EM18', label:'18M Edge Miller' },
  PM115: { node:'PR12', label:'12M Press Bender' },
  PM116: { node:'PR18', label:'18M Press Bender' },
  WD103: { node:'TACK', label:'18M Tack Welder' },
  WD110: { node:'ISAW', label:'내면 1호기' }, WD111: { node:'ISAW', label:'내면 2호기' },
  WD112: { node:'ISAW', label:'내면 3호기' }, WD113: { node:'ISAW', label:'내면 4호기' },
  WD114: { node:'OSAW', label:'외면 1호기' }, WD115: { node:'OSAW', label:'외면 2호기' },
  WD116: { node:'OSAW', label:'외면 3호기' }, WD117: { node:'OSAW', label:'외면 4호기' },
  CM108: { node:'CUT',  label:'시편 절단', approx:true },
  UT109: { node:'UT1',  label:'1차 U.T' },
  EP102: { node:'RB',   label:'R/B Expander', machine:'RB' },
  EP103: { node:'EXP',  label:'확관 1호기', machine:'M1' },
  EP104: { node:'EXP',  label:'확관 2호기', machine:'M2' },
  FC110: { node:'EF',   label:'면취' },
  FC112: { node:'RBEF', label:'R/B 면취' },
  HY106: { node:'HYD',  label:'수압' },
  UT110: { node:'FUT',  label:'2차 U.T' },
  RT102: { node:'XE',   label:'RT (관단)' },
  RT101: { node:'FX',   label:'RT (전장 320kV)' },
  RT105: { node:'FX',   label:'RT (전장 450kV)' },
  RT104: { node:'RBRT', label:'R/B RT' },
  PK112: { node:'PACKRB', label:'배척 포장' },
  PK113: { node:'PACK', label:'JCOE 포장' },
  /* 모관검사 — 표준시간 엑셀 「Total Summary」 20개 공정에 **산출식이 없습니다.**
     2026-08-14 세아제강 확정: 「공정시간 식이 없으면 공정흐름에 추가 안 하셔도 됩니다」
     → 실적(379본)은 보여 주되 공정 흐름·시뮬레이션에는 넣지 않습니다. */
  IP106: { node:null,   label:'모관검사 (산출식 없음 — 공정흐름 미포함, 2026-08-14 확정)' },
};

/* 아주 작은 CSV 파서 — 따옴표·BOM·CRLF 만 처리하면 충분하다 */
function plogParseCSV(text) {
  const s = text.replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    /* 따옴표는 **필드 맨 앞에 있을 때만** 인용 시작이다.
       종전에는 필드 중간의 따옴표(자재내역의 42" 같은 인치 표기)도 인용 시작으로 봐서
       거기서부터 파일 나머지를 통째로 한 필드에 삼켰다. (2026-08-14 전수 감사) */
    } else if (c === '"' && cur === '') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); cur = ''; if (row.some(v => v !== '')) rows.push(row); row = []; }
    else if (c !== '\r') cur += c;
  }
  row.push(cur); if (row.some(v => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/* 길이 단위: `12.802M` 는 미터, `12192mm` 는 밀리미터.
   종전 정규식은 [mM] 하나만 봐서 'mm' 의 첫 글자에 걸렸고, 12192mm 를 12,192,000mm 로 읽었다. */
const PLOG_SPEC_RX = /(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[tT]\s*[xX]\s*(\d+(?:\.\d+)?)\s*(mm|MM|[mM])\b/;

/** 자재 내역 → 규격.  ex) '원Z483C2X70M BBE 1067x19.6tx12.192M A45' */
function plogSpec(desc) {
  const m = PLOG_SPEC_RX.exec(desc || '');
  if (!m) return null;
  const head = String(desc).split(/\s+/)[0] || '';
  return {
    od: +m[1], t: +m[2], L: +m[3] * (/^mm$/i.test(m[4]) ? 1 : 1000),
    /* 표준시간 엑셀 No.20 메모 — 「자재내역의 'C2' 강관기호가 있으면 옥외 열처리 진행」 */
    /* 옥외 열처리 = 강관기호에 'C2'. `/C2/` 만 쓰면 **`C22` 안의 C2** 까지 잡는다
       (원1C65**C22**-2 → 오탐. 2026-07 로그에서 21본 오탐 확인, 2026-08-19 원자료 대조).
       실제 표기는 `Z483C2X70M`·`Z448C2X65M` 처럼 C2 뒤에 **숫자가 오지 않는다.** */
    heat: /C2(?!\d)/.test(head),
    /* '편' 은 편척(짧게 잘라 쓴 것) — 배척 여부의 대리 지표. 확인 필요 */
    partial: /^편/.test(head),
    code: head,
  };
}

const plogTs = (v) => { const t = Date.parse(String(v || '').replace(' ', 'T')); return isFinite(t) ? t / 1000 : null; };

/* --------------------------------------------------------------------
   집계
   -------------------------------------------------------------------- */
function loadProdLog(text) {
  const raw = plogParseCSV(text);
  const need = ['REAL_WC_ID', 'WO_NO', 'MATERIAL_DESC', 'WORK_DATE', 'SHIFT', 'LAST_TIME', 'PROD_QTY_cum'];
  const miss = need.filter(k => !(k in (raw[0] || {})));
  if (miss.length) return { error: `열이 없습니다: ${miss.join(', ')}` };

  const rows = raw.map(r => ({
    wc: r.REAL_WC_ID, wcDesc: r.REAL_WC_DESC, op: r.OPERATION_NM,
    wo: r.WO_NO, mat: r.MATERIAL_DESC, date: r.WORK_DATE, shift: +r.SHIFT || 0,
    last: plogTs(r.LAST_TIME), poll: plogTs(r.poll_time),
    cum: (isFinite(+r.PROD_QTY_cum) && String(r.PROD_QTY_cum).trim() !== '') ? +r.PROD_QTY_cum : null,
  })).filter(r => r.wc && r.last != null && r.cum != null);
  /* 시각을 하나도 못 읽으면 여기서 rows 가 비고, 아래에서 rows[0].last 로 터졌다.
     열이 없을 때와 같이 **오류 객체로 돌려준다.** (2026-08-14 전수 감사) */
  if (!rows.length) return { error: 'LAST_TIME 을 읽을 수 있는 행이 없습니다 (예: 2026-07-20 15:01:14 형식)' };
  rows.sort((a, b) => a.last - b.last);

  /* ① 본수 — (설비·WO·일·근) 별 최대 누적의 합 (qty_delta 는 쓰지 않는다) */
  const bucket = new Map();
  for (const r of rows) {
    const k = `${r.wc}|${r.wo}|${r.date}|${r.shift}`;
    const b = bucket.get(k);
    if (!b || r.cum > b.cum) bucket.set(k, { ...r, cum: r.cum });
  }
  const qtyWC = {}, qtyWCWO = {};
  for (const b of bucket.values()) {
    qtyWC[b.wc] = (qtyWC[b.wc] || 0) + b.cum;
    qtyWCWO[`${b.wc}|${b.wo}`] = (qtyWCWO[`${b.wc}|${b.wo}`] || 0) + b.cum;
  }

  /* ② 설비별 요약 — 실적 본당 소요시간
     스냅샷 poller 라 한 간격이 반드시 1본은 아니다(누적이 2~4 씩 뛰는 구간이 있다).
     그래서 간격마다 Δt/Δ누적 으로 본당을 환산한 뒤,
       · perPipeSec = ΣΔt / ΣΔ누적   ← **처리량 기준 본당 소요.** 표준시간과 비교할 값
       · paceSec    = Δt/Δ누적 의 중위수 ← 「돌고 있을 때의 페이스」 참고값
     을 각각 낸다.

     ── 2026-08-14 정정 ─────────────────────────────────────────────
     처음에는 paceSec(중위수)만으로 표준시간과 비교해 「포장·수압·면취가 표준보다 빠르다」고
     보고했는데, **잘못된 비교**였다. 완료 간격 분포는 (돌 때 짧고 멈추면 긴) 오른쪽 꼬리가
     아주 긴 형태라 중위수는 가동 중 페이스만 집어내고 대기를 통째로 버린다.
     처리량 기준(ΣΔt/ΣΔ누적)으로 다시 재면 **전 설비가 표준 이상(비율 ≥ 1.02)** 으로,
     물리적으로 당연한 모습이 된다. 포장은 1.02 로 가장 여유가 없는 설비다. */
  const byWC = new Map();
  for (const r of rows) {
    if (!byWC.has(r.wc)) byWC.set(r.wc, []);
    byWC.get(r.wc).push(r);
  }
  const wcStat = [];
  for (const [wc, list] of byWC) {
    const map = PLOG_WC[wc] || { node: null, label: list[0].wcDesc || wc };
    /* 완료 간격 — 같은 (WO·일·근) 안에서 누적이 늘어난 순간들 사이의 간격만 본다 */
    const gaps = [];
    let sumDt = 0, sumDq = 0;
    const seen = new Map();
    for (const r of list) {
      const k = `${r.wo}|${r.date}|${r.shift}`;
      const p = seen.get(k);
      if (p && r.cum > p.cum && r.last > p.last) {
        const dt = r.last - p.last, dq = r.cum - p.cum;
        const d = dt / dq;
        /* ★ 처리량 기준 합계(perPipeSec)는 **긴 유휴 구간도 포함**해야 한다.
           종전에는 4시간 넘는 구간을 sumDt 에서도 빼서, 실적의 7.6% (1,592h 중 120h)가
           통째로 사라졌다. 그러면 「처리량 기준」이라고 부르면서 실제로는 걸러낸 페이스였다.
           30일을 넘는 값만 데이터 오류로 보고 제외한다.
           페이스 중위수(paceSec)는 종전대로 20초~4시간 표본만 쓴다. (2026-08-14 전수 감사) */
        if (d > 0 && d < 30 * 86400) { sumDt += dt; sumDq += dq; }
        if (d > 20 && d < 4 * 3600) gaps.push(d);
      }
      if (!p || r.cum >= p.cum) seen.set(k, r);
    }
    gaps.sort((a, b) => a - b);
    wcStat.push({
      wc, node: map.node, label: map.label, approx: !!map.approx, machine: map.machine || null,
      desc: list[0].wcDesc, op: list[0].op,
      qty: qtyWC[wc] || 0, rows: list.length,
      first: list[0].last, last: list[list.length - 1].last,
      /* 표준시간과 비교할 값 — 처리량 기준 본당 소요 */
      perPipeSec: sumDq > 0 ? sumDt / sumDq : null,
      /* 참고 — 돌고 있을 때의 페이스(중위수). 대기를 버리므로 표준 비교에는 쓰지 않는다 */
      paceSec: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
      medGapSec: sumDq > 0 ? sumDt / sumDq : null,   // 하위호환
      nGap: gaps.length,
    });
  }
  wcStat.sort((a, b) => b.qty - a.qty);

  /* ③ 오더(WO) — 규격 파싱 + 최종 공정 본수 */
  const woMap = new Map();
  for (const r of rows) {
    if (!woMap.has(r.wo)) woMap.set(r.wo, { wo: r.wo, mat: r.mat, first: r.last, last: r.last, wcs: new Set() });
    const o = woMap.get(r.wo);
    o.first = Math.min(o.first, r.last); o.last = Math.max(o.last, r.last);
    o.wcs.add(r.wc);
    if ((r.mat || '').length > (o.mat || '').length) o.mat = r.mat;
  }
  const orders = [], badSpec = [];
  for (const o of [...woMap.values()].sort((a, b) => a.first - b.first)) {
    const sp = plogSpec(o.mat);
    if (!sp) { badSpec.push(o.wo); continue; }
    /* 수량 — 포장(PK113/PK112) 실적이 있으면 그것을, 없으면 설비 중 최대치를 쓴다 */
    const pack = (qtyWCWO[`PK113|${o.wo}`] || 0) + (qtyWCWO[`PK112|${o.wo}`] || 0);
    let mx = 0;
    for (const wc of o.wcs) mx = Math.max(mx, qtyWCWO[`${wc}|${o.wo}`] || 0);
    orders.push({
      no: String(o.wo), od: sp.od, t: sp.t, L: sp.L,
      /* 오더 본수 — 포장까지 끝난 수(pack)만 쓰면 아직 공정 중인 본이 통째로 빠진다.
         실제 로그에서 456본 중 69본(15%)이 사라졌다. 어느 설비에서든 관측된 최대치를 쓴다.
         (2026-08-14 전수 감사) */
      qty: Math.max(pack || 0, mx || 0) || 1, packQty: pack, maxQty: mx,
      start: null, due: null,
      mat: o.mat, code: sp.code, heat: sp.heat, partial: sp.partial,
      /* 열처리(C2) → 병목공정 HT102 로 표기해 R/B 강제 투입 규칙을 그대로 태운다 */
      bottleneck: sp.heat ? 'HT102' : null,
      rawL: 0,
      firstDone: o.first, lastDone: o.last, wcs: [...o.wcs],
    });
  }

  const t0 = rows[0].last, t1 = rows[rows.length - 1].last;
  return {
    rows, wcStat, orders, badSpec, qtyWCWO,
    span: { from: t0, to: t1, hours: (t1 - t0) / 3600 },
    unmapped: wcStat.filter(w => !w.node).map(w => `${w.wc} ${w.label}`),
    totalPack: (qtyWC.PK113 || 0) + (qtyWC.PK112 || 0),
  };
}

/* --------------------------------------------------------------------
   표준시간 검증 — 실적 완료 간격(중위수) vs 엑셀 산출식
   실적 간격은 설비 1대 기준이므로, 병렬 설비(내면·외면 SAW, F-X ray)는
   설비 코드 하나가 곧 1대여서 그대로 비교할 수 있다.
   -------------------------------------------------------------------- */
function verifyProdLog(log, cfg) {
  if (!log || log.error) return [];
  const out = [];
  for (const w of log.wcStat) {
    if (!w.node || w.perPipeSec == null) continue;
    const node = (typeof NODE !== 'undefined') ? NODE[w.node] : null;
    if (!node || !node.st) continue;
    /* 그 설비를 지난 오더들의 표준시간을 **그 설비에서의 실적 본수**로 가중평균한다.
       종전에는 오더 전체 본수(포장 기준)로 가중해서, 상류 설비에서 아직 43본을 돌리고 있는데
       포장은 6본만 끝난 오더가 6본짜리로 계산됐다 (EM102 표준 471s → 실제 522s). */
    let num = 0, den = 0;
    for (const o of log.orders) {
      if (!o.wcs.includes(w.wc)) continue;
      const line = (o.L / 1000) > 13 ? '18M' : '12M';
      const spec = { od:o.od, t:o.t, L:o.L, qty:o.qty, api5l:false, mat:'', use:'',
                     holdSec:(cfg && cfg.holdSec) || 60,
                     rtType: node.rtType || null };
      let sec = null;
      try {
        const f = STD[node.st];
        if (!f) continue;
        const r = (node.st === 'Expander')
          ? f(spec, w.machine || node.machine || 'M2')
          : f(spec, line, 1);
        sec = r && isFinite(r.sec) ? r.sec : null;
      } catch (e) { sec = null; }
      if (sec == null) continue;
      num += sec * o.qty; den += o.qty;
    }
    if (!den) continue;
    const std = num / den;
    out.push({
      wc: w.wc, label: w.label, node: w.node, st: node.st, qty: w.qty,
      actualSec: w.perPipeSec, paceSec: w.paceSec, stdSec: std, nGap: w.nGap,
      ratio: std > 0 ? w.perPipeSec / std : null,
      /* 여유율 — 실적 본당에서 표준 작업시간을 뺀 몫이 대기·전환·정지다.
         0 에 가까울수록 쉬지 않고 돌고 있다는 뜻 = 진짜 병목 */
      idleShare: std > 0 ? Math.max(0, (w.perPipeSec - std) / w.perPipeSec) : null,
      approx: w.approx,
    });
  }
  out.sort((a, b) => b.qty - a.qty);
  return out;
}

/* --------------------------------------------------------------------
   실적 보정 계수 — 표준시간 산출식을 실적으로 **한 방향만** 내린다.

   실적 완료 간격에는 대기·전환·정지가 전부 섞여 있으므로
     · 실적 > 표준  →  대기 때문인지 산출식 때문인지 구분할 수 없다 → 손대지 않는다
     · 실적 < 표준  →  대기를 포함하고도 더 빠르다 = **산출식이 확실히 느리다** → 내린다
   그래서 계수는 `min(1, 실적/표준)` 이고, 이건 표준시간의 **상한 보정**입니다.

   2026-08-14 **정정** — 처리량 기준(ΣΔt/ΣΔ누적)으로 다시 재니 전 설비가 비율 ≥ 1.02 라
   보정 대상이 하나도 없습니다. 이 함수는 빈 객체를 돌려주고, 화면에는 그 사실을 표시합니다.
   (종전에는 중위수 기준으로 Packing 0.61 · HydroTest 0.79 · EndFacing 0.94 가 잡혔는데,
    중위수가 대기를 버려서 생긴 착시였습니다.)
   -------------------------------------------------------------------- */
function prodlogCalibration(log, cfg) {
  const out = {};
  for (const v of verifyProdLog(log, cfg)) {
    if (!v.ratio || !isFinite(v.ratio) || v.ratio >= 1) continue;
    out[v.st] = (out[v.st] == null) ? v.ratio : Math.min(out[v.st], v.ratio);
  }
  return out;
}
