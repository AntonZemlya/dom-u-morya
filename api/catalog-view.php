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
    $checkedAt = $state['checked_at'] ?? 0;
    if (!is_int($checkedAt) || $checkedAt < 0) throw new \RuntimeException('Invalid catalog check time');
    $age = time() - $checkedAt;
    $publishedChecked = $state['published_checked_at'] ?? 0;
    if (!is_int($publishedChecked) || $publishedChecked < 0 || $publishedChecked > $checkedAt) {
        throw new \RuntimeException('Invalid published offer check time');
    }
    $trusted = ($state['source_ok'] ?? false) === true && $age >= 0 && $age <= 36 * 3600;
    return [
        'version' => $version,
        'published_checked_at' => $publishedChecked,
        'status' => $trusted ? 'confirmed' : 'unconfirmed',
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

function priceDate(array $active): string {
    $latest = $active['published_checked_at'];
    $snapshot = $active['snapshot'];
    if ($latest === 0) {
        return 'Информация по состоянию на '.implode('.', array_reverse(explode('-', $snapshot['date'])));
    }
    $date = (new \DateTimeImmutable('@'.$latest))->setTimezone(new \DateTimeZone('Europe/Moscow'));
    $age = time() - $latest;
    if ($active['status'] !== 'confirmed' || $age < 0 || $age > 36 * 3600
        || count($snapshot['offers']) !== count($snapshot['lots'])) {
        return 'Информация по состоянию на '.$date->format('d.m.Y');
    }
    return 'Цены и наличие проверены по данным застройщика '.$date->format('d.m.Y').' в '.$date->format('H:i').' МСК';
}

function render(string $html, array $active): string {
    $snapshot = $active['snapshot'];
    $trusted = $active['status'] !== 'unconfirmed';
    $markup = $trusted ? $snapshot['catalog_html'] : $snapshot['unconfirmed_html'];
    if (!str_contains($markup, 'id="catalog-checked-at"')) {
        // Snapshots generated before the date field used the same furniture footnote.
        $markup = substitute($markup, '~(<p class="catalog-footnote">.*?)</p>~s',
            static fn(array $m): string => $m[1].'<br><span id="catalog-checked-at"></span></p>');
    }
    $markup = substitute($markup, '~(<span id="catalog-checked-at">).*?(</span>)~s',
        static fn(array $m): string => $m[1].priceDate($active).$m[2]);
    $html = substitute($html, '~(<!-- CONTENT:catalog:start -->).*?(<!-- CONTENT:catalog:end -->)~s',
        static fn(array $m): string => $m[1]."\n".$markup."\n".$m[2]);
    $html = substitute($html, '~(<script id="site-data" type="application/json">)(.*?)(</script>)~s',
        static function (array $m) use ($snapshot, $active, $trusted): string {
            $data = json_decode($m[2], true, 32, JSON_THROW_ON_ERROR);
            $data['snapshot_date'] = $snapshot['date'];
            $data['catalog_version'] = $active['version'];
            $data['catalog_status'] = $active['status'];
            $data['apartments'] = $snapshot['browser'];
            if (!$trusted) {
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
            static fn(): string => $input);
    }
    return substitute($html, '~(<script type="application/ld\+json">)(.*?)(</script>)~s',
        static function (array $m) use ($snapshot, $trusted): string {
            $schema = json_decode($m[2], true, 32, JSON_THROW_ON_ERROR);
            $nodes = [];
            foreach ($schema['@graph'] as $node) {
                if ($node['@type'] === 'Apartment' || ($node['@id'] ?? '') === 'https://zhk-dom-umorya.ru/#plans') continue;
                if (isset($node['offers'])) $node['offers'] = $trusted ? $snapshot['offers'] : [];
                $nodes[] = $node;
            }
            $schema['@graph'] = array_merge($nodes, $snapshot['graph']);
            return $m[1].jsonScript($schema).$m[3];
        });
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }
