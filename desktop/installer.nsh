!include "FileFunc.nsh"

; Keep the default directory and the builder's final directory check consistent.
!undef /noerrors APP_FILENAME
!define APP_FILENAME "JiangshanAtlas"

!ifndef BUILD_UNINSTALLER
Function AtlasNormalizeInstallDirectory
  Push $0

  ; Remove trailing separators before comparing the final component, not a substring.
  atlas_trim_separator:
    StrCpy $0 "$INSTDIR" 1 -1
    StrCmp $0 "\" 0 atlas_check_leaf
    StrCpy $INSTDIR "$INSTDIR" -1
    Goto atlas_trim_separator

  atlas_check_leaf:
    ${GetFileName} "$INSTDIR" $0
    ; NSIS StrCmp is case-insensitive, matching Windows directory semantics.
    StrCmp $0 "JiangshanAtlas" atlas_directory_ready
    StrCpy $INSTDIR "$INSTDIR\JiangshanAtlas"

  atlas_directory_ready:
    Pop $0
FunctionEnd

!macro customInit
  ; Also covers silent installation and the /D command-line destination.
  Call AtlasNormalizeInstallDirectory
!macroend

!macro customPageAfterChangeDir
  ; The directory page assigns INSTDIR after its leave callback. Normalize at the
  ; install-page pre callback, before any uninstall, extraction or registry writes.
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE AtlasInstallFilesPre

  Function AtlasInstallFilesPre
    Call AtlasNormalizeInstallDirectory
    Call instFilesPre
  FunctionEnd
!macroend
!endif
