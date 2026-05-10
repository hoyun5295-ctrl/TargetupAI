$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Web

$root    = 'C:\Users\ceo\projects\targetup\Alimtalk'
$outPath = 'C:\Users\ceo\projects\targetup\kakao_alimtalk.md'

$categoryOrder = @(
  '알림톡 템플릿 관리 API',
  '발신프로필 관리 API',
  '이미지 업로드 API',
  '브랜드메시지 템플릿 관리 API',
  '알림톡 템플릿 검수 알림 수신자 관리 API',
  '템플릿 카테고리 조회 API'
)
$methodOrder = @{ 'POST'=1; 'GET'=2; 'PUT'=3; 'PATCH'=4; 'DELETE'=5 }

function Extract-Manual {
  param([string]$Path)

  $html = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)

  $bodyStart = $html.IndexOf('<body', [StringComparison]::OrdinalIgnoreCase)
  if ($bodyStart -lt 0) { return '(body not found)' }
  $tagEnd = $html.IndexOf('>', $bodyStart) + 1
  $body = $html.Substring($tagEnd)

  $body = [regex]::Replace($body, '<script[\s\S]*?</script>', '', 'IgnoreCase')
  $body = [regex]::Replace($body, '<style[\s\S]*?</style>', '', 'IgnoreCase')
  $body = [regex]::Replace($body, '<noscript[\s\S]*?</noscript>', '', 'IgnoreCase')
  $body = [regex]::Replace($body, '<template[\s\S]*?</template>', '', 'IgnoreCase')
  $body = [regex]::Replace($body, '<svg[\s\S]*?</svg>', '', 'IgnoreCase')

  $body = [regex]::Replace($body, 'src(set)?\s*=\s*"data:[^"]*"', '', 'IgnoreCase')
  $body = [regex]::Replace($body, "src(set)?\s*=\s*'data:[^']*'", '', 'IgnoreCase')
  $body = [regex]::Replace($body, 'href\s*=\s*"data:[^"]*"', '', 'IgnoreCase')

  $blockTags = 'p|div|h[1-6]|li|tr|td|th|table|thead|tbody|section|article|main|header|footer|nav|pre|code|br|hr'
  $body = [regex]::Replace($body, "<($blockTags)\b[^>]*>", "`n", 'IgnoreCase')
  $body = [regex]::Replace($body, "</($blockTags)\s*>", "`n", 'IgnoreCase')

  $body = [regex]::Replace($body, '<[^>]+>', '')
  $body = [System.Web.HttpUtility]::HtmlDecode($body)

  $body = $body -replace "[ ​]", ' '
  $body = $body -replace '[ \t]+', ' '
  $body = $body -replace '\r\n', "`n"
  $body = $body -replace ' *\n *', "`n"
  $body = $body -replace '\n{3,}', "`n`n"
  $body = $body.Trim()

  # 좌측 글로벌 메뉴 제거 — "선택한 버전(기본:" 영역
  $verIdx = $body.IndexOf('선택한 버전(기본:')
  if ($verIdx -ge 0) {
    $afterVer = $body.IndexOf("`n`n", $verIdx)
    if ($afterVer -ge 0) {
      $body = $body.Substring($afterVer + 2)
    }
  }

  # 우측 사이드바(엔드포인트\n\nALL...) + 인증 영역(x-imc-api-key + 샌드박스 안내문) 통째 제거
  # cURL 라인이 있으면 cURL 직전까지 자름, 없으면 "엔드포인트" 라인부터 끝까지 자름
  $body = [regex]::Replace(
    $body,
    '\n엔드포인트\s*\n\s*ALL[\s\S]*?(?=\ncURL\s*\n|\z)',
    "`n",
    'Singleline'
  )
  # cURL이 없는 매뉴얼인데 인증 섹션만 남은 경우 보강
  $body = [regex]::Replace(
    $body,
    '\n인증\s*\nx-imc-api-key[\s\S]*?(?=\ncURL\s*\n|\z)',
    "`n",
    'Singleline'
  )

  # Path Params / Query Params / Headers / Request Body 입력 폼 영역 제거
  $body = [regex]::Replace($body, '\nPath Params\n[\s\S]*?(?=\nTest 결과|\Z)', '', 'Singleline')
  $body = [regex]::Replace($body, '\nQuery Params\n[\s\S]*?(?=\nTest 결과|\Z)', '', 'Singleline')
  $body = [regex]::Replace($body, '\nHeaders\n[\s\S]*?(?=\nTest 결과|\Z)', '', 'Singleline')
  $body = [regex]::Replace($body, '\nRequest Body\n[\s\S]*?(?=\nTest 결과|\nPath Params|\nQuery Params|\Z)', '', 'Singleline')

  # Test 결과 이후 제거
  $testIdx = $body.IndexOf('Test 결과')
  if ($testIdx -ge 0) {
    $body = $body.Substring(0, $testIdx).TrimEnd()
  }

  # 잔여 UI 텍스트 제거
  $body = $body -replace '\n전체 펼치기전체 접기\n', "`n"
  $body = $body -replace '\n복사reset테스트 요청\n', "`n"
  $body = $body -replace '\n복사테스트 요청\n', "`n"
  $body = $body -replace '\n복사\n', "`n"
  $body = $body -replace '\nreset\n', "`n"
  $body = $body -replace '\n하위 속성 숨기기\n', "`n"
  $body = $body -replace '\n하위 속성 보기\n', "`n"
  $body = $body -replace '⧉', ''
  $body = $body -replace '🌙', ''
  $body = $body -replace '▸', ''

  $body = $body -replace '\n{3,}', "`n`n"
  return $body.Trim()
}

# === 본문 작성 ===
$sb = New-Object System.Text.StringBuilder

$totalCount = 0
foreach ($cat in $categoryOrder) {
  $catPath = Join-Path $root $cat
  if (Test-Path $catPath) {
    $totalCount += (Get-ChildItem $catPath -Filter '*.html').Count
  }
}

[void]$sb.AppendLine('# 카카오 알림톡 / 브랜드메시지 IMC API 통합 레퍼런스')
[void]$sb.AppendLine()
[void]$sb.AppendLine('**출처:** humuson IMC Developer Portal (`http://121.189.17.229:3100/docs/`)  ')
[void]$sb.AppendLine("**추출일:** $(Get-Date -Format 'yyyy-MM-dd')  ")
[void]$sb.AppendLine("**총 API 개수:** $totalCount  ")
[void]$sb.AppendLine('**한줄로 매핑 대상 파일:** `packages/backend/src/utils/alimtalk-api.ts`, `brand-message.ts`  ')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 목차')
[void]$sb.AppendLine()
foreach ($cat in $categoryOrder) {
  $catPath = Join-Path $root $cat
  if (Test-Path $catPath) {
    $cnt = (Get-ChildItem $catPath -Filter '*.html').Count
    $anchor = $cat.Replace(' ', '-')
    [void]$sb.AppendLine("- [$cat](#$anchor) — $cnt 개")
  }
}
[void]$sb.AppendLine()
[void]$sb.AppendLine('---')
[void]$sb.AppendLine()

foreach ($cat in $categoryOrder) {
  $catPath = Join-Path $root $cat
  if (-not (Test-Path $catPath)) { continue }

  $files = Get-ChildItem $catPath -Filter '*.html'
  $sorted = $files | Sort-Object @{
    Expression = {
      if ($_.Name -match '^(POST|GET|PUT|PATCH|DELETE)_') { $methodOrder[$matches[1]] }
      else { 99 }
    }
  }, Name

  [void]$sb.AppendLine("# $cat")
  [void]$sb.AppendLine()
  [void]$sb.AppendLine("총 **$($files.Count)개** API")
  [void]$sb.AppendLine()

  foreach ($f in $sorted) {
    if ($f.BaseName -match '^(POST|GET|PUT|PATCH|DELETE)_(.+)$') {
      $method = $matches[1]
      $title  = $matches[2]
    } else {
      $method = '?'
      $title  = $f.BaseName
    }

    Write-Host ("  -> [{0}] {1}" -f $method, $title)
    $extracted = Extract-Manual -Path $f.FullName

    [void]$sb.AppendLine("## [$method] $title")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine($extracted)
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('---')
    [void]$sb.AppendLine()
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), $utf8NoBom)

$outFile = Get-Item $outPath
"`n=== Done ==="
"Output: $outPath"
"Size  : {0} KB ({1:N0} bytes)" -f [int]($outFile.Length / 1024), $outFile.Length
"Lines : {0:N0}" -f ([System.IO.File]::ReadAllLines($outPath).Length)
"Total : $totalCount manuals processed"
