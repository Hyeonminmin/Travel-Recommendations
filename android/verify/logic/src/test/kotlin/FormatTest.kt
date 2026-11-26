import com.travelrec.ui.*
import kotlin.test.Test
import kotlin.test.assertEquals

class FormatTest {
    @Test fun money() {
        assertEquals("1,307,578원", krw(1_307_578))
        assertEquals("131만원", manWon(1_307_578))
        assertEquals("1,235만원", manWon(12_345_678))
        assertEquals("0만원", manWon(0))
    }
    @Test fun percentAndLabels() {
        assertEquals("45%", percent(0.45))
        assertEquals("가격", factorLabel("cost"))
        assertEquals("unknown", factorLabel("unknown"))
        assertEquals("숙소 평점", sourceLabel("lodgingRating"))
        assertEquals("newKey", sourceLabel("newKey"))
    }
    @Test fun asOfIsKst() {
        assertEquals("2026-11-26 09:27", formatAsOf("2026-11-26T00:27:45.914Z"))
        assertEquals("2026-12-01 00:00", formatAsOf("2026-11-30T15:00:00Z")) // 날짜 경계: UTC 15시 = KST 다음날 0시
        assertEquals("garbage", formatAsOf("garbage"))
        assertEquals("", formatAsOf(""))
    }
    @Test fun ranges() {
        assertEquals("12/20 ~ 12/24", shortRange("2026-12-20", "2026-12-24"))
        assertEquals("12/20", shortRange("2026-12-20", "2026-12-20"))
        assertEquals("x ~ y", shortRange("x", "y"))
    }
    @Test fun sourceOrderIsStableAndKeepsUnknownKeys() {
        val m = linkedMapOf("poi" to 1, "zzz" to 2, "flight" to 3, "weather" to 4, "lodging" to 5)
        assertEquals(listOf("flight", "lodging", "weather", "poi", "zzz"), orderedSources(m).map { it.first })
    }
}
