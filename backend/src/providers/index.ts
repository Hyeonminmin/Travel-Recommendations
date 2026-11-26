import { DESTINATIONS } from "../data.js";
import { createMockProviders } from "./mock.js";
import { createKakaoPoi } from "./kakao.js";
import { createKmaWeather } from "./kma.js";
import { createKmaMidWeather } from "./kmaMid.js";
import { createOpenMeteoWeather } from "./openMeteo.js";
import { createHotelFileStore, createSerpApiHotels } from "./serpApiHotels.js";
import { createSpecialDaysHolidays } from "./specialDays.js";
import { createTourApiEvents } from "./tourApi.js";
import { createFileStore, createTourApiLodging } from "./tourApiLodging.js";
import { createTravelpayoutsFlight } from "./travelpayouts.js";
import type { Providers } from "./types.js";

/** 키가 있는 소스만 실제 Provider 로 교체하고 나머지는 Mock 유지. */
export function createProviders(env: NodeJS.ProcessEnv = process.env): { providers: Providers; live: string[]; warmUp: () => Promise<void> } {
  const mock = createMockProviders();
  const live: string[] = [];
  let warmUp: () => Promise<void> = async () => {};
  const providers: Providers = { ...mock };
  if (env.USE_OPEN_METEO !== "false") {
    providers.weather = createOpenMeteoWeather(mock.weather);
    live.push("weather(open-meteo)");
  }
  if (env.DATA_GO_KR_SERVICE_KEY) {
    // 국내: 3일 이내=단기예보 → 4~10일=중기예보 → 그 외(해외·걸친 일정·먼 날짜)=Open-Meteo→Mock
    providers.weather = createKmaMidWeather(env.DATA_GO_KR_SERVICE_KEY, providers.weather);
    providers.weather = createKmaWeather(env.DATA_GO_KR_SERVICE_KEY, providers.weather);
    live.push("weather(기상청 단기예보 3일 이내 + 중기예보 4~10일, 국내)");
  }
  if (env.TRAVELPAYOUTS_TOKEN) {
    providers.flight = createTravelpayoutsFlight(env.TRAVELPAYOUTS_TOKEN, mock.flight);
    live.push("flight(travelpayouts, 해외만)");
  }
  if (env.DATA_GO_KR_SERVICE_KEY) {
    providers.event = createTourApiEvents(env.DATA_GO_KR_SERVICE_KEY, mock.event);
    live.push("event(tourapi, 국내만)");
    providers.holiday = createSpecialDaysHolidays(env.DATA_GO_KR_SERVICE_KEY, mock.holiday);
    live.push("holiday(특일정보)");
    // 숙소 요금은 상세 조회가 느려(호출당 ~5초) 서버 시작 시 백그라운드로 수집·파일 캐시. 수집 전에는 샘플값.
    const lodging = createTourApiLodging(env.DATA_GO_KR_SERVICE_KEY, mock.lodging, {
      store: createFileStore(env.LODGING_CACHE_FILE ?? ".cache/lodging.json"),
      log: (m) => console.log(`[lodging] ${m}`),
    });
    providers.lodging = lodging;
    warmUp = () => lodging.warmUp(DESTINATIONS);
    live.push("lodging(TourAPI 공시요금, 국내만·수집 후 적용)");
  }
  if (env.SERPAPI_KEY) {
    // 해외 숙소 1박 요금·평점은 Google Hotels(SerpAPI). 국내는 아래 fallback(TourAPI 공시요금 또는 샘플)로 위임
    const hotels = createSerpApiHotels(env.SERPAPI_KEY, providers.lodging, {
      store: createHotelFileStore(env.SERPAPI_CACHE_FILE ?? ".cache/serpapi-hotels.json"),
      monthlyBudget: env.SERPAPI_MONTHLY_BUDGET ? Number(env.SERPAPI_MONTHLY_BUDGET) : undefined,
      log: (m) => console.log(`[hotels] ${m}`),
    });
    providers.lodging = hotels;
    const prevWarm = warmUp;
    warmUp = async () => { await Promise.all([prevWarm(), hotels.warmUp(DESTINATIONS)]); };
    live.push("lodging+rating(SerpAPI Google Hotels, 해외만·월 캐시·수집 후 적용)");
  }
  if (env.KAKAO_REST_API_KEY) {
    providers.poi = createKakaoPoi(env.KAKAO_REST_API_KEY, mock.poi);
    live.push("poi(kakao 로컬, 국내만)");
  }
  return { providers, live, warmUp };
}
