!macro customInstall
  ; Add an explorer context menu entry for folders/directories.
  WriteRegStr HKCU "Software\\Classes\\Directory\\shell\\Open with AudioMetaEditor" "" "Open with AudioMetaEditor"
  WriteRegStr HKCU "Software\\Classes\\Directory\\shell\\Open with AudioMetaEditor" "Icon" "$INSTDIR\\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\\Classes\\Directory\\shell\\Open with AudioMetaEditor\\command" "" '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr HKCU "Software\\Classes\\Folder\\shell\\Open with AudioMetaEditor" "" "Open with AudioMetaEditor"
  WriteRegStr HKCU "Software\\Classes\\Folder\\shell\\Open with AudioMetaEditor" "Icon" "$INSTDIR\\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\\Classes\\Folder\\shell\\Open with AudioMetaEditor\\command" "" '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\\Classes\\Directory\\shell\\Open with AudioMetaEditor"
  DeleteRegKey HKCU "Software\\Classes\\Folder\\shell\\Open with AudioMetaEditor"
!macroend
