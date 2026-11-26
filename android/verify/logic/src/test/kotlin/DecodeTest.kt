import com.travelrec.data.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import com.travelrec.ui.orderedSources
import kotlin.test.*

/** 실제 백엔드(api.base) 와 Retrofit + kotlinx.serialization 스택으로 통신해 응답 계약이 모델과 맞는지 검증한다. */
class DecodeTest {
    private val req = RecommendRequest(startDate = "2026-12-20", endDate = "2026-12-24", budgetKRW = 3_000_000, travelers = 2, tags = listOf("미식"))
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true } // ApiProvider 와 동일 설정

    @Test fun recommendDecodes() = runBlocking<Unit> {
        val r = ApiProvider.api.recommend(req)
        assertTrue(r.results.isNotEmpty())
        r.results.forEach { assertTrue(it.breakdown.size == 6); assertTrue(it.estimatedTotalKRW > 0) }
    }

    @Test fun destinationDecodesAndIsConsistent() = runBlocking<Unit> {
        val list = ApiProvider.api.recommend(req)
        for (id in listOf("busan", "tokyo", "jeju")) {
            val d = ApiProvider.api.destination(id, req)
            assertEquals(id, d.destination.id)
            assertEquals(2, d.trip.travelers)
            assertEquals(4, d.trip.nights)
            assertEquals(3_000_000L, d.trip.budgetKRW)
            val c = d.cost
            assertEquals(c.flightTotalKRW + c.lodgingTotalKRW + c.localSpendKRW, c.totalKRW)
            assertEquals(d.recommendation.estimatedTotalKRW, c.totalKRW)
            assertEquals(d.withinBudget, c.totalKRW <= d.trip.budgetKRW)
            assertEquals(6, d.recommendation.breakdown.size)
            // 7개 출처가 모두 있고, 표시 순서 함수가 서버 키를 빠짐없이 다룬다
            assertEquals(setOf("flight", "lodging", "lodgingRating", "weather", "event", "holiday", "poi"), d.sources.keys)
            assertEquals(d.sources.size, orderedSources(d.sources).size)
            d.sources.values.forEach { assertTrue(it.source.isNotBlank()); assertTrue(it.asOf.isNotBlank()) }
            // 목록과 같은 요청이면 같은 점수
            list.results.find { it.destinationId == id }?.let { assertEquals(it.totalScore, d.recommendation.totalScore, 1e-9) }
        }
    }

    @Test fun overBudgetStillReturnsDetail() = runBlocking<Unit> {
        val d = ApiProvider.api.destination("bangkok", req.copy(budgetKRW = 500_000))
        assertFalse(d.withinBudget)
        assertTrue(d.cost.totalKRW > d.trip.budgetKRW)
    }

    @Test fun unknownDestinationIs404() {
        val e = assertFailsWith<retrofit2.HttpException> { runBlocking { ApiProvider.api.destination("atlantis", req) } }
        assertEquals(404, e.code())
    }

    @Test fun holidayPenaltyAppearsForDomesticOnHolidays() = runBlocking<Unit> {
        val d = ApiProvider.api.destination("busan", req.copy(startDate = "2026-12-24", endDate = "2026-12-27"))
        assertTrue(d.holidays.any { it.date == "2026-12-25" })
        val p = d.recommendation.penalties.single()
        assertEquals("holiday-congestion", p.kind)
        assertTrue(p.points > 0)
        val t = ApiProvider.api.destination("tokyo", req.copy(startDate = "2026-12-24", endDate = "2026-12-27"))
        assertTrue(t.holidays.isEmpty())
        assertTrue(t.recommendation.penalties.isEmpty())
    }

    // ── 하위 호환: 구버전 서버 응답(penalties/places 없음), 알 수 없는 필드 ──
    @Test fun oldRecommendationWithoutNewFieldsStillDecodes() {
        val old = """{"destinationId":"busan","name":"부산","country":"KR","totalScore":60.5,"estimatedTotalKRW":1000000,
            "breakdown":[{"factor":"cost","score":0.5,"weight":0.3,"reason":"x"}],"events":[],"dataNotes":[],"links":[],"someFutureField":{"a":1}}"""
        val r = json.decodeFromString<Recommendation>(old)
        assertTrue(r.penalties.isEmpty())
        assertEquals(Places(), r.places)
    }

    @Test fun detailWithMinimalOptionalFieldsDecodes() {
        val s = """{"destination":{"id":"x","name":"X","country":"KR","domestic":true,"lat":1.0,"lon":2.0},
          "trip":{"origin":"ICN","startDate":"2026-12-20","endDate":"2026-12-22","nights":2,"rooms":1,"travelers":2,"budgetKRW":3000000},
          "withinBudget":true,
          "recommendation":{"destinationId":"x","name":"X","country":"KR","totalScore":1.0,"estimatedTotalKRW":10,"breakdown":[],"events":[],"dataNotes":[],"links":[]},
          "cost":{"flightPerPersonKRW":1,"flightTotalKRW":2,"lodgingPerNightKRW":3,"lodgingTotalKRW":4,"localSpendKRW":5,"totalKRW":11},
          "weather":{"avgTempC":10.5,"rainProb":0.3}}"""
        val d = json.decodeFromString<DestinationDetail>(s)
        assertTrue(d.sources.isEmpty() && d.events.isEmpty() && d.holidays.isEmpty())
        assertEquals(0.3, d.weather.rainProb)
    }
}
