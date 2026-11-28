package com.travelrec.ui

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

// Compose 에 의존하지 않는 순수 함수들(JVM 에서 단위 테스트 가능).

/** 1,307,578원 */
fun krw(n: Long): String = String.format(Locale.KOREA, "%,d원", n)

/** 131만원 (만원 단위 반올림) */
fun manWon(n: Long): String = String.format(Locale.KOREA, "%,d만원", (n / 10_000.0).roundToInt())

fun percent(v: Double): String = "${(v * 100).roundToInt()}%"

fun factorLabel(k: String) = when (k) {
    "cost" -> "가격"; "weather" -> "날씨"; "event" -> "축제"; "lodging" -> "숙소"; "poi" -> "볼거리"; "logistics" -> "이동"; else -> k
}

/** 국내는 KTX·버스·국내선 등을 뭉뚱그린 "교통", 해외는 "항공". (API 필드명은 flight* 지만 화면에는 목적지에 맞게 표시한다) */
fun transportLabel(domestic: Boolean) = if (domestic) "교통" else "항공"

/** 서버 sources 맵의 키 → 화면 표시 이름. 모르는 키는 그대로 보여 준다. */
fun sourceLabel(k: String, domestic: Boolean = false) = when (k) {
    "flight" -> if (domestic) "국내 교통" else "항공권"
    "lodging" -> "숙소 1박 요금"; "lodgingRating" -> "숙소 평점"; "weather" -> "날씨"
    "event" -> "행사"; "holiday" -> "공휴일"; "poi" -> "볼거리·식당"; else -> k
}

/** 화면에서 보여 줄 출처 순서(서버 맵 순서에 의존하지 않는다). 목록에 없는 키는 뒤에 붙는다. */
val SOURCE_ORDER = listOf("flight", "lodging", "lodgingRating", "weather", "event", "holiday", "poi")

fun <T> orderedSources(sources: Map<String, T>): List<Pair<String, T>> =
    SOURCE_ORDER.mapNotNull { k -> sources[k]?.let { k to it } } + sources.filterKeys { it !in SOURCE_ORDER }.toList()

private val ASOF_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Seoul"))

/** ISO-8601(UTC) → "2026-11-26 09:27"(KST). 파싱할 수 없으면 원문 그대로. */
fun formatAsOf(iso: String): String = try {
    ASOF_FORMAT.format(Instant.parse(iso))
} catch (_: Exception) {
    iso
}

/** "2026-12-20" ~ "2026-12-24" → "12/20 ~ 12/24" */
fun shortRange(start: String, end: String): String {
    fun md(d: String) = if (d.length >= 10) "${d.substring(5, 7)}/${d.substring(8, 10)}" else d
    return if (start == end) md(start) else "${md(start)} ~ ${md(end)}"
}
