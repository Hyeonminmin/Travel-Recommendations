import type { Destination, TripEvent } from "./types.js";

// ⚠️ 샘플(Mock) 데이터. 실제 값이 아니며 Phase 0 이후 API 값으로 대체된다.
const t = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) =>
  [a, b, c, d, e, f, g, h, i, j, k, l];
const mk = (temps: number[], rains: number[]) => temps.map((avgTempC, i) => ({ avgTempC, rainProb: rains[i] }));

export const DESTINATIONS: Destination[] = [
  { id: "jeju", name: "제주", country: "KR", domestic: true, lat: 33.5, lon: 126.53, tags: ["휴양", "자연", "미식"], poiDensity: 0.8, lodgingRating: 4.2, lodgingPerNightKRW: 140000, dailySpendKRW: 90000, flightHours: 1.2, flightBaseKRW: 90000,
    climate: mk(t(5, 6, 10, 15, 19, 23, 27, 28, 24, 19, 13, 7), t(.4, .35, .35, .35, .35, .45, .5, .45, .4, .25, .3, .35)) },
  { id: "busan", name: "부산", country: "KR", domestic: true, lat: 35.18, lon: 129.07, tags: ["도시", "미식", "축제"], poiDensity: 0.85, lodgingRating: 4.1, lodgingPerNightKRW: 130000, dailySpendKRW: 85000, flightHours: 1, flightBaseKRW: 80000,
    climate: mk(t(3, 5, 9, 14, 18, 21, 25, 26, 22, 17, 11, 5), t(.15, .2, .25, .3, .3, .4, .5, .4, .4, .2, .2, .15)) },
  { id: "gangneung", name: "강릉", country: "KR", domestic: true, lat: 37.75, lon: 128.9, tags: ["휴양", "자연", "미식"], poiDensity: 0.65, lodgingRating: 4.0, lodgingPerNightKRW: 120000, dailySpendKRW: 80000, flightHours: 2.5, flightBaseKRW: 60000,
    climate: mk(t(1, 3, 7, 13, 18, 21, 25, 26, 21, 16, 9, 3), t(.2, .2, .25, .25, .3, .35, .45, .4, .35, .25, .25, .2)) },
  { id: "yeosu", name: "여수", country: "KR", domestic: true, lat: 34.76, lon: 127.66, tags: ["휴양", "미식", "축제"], poiDensity: 0.6, lodgingRating: 4.0, lodgingPerNightKRW: 110000, dailySpendKRW: 75000, flightHours: 3, flightBaseKRW: 55000,
    climate: mk(t(3, 5, 9, 14, 18, 22, 26, 27, 23, 17, 11, 5), t(.2, .2, .25, .3, .3, .4, .5, .4, .4, .2, .2, .2)) },
  { id: "tokyo", name: "도쿄", country: "JP", domestic: false, iata: "TYO", lat: 35.68, lon: 139.69, tags: ["도시", "미식", "쇼핑"], poiDensity: 0.95, lodgingRating: 4.2, lodgingPerNightKRW: 170000, dailySpendKRW: 130000, flightHours: 2.3, flightBaseKRW: 330000,
    climate: mk(t(6, 7, 10, 15, 20, 23, 27, 28, 25, 19, 14, 8), t(.2, .25, .35, .4, .4, .5, .45, .4, .5, .4, .3, .2)) },
  { id: "osaka", name: "오사카", country: "JP", domestic: false, iata: "OSA", lat: 34.69, lon: 135.5, tags: ["도시", "미식", "축제"], poiDensity: 0.9, lodgingRating: 4.1, lodgingPerNightKRW: 150000, dailySpendKRW: 120000, flightHours: 1.8, flightBaseKRW: 290000,
    climate: mk(t(6, 7, 10, 16, 21, 24, 28, 29, 25, 19, 14, 8), t(.2, .25, .3, .35, .35, .5, .4, .35, .45, .35, .3, .2)) },
  { id: "fukuoka", name: "후쿠오카", country: "JP", domestic: false, iata: "FUK", lat: 33.59, lon: 130.4, tags: ["미식", "도시", "휴양"], poiDensity: 0.7, lodgingRating: 4.0, lodgingPerNightKRW: 120000, dailySpendKRW: 110000, flightHours: 1.4, flightBaseKRW: 230000,
    climate: mk(t(7, 8, 11, 16, 20, 23, 28, 29, 25, 20, 14, 9), t(.25, .3, .35, .35, .35, .55, .5, .4, .4, .25, .3, .25)) },
  { id: "bangkok", name: "방콕", country: "TH", domestic: false, iata: "BKK", lat: 13.75, lon: 100.5, tags: ["도시", "미식", "휴양", "쇼핑"], poiDensity: 0.85, lodgingRating: 4.3, lodgingPerNightKRW: 90000, dailySpendKRW: 70000, flightHours: 5.8, flightBaseKRW: 450000,
    climate: mk(t(27, 29, 30, 31, 30, 30, 29, 29, 28, 28, 28, 27), t(.1, .15, .25, .4, .6, .65, .7, .7, .75, .6, .3, .1)) },
  { id: "danang", name: "다낭", country: "VN", domestic: false, iata: "DAD", lat: 16.05, lon: 108.2, tags: ["휴양", "자연", "미식"], poiDensity: 0.6, lodgingRating: 4.3, lodgingPerNightKRW: 80000, dailySpendKRW: 55000, flightHours: 4.7, flightBaseKRW: 400000,
    climate: mk(t(21, 22, 24, 26, 28, 30, 30, 30, 28, 26, 24, 22), t(.5, .35, .3, .3, .35, .3, .3, .4, .6, .75, .75, .65)) },
  { id: "taipei", name: "타이베이", country: "TW", domestic: false, iata: "TPE", lat: 25.03, lon: 121.57, tags: ["도시", "미식", "쇼핑"], poiDensity: 0.85, lodgingRating: 4.1, lodgingPerNightKRW: 110000, dailySpendKRW: 90000, flightHours: 2.5, flightBaseKRW: 300000,
    climate: mk(t(16, 17, 19, 22, 26, 28, 31, 30, 28, 24, 21, 17), t(.6, .65, .65, .65, .7, .65, .5, .6, .6, .5, .55, .55)) },
];

// ⚠️ 샘플 이벤트(연례 반복, 날짜는 근사값). TourAPI/이벤트 API 연동 시 대체.
export interface RecurringEvent { destinationId: string; name: string; tags: string[]; startMD: string; endMD: string }
export const SAMPLE_EVENTS: RecurringEvent[] = [
  { destinationId: "jeju", name: "유채꽃 시즌(샘플)", tags: ["자연", "휴양"], startMD: "03-25", endMD: "04-10" },
  { destinationId: "gangneung", name: "강릉 커피축제(샘플)", tags: ["축제", "미식"], startMD: "10-01", endMD: "10-05" },
  { destinationId: "busan", name: "부산 불꽃축제(샘플)", tags: ["축제", "도시"], startMD: "11-01", endMD: "11-10" },
  { destinationId: "yeosu", name: "여수 밤바다 불꽃축제(샘플)", tags: ["축제", "휴양"], startMD: "10-05", endMD: "10-15" },
  { destinationId: "osaka", name: "오사카 겨울 일루미네이션(샘플)", tags: ["축제", "도시"], startMD: "11-20", endMD: "12-31" },
  { destinationId: "tokyo", name: "도쿄 겨울 일루미네이션(샘플)", tags: ["축제", "도시"], startMD: "11-15", endMD: "12-25" },
  { destinationId: "bangkok", name: "러이끄라통(샘플)", tags: ["축제"], startMD: "11-01", endMD: "11-30" },
];

export function eventsFor(destinationId: string, startDate: string, endDate: string): TripEvent[] {
  const year = Number(startDate.slice(0, 4));
  return SAMPLE_EVENTS.filter((e) => e.destinationId === destinationId)
    .map((e) => ({ name: e.name, tags: e.tags, startDate: `${year}-${e.startMD}`, endDate: `${year}-${e.endMD}` }))
    .filter((e) => e.startDate <= endDate && e.endDate >= startDate);
}
