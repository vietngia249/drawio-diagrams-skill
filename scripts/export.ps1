[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InputFile,
  [Parameter(Mandatory=$true)][string]$OutputDir,
  [ValidateSet('png','svg')][string]$Format='png',
  [ValidateRange(1,600)][int]$TimeoutSeconds=60
)
$ErrorActionPreference = 'Stop'
function Stop-WithDiagnostic([string]$Code, [string]$Message, [int]$ExitCode = 1) {
  [Console]::Error.WriteLine((@{ok=$false;error=$Message;diagnostics=@(@{severity='error';code=$Code;message=$Message})} | ConvertTo-Json -Depth 5))
  exit $ExitCode
}
function Quote-NativeArgument([string]$Value) {
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}
try {
  $source = (Resolve-Path -LiteralPath $InputFile).Path
  if ([IO.Path]::GetExtension($source) -notin @('.drawio','.xml')) { Stop-WithDiagnostic 'INPUT_TYPE' 'Input must be a .drawio or .xml file.' }
  $null = New-Item -ItemType Directory -Force -Path $OutputDir
  $destination = (Resolve-Path -LiteralPath $OutputDir).Path
  $referenceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\work\drawio-references')).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ($destination.Equals($referenceRoot.TrimEnd([IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or $destination.StartsWith($referenceRoot, [StringComparison]::OrdinalIgnoreCase)) { Stop-WithDiagnostic 'REFERENCE_TREE_WRITE' 'Export output directory must be outside work/drawio-references.' }
  $candidates = @()
  $command = Get-Command drawio -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { $candidates += $command.Source }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($base) { $candidates += (Join-Path $base 'draw.io/draw.io.exe'); $candidates += (Join-Path $base 'draw.io.exe'); $candidates += (Join-Path $base 'Programs/draw.io/draw.io.exe') }
  }
  $exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if (!$exe) { Stop-WithDiagnostic 'CLI_NOT_FOUND' 'draw.io Desktop executable was not found on PATH or in standard install locations.' }
  $before = @{}; Get-ChildItem -LiteralPath $destination -File | ForEach-Object { $before[$_.FullName.ToLowerInvariant()] = $_.LastWriteTimeUtc.Ticks }
  $started = [DateTime]::UtcNow
  $psi = [Diagnostics.ProcessStartInfo]::new(); $psi.FileName = $exe; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $nativeArgs = @('--export','--format',$Format,'--output',$destination,$source) | ForEach-Object { Quote-NativeArgument ([string]$_) }
  $psi.Arguments = $nativeArgs -join ' '
  $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
  if (!$process.Start()) { Stop-WithDiagnostic 'EXPORT_START' 'Could not start draw.io Desktop.' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
  if (!$process.WaitForExit($TimeoutSeconds * 1000)) { try { $process.Kill($true) } catch { try { $process.Kill() } catch {} }; Stop-WithDiagnostic 'EXPORT_TIMEOUT' "draw.io export exceeded $TimeoutSeconds seconds." 124 }
  $process.WaitForExit(); $stdout = $stdoutTask.GetAwaiter().GetResult(); $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) { Stop-WithDiagnostic 'EXPORT_EXIT' "draw.io returned exit code $($process.ExitCode). $stderr $stdout" $process.ExitCode }
  $fresh = @(Get-ChildItem -LiteralPath $destination -File -Filter "*.$Format" | Where-Object { $_.LastWriteTimeUtc -ge $started -and $_.Length -gt 0 -and (!$before.ContainsKey($_.FullName.ToLowerInvariant()) -or $_.LastWriteTimeUtc.Ticks -gt $before[$_.FullName.ToLowerInvariant()]) })
  if ($fresh.Count -eq 0) { Stop-WithDiagnostic 'OUTPUT_MISSING' "draw.io returned success but produced no fresh, nonempty .$Format file." }
  foreach ($file in $fresh) {
    if ($Format -eq 'png') {
      $bytes = [IO.File]::ReadAllBytes($file.FullName)
      if ($bytes.Length -lt 24 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71 -or $bytes[12] -ne 73 -or $bytes[13] -ne 72 -or $bytes[14] -ne 68 -or $bytes[15] -ne 82) { Stop-WithDiagnostic 'OUTPUT_INVALID' "Exported PNG is unreadable: $($file.FullName)" }
    } else {
      try { $xml = [xml](Get-Content -LiteralPath $file.FullName -Raw); if (!$xml.DocumentElement -or $xml.DocumentElement.LocalName -ne 'svg') { throw 'No svg root element' } } catch { Stop-WithDiagnostic 'OUTPUT_INVALID' "Exported SVG is unreadable: $($file.FullName): $($_.Exception.Message)" }
    }
  }
  @{ok=$true;executable=$exe;outputFiles=@($fresh | ForEach-Object { @{path=$_.FullName;bytes=$_.Length} });stdout=$stdout;stderr=$stderr} | ConvertTo-Json -Depth 5
} catch { Stop-WithDiagnostic 'EXPORT_FAILURE' $_.Exception.Message }
