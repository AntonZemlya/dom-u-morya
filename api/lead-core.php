<?php
declare(strict_types=1);

namespace DomLead;

const CONSENT_VERSION = '2026-10-30';
const MAILBOX = 'sales@zhk-dom-umorya.ru';
const ORIGIN = 'https://zhk-dom-umorya.ru';
const MAX_BODY = 8192;

final class Rejection extends \RuntimeException {
    public function __construct(public int $status, public string $reason) { parent::__construct($reason); }
}

function reject(int $status, string $reason): never { throw new Rejection($status, $reason); }
function localTest(): bool { return in_array(PHP_SAPI, ['cli', 'cli-server'], true); }

function config(): array {
    $path = dirname(__DIR__, 3) . '/.dom-u-morya/config.php';
    if (localTest() && getenv('LEAD_CONFIG')) $path = getenv('LEAD_CONFIG');
    if (!is_file($path) || is_link($path)) return [];
    $real = realpath($path);
    $root = realpath(dirname(__DIR__));
    if (!$real || str_starts_with($real, $root . DIRECTORY_SEPARATOR)) return [];
    $value = require $real;
    return is_array($value) ? $value : [];
}

function enabled(array $config): bool {
    return ($config['FORM_ENABLED'] ?? false) === true
        && ($config['DELIVERY_VERIFIED'] ?? false) === true
        && ($config['LEGAL_APPROVED'] ?? '') === CONSENT_VERSION;
}

function text(mixed $value, int $max, bool $required = false): string {
    if (!is_string($value) || !preg_match('//u', $value)
        || preg_match('/[\p{C}<>]/u', $value)) reject(422, 'invalid_fields');
    $value = trim($value);
    if (($required && $value === '') || preg_match_all('/./us', $value) > $max) reject(422, 'invalid_fields');
    return $value;
}

function validate(string $raw): array {
    try { $data = json_decode($raw, false, 12, JSON_THROW_ON_ERROR); }
    catch (\JsonException) { reject(400, 'invalid_json'); }
    if (!$data instanceof \stdClass) reject(400, 'invalid_json');
    $d = (array)$data;
    $allowed = ['name','phone','consent','consentVersion','lotId','category','planView','requestKind','email','channel','callTime','calculation','website'];
    if (array_diff(array_keys($d), $allowed)) reject(422, 'unknown_fields');
    if (($d['consent'] ?? false) !== true || ($d['consentVersion'] ?? '') !== CONSENT_VERSION) reject(422, 'consent_required');
    $v = ['name'=>text($d['name'] ?? null, 80, true), 'phone'=>text($d['phone'] ?? null, 12, true)];
    if (!preg_match('/^\+7[0-9]{10}$/D', $v['phone'])) reject(422, 'invalid_fields');
    foreach (['email'=>254,'lotId'=>16,'category'=>8,'planView'=>16,'requestKind'=>8,'channel'=>16,'callTime'=>8,'website'=>100] as $k=>$max) $v[$k] = text($d[$k] ?? '', $max);
    if ($v['website'] !== '') reject(422, 'invalid_fields');
    if ($v['email'] !== '' && !filter_var($v['email'], FILTER_VALIDATE_EMAIL)) reject(422, 'invalid_fields');
    foreach (['category'=>['','studio','1k','2k','3k','unsure'], 'planView'=>['','furnished','unfurnished','floor'], 'requestKind'=>['','general','plan','calc','full'], 'channel'=>['','Звонок','MAX','Telegram'], 'callTime'=>['','9-12','12-15','15-18']] as $key=>$values) {
        if (!in_array($v[$key], $values, true)) reject(422, 'invalid_fields');
    }
    $v['lot'] = null;
    if ($v['lotId'] !== '') {
        $catalog = json_decode(file_get_contents(dirname(__DIR__) . '/data/apartments.json'), true, 32, JSON_THROW_ON_ERROR);
        foreach ($catalog as $lot) if ($lot['id'] === $v['lotId']) $v['lot'] = $lot;
        if (!$v['lot']) reject(422, 'unknown_lot');
        $category = ['studio','1k','2k','3k'][$v['lot']['bedrooms']];
        if ($v['category'] !== '' && $v['category'] !== $category) reject(422, 'invalid_fields');
        $v['category'] = $category;
    }
    $v['calculation'] = null;
    if (isset($d['calculation'])) {
        if (!$d['calculation'] instanceof \stdClass) reject(422, 'invalid_fields');
        $c = (array)$d['calculation'];
        if (array_diff(array_keys($c), ['price','downPct','term','rate','program']) || count($c) !== 5) reject(422, 'invalid_fields');
        foreach (['price'=>[6978183,20000000], 'downPct'=>[10,70], 'term'=>[3,30], 'rate'=>[2,20]] as $key=>[$min,$max]) {
            if ((!is_int($c[$key] ?? null) && !is_float($c[$key] ?? null)) || !is_finite((float)$c[$key]) || $c[$key] < $min || $c[$key] > $max) reject(422, 'invalid_fields');
        }
        if (!is_int($c['price']) || !is_int($c['term']) || !is_int($c['downPct']) || !in_array($c['program'], ['regional','family','custom'], true)) reject(422, 'invalid_fields');
        if ($v['lot'] && $c['price'] !== $v['lot']['price_rub']) reject(422, 'price_mismatch');
        $v['calculation'] = $c;
    }
    return $v;
}

/** Body is plain text; every header and envelope address is controlled by the application. */
function message(array $v, string $id, int $now): array {
    $lines = ['ЖК «Дом у моря» — запрос на обработку', 'ID: '.$id, 'Время UTC: '.gmdate('c', $now),
        'Оператор: ИП Саврасова Елена Анатольевна', 'Имя: '.$v['name'], 'Телефон: '.$v['phone'],
        'E-mail: '.($v['email'] ?: 'не указан'), 'Связь: '.($v['channel'] ?: 'не указана'), 'Время связи: '.($v['callTime'] ?: 'любое'),
        'Категория: '.($v['category'] ?: 'не выбрана'), 'Тип запроса: '.($v['requestKind'] === 'full' ? '100% оплата, актуальный прайс и условия' : ($v['requestKind'] ?: 'общий')),
        'Вид планировки: '.($v['planView'] ?: 'не выбран')];
    if ($v['lot']) {
        $lot = $v['lot'];
        $lines[] = 'Каталог от '.$lot['snapshot_date'].'; наличие и цена требуют подтверждения агентством.';
        $lines[] = 'Лот '.$lot['id'].'; квартира '.$lot['number'].'; этаж '.$lot['floor'].'; площадь '.$lot['area_m2'].' м²; цена каталога '.$lot['price_rub'].' руб.';
    }
    if ($v['calculation']) {
        $c = $v['calculation'];
        $lines[] = 'Параметры расчёта введены пользователем, не являются предложением банка:';
        $lines[] = 'Стоимость '.$c['price'].' руб.; взнос '.$c['downPct'].'%; срок '.$c['term'].' лет; ставка '.$c['rate'].'%; программа '.$c['program'];
    }
    $lines[] = 'Самостоятельное согласие: true; редакция '.CONSENT_VERSION.'; получено UTC '.gmdate('c', $now);
    $lines[] = ORIGIN.'/consent-personal-data.html';
    return ['to'=>MAILBOX, 'subject'=>'=?UTF-8?B?'.base64_encode('Дом у моря — заявка').'?=',
        'body'=>implode("\r\n", $lines), 'id'=>$id];
}

function mailTransport(array $m): bool {
    // No visitor input in headers, envelope flags or a shell command. No PHP mail.log.
    ini_set('mail.log', '');
    return @mail(MAILBOX, $m['subject'], chunk_split(base64_encode($m['body']), 76, "\r\n"), [
        'From'=>MAILBOX, 'MIME-Version'=>'1.0', 'Content-Type'=>'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding'=>'base64', 'Message-ID'=>'<'.$m['id'].'@zhk-dom-umorya.ru>',
    ], '-fsales@zhk-dom-umorya.ru');
}

/** Single bounded state file contains HMACs and delivery metadata only; never raw IP or payload. */
function accept(array $v, string $key, string $ip, array $cfg, callable $mailer, int $now): array {
    $secret = $cfg['HMAC_SECRET'] ?? '';
    $dir = $cfg['STATE_DIR'] ?? '';
    $real = is_string($dir) ? realpath($dir) : false;
    $root = realpath(dirname(__DIR__));
    if (!is_string($secret) || strlen($secret) < 32 || !$real || is_link($dir)
        || str_starts_with($real.'/', $root.'/') || !is_writable($real) || (fileperms($real) & 0077)) reject(503, 'unavailable');
    $path = $real.'/state.json';
    if (is_link($path)) reject(503, 'unavailable');
    $handle = fopen($path, 'c+');
    if (!$handle) reject(503, 'unavailable');
    chmod($path, 0600);
    $deadline = microtime(true) + 0.25;
    while (!flock($handle, LOCK_EX | LOCK_NB)) {
        if (microtime(true) > $deadline) { fclose($handle); reject(503, 'busy'); }
        usleep(10000);
    }
    try {
        $raw = stream_get_contents($handle, 2097153);
        if (strlen($raw) > 2097152) reject(503, 'unavailable');
        $s = $raw === '' ? ['items'=>[], 'rates'=>[]] : json_decode($raw, true, 12, JSON_THROW_ON_ERROR);
        if (!is_array($s['items'] ?? null) || !is_array($s['rates'] ?? null)) reject(503, 'unavailable');
        $save = static function () use ($handle, &$s): void {
            $data = json_encode($s, JSON_THROW_ON_ERROR);
            rewind($handle);
            if (!ftruncate($handle, 0) || fwrite($handle, $data) !== strlen($data) || !fflush($handle)) reject(503, 'unavailable');
            if (function_exists('fsync')) fsync($handle);
        };
        $count = count($s['items']) + count($s['rates']);
        foreach ($s['items'] as $k=>$item) if ($item['expires'] <= $now) unset($s['items'][$k]);
        foreach ($s['rates'] as $k=>$rate) if ($rate['until'] <= $now) unset($s['rates'][$k]);
        if (count($s['items']) + count($s['rates']) !== $count) $save();
        $hash = fn(string $value): string => hash_hmac('sha256', $value, $secret);
        $k = $hash('key:'.$key);
        $fingerprint = $hash('body:'.json_encode($v, JSON_THROW_ON_ERROR));
        if (isset($s['items'][$k])) {
            $item = $s['items'][$k];
            if (!hash_equals($item['fingerprint'], $fingerprint)) reject(409, 'idempotency_conflict');
            if ($item['status'] !== 'accepted') reject(409, 'delivery_uncertain');
            return ['id'=>$item['id']];
        }
        // Also prevent an accidental second send with a new key in another tab (10 minutes).
        foreach ($s['items'] as $item) if ($item['fingerprint'] === $fingerprint && $item['created'] + 600 > $now) {
            if ($item['status'] !== 'accepted') reject(409, 'delivery_uncertain');
            return ['id'=>$item['id']];
        }
        if (count($s['items']) >= 2000 || count($s['rates']) >= 2000) reject(503, 'busy');
        foreach ([$hash('ip:'.$ip)=>3, 'global'=>100] as $r=>$limit) {
            $rate = $s['rates'][$r] ?? ['count'=>0,'until'=>$now+600];
            if ($rate['count'] >= $limit) reject(429, 'rate_limited');
            $s['rates'][$r] = ['count'=>$rate['count']+1,'until'=>$rate['until']];
        }
        $id = gmdate('Ymd', $now).'-'.bin2hex(random_bytes(8));
        $s['items'][$k] = ['id'=>$id,'fingerprint'=>$fingerprint,'created'=>$now,'expires'=>$now+86400,'status'=>'pending','consentVersion'=>CONSENT_VERSION];
        $save(); // A crash or timeout leaves pending: never silently retry an uncertain mail.
        $sent = $mailer(message($v, $id, $now));
        $s['items'][$k]['status'] = $sent === true ? 'accepted' : 'failed';
        $save();
        if ($sent !== true) reject(502, 'mail_unavailable');
        return ['id'=>$id];
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}

function handle(array $server, string $raw, array $cfg, callable $mailer, ?int $now = null): array {
    if (($server['REQUEST_METHOD'] ?? '') !== 'POST') reject(405, 'method_not_allowed');
    if (strlen($raw) > MAX_BODY || (int)($server['CONTENT_LENGTH'] ?? 0) > MAX_BODY) reject(413, 'payload_too_large');
    if (!preg_match('/^application\/json(?:\s*;\s*charset=utf-8)?$/iD', $server['CONTENT_TYPE'] ?? '')) reject(415, 'json_required');
    $origin = localTest() ? ($cfg['ORIGIN'] ?? ORIGIN) : ORIGIN;
    if (($server['HTTP_ORIGIN'] ?? '') !== $origin || ($server['HTTP_X_LEAD_REQUEST'] ?? '') !== '1'
        || (isset($server['HTTP_SEC_FETCH_SITE']) && $server['HTTP_SEC_FETCH_SITE'] !== 'same-origin')) reject(403, 'origin_rejected');
    if (!enabled($cfg)) reject(503, 'form_disabled');
    $key = $server['HTTP_IDEMPOTENCY_KEY'] ?? '';
    if (!preg_match('/^[a-f0-9-]{32,64}$/D', $key)) reject(400, 'idempotency_required');
    return accept(validate($raw), $key, $server['REMOTE_ADDR'] ?? '', $cfg, $mailer, $now ?? time());
}

function response(int $code, array $data): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex');
    if ($code === 405) header('Allow: '.(basename($_SERVER['SCRIPT_NAME'] ?? '') === 'form-status.php' ? 'GET' : 'POST'));
    if ($code === 429 || $code === 503) header('Retry-After: 600');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function serve(bool $statusOnly = false): never {
    ini_set('display_errors', '0');
    ini_set('log_errors', '0'); // Errors must never serialize visitor data/paths to shared logs.
    set_time_limit(10);
    try {
        $cfg = config();
        if ($statusOnly) {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') reject(405, 'method_not_allowed');
            response(200, ['enabled'=>enabled($cfg), 'consentVersion'=>CONSENT_VERSION]);
        }
        $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
        $result = handle($_SERVER, $raw === false ? '' : $raw, $cfg, __NAMESPACE__.'\\mailTransport');
        response(202, ['ok'=>true] + $result);
    } catch (Rejection $e) { response($e->status, ['ok'=>false,'error'=>$e->reason]); }
    catch (\Throwable) { response(503, ['ok'=>false,'error'=>'unavailable']); }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) response(404, ['ok'=>false,'error'=>'not_found']);
