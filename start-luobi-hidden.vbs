' 隐藏窗口启动落笔（不弹出控制台）
' 自动定位脚本所在目录，不依赖任何绝对路径
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ws.Run "cmd /c """ & scriptDir & "\start-luobi.cmd""", 0, False
