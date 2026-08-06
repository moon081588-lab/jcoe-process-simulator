#!/usr/bin/env python3
"""JCOE 2D 시뮬레이터 빌드 — source/{src,data,vendor} 를 단일 HTML 로 합쳐 저장소 루트에 씁니다.

    python3 source/build.py     →  ./JCOE_Simulator.html
"""
import json, pathlib
R = pathlib.Path(__file__).resolve().parent          # source/
OUT = R.parent                                        # 저장소 루트 — HTML 은 여기에 떨어집니다
tpl = (R/'src/shell.html').read_text(encoding='utf-8')
out = (tpl
  .replace('__TABLES__', json.dumps(json.loads((R/'data/tables.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__ORDERS__', json.dumps(json.loads((R/'data/orders.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__XLSX__',     (R/'vendor/xlsx.full.min.js').read_text(encoding='utf-8'))
  .replace('__PLANLOAD__', (R/'src/planload.js').read_text(encoding='utf-8'))
  .replace('__ENGINE__', (R/'src/engine.js').read_text(encoding='utf-8'))
  .replace('__FLOW__',   (R/'src/flow.js').read_text(encoding='utf-8'))
  .replace('__UI__',     (R/'src/ui.js').read_text(encoding='utf-8')))
p = OUT/'JCOE_Simulator.html'
p.write_text(out, encoding='utf-8')
print(f'[built] {p}  {len(out)/1024:.0f} KB')
