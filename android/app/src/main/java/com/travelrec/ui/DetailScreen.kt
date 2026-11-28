package com.travelrec.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.travelrec.data.CostBreakdown
import com.travelrec.data.DestinationDetail
import com.travelrec.data.FactorResult
import com.travelrec.data.Holiday
import com.travelrec.data.Penalty
import com.travelrec.data.Places
import com.travelrec.data.SourceMeta
import com.travelrec.data.TripEvent
import com.travelrec.data.TripInfo
import com.travelrec.data.Weather

/** 목적지 상세. 불러오는 중/오류/성공을 DetailState 로 구분해 그린다. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(state: DetailState, onBack: () -> Unit, onRetry: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.name) },
                navigationIcon = { TextButton(onClick = onBack) { Text("← 목록") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val data = state.data
            when {
                data != null -> DetailContent(data)
                state.error != null -> Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(state.error, color = MaterialTheme.colorScheme.error)
                    Button(onClick = onRetry) { Text("다시 시도") }
                }
                else -> CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DetailContent(d: DestinationDetail) {
    val uri = LocalUriHandler.current
    val r = d.recommendation
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)) }
        item { Header(d) }
        if (!d.withinBudget) {
            item {
                Text(
                    "예산 초과: 예상 ${krw(d.cost.totalKRW)} > 예산 ${krw(d.trip.budgetKRW)}",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        item { SectionCard("비용 내역") { CostSection(d.cost, d.trip, d.destination.domestic, d.sources["flight"]?.estimated == true) } }
        item { SectionCard("날씨") { WeatherSection(d.weather, d.sources["weather"]) } }
        if (r.penalties.isNotEmpty() || d.holidays.isNotEmpty()) {
            item { SectionCard("공휴일·혼잡") { HolidaySection(d.holidays, r.penalties) } }
        }
        item { SectionCard("기간 내 행사") { EventSection(d.events) } }
        if (d.places.attractions.isNotEmpty() || d.places.restaurants.isNotEmpty()) {
            item { SectionCard("볼거리·식당") { PlacesSection(d.places) } }
        }
        item { SectionCard("점수 근거") { BreakdownSection(r.breakdown) } }
        item { SectionCard("데이터 출처") { SourcesSection(d.sources, d.destination.domestic) } }
        if (r.dataNotes.isNotEmpty()) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    r.dataNotes.forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline) }
                }
            }
        }
        if (d.links.isNotEmpty()) {
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    d.links.forEach { l -> OutlinedButton(onClick = { uri.openUri(l.url) }) { Text(l.label, style = MaterialTheme.typography.labelSmall) } }
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Header(d: DestinationDetail) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("${d.destination.name} (${d.destination.country})", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "${shortRange(d.trip.startDate, d.trip.endDate)} · ${d.trip.nights}박 · ${d.trip.travelers}명",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            Text("%.1f점".format(d.recommendation.totalScore), style = MaterialTheme.typography.headlineSmall)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AssistChip(onClick = {}, label = { Text(if (d.destination.domestic) "국내" else "해외") })
            AssistChip(onClick = {}, label = { Text(if (d.withinBudget) "예산 이내" else "예산 초과") })
            d.destination.tags.forEach { AssistChip(onClick = {}, label = { Text(it) }) }
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun LabelValue(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.Bold else null)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.Bold else null)
    }
}

@Composable
private fun Caption(text: String) = Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)

@Composable
private fun CostSection(c: CostBreakdown, t: TripInfo, domestic: Boolean, transportEstimated: Boolean) {
    LabelValue("${transportLabel(domestic)}(왕복 1인 ${krw(c.flightPerPersonKRW)} × ${t.travelers}명)", krw(c.flightTotalKRW))
    LabelValue("숙소(1박 ${krw(c.lodgingPerNightKRW)} × ${t.nights}박 × ${t.rooms}실)", krw(c.lodgingTotalKRW))
    LabelValue("현지 지출", krw(c.localSpendKRW))
    HorizontalDivider()
    LabelValue("합계", krw(c.totalKRW), bold = true)
    val ratio = if (t.budgetKRW > 0) (c.totalKRW * 100.0 / t.budgetKRW).toInt() else 0
    Caption("예산 ${krw(t.budgetKRW)}의 ${ratio}%")
    if (transportEstimated) {
        Caption(if (domestic) "교통비는 KTX·버스·국내선 등을 뭉뚱그린 샘플 추정치입니다(실제 요금 아님)." else "항공권 가격은 추정치입니다.")
    }
}

@Composable
private fun WeatherSection(w: Weather, source: SourceMeta?) {
    LabelValue("평균 기온", "%.1f℃".format(w.avgTempC))
    LabelValue("강수확률", percent(w.rainProb))
    source?.let { Caption(it.source + if (it.estimated) " (추정)" else "") }
}

@Composable
private fun HolidaySection(holidays: List<Holiday>, penalties: List<Penalty>) {
    holidays.forEach { Text("• ${it.date} ${it.name}", style = MaterialTheme.typography.bodyMedium) }
    penalties.forEach {
        Text("혼잡 패널티 -${"%.0f".format(it.points)}점", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        Caption(it.reason)
    }
}

@Composable
private fun EventSection(events: List<TripEvent>) {
    if (events.isEmpty()) {
        Text("기간 내 주요 행사 없음", style = MaterialTheme.typography.bodyMedium)
        return
    }
    events.forEach { e ->
        Text(e.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        Caption("${shortRange(e.startDate, e.endDate)} · ${e.tags.joinToString(", ")}")
    }
}

@Composable
private fun PlacesSection(p: Places) {
    if (p.attractions.isNotEmpty()) {
        Text("관광명소", style = MaterialTheme.typography.labelLarge)
        p.attractions.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
    }
    if (p.restaurants.isNotEmpty()) {
        Text("식당", style = MaterialTheme.typography.labelLarge)
        p.restaurants.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
    }
    Caption("카카오 지도 검색 상위 결과(인기순 아님)")
}

@Composable
private fun BreakdownSection(factors: List<FactorResult>) {
    factors.forEach { f ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${factorLabel(f.factor)} · 가중치 ${percent(f.weight)}", style = MaterialTheme.typography.bodyMedium)
            Text("${(f.score * 100).toInt()}점", style = MaterialTheme.typography.bodyMedium)
        }
        LinearProgressIndicator(progress = { f.score.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        Caption(f.reason)
    }
}

@Composable
private fun SourcesSection(sources: Map<String, SourceMeta>, domestic: Boolean) {
    if (sources.isEmpty()) {
        Text("출처 정보 없음", style = MaterialTheme.typography.bodyMedium)
        return
    }
    orderedSources(sources).forEach { (key, m) ->
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(sourceLabel(key, domestic), style = MaterialTheme.typography.labelLarge)
            if (m.estimated) Text("추정", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
        }
        Caption("${m.source} · ${formatAsOf(m.asOf)} 기준")
    }
}
