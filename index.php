<?php
declare(strict_types=1);

require __DIR__.'/api/catalog-view.php';

header('Cache-Control: no-store, max-age=0');
header('Content-Type: text/html; charset=UTF-8');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD'], true)) {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit;
}
try {
    $template = file_get_contents(__DIR__.'/index.html');
    if ($template === false) throw new RuntimeException('Catalog template missing');
    $active = DomCatalog\current();
    $page = $active ? DomCatalog\render($template, $active) : $template;
    header('X-Dom-Catalog-Template: '.hash('sha256', $template));
    header('X-Dom-Catalog-Snapshot: '.($active['version'] ?? 'bundled'));
    header('X-Dom-Catalog-Status: '.(!$active || $active['confirmed'] ? 'confirmed' : 'unconfirmed'));
    if ($method === 'GET') echo $page;
} catch (Throwable $error) {
    error_log('dom-catalog: '.$error->getMessage());
    http_response_code(503);
    header('Retry-After: 60');
    if ($method === 'GET') echo '<p>Каталог временно недоступен. Уточните наличие по телефону +7 (952) 956-88-75.</p>';
}
