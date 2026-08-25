$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://127.0.0.1:9876/')
$listener.Start()
$root = 'D:\桌面\生产管理客户端'
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = $req.Url.LocalPath
    if ($path -eq '/') { $path = '/index.html' }
    $full = Join-Path $root ($path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    if (Test-Path $full) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = $bytes.Length
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      switch ($ext) {
        '.html' { $res.ContentType = 'text/html; charset=utf-8' }
        '.js'   { $res.ContentType = 'application/javascript; charset=utf-8' }
        '.css'  { $res.ContentType = 'text/css; charset=utf-8' }
        '.png'  { $res.ContentType = 'image/png' }
        '.json' { $res.ContentType = 'application/json; charset=utf-8' }
        default { $res.ContentType = 'text/plain; charset=utf-8' }
      }
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found: ' + $path)
      $res.OutputStream.Write($msg, 0, $msg.Length)
    }
    $res.OutputStream.Close()
  } catch {}
}
