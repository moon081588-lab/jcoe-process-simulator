#!/usr/bin/env python3
"""JCOE 2D 시뮬레이터 빌드 — src/* + data/* 를 단일 HTML 로 합칩니다."""
import json, pathlib
R = pathlib.Path(__file__).parent
tpl = (R/'src/shell.html').read_text(encoding='utf-8')
out = (tpl
  .replace('__TABLES__', json.dumps(json.loads((R/'data/tables.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__ORDERS__', json.dumps(json.loads((R/'data/orders.json').read_text(encoding='utf-8')), ensure_ascii=False))
  .replace('__ENGINE__', (R/'src/engine.js').read_text(encoding='utf-8'))
  .replace('__FLOW__',   (R/'src/flow.js').read_text(encoding='utf-8'))
  .replace('__UI__',     (R/'src/ui.js').read_text(encoding='utf-8')))
p = R/'dist/JCOE_Simulator.html'
p.parent.mkdir(exist_ok=True)
p.write_text(out, encoding='utf-8')
print(f'[built] {p}  {len(out)/1024:.0f} KB')
