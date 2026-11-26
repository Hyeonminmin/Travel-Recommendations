import { createMockProviders } from "./mock.js";
import { createKakaoPoi } from "./kakao.js";
import { createKmaWeather } from "./kma.js";
import { createKmaMidWeather } from "./kmaMid.js";
import { createOpenMeteoWeather } from "./openMeteo.js";
import { createSpecialDaysHolidays } from "./specialDays.js";
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
  }
  if (env.KAKAO_REST_API_KEY) {
    providers.poi = createKakaoPoi(env.KAKAO_REST_API_KEY, mock.poi);
    live.push("poi(kakao 로컬, 국내만)");
  }
  return { providers, live };
}
