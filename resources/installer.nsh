!include "LogicLib.nsh"
!include "nsProcess.nsh"

!macro customInit
  ${IfNot} ${UAC_IsInnerInstance}
    ${If} $hasPerMachineInstallation == "1"
    ${OrIf} $hasPerUserInstallation == "1"
      MessageBox MB_YESNO|MB_ICONQUESTION "检测到 Flux 已安装。是否覆盖安装并保留现有配置？" /SD IDYES IDYES flux_overwrite_confirmed
      Quit
      flux_overwrite_confirmed:
    ${EndIf}
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
