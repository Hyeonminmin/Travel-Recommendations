import { DESTINATIONS } from "./data.js";
import type { Providers } from "./providers/types.js";
import {
  WEIGHT_KEYS,
  type Destination,
  type ExcludedDestination,
  type FactorResult,
  type Holiday,
  type Penalty,
  type Recommendation,
  type RecommendRequest,
} from "./types.js";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const krw = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;

export function nightsBetween(start: string, end: string): number {
  const ms = Date.parse(end) - Date.parse(start);
  return Math.max(1, Math.round(ms / 86_400_000));
}

export function normalizeWeights(w: RecommendRequest["weights"]): Record<(typeof WEIGHT_KEYS)[number], number> {
  const sum = WEIGHT_KEYS.reduce((a, k) => a + w[k], 0);
  const out = {} as Record<(typeof WEIGHT_KEYS)[number], number>;
  for (const k of WEIGHT_KEYS) out[k] = sum > 0 ? w[k] / sum : 1 / WEIGHT_KEYS.length;
  return out;
}

// ── 개별 factor 점수 (0..1) ─────────────────────────────────────────────
/** 예산 대비 지출 비율 40% 이하=1점, 100%=0점 (선형) */
export function costScore(total: number, budget: number): number {
  return clamp01((1 - total / budget) / 0.6);
}
/** 선호 기온 범위 이탈 정도(10℃ 이탈=0점)와 강수확률을 6:4로 합산 */
export function weatherScore(avgTempC: number, rainProb: number, ideal: [number, number]): number {
  const [lo, hi] = ideal;
  const dist = avgTempC < lo ? lo - avgTempC : avgTempC > hi ? avgTempC - hi : 0;
  return clamp01(0.6 * (1 - dist / 10) + 0.4 * (1 - rainProb));
}
/** 취향 태그와 겹치는 이벤트 0.5점, 그 외 0.2점, 합산 후 상한 1 */
export function eventScore(events: { tags: string[] }[], userTags: string[]): number {
  return clamp01(events.reduce((a, e) => a + (e.tags.some((t) => userTags.includes(t)) ? 0.5 : 0.2), 0));
}
/** 숙소 평점 3.0=0점 ~ 5.0=1점 */
export function lodgingScore(rating: number): number {
  return clamp01((rating - 3) / 2);
}
/** 볼거리 밀도 70% + 취향 태그 일치율 30% */
export function poiScore(dest: Destination, userTags: string[]): number {
  const match = userTags.length ? dest.tags.filter((t) => userTags.includes(t)).length / userTags.length : 0.5;
  return clamp01(0.7 * dest.poiDensity + 0.3 * match);
}
/** 비행시간 0h=1점, 12h=0점 */
export function logisticsScore(flightHours: number): number {
  return clamp01(1 - flightHours / 12);
}

export const HOLIDAY_PENALTY_PER_DAY = 3; // 총점(0..100) 차감, 임의 튜닝값
export const HOLIDAY_PENALTY_MAX = 10;

/**
 * 공휴일 혼잡 패널티. 국내 여행만 대상(해외는 항공가에 이미 수요가 반영되고, 현지 혼잡과는 무관).
 * 여행 기간에 걸친 공휴일 하루당 3점, 최대 10점을 총점에서 차감한다.
 */
export function holidayPenalty(dest: Destination, holidays: Holiday[]): Penalty | null {
  if (!dest.domestic || holidays.length === 0) return null;
  const points = Math.min(HOLIDAY_PENALTY_MAX, holidays.length * HOLIDAY_PENALTY_PER_DAY);
  return { kind: "holiday-congestion", points, reason: `공휴일 ${holidays.length}일 포함(${[...new Set(holidays.map((h) => h.name))].join(", ")}) — 혼잡·가격 상승 가능` };
}

function links(dest: Destination, req: RecommendRequest) {
  const q = encodeURIComponent;
  const out = [
    { label: "숙소 검색(Google)", url: `https://www.google.com/travel/hotels/${q(dest.name)}?q=${q(dest.name + " 호텔")}` },
  ];
  if (dest.domestic) {
    out.push({ label: "국내 항공/교통 검색(네이버)", url: `https://search.naver.com/search.naver?query=${q(`${dest.name} 항공권`)}` });
  } else {
    out.push({
      label: "항공권 검색(Google)",
      url: `https://www.google.com/travel/flights?q=${q(`Flights from ${req.origin} to ${dest.iata} on ${req.startDate} through ${req.endDate}`)}`,
    });
  }
  return out;
}

export async function recommend(
  req: RecommendRequest,
  providers: Providers,
  destinations: Destination[] = DESTINATIONS,
): Promise<{ results: Recommendation[]; excluded: ExcludedDestination[] }> {
  const weights = normalizeWeights(req.weights);
  const nights = nightsBetween(req.startDate, req.endDate);
  const q = { origin: req.origin, startDate: req.startDate, endDate: req.endDate, travelers: req.travelers };
  const rooms = Math.ceil(req.travelers / 2);

  const candidates = destinations.filter((d) =>
    req.scope === "both" ? true : req.scope === "domestic" ? d.domestic : !d.domestic,
  );

  const holidays = await providers.holiday.holidays(q); // 국내 공통이므로 요청당 1회
  const results: Recommendation[] = [];
  const excluded: ExcludedDestination[] = [];

  await Promise.all(
    candidates.map(async (dest) => {
      const [flight, night, rating, weather, events] = await Promise.all([
        providers.flight.roundTripPerPersonKRW(dest, q),
        providers.lodging.perNightKRW(dest, q),
        providers.lodging.rating(dest),
        providers.weather.forecast(dest, q),
        providers.event.events(dest, q),
      ]);

      const total = flight.value * req.travelers + night.value * nights * rooms + dest.dailySpendKRW * req.travelers * nights;
      if (total > req.budgetKRW) {
        excluded.push({ destinationId: dest.id, name: dest.name, reason: `예상 ${krw(total)} > 예산 ${krw(req.budgetKRW)}` });
        return;
      }

      const raw: Record<(typeof WEIGHT_KEYS)[number], { score: number; reason: string }> = {
        cost: { score: costScore(total, req.budgetKRW), reason: `예상 총 ${krw(total)} (예산의 ${Math.round((total / req.budgetKRW) * 100)}%)` },
        weather: {
          score: weatherScore(weather.value.avgTempC, weather.value.rainProb, req.idealTempC),
          reason: `평균 ${weather.value.avgTempC}℃, 강수확률 ${Math.round(weather.value.rainProb * 100)}%`,
        },
        event: {
          score: eventScore(events.value, req.tags),
          reason: events.value.length ? events.value.map((e) => e.name).join(", ") : "기간 내 주요 행사 없음",
        },
        lodging: { score: lodgingScore(rating.value), reason: `숙소 평점 ${rating.value.toFixed(1)}/5` },
        poi: { score: poiScore(dest, req.tags), reason: `취향 태그 일치: ${dest.tags.filter((t) => req.tags.includes(t)).join(", ") || "없음"}` },
        logistics: { score: logisticsScore(dest.flightHours), reason: `이동 약 ${dest.flightHours}시간` },
      };

      const breakdown: FactorResult[] = WEIGHT_KEYS.map((k) => ({ factor: k, score: raw[k].score, weight: weights[k], reason: raw[k].reason }));
      const penalty = holidayPenalty(dest, holidays.value);
      const penalties = penalty ? [penalty] : [];
      const base = Math.round(breakdown.reduce((a, b) => a + b.score * b.weight, 0) * 1000) / 10;
      const totalScore = Math.max(0, Math.round((base - (penalty?.points ?? 0)) * 10) / 10);

      const estimated = [flight, night, rating, weather, events].some((s) => s.estimated);
      results.push({
        destinationId: dest.id,
        name: dest.name,
        country: dest.country,
        totalScore,
        estimatedTotalKRW: total,
        breakdown,
        events: events.value,
        penalties,
        dataNotes: [
          ...(estimated ? ["가격·날씨·행사 값은 샘플/추정치입니다. 최종 가격은 예약 사이트에서 확인하세요."] : []),
          // 공휴일 API 실패 시 음력 명절·대체공휴일이 빠진다 → 국내 결과에만 안내
          ...(dest.domestic && holidays.estimated ? ["공휴일 정보를 불러오지 못해 설날·추석·대체공휴일 등이 혼잡 패널티에 반영되지 않았을 수 있습니다."] : []),
        ],
        links: links(dest, req),
      });
    }),
  );

  results.sort((a, b) => b.totalScore - a.totalScore);
  return { results, excluded };
}
