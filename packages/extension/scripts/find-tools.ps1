Write-Host "PATH: $env:PATH"
Write-Host "Node x64: $(Test-Path 'C:\Program Files\nodejs\node.exe')"
Write-Host "Node x86: $(Test-Path 'C:\Program Files (x86)\nodejs\node.exe')"
Write-Host "Local Programs: $(Get-ChildItem -Path "$env:LOCALAPPDATA\Programs" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)"
