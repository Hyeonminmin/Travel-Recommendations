# 여행지 추천 앱 — 설계 문서 (v0.1)

## 0. 확정된 전제
| 항목 | 결정 |
|---|---|
| 용도 | 개인용 (스토어 배포 X) → 제휴 승인/약관 부담 낮음, 키 관리 단순 |
| 범위 | 국내 출발, 해외 + 국내 여행 모두 |
| 백엔드 | 서버리스 백엔드 사용 (키 보호, 캐싱, 점수 계산) |
| 예약 | 앱 내 결제 없음. 외부 사이트 딥링크 이동 |

## 1. 핵심 가치
**조건 → 목적지 도출 (역방향 검색)**
- 입력: 출발지, 날짜 범위(유연 가능), 예산, 인원, 취향 태그, 기피 요소
- 출력: 목적지 랭킹 + 점수 근거(가격/날씨/축제/숙소/볼거리) + 예약 딥링크
- 광고 가중치 없음. 점수는 사용자 슬라이더 가중치로만 결정.

## 2. 데이터 소스 (국내 출발 기준)

> 아래 API의 무료 쿼터·승인 조건·종료 여부는 변동이 잦으므로 **Phase 0에서 실제 키 발급/호출로 검증**한다.

| 영역 | 해외 | 국내 |
|---|---|---|
| 항공 가격 | Travelpayouts Data API(캐시 최저가, 도착지 미지정 탐색 가능) 1순위, Amadeus Self-Service 보조 | 공개 가격 API 없음 → 노선별 대략가 + 딥링크(네이버항공/각 항공사) |
| 교통(국내) | - | KTX/SRT/버스는 정액에 가까움 → 정적 요금표 + 딥링크 |
| 숙소 가격 | Travelpayouts(Hotellook) 캐시 가격, Amadeus Hotel 보조 | TourAPI 숙박 정보(가격 없음) + 가격대 추정 + 딥링크(야놀자/여기어때/네이버) |
| 숙소 컨디션 | 리뷰 요약(LLM) — 확보 가능한 리뷰 범위 내 | 동일 (Naver/Kakao 장소 평점, 리뷰 텍스트는 제한적) |
| 날씨 | Open-Meteo (예보 + 과거 기후 통계) | 기상청 단기/중기예보 (공공데이터포털) + Open-Meteo 기후통계 |
| 축제/이벤트 | PredictHQ 또는 공휴일/이벤트 캘린더 | 한국관광공사 TourAPI 행사정보, 특일정보(공휴일) API |
| 볼거리/식당 | Google Places 또는 Foursquare/OSM | TourAPI(관광지/음식점), Kakao Local, Naver 지역검색 |
| 환율/물가 | 환율 API + 물가지수(정적 테이블) | - |

## 3. 점수 모델
```
Score(dest) = Σ wᵢ · normalize(factorᵢ)      (wᵢ: 사용자 가중치, 합 1)

factor:
  cost      총비용(항공+숙박×박수+현지 일일물가)  ÷ 예산 → 낮을수록 ↑
  weather   기간 내 평균기온/강수확률/체감 vs 선호 범위 적합도
  event     기간 내 축제·행사 매칭(취향 태그와 교차) + 공휴일 혼잡 패널티
  lodging   숙소 평점·컨디션 점수(리뷰 요약) 상위 K개 평균
  poi       반경 내 볼거리/식당 밀도·평점
  logistics 비행시간/환승/이동 편의
```
- 하드 필터: 예산 초과, 우기/태풍철 회피 옵션, 이동시간 상한
- 모든 factor는 0~1 정규화 후 근거 텍스트와 함께 반환 (설명 가능성)
- LLM은 **설명/요약 생성에만** 사용. 가격·날짜 등 사실값은 API 원본만 사용.

## 4. 아키텍처
```
[Android App]  Kotlin · Compose · MVVM + Clean · Hilt · Room · Retrofit · WorkManager/FCM
      │ HTTPS (자체 API만 호출, 외부 키 미보유)
[Backend: Cloud Run(or Firebase Functions)]  TypeScript(Node) 
  ├─ /recommend   조건→목적지 랭킹
  ├─ /destination/{id}  상세(항공·숙소·POI·날씨·이벤트)
  ├─ /alerts      가격 알림 등록
  ├─ Provider 어댑터 (flight/hotel/weather/event/poi) — 소스 교체 가능
  ├─ 캐시(Firestore/Redis) + 스케줄 수집(Cloud Scheduler)
  └─ LLM 요약(리뷰, 추천 사유)
```
- 안드로이드 모듈: `app`, `core:{model,network,database,ui}`, `feature:{search,result,detail,settings,alerts}`
- 서버 Provider 패턴으로 API 정책 변경 시 어댑터만 교체

## 5. 로드맵
- **Phase 0 (검증, 1주)**: API 키 발급, 호출 샘플, 쿼터/응답 품질 확인 → 소스 확정
- **Phase 1 (MVP)**: 해외 항공 캐시가 + 날씨 + 축제 기반 랭킹, 국내 여행(날씨+TourAPI 축제/POI), 결과 근거 화면, 딥링크
- **Phase 2**: 숙소 가격/리뷰 요약, 인근 볼거리·식당, 일정 초안
- **Phase 3**: 가격 알림(FCM), 유연 날짜 캘린더, 취향 학습

## 6. 리스크
| 리스크 | 대응 |
|---|---|
| 항공/호텔 API 접근·쿼터 | Phase 0 검증, Provider 추상화, 캐시 가격 허용 |
| 가격 신선도 | "참고가 + 조회시각" 표기, 최종가는 딥링크처 확인 |
| 국내 가격 데이터 부재 | 정적 요금표/가격대 추정 + 딥링크, 명시적 표기 |
| 리뷰 데이터 제한 | 확보 가능한 소스만 사용, 요약에 출처 표기 |
| API 키 노출 | 서버 보관, 앱엔 자체 API 토큰만 |

## 7. 다음 작업
1. Phase 0: 각 API 키 발급 및 검증 (사용자 작업 필요: 계정 가입/키 발급)
2. Android 프로젝트 스캐폴딩 + 백엔드 스켈레톤 + `/recommend` 목업
