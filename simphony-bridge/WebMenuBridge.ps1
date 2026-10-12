$ErrorActionPreference = 'Stop'
$Base = 'C:\Micros\WebMenuBridge'
$Log = Join-Path $Base 'bridge.log'
$Config = Get-Content (Join-Path $Base 'config.json') -Raw | ConvertFrom-Json
$BridgeUrl = $Config.bridge_url
$BridgeToken = $Config.bridge_token
$OutletSlug = $Config.outlet_slug
$PosApi = 'http://127.0.0.1:8080/EGateway/SimphonyPosApiWeb.asmx'
$EmployeeObjectNum = 966006904

function Write-BridgeLog([string]$Message) {
  Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
}

function Invoke-Bridge([hashtable]$Body) {
  Invoke-RestMethod -Uri $BridgeUrl -Method Post -ContentType 'application/json' -Headers @{ 'x-bridge-token' = $BridgeToken } -Body ($Body | ConvertTo-Json -Depth 20 -Compress) -TimeoutSec 30
}

function Invoke-PosSoap([string]$Action,[string]$Body) {
  Invoke-WebRequest -Uri $PosApi -Method Post -ContentType 'text/xml; charset=utf-8' -Headers @{ SOAPAction = ('"http://tempuri.org/{0}"' -f $Action) } -Body $Body -UseBasicParsing -TimeoutSec 90
}

function Get-OpenChecks([int]$Rvc) {
$soap = @"
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
 <soap:Body><GetOpenChecksByRVC xmlns="http://tempuri.org/">
  <vendorCode>WEBMENU</vendorCode><employeeObjectNum>$EmployeeObjectNum</employeeObjectNum>
  <revenueCenterObjectNum>$Rvc</revenueCenterObjectNum><ppCheckSummary></ppCheckSummary>
 </GetOpenChecksByRVC></soap:Body>
</soap:Envelope>
"@
  $r = Invoke-PosSoap 'GetOpenChecksByRVC' $soap
  [xml]$xml = $r.Content
  @($xml.SelectNodes('//*[local-name()="SimphonyPosApi_CheckSummary"]'))
}

function Get-MenuItemsXml($Job) {
  $sb = New-Object Text.StringBuilder
  foreach ($item in $Job.order.items) {
    $ref = [Security.SecurityElement]::Escape(("WEB ORDER #{0} - {1}" -f $Job.order.order_no, $item.micros_name))
    [void]$sb.Append(@"
    <SimphonyPosApi_MenuItemEx>
     <MenuItem>
      <ItemDiscount />
      <MiObjectNum>$($item.object_number)</MiObjectNum>
      <MiOverridePrice />
      <MiQuantity>$([decimal]$item.qty)</MiQuantity>
      <MiReference>$ref</MiReference>
      <MiWeight />
      <MiMenuLevel>0</MiMenuLevel>
      <MiSubLevel>0</MiSubLevel>
      <MiPriceLevel>$([int]$item.price_sequence)</MiPriceLevel>
      <MiDefinitionSeqNum>$([int]$item.definition_sequence)</MiDefinitionSeqNum>
     </MenuItem>
     <Condiments />
     <Extensibility />
    </SimphonyPosApi_MenuItemEx>
"@)
  }
  $sb.ToString()
}

function Send-SimphonyOrder($Job) {
  $rvc = [int]$Job.rvc_number
  $table = [int]$Job.table_number
  $orderType = [int]$Job.order_type

  $existing = Get-OpenChecks $rvc | Where-Object { [int]$_.CheckTableObjectNum -eq $table }
  if ($existing) { throw "Table $table already has open Simphony check #$($existing[0].CheckNum)." }

  $itemsXml = Get-MenuItemsXml $Job
  if ([string]::IsNullOrWhiteSpace($itemsXml)) { throw 'Order has no mapped Simphony items.' }

  $checkId = "WEB-$($Job.order.order_no)-$(([string]$Job.job_id).Substring(0,8))"
  $tmedRef = [Security.SecurityElement]::Escape("WEB MENU ORDER #$($Job.order.order_no)")
$soap = @"
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
 <soap:Body>
  <PostTransactionEx2 xmlns="http://tempuri.org/">
   <pGuestCheck>
    <CheckEmployeeObjectNum>$EmployeeObjectNum</CheckEmployeeObjectNum>
    <CheckGuestCount>1</CheckGuestCount>
    <CheckID>$checkId</CheckID>
    <CheckOrderType>$orderType</CheckOrderType>
    <CheckRevenueCenterID>$rvc</CheckRevenueCenterID>
    <CheckStatusBits>0</CheckStatusBits>
    <CheckTableObjectNum>$table</CheckTableObjectNum>
   </pGuestCheck>
   <ppMenuItemsEx>
$itemsXml
   </ppMenuItemsEx>
   <ppComboMealsEx />
   <pSvcChargeEx />
   <pSubTotalDiscountEx />
   <pTmedDetailEx2>
    <SimphonyPosApi_TmedDetailItemEx2>
     <Extensibility />
     <TmedEPayment><PaymentCommand>NO_E_PAYMENT</PaymentCommand><BaseAmount /><TipAmount /><CashBackAmount /></TmedEPayment>
     <TmedObjectNum>1001</TmedObjectNum>
     <TmedPartialPayment />
     <TmedReference>$tmedRef</TmedReference>
    </SimphonyPosApi_TmedDetailItemEx2>
   </pTmedDetailEx2>
   <pTotalsResponseEx />
   <ppCheckPrintLines />
   <ppVoucherOutput />
   <checkExtensibilityDetails />
  </PostTransactionEx2>
 </soap:Body>
</soap:Envelope>
"@

  $resp = Invoke-PosSoap 'PostTransactionEx2' $soap
  $decoded = [Net.WebUtility]::HtmlDecode($resp.Content)
  if ($decoded -match '<Success>false</Success>') {
    if ($decoded -match '<ErrorMessage>(.*?)</ErrorMessage>') { throw $Matches[1] }
    throw 'Simphony returned Success=false.'
  }

  Start-Sleep -Seconds 2
  $checks = Get-OpenChecks $rvc | Where-Object { [string]$_.CheckID -eq $checkId }
  if (-not $checks) { throw "No open Simphony check found for CheckID $checkId after PostTransactionEx2." }
  $check = $checks | Sort-Object { [int]$_.CheckSeq } -Descending | Select-Object -First 1

  [pscustomobject]@{
    CheckNum = [int]$check.CheckNum
    CheckSeq = [int]$check.CheckSeq
    Response = @{
      check_id = $checkId
      rvc = $rvc
      table = $table
      order_type = $orderType
      total_due = [string]$check.CheckTotalDue
      api = 'PostTransactionEx2'
    }
  }
}

Write-BridgeLog 'Bridge agent starting.'
while ($true) {
  try {
    $claim = Invoke-Bridge @{ action='claim'; outlet_slug=$OutletSlug }
    if ($null -eq $claim.job) { Start-Sleep -Seconds 5; continue }
    $job = $claim.job
    Write-BridgeLog "Claimed job $($job.job_id) order #$($job.order.order_no) table $($job.table_number)."
    try {
      $result = Send-SimphonyOrder $job
      [void](Invoke-Bridge @{ action='result'; job_id=[string]$job.job_id; success=$true; check_num=$result.CheckNum; check_seq=$result.CheckSeq; response=$result.Response })
      Write-BridgeLog "Sent order #$($job.order.order_no) -> check #$($result.CheckNum) seq $($result.CheckSeq)."
    } catch {
      $err = $_.Exception.Message
      [void](Invoke-Bridge @{ action='result'; job_id=[string]$job.job_id; success=$false; error=$err; response=@{ bridge='WebMenuBridge'; at=(Get-Date).ToString('o') } })
      Write-BridgeLog "FAILED job $($job.job_id): $err"
    }
  } catch {
    Write-BridgeLog "Loop error: $($_.Exception.Message)"
    Start-Sleep -Seconds 10
  }
}