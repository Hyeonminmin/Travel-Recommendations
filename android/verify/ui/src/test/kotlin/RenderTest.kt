import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import com.travelrec.data.*
import com.travelrec.ui.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.jetbrains.skia.EncodedImageFormat
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalComposeUiApi::class)
class RenderTest {
    private val outDir = File(System.getProperty("renders.dir")).also { it.mkdirs() }
    private fun render(name: String, w: Int = 1080, h: Int = 2400, content: @Composable () -> Unit) {
        val scene = ImageComposeScene(width = w, height = h, density = Density(2.625f)) { MaterialTheme { Surface { content() } } }
        val bytes = scene.render(0).encodeToData(EncodedImageFormat.PNG)!!.bytes
        scene.close()
        File(outDir, "$name.png").writeBytes(bytes)
        assertTrue(bytes.size > 5_000, "$name 가 비어 있음")
    }
    private fun req(s: String, e: String, budget: Long = 3_000_000) = RecommendRequest(startDate = s, endDate = e, budgetKRW = budget, travelers = 2, tags = listOf("미식"))

    @Test fun detailScreens() = runBlocking<Unit> {
        // 공휴일(12/25)이 낀 국내 일정: 패널티·공휴일·대표 장소·행사·출처가 모두 채워진 화면
        val busan = ApiProvider.api.destination("busan", req("2026-12-24", "2026-12-27"))
        render("detail_busan", h = 5600) { DetailScreen(DetailState("busan", "부산", loading = false, data = busan), {}, {}) }
        // 해외 + 예산 초과
        val bkk = ApiProvider.api.destination("bangkok", req("2026-12-20", "2026-12-24", budget = 500_000))
        render("detail_bangkok_overbudget", h = 4800) { DetailScreen(DetailState("bangkok", "방콕", loading = false, data = bkk), {}, {}) }
        render("detail_loading", h = 1200) { DetailScreen(DetailState("busan", "부산"), {}, {}) }
        render("detail_error", h = 1200) { DetailScreen(DetailState("busan", "부산", loading = false, error = "상세 정보를 불러오지 못했습니다: HTTP 500"), {}, {}) }
    }

    @Test fun listScreenWithDetailButton() = runBlocking<Unit> {
        val vm = RecommendViewModel()
        vm.update { copy(startDate = "2026-12-24", endDate = "2026-12-27", budgetMan = "300", travelers = "2") }
        vm.search()
        kotlinx.coroutines.withTimeout(30_000) { vm.state.first { it.response != null } }
        render("list", h = 4200) { RecommendScreen(vm) }
    }
}
