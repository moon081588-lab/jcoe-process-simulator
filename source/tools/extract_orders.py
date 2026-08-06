#!/usr/bin/env python3
"""
기존 산출물(legacy/JCOE_view2.html 등)에 임베드된 시뮬레이션 payload 에서
오더 사양만 뽑아 data/orders.json 을 생성합니다.

원본 조관계획서(`1. 2026년 3월 포항공장 조관계획서.xlsx`)와
이를 읽는 data_loader.py / simulator.py 가 전달받은 자료에 포함되어 있지 않아,
기존 HTML 안의 `const DATA = {...}` 블록을 오더 사양의 출처로 사용합니다.

사용:
    python3 tools/extract_orders.py legacy/JCOE_view2.html
"""
import json
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "legacy/JCOE_view2.html")
OUT = pathlib.Path(__file__).resolve().parents[1] / "data" / "orders.json"

html = SRC.read_text(encoding="utf-8")
i = html.find("const DATA = ")
if i < 0:
    sys.exit(f"{SRC} 안에서 `const DATA = ` 를 찾지 못했습니다.")
j = html.find("\n", i)
payload = json.loads(html[i + len("const DATA = "):j].rstrip().rstrip(";"))

orders = [
    {
        "no": o["order_no"],
        "od": o["od_mm"],          # 외경 [mm]
        "t": o["thickness_mm"],    # 두께 [mm]
        "L": o["length_mm"],       # 길이 [mm]
        "qty": o["qty"],           # 수량 [본]
        "start": o["order_start_at"],  # 계획 투입 시각
    }
    for o in payload["orders"]
]
orders.sort(key=lambda x: x["start"])

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(orders, ensure_ascii=False), encoding="utf-8")
print(f"[ok] {OUT}  {len(orders)}오더 / {sum(o['qty'] for o in orders):,}본")
