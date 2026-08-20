!include "LogicLib.nsh"
!include "nsProcess.nsh"

!macro customInit
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    MessageBox MB_YESNO|MB_ICONQUESTION "检测到已安装的 Flux。继续安装将覆盖现有程序文件，用户设置和文档不会被删除。是否继续？" /SD IDYES IDYES flux_continue_overwrite
    Abort
    flux_continue_overwrite:
  ${EndIf}
!macroend

!macro customCheckAppRunning
  flux_check_app_running:
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Flux 正在运行。请先保存文档并关闭 Flux，然后点击“重试”继续安装。" /SD IDCANCEL IDRETRY flux_check_app_running
    Quit
  ${EndIf}
!macroend
