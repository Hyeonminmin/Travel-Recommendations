package com.travelrec.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.travelrec.data.Recommendation
import com.travelrec.data.Weights

private val TAGS = listOf("미식", "휴양", "자연", "도시", "축제", "쇼핑")
private val SCOPES = listOf("both" to "전체", "domestic" to "국내", "international" to "해외")

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun RecommendScreen(vm: RecommendViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()

    LazyColumn(
        modifier = Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text("어디로 갈까?", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 16.dp)) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(s.startDate, { v -> vm.update { copy(startDate = v) } }, label = { Text("출발일") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(s.endDate, { v -> vm.update { copy(endDate = v) } }, label = { Text("귀국일") }, modifier = Modifier.weight(1f), singleLine = true)
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(s.budgetMan, { v -> vm.update { copy(budgetMan = v) } }, label = { Text("총예산(만원)") }, modifier = Modifier.weight(1f), singleLine = true)
                OutlinedTextField(s.travelers, { v -> vm.update { copy(travelers = v) } }, label = { Text("인원") }, modifier = Modifier.weight(1f), singleLine = true)
            }
        }
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SCOPES.forEach { (key, label) -> FilterChip(selected = s.scope == key, onClick = { vm.update { copy(scope = key) } }, label = { Text(label) }) }
            }
        }
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TAGS.forEach { tag -> FilterChip(selected = tag in s.tags, onClick = { vm.toggleTag(tag) }, label = { Text(tag) }) }
            }
        }
        item { WeightSliders(s.weights) { w -> vm.update { copy(weights = w) } } }
        item {
            Button(onClick = vm::search, enabled = !s.loading, modifier = Modifier.fillMaxWidth()) {
                if (s.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("추천 받기")
            }
        }
        s.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        s.response?.let { resp ->
            items(resp.results, key = { it.destinationId }) { RecommendationCard(it) }
            if (resp.excluded.isNotEmpty()) {
                item {
                    Text(
                        "예산 초과 제외: " + resp.excluded.joinToString { "${it.name}(${it.reason})" },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun WeightSliders(w: Weights, onChange: (Weights) -> Unit) {
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = !open }) { Text(if (open) "가중치 닫기" else "가중치 조절") }
    if (!open) return
    Column {
        WeightRow("가격", w.cost) { onChange(w.copy(cost = it)) }
        WeightRow("날씨", w.weather) { onChange(w.copy(weather = it)) }
        WeightRow("축제", w.event) { onChange(w.copy(event = it)) }
        WeightRow("숙소", w.lodging) { onChange(w.copy(lodging = it)) }
        WeightRow("볼거리", w.poi) { onChange(w.copy(poi = it)) }
        WeightRow("이동", w.logistics) { onChange(w.copy(logistics = it)) }
    }
}

@Composable
private fun WeightRow(label: String, value: Double, onChange: (Double) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.width(56.dp))
        Slider(value = value.toFloat(), onValueChange = { onChange(it.toDouble()) }, valueRange = 0f..1f, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun RecommendationCard(r: Recommendation) {
    val uri = LocalUriHandler.current
    var expanded by remember { mutableStateOf(false) }
    Card(modifier = Modifier.fillMaxWidth(), onClick = { expanded = !expanded }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${r.name} (${r.country})", style = MaterialTheme.typography.titleMedium)
                Text("%.1f점".format(r.totalScore), style = MaterialTheme.typography.titleMedium)
            }
            Text("예상 총액 약 ${r.estimatedTotalKRW / 10_000}만원", style = MaterialTheme.typography.bodyMedium)
            if (expanded) {
                r.breakdown.forEach { f ->
                    Text("• ${factorLabel(f.factor)} ${(f.score * 100).toInt()}점 (가중치 ${(f.weight * 100).toInt()}%) — ${f.reason}", style = MaterialTheme.typography.bodySmall)
                }
                r.dataNotes.forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    r.links.forEach { l -> OutlinedButton(onClick = { uri.openUri(l.url) }) { Text(l.label, style = MaterialTheme.typography.labelSmall) } }
                }
            } else {
                Text("탭해서 점수 근거 보기", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}

private fun factorLabel(k: String) = when (k) {
    "cost" -> "가격"; "weather" -> "날씨"; "event" -> "축제"; "lodging" -> "숙소"; "poi" -> "볼거리"; "logistics" -> "이동"; else -> k
}
