param(
    [string]$Serial = $env:JAZZ_ANDROID_SERIAL,
      [string]$UnlockCode = "8272"
)







$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Serial)) {
    throw "JAZZ_ANDROID_SERIAL is not available to unlockmobile"
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }


& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP
& $adb -s $Serial shell input swipe 500 1500 500 500 500
& $adb -s $Serial shell   input text $UnlockCode 

& $adb -s $Serial shell input keyevent KEYCODE_ENTER

Start-Sleep -Seconds 3

$GooglePayPackage = "com.google.android.apps.nbu.paisa.user"
$GooglePayActivity = "com.google.nbu.paisa.flutter.gpay.app.LauncherActivity"

# Close an existing Google Pay session first
& $adb -s $Serial shell am force-stop $GooglePayPackage



# Launch the exact Google Pay activity
& $adb -s $Serial shell am start -n "$GooglePayPackage/$GooglePayActivity"

Start-Sleep -Seconds 4

& $adb -s $Serial shell input tap 670 860
& $adb -s $Serial shell input tap 50 100
Start-Sleep -Milliseconds 500




& $adb -s $Serial shell input text "Meena"
Start-Sleep -Seconds 5

& $adb -s $Serial shell input tap 50 400
Start-Sleep -Seconds 1

& $adb -s $Serial shell input tap 670 1500
Start-Sleep -Seconds 2

 & $adb -s $Serial shell input text "1" 
& $adb -s $Serial shell input keyevent KEYCODE_ENTER 
& $adb -s $Serial shell input tap 670 1400
  Start-Sleep -Seconds 2 
 & $adb -s $Serial shell input tap 50 1300 
 & $adb -s $Serial shell input tap 360 1100 
 & $adb -s $Serial shell input tap 360 1300 
 & $adb -s $Serial shell input tap 360 1100 
 & $adb -s $Serial shell input tap 670 1500














if ($LASTEXITCODE -ne 0) {
    throw "ADB could not wake the Android device."   
}

Start-Sleep -Milliseconds 500

[pscustomobject]@{
    ok             = $true
    status         = "authentication_required"
    message        = "Hey Mama, i have paid to mom. What do you want me to do next??"
    script         = "unlockmobile.ps1"
    executedScript = $true
} | ConvertTo-Json -Compress
