' Luobi launcher - runs start-luobi.cmd with no console window.
'
' ASCII-ONLY ON PURPOSE:
' Windows Script Host decodes a BOM-less .vbs using the system ANSI codepage,
' so non-ASCII characters in comments can corrupt parsing (this broke once).
' Keep this file pure ASCII so it works regardless of the machine locale.
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ws.Run "cmd /c """ & scriptDir & "\start-luobi.cmd""", 0, False
