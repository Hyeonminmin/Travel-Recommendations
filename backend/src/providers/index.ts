import { createMockProviders } from "./mock.js";
import { createOpenMeteoWeather } from "./openMeteo.js";
import { createAsosClimatology } from "./asos.js";
import { createKmaWeather } from "./kma.js";
import { createKakaoPlaces } from "./kakaoPlaces.js";
import { createSerpHotels } from "./serpHotels.js";
import { createSpecialDayHolidays } from "./holidays.js";
import { createTourApiLodging } from "./tourApiLodging.js";
import { createTourApiEvents } from "./tourApi.js";
import { createTravelpayoutsFlight } from "./travelpayouts.js";
import type { Providers } from "./types.js";

/** 키가 있는 소스만 실제 Provider 로 교체하고 나머지는 Mock 유지. */
export function createProviders(env: NodeJS.ProcessEnv = process.env): { providers: Providers; live: string[] } {
  const mock = createMockProviders();
  const live: string[] = [];
  const providers: Providers = { ...mock };
  if (env.USE_OPEN_METEO !== "false") {
    providers.weather = createOpenMeteoWeather(mock.weather);
    live.push("weather(open-meteo)");
  }
  if (env.TRAVELPAYOUTS_TOKEN) {
    providers.flight = createTravelpayoutsFlight(env.TRAVELPAYOUTS_TOKEN, mock.flight);
    live.push("flight(travelpayouts, 해외만)");
  }
  if (env.DATA_GO_KR_SERVICE_KEY) {
    providers.event = createTourApiEvents(env.DATA_GO_KR_SERVICE_KEY, mock.event);
    live.push("event(TourAPI, 국내만)");
    // 과거 평년값: ASOS(국내) → Open-Meteo/Mock. 예보가 덮는 날은 기상청 예보가 우선.
    providers.weather = createAsosClimatology(env.DATA_GO_KR_SERVICE_KEY, providers.weather);
    providers.weather = createKmaWeather(env.DATA_GO_KR_SERVICE_KEY, providers.weather);
    live.push("weather(기상청 단기·중기예보 + ASOS 평년값, 국내)");
    providers.lodging = createTourApiLodging(env.DATA_GO_KR_SERVICE_KEY, mock.lodging);
    live.push("lodging(TourAPI 등록요금 추정, 국내·가격만)");
    providers.holiday = createSpecialDayHolidays(env.DATA_GO_KR_SERVICE_KEY, mock.holiday);
    live.push("holiday(특일)");
  }
  if (env.KAKAO_REST_API_KEY) {
    providers.place = createKakaoPlaces(env.KAKAO_REST_API_KEY, mock.place);
    live.push("place(Kakao, 국내만)");
  }
  if (env.SERPAPI_KEY) {
    providers.hotelQuote = createSerpHotels(env.SERPAPI_KEY, mock.hotelQuote);
    live.push("hotelQuote(SerpApi, 상세 전용·캐시)");
  }
  return { providers, live };
}
