$dirs = @('pages.html', 'pages risaralda', 'pages otros', 'nuevos puntos')
foreach ($dir in $dirs) {
  Get-ChildItem "$dir\*.html" | ForEach-Object {
    $file = $_.FullName
    $content = Get-Content $file -Raw
    $newContent = $content -replace '<div class="footer">© 2025 CM Colombia Dispensario S.A.S</div>', '<div class="footer">© 2025 CM Colombia Dispensario S.A.S | <a href="https://wa.me/6020000000" target="_blank" style="color:#fff;text-decoration:none;">📱 WhatsApp</a> | <a href="mailto:contacto@empresa.com" style="color:#fff;text-decoration:none;">✉️ Gmail</a></div>'
    Set-Content $file $newContent
  }
}