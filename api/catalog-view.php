<?php
declare(strict_types=1);

namespace DomCatalog;

const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_PLAN_BYTES = 2 * 1024 * 1024;

function directory(): string {
    return dirname(__DIR__, 3).'/.dom-u-morya/catalog-sync-v1';
}

function privateBytes(string $file, int $limit): string {
    if (realpath($file) !== $file || !is_file($file) || (fileperms($file) & 0777) !== 0600) {
        throw new \RuntimeException('Catalog file unavailable');
    }
    $bytes = file_get_contents($file, false, null, 0, $limit + 1);
    if ($bytes === false || $bytes === '' || strlen($bytes) > $limit) {
        throw new \RuntimeException('Invalid catalog file size');
    }
    return $bytes;
}

function current(): ?array {
    $dir = directory();
    $file = $dir.'/state.json';
    if (!file_exists($file) && !is_link($file)) return null;
    if (realpath($dir) !== $dir || (fileperms($dir) & 0777) !== 0700) {
        throw new \RuntimeException('Catalog directory unavailable');
    }
    $state = json_decode(privateBytes($file, MAX_STATE_BYTES), true, 24, JSON_THROW_ON_ERROR);
    $version = $state['active'] ?? '';
    if (($state['schema'] ?? null) !== 1 || !preg_match('/\A[a-f0-9]{64}\z/D', $version)) {
        throw new \RuntimeException('Unrecognized catalog state');
    }
    $raw = privateBytes($dir.'/snapshots/'.$version.'.json', MAX_SNAPSHOT_BYTES);
    if (!hash_equals($version, hash('sha256', $raw))) throw new \RuntimeException('Catalog checksum mismatch');
    $snapshot = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    if (($snapshot['schema'] ?? null) !== 1 || empty($snapshot['lots'])) {
        throw new \RuntimeException('Unrecognized catalog snapshot');
    }
    $age = time() - ($state['checked_at'] ?? 0);
    return [
        'version' => $version,
        'confirmed' => ($state['source_ok'] ?? false) === true && $age >= 0 && $age <= 36 * 3600,
        'snapshot' => $snapshot,
    ];
}

function substitute(string $document, string $pattern, callable $build): string {
    $output = preg_replace_callback($pattern, $build, $document, -1, $count);
    if ($output === null || $count !== 1) throw new \RuntimeException('Catalog template markers changed');
    return $output;
}

function jsonScript(array $value): string {
    return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_UNESCAPED_SLASHES);
}

function render(string $html, array $active): string {
    $snapshot = $active['snapshot'];
    $confirmed = $active['confirmed'];
    $notice = '';
    if (!$confirmed) {
        $notice = '<p role="status" class="content-note">Показаны последние проверенные цены. Актуальность цен и наличие уточняются.</p>';
    } elseif (count($snapshot['offers']) < count($snapshot['lots'])) {
        $notice = '<p role="status" class="content-note">Актуальность цены и наличия отдельных квартир уточняется.</p>';
    }
    $markup = $confirmed ? $snapshot['catalog_html'] : $snapshot['unconfirmed_html'];
    $html = substitute($html, '~(<!-- CONTENT:catalog:start -->).*?(<!-- CONTENT:catalog:end -->)~s',
        static fn(array $m): string => $m[1]."\n".$notice.$markup."\n".$m[2]);
    $html = substitute($html, '~(<script id="site-data" type="application/json">)(.*?)(</script>)~s',
        static function (array $m) use ($snapshot, $active, $confirmed): string {
            $data = json_decode($m[2], true, 32, JSON_THROW_ON_ERROR);
            $data['snapshot_date'] = $snapshot['date'];
            $data['catalog_version'] = $active['version'];
            $data['apartments'] = $snapshot['browser'];
            if (!$confirmed) {
                foreach ($data['apartments'] as &$lot) $lot['developer_availability'] = null;
                unset($lot);
            }
            return $m[1].jsonScript($data).$m[3];
        });
    foreach ($snapshot['calculator']['labels'] as $id => $label) {
        $pattern = '~(<(?:span|div) id="'.preg_quote($id, '~').'"[^>]*>).*?(</(?:span|div)>)~s';
        $html = substitute($html, $pattern, static fn(array $m): string => $m[1].$label.$m[2]);
    }
    foreach ($snapshot['calculator']['inputs'] as $id => $input) {
        $html = substitute($html, '~<input type="range"[^>]*id="'.preg_quote($id, '~').'"[^>]*>~',
            static fn(): string => $input.($id === 'price-range' ? $notice : ''));
    }
    return substitute($html, '~(<script type="application/ld\+json">)(.*?)(</script>)~s',
        static function (array $m) use ($snapshot, $confirmed): string {
            $schema = json_decode($m[2], true, 32, JSON_THROW_ON_ERROR);
            $nodes = [];
            foreach ($schema['@graph'] as $node) {
                if ($node['@type'] === 'Apartment' || ($node['@id'] ?? '') === 'https://zhk-dom-umorya.ru/#plans') continue;
                if (isset($node['offers'])) $node['offers'] = $confirmed ? $snapshot['offers'] : [];
                $nodes[] = $node;
            }
            $schema['@graph'] = array_merge($nodes, $snapshot['graph']);
            return $m[1].jsonScript($schema).$m[3];
        });
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }
