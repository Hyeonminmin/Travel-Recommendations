// 데스크톱 Compose 에 없는 Android 전용 API 의 shim(컴파일 검증 전용).
package androidx.activity.compose
import androidx.compose.runtime.Composable
@Composable fun BackHandler(enabled: Boolean = true, onBack: () -> Unit) {}
