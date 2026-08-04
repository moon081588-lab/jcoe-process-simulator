#!/usr/bin/env python3
"""
JCOE View 생성기

View1: 캘린더 기반 오더별 간트 차트 (주차별 wrap, 오더=고정행)
View2: 공정별 상세 대시보드 (오더 선택 → 타임라인/계산식/이벤트 로그)

사용 예:
  python3 gen_views.py
  python3 gen_views.py "../1. 2026년 3월 포항공장 조관계획서.xlsx"
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import PRODUCTION_PLAN_EXCEL
from data_loader import load_production_plan
from simulator import JCOESimulator


PROCESS_FORMULAS = {
    "EdgeMiller": "348/283 - 123/v + feed/215.6 + L×(0.06/v - 0.0016)",
    "PreBender": "46.5/30 + (pitch/290 + 17.2) × ceil((L-2200)/pitch)",
    "PressBender": "203/178 + (L/708)×60 - OD/170 + X1 side press 보정",
    "GapPress": "464 - (L[m]/0.3) + ceil(L/6)×65×4",
    "TackWelder": "setup + gap adjust + L / weld_speed",
    "InsideWelder": "setup + loading/unloading + L / weld_speed",
    "OutsideWelder": "setup + loading/unloading + L / weld_speed",
    "FirstUT": "240 + L/150 + (9600/cut_speed)×2",
    "EndFacing": "363 + 저속절삭시간 테이블",
    "OuterBead": "55 + L/20",
    "HydroTest": "90 + fill_time + hold_time",
    "FinalUT": "200 + L/216.7",
    "RT": "325/345 + ceil(L/140)×7.5 (+ defect 보정)",
    "Packing": "634 + floor(qty/10)×250 + (45000-L)/270 + marking",
}


def expander_formula(machine: str) -> str:
    return {
        "M1": "177 + N×12 + (L+3500)/300",
        "M2": "165 + N×7.5, N=ceil((L-500)/step)+2",
        "RB": "234 + (ceil(L/step)-2)×15",
        "BOTH": "M1+M2 동시 사용, 소요시간=max(M1, M2)",
    }.get(machine or "", "Expander formula")


def parse_args():
    parser = argparse.ArgumentParser(description="JCOE View HTML 생성")
    parser.add_argument("plan", nargs="?", default=PRODUCTION_PLAN_EXCEL, help="조관계획서 xlsx 경로")
    parser.add_argument("--sheet", default="JCOE", help="시트명")
    parser.add_argument("--start", default=None, help="시뮬레이션 시작일 (YYYY-MM-DD)")
    return parser.parse_args()


def ensure_records(table):
    if hasattr(table, "to_dict"):
        return table.to_dict(orient="records")
    return list(table)


def build_payload(plan_path: str, sheet_name: str, start_date: str = None):
    orders = load_production_plan(plan_path, sheet_name=sheet_name)

    if start_date:
        import pandas as _pd
        from datetime import datetime as _dt
        new_start = _dt.strptime(start_date, "%Y-%m-%d")
        min_date = _pd.to_datetime(orders["scheduled_date"]).min()
        offset = new_start - min_date
        orders["scheduled_date"] = _pd.to_datetime(orders["scheduled_date"]) + offset

    sim = JCOESimulator()
    sim.load_orders(orders)
    sim.run()

    detail_rows = ensure_records(sim.to_dataframe())
    summary_rows = ensure_records(sim.order_summary())
    event_rows = ensure_records(sim.event_log())
    bottleneck_rows = ensure_records(sim.bottleneck_analysis())

    detail_by_order = defaultdict(list)
    for row in detail_rows:
        detail_by_order[row["order_no"]].append(row)

    event_by_order = defaultdict(list)
    for row in event_rows:
        event_by_order[row["order_no"]].append(row)

    orders_payload = []
    for row in summary_rows:
        order_no = row["order_no"]
        detail = detail_by_order[order_no]
        event_log = event_by_order[order_no]

        station_rows = []
        for station in [
            "EdgeMiller", "PreBender", "PressBender", "GapPress",
            "TackWelder", "InsideWelder", "OutsideWelder",
            "FirstUT", "Expander",
            "EndFacing", "OuterBead", "HydroTest", "FinalUT", "RT", "Packing",
        ]:
            start_key = f"{station}_start_at"
            end_key = f"{station}_end_at"
            if start_key not in row or end_key not in row:
                continue
            detail_match = next((r for r in detail if r["station"] == station), None)
            expander_machine = detail_match["expander"] if detail_match else ""
            station_rows.append({
                "station": station,
                "start_at": row[start_key],
                "end_at": row[end_key],
                "start_h": row.get(f"{station}_start_h"),
                "end_h": row.get(f"{station}_end_h"),
                "span_h": row.get(f"{station}_span_h"),
                "duration_min": round((row.get(f"{station}_span_h", 0) or 0) * 60, 2),
                "formula": expander_formula(expander_machine) if station == "Expander" else PROCESS_FORMULAS.get(station, ""),
                "expander_machine": expander_machine,
            })

        orders_payload.append({
            "order_no": order_no,
            "od_mm": row["od_mm"],
            "thickness_mm": row["thickness_mm"],
            "length_mm": row["length_mm"],
            "qty": row["qty"],
            "order_start_at": row["order_start_at"],
            "order_end_at": row["order_end_at"],
            "stations": station_rows,
            "event_log": event_log,
        })

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "plan_path": str(Path(plan_path).resolve()),
        "sheet_name": sheet_name,
        "orders": orders_payload,
        "bottlenecks": bottleneck_rows,
    }


# ================================================================
#  View1: 캘린더 간트 차트 (오더 = 고정 Y행, 주차별 wrap)
# ================================================================
def render_view1(payload: dict) -> str:
    data_json = json.dumps(payload, ensure_ascii=False, default=str)
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>JCOE Schedule - Calendar Gantt</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Segoe UI', 'Malgun Gothic', Arial, sans-serif; background: #f8f9fa; color: #212529; }}
.header {{ padding: 16px 28px; background: #fff; border-bottom: 2px solid #dee2e6;
  position: sticky; top: 0; z-index: 200; }}
.header h1 {{ font-size: 20px; font-weight: 700; color: #1a1a2e; }}
.header .meta {{ font-size: 12px; color: #6c757d; margin-top: 4px; }}
.legend {{ padding: 10px 28px; background: #fff; border-bottom: 1px solid #dee2e6;
  display: flex; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; }}
.legend-title {{ font-weight: 600; color: #495057; margin-right: 4px; }}
.legend-item {{ display: flex; align-items: center; gap: 4px; }}
.legend-swatch {{ width: 14px; height: 14px; border-radius: 3px; }}
.gantt-wrap {{ padding: 20px 28px; overflow-x: auto; }}
.gantt-table {{ border-collapse: collapse; width: 100%; min-width: 1200px; }}
.gantt-table th {{ background: #e9ecef; font-size: 11px; font-weight: 600; color: #495057;
  padding: 6px 2px; border: 1px solid #dee2e6; text-align: center; position: sticky; top: 76px; z-index: 100; }}
.gantt-table th.month-hdr {{ background: #1a1a2e; color: #fff; font-size: 13px; font-weight: 700;
  letter-spacing: 1px; }}
.gantt-table th.weekend {{ background: #f1e4e8; }}
.gantt-table th.today {{ background: #cfe2ff; }}
.gantt-table td {{ border: 1px solid #e9ecef; padding: 0; height: 32px; position: relative; }}
.gantt-table td.label-cell {{ padding: 4px 8px; background: #fff; white-space: nowrap;
  font-size: 11px; font-weight: 500; color: #212529; position: sticky; left: 0; z-index: 50;
  border-right: 2px solid #adb5bd; min-width: 260px; max-width: 260px; }}
.gantt-table td.label-cell .order-id {{ font-weight: 700; color: #1a1a2e; }}
.gantt-table td.label-cell .spec {{ color: #6c757d; font-size: 10px; }}
.gantt-table td.label-cell .qty-badge {{ display: inline-block; background: #e9ecef; color: #495057;
  border-radius: 8px; padding: 0 6px; font-size: 10px; font-weight: 600; margin-left: 4px; }}
.gantt-table td.day-cell {{ min-width: 28px; width: 28px; }}
.gantt-table td.day-cell.weekend {{ background: #fdf2f4; }}
.bar {{ position: absolute; top: 3px; height: 26px; border-radius: 4px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.3);
  overflow: hidden; white-space: nowrap; z-index: 10; transition: filter 0.15s; }}
.bar:hover {{ filter: brightness(1.15); box-shadow: 0 2px 8px rgba(0,0,0,0.25); z-index: 20; }}
.tooltip {{ display: none; position: fixed; background: #1a1a2e; color: #e6edf3;
  border-radius: 8px; padding: 12px 16px; font-size: 12px; z-index: 9999;
  pointer-events: none; max-width: 360px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }}
.tooltip .tt-title {{ font-weight: 700; color: #58a6ff; font-size: 14px; margin-bottom: 6px; }}
.tooltip .tt-row {{ margin: 3px 0; color: #8b949e; }}
.tooltip .tt-row b {{ color: #fff; }}
.summary {{ padding: 16px 28px; background: #fff; border-top: 2px solid #dee2e6; }}
.summary h3 {{ font-size: 14px; margin-bottom: 8px; }}
.summary table {{ border-collapse: collapse; font-size: 12px; }}
.summary th, .summary td {{ border: 1px solid #dee2e6; padding: 4px 10px; }}
.summary th {{ background: #e9ecef; }}
.util-high {{ color: #dc3545; font-weight: 700; }}
.util-mid {{ color: #fd7e14; font-weight: 600; }}
</style>
</head>
<body>
<div class="header">
  <h1>JCOE 생산 스케줄 - 간트 차트</h1>
  <div class="meta">
    계획서: {payload["plan_path"]} &middot;
    시트: {payload["sheet_name"]} &middot;
    생성: {payload["generated_at"]} &middot;
    총 오더: {len(payload["orders"])}건
  </div>
</div>
<div class="legend" id="legend"></div>
<div class="gantt-wrap"><table class="gantt-table" id="gantt"></table></div>
<div class="summary" id="summary"></div>
<div class="tooltip" id="tooltip"></div>

<script>
const DATA = {data_json};

// OD 그룹별 색상
const OD_COLORS = {{
  457: '#6c757d', 508: '#495057',
  610: '#20c997', 660: '#12b886', 711: '#0ca678',
  762: '#228be6', 813: '#1c7ed6', 864: '#1971c2',
  914: '#e03131', 965: '#c92a2a', 1016: '#ae3ec9',
  1067: '#7048e8', 1118: '#6741d9',
  1168: '#f08c00', 1219: '#e8590c', 1270: '#d9480f',
  1321: '#2f9e44', 1372: '#2b8a3e', 1422: '#237032',
  1473: '#d6336c', 1524: '#c2255c', 1575: '#a61e4d', 1626: '#862e9c',
}};
function getColor(od) {{
  const k = Object.keys(OD_COLORS).map(Number).sort((a,b)=>a-b);
  let best = k[0];
  for (const v of k) {{ if (Math.abs(v-od) < Math.abs(best-od)) best=v; }}
  return OD_COLORS[best] || '#495057';
}}

function parseDate(s) {{ return new Date(s.replace(' ','T')+':00'); }}
function dayStart(d) {{ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }}
function addDays(d,n) {{ const r=new Date(d); r.setDate(r.getDate()+n); return r; }}
function diffDays(a,b) {{ return Math.round((b-a)/86400000); }}
function fmtD(d) {{ return (d.getMonth()+1)+'/'+d.getDate(); }}
const DOW_SHORT = ['일','월','화','수','목','금','토'];

const orders = DATA.orders.map((o,i) => ({{
  ...o, idx: i,
  color: getColor(o.od_mm),
  startDate: dayStart(parseDate(o.order_start_at)),
  endDate: dayStart(parseDate(o.order_end_at)),
}}));

// 날짜 범위
const globalMin = new Date(Math.min(...orders.map(o=>o.startDate)));
const globalMax = new Date(Math.max(...orders.map(o=>o.endDate)));
const calStart = dayStart(globalMin);
const calEnd = addDays(dayStart(globalMax), 1);
const totalDays = diffDays(calStart, calEnd) + 1;

// 날짜 배열
const dates = [];
for (let i=0; i<totalDays; i++) dates.push(addDays(calStart, i));

// 범례 (OD 그룹)
const odSet = [...new Set(orders.map(o=>o.od_mm))].sort((a,b)=>a-b);
const legendEl = document.getElementById('legend');
legendEl.innerHTML = '<span class="legend-title">OD 그룹:</span>' +
  odSet.map(od => `<span class="legend-item"><span class="legend-swatch" style="background:${{getColor(od)}}"></span>${{od}}mm</span>`).join('');

// 테이블 생성
const gantt = document.getElementById('gantt');
let html = '';

// 월 헤더
html += '<thead><tr><th class="label-cell" rowspan="2" style="position:sticky;left:0;z-index:150;">오더 / 제품 사양</th>';
let curMonth = -1;
let monthSpans = [];
dates.forEach((d,i) => {{
  const m = d.getMonth();
  if (m !== curMonth) {{
    if (monthSpans.length) monthSpans[monthSpans.length-1].span = i - monthSpans[monthSpans.length-1].start;
    monthSpans.push({{ month: m, year: d.getFullYear(), start: i }});
    curMonth = m;
  }}
}});
if (monthSpans.length) monthSpans[monthSpans.length-1].span = totalDays - monthSpans[monthSpans.length-1].start;
monthSpans.forEach(ms => {{
  html += `<th class="month-hdr" colspan="${{ms.span}}">${{ms.year}}년 ${{ms.month+1}}월</th>`;
}});
html += '</tr><tr>';

// 날짜 헤더
dates.forEach(d => {{
  const dow = d.getDay();
  const isWe = dow===0||dow===6;
  html += `<th class="day-cell${{isWe?' weekend':''}}" title="${{d.toISOString().slice(0,10)}}">${{d.getDate()}}</th>`;
}});
html += '</tr></thead><tbody>';

// 오더 행
orders.forEach(o => {{
  html += '<tr>';
  html += `<td class="label-cell">
    <span class="order-id">${{o.order_no}}</span>
    <span class="qty-badge">${{o.qty}}본</span><br>
    <span class="spec">OD${{o.od_mm}} × t${{o.thickness_mm}} × ${{(o.length_mm/1000).toFixed(1)}}m</span>
  </td>`;

  const startIdx = Math.max(0, diffDays(calStart, o.startDate));
  const endIdx = Math.min(totalDays-1, diffDays(calStart, o.endDate));

  dates.forEach((d,i) => {{
    const dow = d.getDay();
    const isWe = dow===0||dow===6;
    if (i === startIdx) {{
      const span = endIdx - startIdx + 1;
      const barDays = span;
      const labelText = barDays >= 3 ? `${{o.order_no}} (${{o.qty}})` : (barDays >= 2 ? `${{o.qty}}` : '');
      html += `<td class="day-cell${{isWe?' weekend':''}}" colspan="${{span}}" style="position:relative;">
        <div class="bar" data-idx="${{o.idx}}"
          style="left:0;right:0;background:${{o.color}};">${{labelText}}</div></td>`;
    }} else if (i > startIdx && i <= endIdx) {{
      // skip - covered by colspan
    }} else {{
      html += `<td class="day-cell${{isWe?' weekend':''}}"></td>`;
    }}
  }});
  html += '</tr>';
}});
html += '</tbody>';
gantt.innerHTML = html;

// 병목 요약
const bns = DATA.bottlenecks || [];
if (bns.length) {{
  const sumEl = document.getElementById('summary');
  let shtml = '<h3>스테이션별 가동률 (병목 분석)</h3><table><thead><tr><th>공정</th><th>가동시간(h)</th><th>가동률(%)</th></tr></thead><tbody>';
  bns.sort((a,b) => (b['utilization_%']||0) - (a['utilization_%']||0));
  bns.forEach(b => {{
    const u = b['utilization_%'] || 0;
    const cls = u >= 80 ? 'util-high' : (u >= 50 ? 'util-mid' : '');
    shtml += `<tr><td>${{b.station}}</td><td>${{b.total_busy_h}}</td><td class="${{cls}}">${{u}}%</td></tr>`;
  }});
  shtml += '</tbody></table>';
  sumEl.innerHTML = shtml;
}}

// 툴팁
const tooltip = document.getElementById('tooltip');
document.addEventListener('mouseover', e => {{
  const bar = e.target.closest('.bar');
  if (bar) {{
    const o = orders[Number(bar.dataset.idx)];
    const days = diffDays(o.startDate, o.endDate) + 1;
    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div class="tt-title">${{o.order_no}}</div>
      <div class="tt-row">OD <b>${{o.od_mm}}mm</b> / t <b>${{o.thickness_mm}}mm</b> / L <b>${{(o.length_mm/1000).toFixed(1)}}m</b></div>
      <div class="tt-row">수량: <b>${{o.qty}}본</b></div>
      <div class="tt-row">시작: <b>${{o.order_start_at}}</b></div>
      <div class="tt-row">종료: <b>${{o.order_end_at}}</b></div>
      <div class="tt-row">소요: <b>${{days}}일</b></div>`;
  }}
}});
document.addEventListener('mousemove', e => {{
  if (tooltip.style.display==='block') {{
    tooltip.style.left = (e.clientX+14)+'px';
    tooltip.style.top = (e.clientY+14)+'px';
  }}
}});
document.addEventListener('mouseout', e => {{
  if (e.target.closest('.bar')) tooltip.style.display = 'none';
}});
</script>
</body>
</html>
"""


# ================================================================
#  View2: 공정별 상세 대시보드 (기존 View1 내용 + 병목 분석)
# ================================================================
def render_view2(payload: dict) -> str:
    data_json = json.dumps(payload, ensure_ascii=False, default=str)

    bottleneck_html = "".join(
        f"<tr><td>{row['station']}</td><td>{row['total_busy_h']}</td><td>{row['utilization_%']}</td><td>{row['sim_end_at']}</td></tr>"
        for row in payload["bottlenecks"]
    )

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>JCOE View2 - 공정 상세</title>
<style>
* {{ box-sizing: border-box; }}
body {{ font-family: 'Segoe UI', Arial, sans-serif; margin: 0; background: #0d1117; color: #e6edf3; }}
.header {{ padding: 14px 20px; border-bottom: 1px solid #30363d; background: #161b22; }}
.header h1 {{ font-size: 18px; font-weight: 600; }}
.header .meta {{ margin-top: 4px; color: #8b949e; font-size: 12px; }}
.container {{ display: grid; grid-template-columns: 300px 1fr; height: calc(100vh - 76px); }}
.sidebar {{ border-right: 1px solid #30363d; overflow-y: auto; background: #0d1117; }}
.order-item {{ padding: 10px 14px; border-bottom: 1px solid #21262d; cursor: pointer; }}
.order-item:hover, .order-item.active {{ background: #161b22; }}
.order-no {{ font-weight: 700; color: #58a6ff; font-size: 13px; }}
.order-sub {{ font-size: 11px; color: #8b949e; margin-top: 3px; }}
.main {{ padding: 18px; overflow-y: auto; }}
.cards {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }}
.card {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 10px; }}
.card .k {{ color: #8b949e; font-size: 11px; }}
.card .v {{ margin-top: 3px; font-weight: 600; font-size: 13px; }}
.section {{ margin-top: 16px; }}
.section h3 {{ margin-bottom: 8px; font-size: 14px; }}
table {{ width: 100%; border-collapse: collapse; background: #0d1117; }}
th, td {{ border: 1px solid #21262d; padding: 6px 8px; font-size: 12px; text-align: left; }}
th {{ background: #161b22; color: #8b949e; }}
.timeline {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }}
.tl-row {{ display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; margin: 6px 0; }}
.tl-track {{ position: relative; height: 20px; background: #0d1117; border-radius: 10px; overflow: hidden; }}
.tl-bar {{ position: absolute; top: 0; height: 20px; border-radius: 10px;
  background: linear-gradient(90deg, #388bfd, #a371f7); }}
.tl-label {{ font-size: 12px; }}
.formula {{ color: #8b949e; font-size: 11px; }}
.bn-section {{ margin-top: 24px; padding-top: 16px; border-top: 1px solid #30363d; }}
.bn-section h2 {{ font-size: 15px; margin-bottom: 10px; }}
</style>
</head>
<body>
<div class="header">
  <h1>JCOE View2 - 공정 상세 대시보드</h1>
  <div class="meta">계획서: {payload["plan_path"]} &middot; 시트: {payload["sheet_name"]} &middot; 생성: {payload["generated_at"]}</div>
</div>
<div class="container">
  <div class="sidebar" id="orderList"></div>
  <div class="main">
    <div id="orderDetail"></div>
    <div class="bn-section">
      <h2>스테이션별 가동률 (병목 분석)</h2>
      <table>
        <thead><tr><th>station</th><th>busy_h</th><th>utilization_%</th><th>sim_end_at</th></tr></thead>
        <tbody>{bottleneck_html}</tbody>
      </table>
    </div>
  </div>
</div>
<script>
const DATA = {data_json};
const orderList = document.getElementById('orderList');
const orderDetail = document.getElementById('orderDetail');

function renderList(activeNo) {{
  orderList.innerHTML = DATA.orders.map(o => `
    <div class="order-item ${{String(o.order_no)===String(activeNo)?'active':''}}"
         onclick="selectOrder('${{o.order_no}}')">
      <div class="order-no">${{o.order_no}}</div>
      <div class="order-sub">OD ${{o.od_mm}} / t ${{o.thickness_mm}} / L ${{(o.length_mm/1000).toFixed(3)}}m / qty ${{o.qty}}</div>
      <div class="order-sub">${{o.order_start_at}} → ${{o.order_end_at}}</div>
    </div>
  `).join('');
}}

function renderTimeline(order) {{
  const sts = order.stations;
  const minH = Math.min(...sts.map(s=>Number(s.start_h??0)));
  const maxH = Math.max(...sts.map(s=>Number(s.end_h??0)));
  const total = Math.max(maxH - minH, 0.01);
  return `<div class="timeline">${{sts.map(st => {{
    const left = ((Number(st.start_h??0)-minH)/total)*100;
    const width = Math.max(((Number(st.end_h??0)-Number(st.start_h??0))/total)*100, 0.5);
    return `<div class="tl-row">
      <div class="tl-label">${{st.station}}</div>
      <div class="tl-track"><div class="tl-bar" style="left:${{left}}%;width:${{width}}%"></div></div>
    </div>`;
  }}).join('')}}</div>`;
}}

function renderOrder(o) {{
  orderDetail.innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">Order</div><div class="v">${{o.order_no}}</div></div>
      <div class="card"><div class="k">Spec</div><div class="v">OD ${{o.od_mm}} / t ${{o.thickness_mm}}</div></div>
      <div class="card"><div class="k">Length / Qty</div><div class="v">${{(o.length_mm/1000).toFixed(3)}}m / ${{o.qty}}</div></div>
      <div class="card"><div class="k">Range</div><div class="v">${{o.order_start_at}} → ${{o.order_end_at}}</div></div>
    </div>
    <div class="section"><h3>공정 타임라인</h3>${{renderTimeline(o)}}</div>
    <div class="section"><h3>공정 계산식 상세</h3>
      <table><thead><tr><th>station</th><th>start</th><th>end</th><th>duration(min)</th><th>formula</th></tr></thead>
      <tbody>${{o.stations.map(st=>`<tr>
        <td>${{st.station}}${{st.expander_machine?' ('+st.expander_machine+')':''}}</td>
        <td>${{st.start_at}}</td><td>${{st.end_at}}</td><td>${{st.duration_min}}</td>
        <td class="formula">${{st.formula}}</td></tr>`).join('')}}</tbody></table>
    </div>
    <div class="section"><h3>이벤트 로그</h3>
      <table><thead><tr><th>event_time</th><th>pipe</th><th>station</th><th>resource</th><th>event_type</th><th>duration_sec</th></tr></thead>
      <tbody>${{o.event_log.map(ev=>`<tr>
        <td>${{ev.event_time}}</td><td>${{ev.pipe_seq}}</td><td>${{ev.station}}</td>
        <td>${{ev.resource}}</td><td>${{ev.event_type}}</td><td>${{ev.duration_sec}}</td></tr>`).join('')}}</tbody></table>
    </div>
  `;
}}

function selectOrder(no) {{
  const o = DATA.orders.find(x=>String(x.order_no)===String(no));
  if(!o) return;
  renderList(no);
  renderOrder(o);
}}

if (DATA.orders.length) selectOrder(DATA.orders[0].order_no);
</script>
</body>
</html>
"""


def render_view3_calendar(payload: dict) -> str:
    data_json = json.dumps(payload, ensure_ascii=False, default=str)
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>JCOE 생산 캘린더</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Segoe UI', 'Malgun Gothic', Arial, sans-serif; background: #f0f2f5; color: #212529; }}
.header {{ padding: 16px 28px; background: #fff; border-bottom: 2px solid #dee2e6; }}
.header h1 {{ font-size: 20px; font-weight: 700; color: #1a1a2e; }}
.header .meta {{ font-size: 12px; color: #6c757d; margin-top: 4px; }}
.legend {{ padding: 10px 28px; background: #fff; border-bottom: 1px solid #dee2e6;
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 11px; }}
.legend-title {{ font-weight: 600; color: #495057; }}
.legend-item {{ display: flex; align-items: center; gap: 3px; }}
.legend-swatch {{ width: 12px; height: 12px; border-radius: 2px; }}
.months {{ padding: 20px 28px; display: flex; flex-wrap: wrap; gap: 24px; }}
.month-card {{ background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 16px; min-width: 340px; flex: 1; max-width: 520px; }}
.month-title {{ font-size: 16px; font-weight: 700; color: #1a1a2e; margin-bottom: 12px;
  padding-bottom: 8px; border-bottom: 2px solid #e9ecef; }}
.cal-grid {{ display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }}
.dow {{ text-align: center; font-size: 10px; font-weight: 600; color: #868e96;
  padding: 4px 0; }}
.dow.sun {{ color: #e03131; }}
.dow.sat {{ color: #228be6; }}
.day-box {{ min-height: 80px; border: 1px solid #e9ecef; border-radius: 6px;
  padding: 2px; background: #fff; overflow: hidden; position: relative; }}
.day-box.empty {{ background: #f8f9fa; border-color: transparent; }}
.day-box.weekend {{ background: #fdf2f4; }}
.day-num {{ font-size: 11px; font-weight: 600; color: #495057; padding: 1px 4px; }}
.day-box.weekend .day-num {{ color: #868e96; }}
.order-chip {{ display: block; font-size: 8px; font-weight: 600; color: #fff;
  padding: 1px 4px; margin: 1px 1px; border-radius: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
  line-height: 14px; }}
.order-chip:hover {{ filter: brightness(1.15); }}
.order-chip.start {{ border-left: 3px solid rgba(255,255,255,0.7); }}
.order-chip.end {{ border-right: 3px solid rgba(0,0,0,0.3); }}
.day-more {{ font-size: 9px; color: #868e96; padding: 0 4px; cursor: pointer; }}
.day-more:hover {{ color: #495057; }}
.tooltip {{ display: none; position: fixed; background: #1a1a2e; color: #e6edf3;
  border-radius: 8px; padding: 12px 16px; font-size: 12px; z-index: 9999;
  pointer-events: none; max-width: 380px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }}
.tooltip .tt-title {{ font-weight: 700; color: #58a6ff; font-size: 14px; margin-bottom: 6px; }}
.tooltip .tt-row {{ margin: 3px 0; color: #8b949e; }}
.tooltip .tt-row b {{ color: #fff; }}
.stats {{ padding: 16px 28px; }}
.stats-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }}
.stat-card {{ background: #fff; border-radius: 8px; padding: 12px 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06); }}
.stat-card .label {{ font-size: 11px; color: #868e96; }}
.stat-card .value {{ font-size: 20px; font-weight: 700; color: #1a1a2e; margin-top: 2px; }}
.stat-card .value.danger {{ color: #e03131; }}
</style>
</head>
<body>
<div class="header">
  <h1>JCOE 생산 캘린더</h1>
  <div class="meta">
    계획서: {payload["plan_path"]} &middot; 생성: {payload["generated_at"]} &middot;
    총 오더: {len(payload["orders"])}건
  </div>
</div>
<div class="legend" id="legend"></div>
<div class="stats" id="stats"></div>
<div class="months" id="months"></div>
<div class="tooltip" id="tooltip"></div>

<script>
const DATA = {data_json};

const OD_COLORS = {{
  457:'#6c757d', 508:'#495057',
  610:'#20c997', 660:'#12b886', 711:'#0ca678',
  762:'#228be6', 813:'#1c7ed6', 864:'#1971c2',
  914:'#e03131', 965:'#c92a2a', 1016:'#ae3ec9',
  1067:'#7048e8', 1118:'#6741d9',
  1168:'#f08c00', 1219:'#e8590c', 1270:'#d9480f',
  1321:'#2f9e44', 1372:'#2b8a3e', 1422:'#237032',
  1473:'#d6336c', 1524:'#c2255c', 1575:'#a61e4d', 1626:'#862e9c',
}};
function getColor(od) {{
  const k = Object.keys(OD_COLORS).map(Number).sort((a,b)=>a-b);
  let best = k[0];
  for (const v of k) if (Math.abs(v-od)<Math.abs(best-od)) best=v;
  return OD_COLORS[best]||'#495057';
}}

function parseDate(s) {{ return new Date(s.replace(' ','T')+':00'); }}
function dayStart(d) {{ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }}
function dateKey(d) {{ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }}

const orders = DATA.orders.map((o,i) => ({{
  ...o, idx: i,
  color: getColor(o.od_mm),
  startDate: dayStart(parseDate(o.order_start_at)),
  endDate: dayStart(parseDate(o.order_end_at)),
}}));

// 날짜별 활성 오더 맵
const dayMap = {{}};
orders.forEach(o => {{
  let d = new Date(o.startDate);
  while (d <= o.endDate) {{
    const k = dateKey(d);
    if (!dayMap[k]) dayMap[k] = [];
    dayMap[k].push(o);
    d = new Date(d); d.setDate(d.getDate()+1);
  }}
}});

// 범례
const odSet = [...new Set(orders.map(o=>o.od_mm))].sort((a,b)=>a-b);
document.getElementById('legend').innerHTML =
  '<span class="legend-title">OD 그룹:</span>' +
  odSet.map(od=>`<span class="legend-item"><span class="legend-swatch" style="background:${{getColor(od)}}"></span>${{od}}</span>`).join('');

// 통계
const totalPipes = orders.reduce((s,o)=>s+o.qty, 0);
const bns = (DATA.bottlenecks||[]).sort((a,b)=>(b['utilization_%']||0)-(a['utilization_%']||0));
const topBn = bns[0] || {{}};
document.getElementById('stats').innerHTML = `
  <div class="stats-grid">
    <div class="stat-card"><div class="label">총 오더</div><div class="value">${{orders.length}}건</div></div>
    <div class="stat-card"><div class="label">총 파이프</div><div class="value">${{totalPipes.toLocaleString()}}본</div></div>
    <div class="stat-card"><div class="label">생산 기간</div><div class="value">${{orders[0]?.order_start_at?.slice(0,10) || '-'}} ~ ${{orders[orders.length-1]?.order_end_at?.slice(0,10) || '-'}}</div></div>
    <div class="stat-card"><div class="label">최대 병목</div><div class="value danger">${{topBn.station||'-'}} (${{topBn['utilization_%']||0}}%)</div></div>
  </div>`;

// 월 범위
const globalMin = new Date(Math.min(...orders.map(o=>o.startDate)));
const globalMax = new Date(Math.max(...orders.map(o=>o.endDate)));
const months = [];
let cur = new Date(globalMin.getFullYear(), globalMin.getMonth(), 1);
while (cur <= globalMax) {{
  months.push({{ year: cur.getFullYear(), month: cur.getMonth() }});
  cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
}}

const DOW = ['일','월','화','수','목','금','토'];
const monthsEl = document.getElementById('months');
let mhtml = '';

months.forEach(mm => {{
  const y = mm.year, m = mm.month;
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m+1, 0);
  const startDow = firstDay.getDay();

  mhtml += `<div class="month-card">`;
  mhtml += `<div class="month-title">${{y}}년 ${{m+1}}월</div>`;
  mhtml += `<div class="cal-grid">`;

  DOW.forEach((d,i) => {{
    const cls = i===0?'dow sun':(i===6?'dow sat':'dow');
    mhtml += `<div class="${{cls}}">${{d}}</div>`;
  }});

  // 빈 칸
  for (let i=0; i<startDow; i++) mhtml += '<div class="day-box empty"></div>';

  // 날짜
  for (let d=1; d<=lastDay.getDate(); d++) {{
    const dt = new Date(y, m, d);
    const dow = dt.getDay();
    const isWe = dow===0||dow===6;
    const k = dateKey(dt);
    const active = dayMap[k] || [];

    mhtml += `<div class="day-box${{isWe?' weekend':''}}">`;
    mhtml += `<div class="day-num">${{d}}</div>`;

    const maxShow = 4;
    active.slice(0, maxShow).forEach(o => {{
      const isStart = dateKey(o.startDate) === k;
      const isEnd = dateKey(o.endDate) === k;
      const cls = (isStart?'start ':'')+(isEnd?'end':'');
      mhtml += `<div class="order-chip ${{cls}}" data-idx="${{o.idx}}"
        style="background:${{o.color}}">${{o.order_no}} ${{o.qty}}본</div>`;
    }});
    if (active.length > maxShow) {{
      mhtml += `<div class="day-more">+${{active.length - maxShow}}건 더</div>`;
    }}
    mhtml += '</div>';
  }}

  // 마지막 빈 칸
  const endDow = lastDay.getDay();
  for (let i=endDow+1; i<7; i++) mhtml += '<div class="day-box empty"></div>';

  mhtml += '</div></div>';
}});

monthsEl.innerHTML = mhtml;

// 툴팁
const tooltip = document.getElementById('tooltip');
document.addEventListener('mouseover', e => {{
  const chip = e.target.closest('.order-chip');
  if (chip) {{
    const o = orders[Number(chip.dataset.idx)];
    const days = Math.round((o.endDate - o.startDate)/86400000)+1;
    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div class="tt-title">${{o.order_no}}</div>
      <div class="tt-row">OD <b>${{o.od_mm}}mm</b> / t <b>${{o.thickness_mm}}mm</b> / L <b>${{(o.length_mm/1000).toFixed(1)}}m</b></div>
      <div class="tt-row">수량: <b>${{o.qty}}본</b></div>
      <div class="tt-row">시작: <b>${{o.order_start_at}}</b></div>
      <div class="tt-row">종료: <b>${{o.order_end_at}}</b></div>
      <div class="tt-row">소요: <b>${{days}}일</b></div>`;
  }}
}});
document.addEventListener('mousemove', e => {{
  if (tooltip.style.display==='block') {{
    tooltip.style.left = Math.min(e.clientX+14, window.innerWidth-380)+'px';
    tooltip.style.top = (e.clientY+14)+'px';
  }}
}});
document.addEventListener('mouseout', e => {{
  if (e.target.closest('.order-chip')) tooltip.style.display='none';
}});
</script>
</body>
</html>
"""


# ================================================================
#  View4: Factory Floor Animation (AnyLogic-style 2D animation)
# ================================================================
def render_view4_animation(payload: dict) -> str:
    """Render an animated factory-floor view with HTML5 Canvas."""
    # Flatten all event logs across orders
    all_events = []
    for order in payload.get("orders", []):
        for ev in order.get("event_log", []):
            all_events.append(ev)
    events_json = json.dumps(all_events, ensure_ascii=False, default=str)
    bottleneck_json = json.dumps(payload.get("bottlenecks", []), ensure_ascii=False, default=str)
    orders_meta = json.dumps(
        [{"order_no": o["order_no"], "qty": o.get("qty", 0)} for o in payload.get("orders", [])],
        ensure_ascii=False, default=str,
    )

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JCOE Factory Floor Animation</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ background: #0a0e17; color: #e0e6ed; font-family: 'Segoe UI', 'Malgun Gothic', sans-serif; overflow: hidden; height: 100vh; }}
#app {{ display: grid; grid-template-rows: 56px 1fr 180px; grid-template-columns: 1fr 280px; height: 100vh; }}
/* -- Top bar -- */
#topbar {{ grid-column: 1 / -1; background: #131926; display: flex; align-items: center; gap: 18px; padding: 0 24px; border-bottom: 1px solid #1e293b; z-index: 10; }}
#topbar h1 {{ font-size: 15px; font-weight: 600; white-space: nowrap; color: #60a5fa; }}
.ctrl-group {{ display: flex; align-items: center; gap: 8px; }}
.ctrl-group label {{ font-size: 12px; color: #94a3b8; }}
#btnPlay {{ width: 36px; height: 36px; border-radius: 50%; border: none; background: #2563eb; color: #fff; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }}
#btnPlay:hover {{ background: #3b82f6; }}
#speedSlider {{ width: 120px; accent-color: #2563eb; }}
#speedLabel {{ font-size: 13px; min-width: 40px; color: #60a5fa; font-weight: 600; }}
#simTime {{ font-size: 22px; font-weight: 700; color: #f0f4ff; font-variant-numeric: tabular-nums; letter-spacing: 0.5px; margin-left: auto; }}
#progressWrap {{ width: 200px; height: 6px; background: #1e293b; border-radius: 3px; overflow: hidden; }}
#progressBar {{ height: 100%; width: 0%; background: linear-gradient(90deg, #2563eb, #60a5fa); border-radius: 3px; transition: width 0.3s; }}
/* -- Canvas area -- */
#canvasWrap {{ background: #0f1520; position: relative; overflow: hidden; }}
#factoryCanvas {{ width: 100%; height: 100%; display: block; }}
/* -- Sidebar -- */
#sidebar {{ background: #131926; border-left: 1px solid #1e293b; overflow-y: auto; padding: 12px; }}
#sidebar h2 {{ font-size: 13px; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }}
.stat-row {{ display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }}
.stat-name {{ font-size: 11px; width: 90px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #cbd5e1; }}
.stat-bar-wrap {{ flex: 1; height: 14px; background: #1e293b; border-radius: 3px; overflow: hidden; position: relative; }}
.stat-bar {{ height: 100%; border-radius: 3px; transition: width 0.4s; }}
.stat-val {{ font-size: 10px; position: absolute; right: 4px; top: 0; line-height: 14px; color: #fff; font-weight: 600; }}
.stat-queue {{ font-size: 10px; width: 28px; text-align: right; color: #94a3b8; }}
#completedCount {{ font-size: 28px; font-weight: 700; color: #22c55e; text-align: center; margin: 12px 0 4px; }}
#completedLabel {{ font-size: 11px; color: #94a3b8; text-align: center; }}
/* -- Bottom log -- */
#bottomPanel {{ grid-column: 1 / -1; background: #131926; border-top: 1px solid #1e293b; overflow-y: auto; padding: 8px 16px; }}
#bottomPanel h2 {{ font-size: 13px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }}
#logBody {{ font-size: 11px; font-family: 'Consolas', 'Courier New', monospace; }}
#logBody .log-line {{ padding: 1px 0; display: flex; gap: 12px; }}
#logBody .log-time {{ color: #64748b; min-width: 130px; }}
#logBody .log-msg {{ color: #e2e8f0; }}
.legend {{ display: flex; gap: 14px; margin-left: 18px; }}
.legend-item {{ display: flex; align-items: center; gap: 4px; font-size: 11px; color: #94a3b8; }}
.legend-dot {{ width: 10px; height: 10px; border-radius: 2px; }}
</style>
</head>
<body>
<div id="app">
  <!-- Top bar -->
  <div id="topbar">
    <h1>JCOE Factory Floor</h1>
    <div class="ctrl-group">
      <button id="btnPlay" title="Play / Pause">&#9654;</button>
    </div>
    <div class="ctrl-group">
      <label>Speed</label>
      <input type="range" id="speedSlider" min="0" max="3" step="1" value="0">
      <span id="speedLabel">1x</span>
    </div>
    <div class="ctrl-group">
      <div id="progressWrap"><div id="progressBar"></div></div>
    </div>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#22c55e"></div>Idle</div>
      <div class="legend-item"><div class="legend-dot" style="background:#3b82f6"></div>Processing</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div>Bottleneck</div>
      <div class="legend-item"><div class="legend-dot" style="background:#eab308"></div>Setup</div>
      <div class="legend-item"><div class="legend-dot" style="background:#4b5563"></div>Off-shift</div>
    </div>
    <div id="simTime">--</div>
  </div>
  <!-- Canvas -->
  <div id="canvasWrap"><canvas id="factoryCanvas"></canvas></div>
  <!-- Sidebar -->
  <div id="sidebar">
    <h2>Station Utilization</h2>
    <div id="statBars"></div>
    <div id="completedCount">0</div>
    <div id="completedLabel">Pipes Completed</div>
  </div>
  <!-- Bottom panel -->
  <div id="bottomPanel">
    <h2>Event Log</h2>
    <div id="logBody"></div>
  </div>
</div>

<script>
// ========= DATA =========
const RAW_EVENTS = {events_json};
const BOTTLENECKS = {bottleneck_json};
const ORDERS_META = {orders_meta};

// ========= CONSTANTS =========
const STATION_NAMES = [
  "EdgeMiller","PreBender","PressBender","GapPress","TackWelder",
  "InsideWelder","OutsideWelder","FirstUT","Expander",
  "EndFacing","OuterBead","HydroTest","FinalUT","RT","Packing"
];
const STATION_CAPS = {{
  EdgeMiller:2, PreBender:2, PressBender:1, GapPress:1, TackWelder:1,
  InsideWelder:4, OutsideWelder:4, FirstUT:1, Expander:2,
  EndFacing:1, OuterBead:1, HydroTest:1, FinalUT:1, RT:2, Packing:1
}};
const SPEED_MAP = [1, 10, 100, 1000];
const SHIFT_START = 8, SHIFT_END = 23;

// ========= PARSE EVENTS =========
function parseTime(s) {{
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.getTime();
}}

const events = RAW_EVENTS.map(e => ({{
  ...e,
  _t: parseTime(e.event_time),
}})).filter(e => e._t !== null).sort((a, b) => a._t - b._t);

const tMin = events.length ? events[0]._t : Date.now();
const tMax = events.length ? events[events.length - 1]._t : tMin + 86400000;

// Build bottleneck utilization lookup
const bnUtil = {{}};
BOTTLENECKS.forEach(b => {{
  const key = b.station || b.resource || b.name;
  const val = b.utilization_pct || b.utilization || b.util || 0;
  if (key) bnUtil[key] = val;
}});

// Order color palette
const orderSet = [...new Set(events.map(e => String(e.order_no)))];
function orderColor(orderNo) {{
  const idx = orderSet.indexOf(String(orderNo));
  const hue = (idx * 47) % 360;
  return `hsl(${{hue}},70%,55%)`;
}}

// ========= STATE =========
let playing = false;
let simT = tMin;
let speed = 1;
let lastFrame = null;

// Per-station runtime state
const stationState = {{}};
STATION_NAMES.forEach(s => {{
  stationState[s] = {{
    processing: [],   // [{{ orderNo, pipeSeq, startT, endT, color }}]
    queue: 0,
    utilPct: bnUtil[s] || 0,
  }};
}});

// Event index for incremental scan
let evIdx = 0;
let completedPipes = 0;
const completedSet = new Set();
const logLines = [];

// ========= UI ELEMENTS =========
const canvas = document.getElementById('factoryCanvas');
const ctx = canvas.getContext('2d');
const btnPlay = document.getElementById('btnPlay');
const speedSlider = document.getElementById('speedSlider');
const speedLabel = document.getElementById('speedLabel');
const simTimeEl = document.getElementById('simTime');
const progressBar = document.getElementById('progressBar');
const statBarsEl = document.getElementById('statBars');
const completedCountEl = document.getElementById('completedCount');
const logBodyEl = document.getElementById('logBody');

// Build stat bars
STATION_NAMES.forEach(s => {{
  const row = document.createElement('div');
  row.className = 'stat-row';
  row.innerHTML = `<span class="stat-name">${{s}}</span>
    <div class="stat-bar-wrap"><div class="stat-bar" id="bar_${{s}}" style="width:0%;background:#22c55e"></div>
    <span class="stat-val" id="val_${{s}}">0%</span></div>
    <span class="stat-queue" id="q_${{s}}">0</span>`;
  statBarsEl.appendChild(row);
}});

// ========= CONTROLS =========
btnPlay.addEventListener('click', () => {{
  playing = !playing;
  btnPlay.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
  if (playing) lastFrame = performance.now();
}});
speedSlider.addEventListener('input', () => {{
  speed = SPEED_MAP[+speedSlider.value];
  speedLabel.textContent = speed + 'x';
}});

// ========= CANVAS SIZING =========
function resize() {{
  const wrap = document.getElementById('canvasWrap');
  canvas.width = wrap.clientWidth * devicePixelRatio;
  canvas.height = wrap.clientHeight * devicePixelRatio;
  canvas.style.width = wrap.clientWidth + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}}
window.addEventListener('resize', resize);
resize();

// ========= LAYOUT GEOMETRY =========
function stationLayout(W, H) {{
  // Arrange stations in a serpentine path
  const padX = 40, padY = 50;
  const usableW = W - padX * 2;
  const usableH = H - padY * 2;
  const cols = 8;
  const rows = 2;
  const cellW = usableW / cols;
  const cellH = usableH / rows;
  const boxW = Math.min(cellW * 0.78, 130);
  const boxH = Math.min(cellH * 0.45, 56);
  const positions = [];
  // Row 0: left-to-right (stations 0..7)
  // Row 1: right-to-left (stations 8..14)
  for (let i = 0; i < STATION_NAMES.length; i++) {{
    let row, col;
    if (i < cols) {{
      row = 0; col = i;
    }} else {{
      row = 1; col = cols - 1 - (i - cols);
    }}
    const cx = padX + col * cellW + cellW / 2;
    const cy = padY + row * cellH + cellH / 2;
    positions.push({{ name: STATION_NAMES[i], cx, cy, w: boxW, h: boxH, row, col }});
  }}
  return positions;
}}

// ========= PIPE POSITIONS (interpolation on conveyor) =========
function pipePositions(layout) {{
  // Build ordered midpoints for conveyor path
  const pts = layout.map(l => ({{ x: l.cx, y: l.cy }}));
  // Add a right-side down-connector between row 0 end and row 1 start
  return pts;
}}

// ========= DRAW =========
function drawConveyors(layout) {{
  ctx.save();
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  for (let i = 0; i < layout.length; i++) {{
    const p = layout[i];
    if (i === 0) ctx.moveTo(p.cx, p.cy);
    else ctx.lineTo(p.cx, p.cy);
  }}
  ctx.stroke();
  ctx.setLineDash([]);
  // Glow
  ctx.strokeStyle = 'rgba(59,130,246,0.12)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  for (let i = 0; i < layout.length; i++) {{
    const p = layout[i];
    if (i === 0) ctx.moveTo(p.cx, p.cy);
    else ctx.lineTo(p.cx, p.cy);
  }}
  ctx.stroke();
  ctx.restore();
}}

function stationColor(name, t) {{
  const hr = new Date(t).getHours();
  if (hr < SHIFT_START || hr >= SHIFT_END) return '#374151'; // off-shift grey
  const st = stationState[name];
  if (st.processing.length > 0) {{
    if (st.utilPct > 85) return '#ef4444'; // bottleneck
    return '#3b82f6'; // processing
  }}
  return '#22c55e'; // idle
}}

function drawStations(layout, t) {{
  const hr = new Date(t).getHours();
  const offShift = hr < SHIFT_START || hr >= SHIFT_END;
  layout.forEach(l => {{
    const st = stationState[l.name];
    const col = stationColor(l.name, t);
    const isBottleneck = st.utilPct > 85 && st.processing.length > 0 && !offShift;
    // Glow / pulse for bottleneck
    if (isBottleneck) {{
      const pulse = 0.35 + 0.25 * Math.sin(performance.now() / 200);
      ctx.save();
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 18 * pulse + 8;
      ctx.fillStyle = `rgba(239,68,68,${{pulse * 0.4}})`;
      ctx.beginPath();
      ctx.roundRect(l.cx - l.w/2 - 6, l.cy - l.h/2 - 6, l.w + 12, l.h + 12, 10);
      ctx.fill();
      ctx.restore();
    }}
    // Station box
    ctx.save();
    if (!offShift && st.processing.length > 0) {{
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
    }}
    ctx.fillStyle = col;
    ctx.globalAlpha = offShift ? 0.35 : 0.85;
    ctx.beginPath();
    ctx.roundRect(l.cx - l.w/2, l.cy - l.h/2, l.w, l.h, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    // Border
    ctx.strokeStyle = offShift ? '#374151' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(l.cx - l.w/2, l.cy - l.h/2, l.w, l.h, 8);
    ctx.stroke();
    // Name
    ctx.fillStyle = '#f0f4ff';
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.name, l.cx, l.cy - 8);
    // Capacity label
    ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${{st.processing.length}}/${{STATION_CAPS[l.name]}}  Q:${{st.queue}}`, l.cx, l.cy + 8);
    // Processing pipe dots
    if (st.processing.length > 0) {{
      const dotR = 5;
      const startX = l.cx - (st.processing.length - 1) * 7;
      st.processing.forEach((p, pi) => {{
        ctx.beginPath();
        ctx.arc(startX + pi * 14, l.cy + l.h/2 + 10, dotR, 0, Math.PI*2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }});
    }}
  }});
}}

function drawMovingPipes(layout, t) {{
  // Draw pipes that are between stations (traveling)
  // We track transitions: a pipe that ended at station i should travel to station i+1
  // Show them along the conveyor line
  const now = t;
  events.forEach(ev => {{
    if (ev.event_type !== 'PROCESS_END') return;
    const endT = ev._t;
    if (endT > now) return;
    const stIdx = STATION_NAMES.indexOf(ev.station);
    if (stIdx < 0 || stIdx >= STATION_NAMES.length - 1) return;
    // Find next PROCESS_START for same pipe at next station
    const nextStation = STATION_NAMES[stIdx + 1];
    // Use a fixed transit time of ~60 seconds visual
    const transitMs = 60000;
    const arriveT = endT + transitMs;
    if (now > arriveT) return; // already arrived
    // Interpolate position
    const frac = Math.max(0, Math.min(1, (now - endT) / transitMs));
    const from = layout[stIdx];
    const to = layout[stIdx + 1];
    const px = from.cx + (to.cx - from.cx) * frac;
    const py = from.cy + (to.cy - from.cy) * frac;
    const col = orderColor(ev.order_no);
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
  }});
}}

// ========= EVENT PROCESSING =========
function processEventsUpTo(t) {{
  while (evIdx < events.length && events[evIdx]._t <= t) {{
    const ev = events[evIdx];
    const st = stationState[ev.station];
    if (!st) {{ evIdx++; continue; }}
    if (ev.event_type === 'PROCESS_START') {{
      st.processing.push({{
        orderNo: ev.order_no,
        pipeSeq: ev.pipe_seq,
        startT: ev._t,
        endT: ev._t + (ev.duration_sec || 0) * 1000,
        color: orderColor(ev.order_no),
      }});
      addLog(ev._t, `START ${{ev.station}} | Order ${{ev.order_no}} Pipe#${{ev.pipe_seq}}`);
    }} else if (ev.event_type === 'PROCESS_END') {{
      // Remove matching entry
      const idx = st.processing.findIndex(p => p.orderNo == ev.order_no && p.pipeSeq == ev.pipe_seq);
      if (idx >= 0) st.processing.splice(idx, 1);
      // Track completed pipes at Packing
      if (ev.station === 'Packing') {{
        const key = ev.order_no + '_' + ev.pipe_seq;
        if (!completedSet.has(key)) {{
          completedSet.add(key);
          completedPipes++;
        }}
      }}
      addLog(ev._t, `END   ${{ev.station}} | Order ${{ev.order_no}} Pipe#${{ev.pipe_seq}}`);
    }}
    evIdx++;
  }}
  // Update queue counts heuristic: count PROCESS_START without matching END that haven't begun processing
  // Simplified: queue = number of events where start is pending minus capacity
  STATION_NAMES.forEach(s => {{
    const st = stationState[s];
    st.queue = Math.max(0, st.processing.length - STATION_CAPS[s]);
  }});
}}

function resetSim() {{
  evIdx = 0;
  completedPipes = 0;
  completedSet.clear();
  logLines.length = 0;
  STATION_NAMES.forEach(s => {{
    stationState[s].processing = [];
    stationState[s].queue = 0;
  }});
}}

function addLog(t, msg) {{
  const d = new Date(t);
  const ts = d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0') + ' ' +
    String(d.getHours()).padStart(2,'0') + ':' +
    String(d.getMinutes()).padStart(2,'0') + ':' +
    String(d.getSeconds()).padStart(2,'0');
  logLines.push({{ ts, msg }});
  if (logLines.length > 200) logLines.shift();
}}

// ========= UPDATE UI =========
function updateUI(t) {{
  // Time display
  const d = new Date(t);
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  simTimeEl.textContent = d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0') + ' (' +
    dayNames[d.getDay()] + ') ' +
    String(d.getHours()).padStart(2,'0') + ':' +
    String(d.getMinutes()).padStart(2,'0');

  // Progress
  const pct = Math.min(100, (t - tMin) / (tMax - tMin) * 100);
  progressBar.style.width = pct.toFixed(1) + '%';

  // Station bars
  STATION_NAMES.forEach(s => {{
    const st = stationState[s];
    const util = st.utilPct;
    const bar = document.getElementById('bar_' + s);
    const val = document.getElementById('val_' + s);
    const q = document.getElementById('q_' + s);
    bar.style.width = util + '%';
    bar.style.background = util > 85 ? '#ef4444' : util > 50 ? '#3b82f6' : '#22c55e';
    val.textContent = util.toFixed(0) + '%';
    q.textContent = st.queue;
  }});

  completedCountEl.textContent = completedPipes;

  // Log (show last 40 lines)
  const recent = logLines.slice(-40);
  logBodyEl.innerHTML = recent.map(l =>
    `<div class="log-line"><span class="log-time">${{l.ts}}</span><span class="log-msg">${{l.msg}}</span></div>`
  ).join('');
  logBodyEl.scrollTop = logBodyEl.scrollHeight;
}}

// ========= ANIMATION LOOP =========
function frame(ts) {{
  requestAnimationFrame(frame);
  if (playing) {{
    if (lastFrame === null) lastFrame = ts;
    const dtReal = ts - lastFrame;
    lastFrame = ts;
    const dtSim = dtReal * speed; // ms of sim time per frame
    simT = Math.min(simT + dtSim, tMax);
    if (simT >= tMax) {{
      playing = false;
      btnPlay.innerHTML = '&#9654;';
    }}
  }} else {{
    lastFrame = ts;
  }}

  processEventsUpTo(simT);

  // Draw
  const W = canvas.width / devicePixelRatio;
  const H = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, W, H);

  // Background grid
  ctx.fillStyle = '#0f1520';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1a2233';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < W; x += 40) {{ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }}
  for (let y = 0; y < H; y += 40) {{ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }}

  const layout = stationLayout(W, H);
  drawConveyors(layout);
  drawStations(layout, simT);
  drawMovingPipes(layout, simT);

  // Title watermark
  ctx.save();
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#1e293b';
  ctx.textAlign = 'right';
  ctx.fillText('JCOE Simulation', W - 10, H - 8);
  ctx.restore();

  updateUI(simT);
}}

// ========= INIT =========
// Compute dynamic utilization from events if bottleneck data has station key
STATION_NAMES.forEach(s => {{
  // Try various key patterns from bottleneck data
  const match = BOTTLENECKS.find(b =>
    (b.station || b.resource || b.name || '') === s ||
    (b.station || b.resource || b.name || '').startsWith(s)
  );
  if (match) {{
    stationState[s].utilPct = match.utilization_pct || match.utilization || match.util || match.busy_pct || 0;
  }}
}});

requestAnimationFrame(frame);

// Allow click on progress bar to seek
document.getElementById('progressWrap').addEventListener('click', (e) => {{
  const rect = e.currentTarget.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  const targetT = tMin + frac * (tMax - tMin);
  // Need to reset and replay
  resetSim();
  simT = targetT;
  processEventsUpTo(simT);
}});
</script>
</body>
</html>
"""


def render_view5_3d(payload: dict) -> str:
    """Render 3D factory floor simulation using Three.js."""
    all_events = []
    for order in payload.get("orders", []):
        for ev in order.get("event_log", []):
            all_events.append(ev)

    data_json = json.dumps({
        "events": all_events,
        "bottlenecks": payload.get("bottlenecks", []),
        "orders": [{"order_no": o["order_no"], "od_mm": o.get("od_mm", 0),
                     "thickness_mm": o.get("thickness_mm", 0), "qty": o.get("qty", 0)}
                    for o in payload.get("orders", [])]
    }, ensure_ascii=False, default=str)

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JCOE 3D Factory Floor Simulation</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:100%; height:100%; overflow:hidden; font-family:'Segoe UI','Malgun Gothic',sans-serif; background:#0d1117; color:#c9d1d9; }}
#container {{ width:100%; height:100%; position:relative; }}
canvas {{ display:block; }}

/* Top bar */
#topbar {{
  position:absolute; top:0; left:0; right:0; height:52px; z-index:100;
  background:rgba(13,17,23,0.92); backdrop-filter:blur(8px);
  border-bottom:1px solid #21262d;
  display:flex; align-items:center; padding:0 20px; gap:16px;
}}
#topbar h1 {{ font-size:15px; font-weight:700; color:#58a6ff; white-space:nowrap; }}
.tb-group {{ display:flex; align-items:center; gap:8px; }}
.tb-group label {{ font-size:11px; color:#8b949e; }}
#btnPlay {{
  width:34px; height:34px; border-radius:50%; border:2px solid #58a6ff;
  background:transparent; color:#58a6ff; font-size:14px; cursor:pointer;
  display:flex; align-items:center; justify-content:center; transition:all .2s;
}}
#btnPlay:hover {{ background:#58a6ff; color:#0d1117; }}
#btnPlay.playing {{ background:#58a6ff; color:#0d1117; }}
.speed-btn {{
  padding:3px 10px; border-radius:12px; border:1px solid #30363d;
  background:transparent; color:#8b949e; font-size:11px; cursor:pointer;
  font-weight:600; transition:all .2s;
}}
.speed-btn.active {{ background:#58a6ff; color:#0d1117; border-color:#58a6ff; }}
#simTime {{ font-size:20px; font-weight:700; color:#f0f6fc; font-variant-numeric:tabular-nums; margin-left:auto; }}
#nightBadge {{ display:none; background:#eab308; color:#000; padding:2px 10px; border-radius:10px; font-size:11px; font-weight:700; margin-left:8px; }}
#progressWrap {{ width:180px; height:5px; background:#21262d; border-radius:3px; overflow:hidden; margin-left:12px; }}
#progressBar {{ height:100%; width:0%; background:linear-gradient(90deg,#58a6ff,#3fb950); border-radius:3px; transition:width .3s; }}

/* Right panel */
#rightPanel {{
  position:absolute; top:60px; right:8px; width:260px; bottom:60px; z-index:100;
  background:rgba(13,17,23,0.88); backdrop-filter:blur(8px);
  border:1px solid #21262d; border-radius:10px; overflow-y:auto;
  padding:12px; font-size:11px;
}}
#rightPanel h2 {{ font-size:12px; color:#8b949e; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; }}
.st-row {{ display:flex; align-items:center; gap:5px; margin-bottom:5px; }}
.st-name {{ width:85px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#c9d1d9; font-size:10px; }}
.st-bar-wrap {{ flex:1; height:13px; background:#161b22; border-radius:3px; overflow:hidden; position:relative; }}
.st-bar {{ height:100%; border-radius:3px; transition:width .4s; }}
.st-val {{ position:absolute; right:3px; top:0; line-height:13px; font-size:9px; color:#fff; font-weight:700; }}
.st-info {{ font-size:9px; color:#8b949e; width:40px; text-align:right; }}

/* Bottom bar */
#bottomBar {{
  position:absolute; bottom:0; left:0; right:0; height:52px; z-index:100;
  background:rgba(13,17,23,0.92); backdrop-filter:blur(8px);
  border-top:1px solid #21262d;
  display:flex; align-items:center; padding:0 20px; gap:24px;
}}
#completedInfo {{ font-size:13px; color:#3fb950; font-weight:700; }}
#processingInfo {{ font-size:11px; color:#8b949e; flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }}
#resetCam {{
  padding:5px 14px; border-radius:8px; border:1px solid #30363d;
  background:transparent; color:#8b949e; font-size:11px; cursor:pointer;
}}
#resetCam:hover {{ background:#21262d; color:#c9d1d9; }}

/* Legend */
.legend {{ display:flex; gap:12px; }}
.legend-item {{ display:flex; align-items:center; gap:4px; font-size:10px; color:#8b949e; }}
.legend-dot {{ width:8px; height:8px; border-radius:50%; }}
</style>
</head>
<body>
<div id="container">
  <div id="topbar">
    <h1>JCOE 3D Factory</h1>
    <div class="tb-group">
      <button id="btnPlay" title="Play/Pause">&#9654;</button>
    </div>
    <div class="tb-group">
      <label>Speed</label>
      <button class="speed-btn active" data-speed="1">1x</button>
      <button class="speed-btn" data-speed="10">10x</button>
      <button class="speed-btn" data-speed="100">100x</button>
      <button class="speed-btn" data-speed="1000">1000x</button>
    </div>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#3fb950"></div>Idle</div>
      <div class="legend-item"><div class="legend-dot" style="background:#58a6ff"></div>Processing</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f85149"></div>Bottleneck</div>
      <div class="legend-item"><div class="legend-dot" style="background:#484f58"></div>Off</div>
    </div>
    <span id="nightBadge">&#127769; NIGHT</span>
    <span id="simTime">--</span>
    <div id="progressWrap"><div id="progressBar"></div></div>
  </div>

  <div id="rightPanel">
    <h2>Station Utilization</h2>
    <div id="stationStats"></div>
    <h2 style="margin-top:14px;">Work Orders</h2>
    <div id="orderLegend" style="max-height:200px;overflow-y:auto;"></div>
  </div>

  <div id="bottomBar">
    <span id="completedInfo">Completed: 0</span>
    <span id="processingInfo"></span>
    <button id="resetCam">Reset Camera</button>
  </div>
</div>

<script type="importmap">
{{
  "imports": {{
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
  }}
}}
</script>
<script type="module">
import * as THREE from 'three';
import {{ OrbitControls }} from 'three/addons/controls/OrbitControls.js';
import {{ CSS2DRenderer, CSS2DObject }} from 'three/addons/renderers/CSS2DRenderer.js';

// ─── DATA ───
const DATA = {data_json};
const events = DATA.events.map(e => ({{ ...e, _t: new Date(e.event_time).getTime() }}))
  .sort((a,b) => a._t - b._t);
const bottlenecks = DATA.bottlenecks;
const orders = DATA.orders;

// ─── STATION DEFINITIONS ───
const STATIONS = [
  {{ name:'EdgeMiller',    count:2, color:0x2563eb, label:'Edge Miller' }},
  {{ name:'PreBender',     count:2, color:0x4b5563, label:'Pre Bender' }},
  {{ name:'PressBender',   count:1, color:0x6b7280, label:'Press Bender' }},
  {{ name:'GapPress',      count:1, color:0x6b7280, label:'Gap Press' }},
  {{ name:'TackWelder',    count:1, color:0xd97706, label:'Tack Welder' }},
  {{ name:'InsideWelder',  count:4, color:0xf59e0b, label:'Inside Welder' }},
  {{ name:'OutsideWelder', count:4, color:0xe97451, label:'Outside Welder' }},
  {{ name:'FirstUT',       count:1, color:0x8b5cf6, label:'First UT' }},
  {{ name:'Expander',      count:2, color:0x059669, label:'Expander' }},
  {{ name:'EndFacing',     count:1, color:0x6366f1, label:'End Facing' }},
  {{ name:'OuterBead',     count:1, color:0x7c3aed, label:'Outer Bead' }},
  {{ name:'HydroTest',     count:1, color:0x0ea5e9, label:'Hydro Test' }},
  {{ name:'FinalUT',       count:1, color:0x8b5cf6, label:'Final UT' }},
  {{ name:'RT',            count:2, color:0xec4899, label:'RT X-Ray' }},
  {{ name:'Packing',       count:1, color:0x78716c, label:'Packing' }},
];

// Build utilization lookup
const utilizationMap = {{}};
bottlenecks.forEach(b => {{
  const key = (b.station || b.resource || '').replace(/_\\d+$/,'');
  if (!utilizationMap[key]) utilizationMap[key] = b.utilization || b.utilization_pct || 0;
}});

// ─── LAYOUT (U-shape on XZ plane) ───
function buildLayout() {{
  const positions = [];
  // Row 1: left to right (stations 0-6)
  const row1Count = 7;
  const spacing = 10;
  const startX = -(row1Count - 1) * spacing / 2;
  for (let i = 0; i < row1Count; i++) {{
    positions.push({{ x: startX + i * spacing, z: -18 }});
  }}
  // Turn: station 7 goes down
  positions.push({{ x: startX + 6 * spacing, z: -6 }});
  // Row 2: right to left (stations 8-14)
  const row2Count = 7;
  for (let i = 0; i < row2Count; i++) {{
    positions.push({{ x: startX + (6 - i) * spacing, z: 6 }});
  }}
  return positions;
}}

const layoutPositions = buildLayout();

// ─── THREE.JS SETUP ───
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.FogExp2(0x1a1a2e, 0.006);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 55, 55);
camera.lookAt(0, 0, -5);

const renderer = new THREE.WebGLRenderer({{ antialias: true, alpha: false }});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.getElementById('container').insertBefore(renderer.domElement, document.getElementById('topbar'));

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.getElementById('container').insertBefore(labelRenderer.domElement, document.getElementById('topbar'));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 15;
controls.maxDistance = 150;
controls.target.set(0, 0, -5);

// ─── LIGHTING ───
const ambient = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(30, 50, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -60;
dirLight.shadow.camera.right = 60;
dirLight.shadow.camera.top = 40;
dirLight.shadow.camera.bottom = -40;
scene.add(dirLight);

const pointLight1 = new THREE.PointLight(0x58a6ff, 0.4, 100);
pointLight1.position.set(-20, 20, -15);
scene.add(pointLight1);
const pointLight2 = new THREE.PointLight(0x3fb950, 0.3, 100);
pointLight2.position.set(20, 20, 10);
scene.add(pointLight2);

// ─── FLOOR ───
const floorGeo = new THREE.PlaneGeometry(140, 80);
const floorMat = new THREE.MeshStandardMaterial({{ color: 0x1e2233, roughness: 0.9, metalness: 0.1 }});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.5;
floor.receiveShadow = true;
scene.add(floor);

// Grid
const gridHelper = new THREE.GridHelper(140, 70, 0x2a2a4a, 0x2a2a4a);
gridHelper.position.y = -0.48;
scene.add(gridHelper);

// ─── BUILD MACHINES ───
const machineGroups = []; // [{{ group, name, statusLight, bodies, count }}]
const statusLights = []; // flat list of all status light meshes per sub-machine

STATIONS.forEach((st, si) => {{
  const pos = layoutPositions[si];
  const group = new THREE.Group();
  group.position.set(pos.x, 0, pos.z);
  scene.add(group);

  const subMachines = [];
  const subSpacing = st.count > 1 ? 3.5 : 0;
  const startOffset = -(st.count - 1) * subSpacing / 2;

  for (let mi = 0; mi < st.count; mi++) {{
    const subGroup = new THREE.Group();
    const offsetZ = startOffset + mi * subSpacing;
    subGroup.position.z = offsetZ;

    // Main body
    const w = 3.5, h = 2.2, d = 2.0;
    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    const bodyMat = new THREE.MeshStandardMaterial({{
      color: st.color,
      roughness: 0.4,
      metalness: 0.6,
      emissive: new THREE.Color(st.color).multiplyScalar(0.1),
    }});
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    subGroup.add(body);

    // Control panel
    const panelGeo = new THREE.BoxGeometry(0.6, 1.0, 0.8);
    const panelMat = new THREE.MeshStandardMaterial({{ color: 0x2d333b, roughness: 0.5, metalness: 0.3 }});
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(w / 2 + 0.35, 0.5, 0);
    panel.castShadow = true;
    subGroup.add(panel);

    // Screen on panel
    const screenGeo = new THREE.PlaneGeometry(0.4, 0.3);
    const screenMat = new THREE.MeshStandardMaterial({{ color: 0x58a6ff, emissive: 0x58a6ff, emissiveIntensity: 0.3 }});
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(w / 2 + 0.66, 0.7, 0);
    screen.rotation.y = Math.PI / 2;
    subGroup.add(screen);

    // Status light (sphere on top)
    const lightGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const lightMat = new THREE.MeshStandardMaterial({{
      color: 0x3fb950,
      emissive: 0x3fb950,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.0,
    }});
    const statusLight = new THREE.Mesh(lightGeo, lightMat);
    statusLight.position.y = h + 0.4;
    subGroup.add(statusLight);

    // Pipe support rails
    const railGeo = new THREE.BoxGeometry(3.5, 0.08, 0.1);
    const railMat = new THREE.MeshStandardMaterial({{ color: 0x484f58, metalness: 0.8, roughness: 0.3 }});
    const rail1 = new THREE.Mesh(railGeo, railMat);
    rail1.position.set(0, 0.04, d/2 + 0.3);
    subGroup.add(rail1);
    const rail2 = rail1.clone();
    rail2.position.z = -(d/2 + 0.3);
    subGroup.add(rail2);

    group.add(subGroup);
    subMachines.push({{ subGroup, body, statusLight, bodyMat }});
    statusLights.push({{ stationName: st.name, idx: mi, light: statusLight, mat: lightMat, bodyMat }});
  }}

  // Label (CSS2D)
  const labelDiv = document.createElement('div');
  labelDiv.style.cssText = 'font-size:11px;font-weight:700;color:#f0f6fc;background:rgba(13,17,23,0.8);padding:2px 8px;border-radius:4px;white-space:nowrap;border:1px solid #30363d;';
  labelDiv.textContent = st.label + (st.count > 1 ? ' (' + st.count + ')' : '');
  const labelObj = new CSS2DObject(labelDiv);
  labelObj.position.y = 4.0;
  group.add(labelObj);

  machineGroups.push({{ group, name: st.name, subMachines, count: st.count }});
}});

// ─── CONVEYOR LINES ───
const conveyorMaterial = new THREE.MeshStandardMaterial({{
  color: 0x1e40af,
  emissive: 0x1e40af,
  emissiveIntensity: 0.3,
  roughness: 0.3,
  metalness: 0.7,
}});

for (let i = 0; i < layoutPositions.length - 1; i++) {{
  const from = layoutPositions[i];
  const to = layoutPositions[i + 1];
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const midX = (from.x + to.x) / 2;
  const midZ = (from.z + to.z) / 2;

  const convGeo = new THREE.BoxGeometry(dist, 0.08, 0.6);
  const conv = new THREE.Mesh(convGeo, conveyorMaterial);
  conv.position.set(midX, 0.04, midZ);
  conv.rotation.y = Math.atan2(dz, dx);
  conv.receiveShadow = true;
  scene.add(conv);

  // Side rails for conveyor
  const sideGeo = new THREE.BoxGeometry(dist, 0.15, 0.06);
  const sideMat = new THREE.MeshStandardMaterial({{ color: 0x30363d, metalness: 0.5, roughness: 0.5 }});
  const sideA = new THREE.Mesh(sideGeo, sideMat);
  sideA.position.set(midX, 0.08, midZ);
  sideA.rotation.y = Math.atan2(dz, dx);
  const offsetX = -Math.sin(sideA.rotation.y) * 0.33;
  const offsetZ = Math.cos(sideA.rotation.y) * 0.33;
  sideA.position.x += offsetX;
  sideA.position.z += offsetZ;
  scene.add(sideA);
  const sideB = sideA.clone();
  sideB.position.x = midX - offsetX;
  sideB.position.z = midZ - offsetZ;
  scene.add(sideB);
}}

// ─── PIPE POOL ───
const MAX_PIPES = 200;
const pipeGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.2, 8);
pipeGeo.rotateZ(Math.PI / 2);
const pipeMeshes = [];
const pipeMaterials = [];
for (let i = 0; i < MAX_PIPES; i++) {{
  const mat = new THREE.MeshStandardMaterial({{ color: 0xffffff, roughness: 0.3, metalness: 0.7, emissive: 0x000000, emissiveIntensity: 0.3 }});
  const mesh = new THREE.Mesh(pipeGeo, mat);
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  pipeMeshes.push(mesh);
  pipeMaterials.push(mat);
}}

// ─── ORDER COLOR MAP (distinct colors per work order) ───
const ORDER_PALETTE = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231,
  0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0xfabed4,
  0x469990, 0xdcbeff, 0x9A6324, 0xfffac8, 0x800000,
  0xaaffc3, 0x808000, 0xffd8b1, 0x000075, 0xa9a9a9,
  0xff6384, 0x36a2eb, 0xffce56, 0x4bc0c0, 0x9966ff,
  0xff9f40, 0xc9cbcf, 0x7bc8a4, 0xe7698a, 0x5ad45a,
];
const orderColorCache = {{}};
let orderColorIdx = 0;
function orderToColor(orderNo) {{
  const key = String(orderNo);
  if (!orderColorCache[key]) {{
    orderColorCache[key] = new THREE.Color(ORDER_PALETTE[orderColorIdx % ORDER_PALETTE.length]);
    orderColorIdx++;
  }}
  return orderColorCache[key];
}}

// ─── QUEUE PIPE POOL (pipes stacked in front of station) ───
const MAX_QUEUE_PIPES = 300;
const queuePipeGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.8, 6);
queuePipeGeo.rotateZ(Math.PI / 2);
const queuePipeMeshes = [];
const queuePipeMaterials = [];
for (let i = 0; i < MAX_QUEUE_PIPES; i++) {{
  const mat = new THREE.MeshStandardMaterial({{ color: 0x888888, roughness: 0.4, metalness: 0.5, emissive: 0x000000, emissiveIntensity: 0.15 }});
  const mesh = new THREE.Mesh(queuePipeGeo, mat);
  mesh.visible = false;
  mesh.castShadow = true;
  scene.add(mesh);
  queuePipeMeshes.push(mesh);
  queuePipeMaterials.push(mat);
}}

// ─── QUEUE COUNT LABELS (3D text above queue) ───
const queueLabels = {{}};
STATIONS.forEach((st, si) => {{
  const pos = layoutPositions[si];
  const div = document.createElement('div');
  div.style.cssText = 'font-size:10px;font-weight:700;color:#f85149;background:rgba(248,81,73,0.15);padding:1px 6px;border-radius:3px;border:1px solid #f85149;display:none;';
  const label = new CSS2DObject(div);
  label.position.set(pos.x, 3.5, pos.z + 5);
  scene.add(label);
  queueLabels[st.name] = {{ label, div, stIdx: si }};
}});

// ─── SIMULATION STATE ───
let simTime = events.length > 0 ? events[0]._t : Date.now();
const simEnd = events.length > 0 ? events[events.length - 1]._t : simTime;
const simStart = simTime;
let playing = false;
let speedMult = 1;
let eventIdx = 0;

// Per-station runtime state
const stationState = {{}};
STATIONS.forEach(st => {{
  stationState[st.name] = {{
    processing: new Map(), // resource -> {{ orderNo, pipe, startT }}
    queueList: [],          // [{{ orderNo, pipe }}] - actual queue items for visual stacking
    queue: 0,
    active: 0,
    completed: 0,
  }};
}});
let totalCompleted = 0;

// Active pipes for rendering
const activePipes = new Map();

// ─── PROCESS EVENTS ───
function processEventsUpTo(t) {{
  while (eventIdx < events.length && events[eventIdx]._t <= t) {{
    const ev = events[eventIdx];
    const stName = ev.station;
    const state = stationState[stName];
    if (!state) {{ eventIdx++; continue; }}
    const pipeId = ev.pipe_seq || ev.pipe || 0;
    const key = ev.order_no + '|' + pipeId + '|' + stName;

    if (ev.event_type === 'PROCESS_START') {{
      state.processing.set(ev.resource || stName, {{ orderNo: ev.order_no, pipe: pipeId, startT: ev._t }});
      state.active = state.processing.size;
      // Remove from queue
      if (state.queue > 0) state.queue--;
      const qRemIdx = state.queueList.findIndex(q => q.orderNo === ev.order_no && q.pipe === pipeId);
      if (qRemIdx >= 0) state.queueList.splice(qRemIdx, 1);

      activePipes.set(key, {{
        stationName: stName,
        orderNo: ev.order_no,
        pipe: pipeId,
        startT: ev._t,
        endT: ev._t + (ev.duration_sec || 300) * 1000,
        state: 'processing',
      }});
    }} else if (ev.event_type === 'PROCESS_END') {{
      state.processing.delete(ev.resource || stName);
      state.active = state.processing.size;
      state.completed++;

      const stIdx = STATIONS.findIndex(s => s.name === stName);
      if (stIdx === STATIONS.length - 1) {{
        totalCompleted++;
        activePipes.delete(key);
      }} else {{
        const existing = activePipes.get(key);
        if (existing) {{
          existing.state = 'transit';
          existing.transitStart = ev._t;
          existing.fromStationIdx = stIdx;
          existing.toStationIdx = stIdx + 1;
        }}
        // Add to next station queue with order info
        const nextName = STATIONS[stIdx + 1].name;
        const nextState = stationState[nextName];
        nextState.queue++;
        nextState.queueList.push({{ orderNo: ev.order_no, pipe: pipeId }});
      }}
    }} else if (ev.event_type === 'QUEUE_ENTER') {{
      state.queue++;
      state.queueList.push({{ orderNo: ev.order_no, pipe: pipeId }});
    }}
    eventIdx++;
  }}
}}

// Clean up old pipes from activePipes
function cleanupPipes(t) {{
  const transitTime = 60000; // 60s visual transit
  for (const [key, p] of activePipes) {{
    if (p.state === 'transit' && t > p.transitStart + transitTime) {{
      activePipes.delete(key);
    }}
    if (p.state === 'processing' && t > p.endT + 5000) {{
      activePipes.delete(key);
    }}
  }}
}}

// ─── RENDER PIPES ───
function updatePipeVisuals(t) {{
  let pipeIdx = 0;
  const transitTime = 60000;

  for (const [key, p] of activePipes) {{
    if (pipeIdx >= MAX_PIPES) break;
    const mesh = pipeMeshes[pipeIdx];
    const mat = pipeMaterials[pipeIdx];
    mesh.visible = true;

    const col = orderToColor(p.orderNo);
    mat.color.copy(col);
    mat.emissive.copy(col).multiplyScalar(0.2);

    const stIdx = STATIONS.findIndex(s => s.name === p.stationName);
    if (stIdx < 0) {{ mesh.visible = false; pipeIdx++; continue; }}

    if (p.state === 'processing') {{
      const pos = layoutPositions[stIdx];
      mesh.position.set(pos.x, 0.5, pos.z + 2.0);
      // Slight bob animation
      mesh.position.y += Math.sin(t * 0.003 + pipeIdx) * 0.05;
    }} else if (p.state === 'transit' && p.fromStationIdx !== undefined) {{
      const from = layoutPositions[p.fromStationIdx];
      const to = layoutPositions[p.toStationIdx];
      const frac = Math.min(1, (t - p.transitStart) / transitTime);
      const eased = frac < 0.5 ? 2 * frac * frac : 1 - Math.pow(-2 * frac + 2, 2) / 2;
      mesh.position.set(
        from.x + (to.x - from.x) * eased,
        0.5 + Math.sin(eased * Math.PI) * 1.5,
        from.z + (to.z - from.z) * eased
      );
    }} else {{
      mesh.visible = false;
    }}
    pipeIdx++;
  }}

  // Hide unused
  for (let i = pipeIdx; i < MAX_PIPES; i++) {{
    pipeMeshes[i].visible = false;
  }}
}}

// ─── UPDATE QUEUE VISUALS (pipes stacked before bottleneck station) ───
function updateQueueVisuals(t) {{
  let qIdx = 0;
  STATIONS.forEach((st, si) => {{
    const state = stationState[st.name];
    const qLen = state.queueList.length;
    const pos = layoutPositions[si];
    const ql = queueLabels[st.name];

    // Show queue count label
    if (qLen > 0) {{
      ql.div.style.display = 'block';
      ql.div.textContent = '⏳ ' + qLen + ' waiting';
    }} else {{
      ql.div.style.display = 'none';
    }}

    // Stack pipes visually in front of this station
    // Direction: towards the previous station (where pipes come from)
    const maxShow = Math.min(qLen, 20); // limit visual pipes per station
    for (let qi = 0; qi < maxShow; qi++) {{
      if (qIdx >= MAX_QUEUE_PIPES) break;
      const mesh = queuePipeMeshes[qIdx];
      const mat = queuePipeMaterials[qIdx];
      mesh.visible = true;

      const item = state.queueList[qi];
      const col = orderToColor(item.orderNo);
      mat.color.copy(col);
      mat.emissive.copy(col).multiplyScalar(0.1);

      // Stack layout: rows of 5, stacked upward
      const col5 = qi % 5;
      const row5 = Math.floor(qi / 5);
      const stackX = pos.x + (col5 - 2) * 0.5;
      const stackY = 0.2 + row5 * 0.4;
      // Offset toward incoming side (z direction)
      const stackZ = si < 7 ? pos.z + 3.5 + row5 * 0.1 : (si === 7 ? pos.z + 3.5 : pos.z - 3.5 - row5 * 0.1);

      mesh.position.set(stackX, stackY, stackZ);
      qIdx++;
    }}
  }});

  // Hide unused
  for (let i = qIdx; i < MAX_QUEUE_PIPES; i++) {{
    queuePipeMeshes[i].visible = false;
  }}
}}

// ─── UPDATE STATION VISUALS ───
function updateStationVisuals(t) {{
  const hour = new Date(t).getHours();
  const isNight = hour >= 23 || hour < 8;

  statusLights.forEach(sl => {{
    const state = stationState[sl.stationName];
    if (!state) return;

    let color, emissiveIntensity;
    if (isNight) {{
      color = 0x484f58;
      emissiveIntensity = 0.2;
    }} else if (state.active > 0) {{
      // Check if bottleneck
      const util = utilizationMap[sl.stationName] || 0;
      if (util >= 85) {{
        color = 0xf85149;
        emissiveIntensity = 1.0 + Math.sin(t * 0.005) * 0.3;
      }} else {{
        color = 0x58a6ff;
        emissiveIntensity = 0.8;
      }}
    }} else {{
      color = 0x3fb950;
      emissiveIntensity = 0.5;
    }}

    sl.mat.color.setHex(color);
    sl.mat.emissive.setHex(color);
    sl.mat.emissiveIntensity = emissiveIntensity;

    // Dim machine body during night
    if (isNight) {{
      sl.bodyMat.emissive.setHex(0x000000);
      sl.bodyMat.emissiveIntensity = 0;
    }} else if (state.active > 0) {{
      sl.bodyMat.emissive.setHex(sl.bodyMat.color.getHex());
      sl.bodyMat.emissiveIntensity = 0.15;
    }} else {{
      sl.bodyMat.emissive.setHex(0x000000);
      sl.bodyMat.emissiveIntensity = 0;
    }}
  }});
}}

// ─── UI UPDATE ───
const stationStatsEl = document.getElementById('stationStats');
function buildStationUI() {{
  let html = '';
  STATIONS.forEach(st => {{
    html += `<div class="st-row" data-station="${{st.name}}">
      <span class="st-name">${{st.label}}</span>
      <div class="st-bar-wrap"><div class="st-bar" id="bar_${{st.name}}"></div><span class="st-val" id="val_${{st.name}}">0%</span></div>
      <span class="st-info" id="info_${{st.name}}">0/${{st.count}}</span>
    </div>`;
  }});
  stationStatsEl.innerHTML = html;
}}
buildStationUI();

// Build order color legend
(function buildOrderLegend() {{
  const el = document.getElementById('orderLegend');
  let html = '';
  orders.forEach(o => {{
    const col = orderToColor(o.order_no);
    const hex = '#' + col.getHexString();
    html += `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
      <div style="width:14px;height:8px;border-radius:2px;background:${{hex}};flex-shrink:0;"></div>
      <span style="font-size:9px;color:#c9d1d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${{o.order_no}} (OD${{o.od_mm}} x${{o.qty}})</span>
    </div>`;
  }});
  el.innerHTML = html;
}})();

function updateUI(t) {{
  // Time
  const d = new Date(t);
  const h = d.getHours();
  const isNight = h >= 23 || h < 8;
  document.getElementById('simTime').textContent =
    d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    + ' ' + String(h).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');

  const nb = document.getElementById('nightBadge');
  nb.style.display = isNight ? 'inline' : 'none';

  // Progress
  const pct = Math.min(100, ((t - simStart) / (simEnd - simStart)) * 100);
  document.getElementById('progressBar').style.width = pct + '%';

  // Completed
  document.getElementById('completedInfo').textContent = 'Completed: ' + totalCompleted;

  // Processing info
  const procs = [];
  STATIONS.forEach(st => {{
    const state = stationState[st.name];
    if (state.active > 0) {{
      for (const [res, info] of state.processing) {{
        procs.push(st.label + ': ' + info.orderNo);
      }}
    }}
  }});
  document.getElementById('processingInfo').textContent = procs.slice(0, 6).join('  |  ');

  // Station bars
  STATIONS.forEach(st => {{
    const state = stationState[st.name];
    const util = utilizationMap[st.name] || 0;
    const bar = document.getElementById('bar_' + st.name);
    const val = document.getElementById('val_' + st.name);
    const info = document.getElementById('info_' + st.name);
    if (!bar) return;

    // Compute live utilization - blend static data with current active ratio
    const liveUtil = Math.min(100, Math.max(util, (state.active / st.count) * 100));
    bar.style.width = liveUtil + '%';
    bar.style.background = liveUtil >= 85 ? '#f85149' : liveUtil >= 50 ? '#e3b341' : '#3fb950';
    val.textContent = Math.round(liveUtil) + '%';
    info.textContent = state.active + '/' + st.count + ' Q:' + Math.max(0, state.queue);
  }});
}}

// ─── CONTROLS ───
let lastFrameTime = performance.now();

document.getElementById('btnPlay').addEventListener('click', () => {{
  playing = !playing;
  const btn = document.getElementById('btnPlay');
  btn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
  btn.classList.toggle('playing', playing);
  lastFrameTime = performance.now();
}});

document.querySelectorAll('.speed-btn').forEach(btn => {{
  btn.addEventListener('click', () => {{
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    speedMult = parseInt(btn.dataset.speed);
  }});
}});

document.getElementById('resetCam').addEventListener('click', () => {{
  camera.position.set(0, 55, 55);
  controls.target.set(0, 0, -5);
  controls.update();
}});

// ─── ANIMATION LOOP ───
function animate(now) {{
  requestAnimationFrame(animate);

  if (playing) {{
    const dt = (now - lastFrameTime) * speedMult;
    simTime += dt;
    if (simTime > simEnd) {{
      simTime = simEnd;
      playing = false;
      document.getElementById('btnPlay').innerHTML = '&#9654;';
      document.getElementById('btnPlay').classList.remove('playing');
    }}
    processEventsUpTo(simTime);
    cleanupPipes(simTime);
  }}
  lastFrameTime = now;

  updatePipeVisuals(simTime);
  updateQueueVisuals(simTime);
  updateStationVisuals(simTime);
  updateUI(simTime);

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}}

requestAnimationFrame(animate);

// ─── RESIZE ───
window.addEventListener('resize', () => {{
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}});
</script>
</body>
</html>"""


def main():
    args = parse_args()
    payload = build_payload(args.plan, args.sheet, start_date=args.start)

    out_dir = Path(__file__).resolve().parent
    view1_path = out_dir / "JCOE_view1.html"
    view2_path = out_dir / "JCOE_view2.html"
    view3_path = out_dir / "JCOE_calendar.html"
    view4_path = out_dir / "JCOE_animation.html"
    view5_path = out_dir / "JCOE_3d.html"

    view1_path.write_text(render_view1(payload), encoding="utf-8")
    view2_path.write_text(render_view2(payload), encoding="utf-8")
    view3_path.write_text(render_view3_calendar(payload), encoding="utf-8")
    view4_path.write_text(render_view4_animation(payload), encoding="utf-8")
    view5_path.write_text(render_view5_3d(payload), encoding="utf-8")

    print(f"[생성 완료] {view1_path}")
    print(f"[생성 완료] {view2_path}")
    print(f"[생성 완료] {view3_path}")
    print(f"[생성 완료] {view4_path}")
    print(f"[생성 완료] {view5_path}")


if __name__ == "__main__":
    main()
