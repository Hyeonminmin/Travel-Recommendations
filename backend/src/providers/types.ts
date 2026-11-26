import type { Destination, Sourced, TripEvent } from "../types.js";

export interface TripQuery {
  origin: string;
  startDate: string;
  endDate: string;
  travelers: number;
}

/** 외부 API 어댑터 인터페이스. 소스가 바뀌면 구현체만 교체한다. */
export interface FlightProvider {
  roundTripPerPersonKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>>;
}
export interface LodgingProvider {
  perNightKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>>;
  rating(dest: Destination): Promise<Sourced<number>>;
}
export interface WeatherProvider {
  forecast(dest: Destination, q: TripQuery): Promise<Sourced<{ avgTempC: number; rainProb: number }>>;
}
export interface EventProvider {
  events(dest: Destination, q: TripQuery): Promise<Sourced<TripEvent[]>>;
}
export interface HolidayProvider {
  /** 여행 기간 내 공휴일 (혼잡도 근거) */
  holidays(q: TripQuery): Promise<Sourced<{ date: string; name: string }[]>>;
}
export interface Place { name: string; category: string; address: string; url: string; lat?: number; lon?: number }
export interface PlaceProvider {
  places(dest: Destination): Promise<Sourced<{ restaurants: Place[]; attractions: Place[] }>>;
}
export interface HotelQuote { name: string; perNightKRW: number; rating?: number; url?: string }
export interface HotelQuoteProvider {
  /** 실시간 숙소 시세(유료 API). 호출 비용이 있어 결과 상세에서만 사용한다. */
  quotes(dest: Destination, q: TripQuery): Promise<Sourced<{ medianPerNightKRW: number; hotels: HotelQuote[] }>>;
}
export interface Providers {
  flight: FlightProvider;
  lodging: LodgingProvider;
  weather: WeatherProvider;
  event: EventProvider;
  holiday: HolidayProvider;
  place: PlaceProvider;
  hotelQuote: HotelQuoteProvider;
}
