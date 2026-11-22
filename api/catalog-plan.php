<?php
declare(strict_types=1);

require __DIR__.'/catalog-view.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD'], true)) {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit;
}
$file = $_GET['file'] ?? '';
$preview = $_GET['preview'] ?? null;
if (!is_string($file) || !preg_match('/\A[a-f0-9]{64}(?:\.svg|\.preview\.webp)\z/D', $file)) {
    http_response_code(404);
    exit;
}
if ($preview !== null && (!is_string($preview) || !preg_match('/\A[a-f0-9]{64}\z/D', $preview))) {
    http_response_code(404);
    exit;
}
$svg = str_ends_with($file, '.svg');
$relative = !$svg && $preview !== null ? 'previews/'.$preview.'.webp' : $file;
try {
    $bytes = DomCatalog\privateBytes(DomCatalog\directory().'/media/'.$relative, DomCatalog\MAX_PLAN_BYTES);
} catch (Throwable) {
    http_response_code(404);
    exit;
}
if ($svg && !hash_equals(substr($file, 0, 64), hash('sha256', $bytes))) {
    http_response_code(503);
    exit;
}
if (!$svg && $preview !== null && !hash_equals($preview, hash('sha256', $bytes))) {
    http_response_code(503);
    exit;
}
header('Content-Type: '.($svg ? 'image/svg+xml' : 'image/webp'));
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox");
header('Cache-Control: public, max-age=86400, immutable');
header('Content-Length: '.strlen($bytes));
if ($method === 'GET') echo $bytes;
