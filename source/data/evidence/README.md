# 확관 산출식 근거 이미지

「★JCOE 공정 생산 표준 시간 분석 20251231 (POSTECH 송부).xlsx」에 **이미지로만** 들어 있던 내용입니다.
셀 값이 아니라 그림이라 텍스트 추출로는 보이지 않아, 2026-08-06 시점에는 "시트가 비어 있다"고 잘못 보고했습니다.

`python3 tools/extract_images.py <xlsx> -o data/evidence` 로 다시 뽑을 수 있습니다.

| 파일 | 앵커 | 내용 |
|---|---|---|
| `Total_Summary__S22__image2.png` | `Total Summary!S22` (Expander **1호기** 비고) | 확관 Step Size = **다이 Size − 150mm** (ex. 700mm 다이 → 550mm 를 HMI 레시피에 입력). 단, 끝단 남을 길이가 150mm 이하면 −100mm.<br>`N = ROUNDUP( L / StepSize )` — 계산 예시 **12,802mm / 24" / 12.7t → 12,802 / (550−150) = 33회** |
| `Total_Summary__S23__image1.png` | `Total Summary!S23` (Expander **2호기** 비고) | `N = ROUNDUP( (L − (S_start + S_end)) / (F − O) ) + 2 + α`<br>셀 메모: 「α : α 를 제외한 N 이 짝수일 시 +1, 즉 **N 은 항상 홀수**」 |
| `Expander(RB)__J4__image3.png` | `Expander(RB)!J4` (R/B 비고) | 확관 Step Size = **다이 Size − 90mm** (ex. 700mm 다이 → 610mm 를 레시피에 입력) |

## 시뮬레이터 반영 상태

| 항목 | 반영 |
|---|---|
| #1호기 StepSize = 다이 − 150 | `engine.js STEP_MARGIN.M1 = 150` |
| #1호기 N (엑셀식) | `N = ceil(L / StepSize)` — 「확관 N 산출식 = 엑셀」 모드 |
| #1호기 N (정본 specs.py) | `N = round(L / StepSize)` — **기본값**. 올림/사사오입만 다르다 |
| #2호기 N 홀수 보정 | 엑셀 모드에서 홀수, 정본 모드에서 짝수 — **서로 반대**. 확인 요청 중 |
| R/B StepSize = 다이 − 90 | `engine.js STEP_MARGIN.RB = 90` — **2026-08-14 신규 반영** |
| R/B 소요 = 234 + (N−2)×15 | `STD.Expander(..., 'RB')` |
