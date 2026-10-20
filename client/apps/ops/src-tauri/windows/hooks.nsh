; 0.1.7 及以前产品名叫 LightClient_Ops，装在另一个目录、另一条卸载记录下。
; 装新版前先静默卸掉旧的，免得改名后两个并存；应用数据按 identifier 存，静默卸载不删数据。
!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LightClient_Ops" "InstallLocation"
  ; 注册表里的路径带引号
  StrCpy $R1 $R0 1
  ${If} $R1 == '"'
    StrCpy $R0 $R0 -1 1
  ${EndIf}
  ${If} $R0 != ""
  ${AndIf} ${FileExists} "$R0\uninstall.exe"
    ExecWait '"$R0\uninstall.exe" /S _?=$R0'
    Delete "$R0\uninstall.exe"
    RMDir "$R0"
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend
