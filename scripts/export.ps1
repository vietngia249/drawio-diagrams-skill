param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputDir,[ValidateSet('png','svg')][string]$Format='png')
$cli=Get-Command drawio -ErrorAction SilentlyContinue
if(!$cli){Write-Output 'draw.io CLI not found. Install diagrams.net desktop/CLI, then rerun export.ps1.';exit 0}
New-Item -ItemType Directory -Force $OutputDir|Out-Null
& $cli.Source --export --format $Format --output $OutputDir $InputFile
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}