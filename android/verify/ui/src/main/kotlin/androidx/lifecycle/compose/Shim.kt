// 데스크톱 Compose 에 없는 Android 전용 API 의 shim(컴파일 검증 전용, 실제 앱에는 포함되지 않는다).
package androidx.lifecycle.compose
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import kotlinx.coroutines.flow.StateFlow
@Composable fun <T> StateFlow<T>.collectAsStateWithLifecycle(): State<T> = collectAsState()
