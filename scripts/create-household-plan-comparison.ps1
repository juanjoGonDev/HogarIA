[CmdletBinding()]
param(
  [string]$ReferenceDirectory = (Join-Path $env:USERPROFILE '.codex/generated_images/01a11138-d990-7ed3-a48d-2681d285b3d7'),
  [string]$ScreenshotDirectory = (Join-Path (Get-Location) '.e2e-screenshots/household-plan-tasks'),
  [string]$OutputDirectory = (Join-Path (Get-Location) '.e2e-screenshots/household-plan-comparison')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$states = @(
  @{ Name = '01-plan-start'; Reference = 'exec-3d60ee65-e311-4692-a979-b1f4564929a9.png'; DesktopX = 264; DesktopWidth = 804 },
  @{ Name = '02-plan-editor'; Reference = 'exec-3be5f6ed-8bd1-47a8-b708-35ab9452dff0.png'; DesktopX = 264; DesktopWidth = 804 },
  @{ Name = '03-photo-proposal'; Reference = 'exec-9299b3b6-c022-4f96-b9c4-7eb0337afc28.png'; DesktopX = 264; DesktopWidth = 804 },
  @{ Name = '04-zone-assignment'; Reference = 'exec-e2e39a1a-d995-4927-bc38-205c925ab781.png'; DesktopX = 264; DesktopWidth = 804 },
  @{ Name = '05-weekly-tasks'; Reference = 'exec-455e098e-dd5b-4600-b0aa-1c9939baf363.png'; DesktopX = 264; DesktopWidth = 804 },
  @{ Name = '06-chat-adjustment'; Reference = 'exec-042a1622-76b0-4f9a-87d6-bc7f4e404ba3.png'; DesktopX = 264; DesktopWidth = 804 }
)

function Get-Crop($Image, $X, $Y, $Width, $Height) {
  if (($X + $Width) -gt $Image.Width -or ($Y + $Height) -gt $Image.Height) {
    throw "Crop ${X},${Y},${Width},${Height} exceeds source image $($Image.Width)x$($Image.Height)."
  }

  $crop = [System.Drawing.Bitmap]::new($Width, $Height)
  $graphics = [System.Drawing.Graphics]::FromImage($crop)
  try {
    $graphics.DrawImage(
      $Image,
      [System.Drawing.Rectangle]::new(0, 0, $Width, $Height),
      [System.Drawing.Rectangle]::new($X, $Y, $Width, $Height),
      [System.Drawing.GraphicsUnit]::Pixel
    )
  }
  finally {
    $graphics.Dispose()
  }
  return $crop
}

function Save-Comparison($Reference, $Actual, $Path) {
  $canvas = [System.Drawing.Bitmap]::new($Reference.Width + $Actual.Width, [Math]::Max($Reference.Height, $Actual.Height))
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.DrawImage($Reference, 0, 0, $Reference.Width, $Reference.Height)
    $graphics.DrawImage($Actual, $Reference.Width, 0, $Actual.Width, $Actual.Height)
    $canvas.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $canvas.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

foreach ($state in $states) {
  $referencePath = Join-Path $ReferenceDirectory $state.Reference
  $desktopPath = Join-Path (Join-Path $ScreenshotDirectory 'chromium') "$($state.Name).png"
  $mobilePath = Join-Path (Join-Path $ScreenshotDirectory 'mobile-chrome') "$($state.Name).png"
  foreach ($path in @($referencePath, $desktopPath, $mobilePath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing comparison input: $path" }
  }

  $reference = [System.Drawing.Image]::FromFile($referencePath)
  $desktop = [System.Drawing.Image]::FromFile($desktopPath)
  $mobile = [System.Drawing.Image]::FromFile($mobilePath)
  $desktopReference = $null
  $mobileReference = $null
  try {
    # Compare the product content below each prototype/app shell, not their different navigation shells.
    $desktopReference = Get-Crop $reference $state.DesktopX 104 $state.DesktopWidth 894
    $desktopActual = Get-Crop $desktop 312 76 $state.DesktopWidth 894
    # Crop the 390x950 phone screen, excluding its status bar and device bezel.
    $mobileReference = Get-Crop $reference 1124 54 390 950
    Save-Comparison $desktopReference $desktopActual (Join-Path $OutputDirectory "$($state.Name)-desktop.png")
    Save-Comparison $mobileReference $mobile (Join-Path $OutputDirectory "$($state.Name)-mobile.png")
  }
  finally {
    $reference.Dispose()
    $desktop.Dispose()
    $mobile.Dispose()
    if ($desktopReference) { $desktopReference.Dispose() }
    if ($desktopActual) { $desktopActual.Dispose() }
    if ($mobileReference) { $mobileReference.Dispose() }
  }
}

Write-Output "Created 12 synthetic desktop/mobile comparisons in $OutputDirectory"
