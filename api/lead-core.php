<?php
declare(strict_types=1);

namespace DomLead;

const CONSENT_VERSION = '2026-10-31';
const MAIL_FROM = 'sales@zhk-dom-umorya.ru';
const MAIL_TO = 'info@anyara.ru';
const MAIL_BCC = 'azm1982@yandex.ru';
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
    if (!is_file($path) || is_link($path) || (fileperms($path) & 0777) !== 0600
        || (fileperms(dirname($path)) & 0777) !== 0700) return [];
    $real = realpath($path);
    $root = realpath(dirname(__DIR__));
    if (!$real || str_starts_with($real, $root . DIRECTORY_SEPARATOR)) return [];
    $value = require $real;
    return is_array($value) ? $value : [];
}

function enabled(array $config): bool {
    return ($config['FORM_ENABLED'] ?? false) === true
        && ($config['SMTP_TRANSPORT_VERIFIED'] ?? false) === true
        && ($config['CONTROL_MAILBOX_VERIFIED'] ?? '') === MAIL_BCC
        && ($config['OWNER_CONFIRMED_TO'] ?? '') === MAIL_TO
        && ($config['ACCEPT_UNTESTED_MAIN'] ?? false) === true
        && ($config['LEGAL_APPROVED'] ?? '') === CONSENT_VERSION
        && ($config['MAIL_TO'] ?? '') === MAIL_TO
        && ($config['MAIL_BCC'] ?? '') === MAIL_BCC
        && ($config['LEGAL_MAIL_TO'] ?? '') === MAIL_TO
        && ($config['LEGAL_MAIL_BCC'] ?? '') === MAIL_BCC;
}

/** Read-only readiness: never create a state file or contact SMTP. */
function stateReady(array $cfg): bool {
    $dir = $cfg['STATE_DIR'] ?? '';
    $real = is_string($dir) ? realpath($dir) : false;
    $secret = $cfg['HMAC_SECRET'] ?? '';
    if (!is_string($secret) || strlen($secret) < 32 || !$real || is_link($dir)
        || str_starts_with($real.'/', realpath(dirname(__DIR__)).'/')
        || !is_writable($real) || (fileperms($real) & 0077)) return false;
    $file = $real.'/state.json';
    if (is_link($file)) return false;
    if (!file_exists($file)) return true;
    if (!is_file($file) || !is_writable($file) || (fileperms($file) & 0777) !== 0600
        || filesize($file) > 2 * 1024 * 1024) return false;
    $handle = fopen($file, 'r');
    if (!$handle) return false;
    try {
        if (!flock($handle, LOCK_SH | LOCK_NB)) return false;
        $state = json_decode(stream_get_contents($handle, 2 * 1024 * 1024 + 1), true, 12, JSON_THROW_ON_ERROR);
        return is_array($state) && is_array($state['items'] ?? null) && is_array($state['rates'] ?? null);
    } catch (\Throwable) { return false; }
    finally { flock($handle, LOCK_UN); fclose($handle); }
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
        $catalog = require __DIR__.'/lead-catalog.php';
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
        if (!is_int($c['price']) || !is_int($c['term']) || !is_int($c['downPct']) || !in_array($c['program'], ['regional','family','custom',null], true)) reject(422, 'invalid_fields');
        $c['program'] ??= 'custom'; // The existing manual-rate UI sends null.
        if ($v['lot'] && $c['price'] !== $v['lot']['price_rub']) reject(422, 'price_mismatch');
        $v['calculation'] = $c;
    }
    return $v;
}

/** Manager-facing plain text; delivery/consent identifiers remain in private state and Message-ID. */
function message(array $v, string $id, int $now): array {
    $date = (new \DateTimeImmutable('@'.$now))->setTimezone(new \DateTimeZone('Europe/Moscow'));
    $money = static fn(int $rub): string => number_format($rub, 0, ',', ' ').' ₽';
    $number = static fn(int|float $value): string => str_replace('.', ',', (string)$value);
    $categories = ['studio'=>'Студия','1k'=>'1 спальня','2k'=>'2 спальни','3k'=>'3 спальни','unsure'=>'Пока не определена'];
    $views = ['furnished'=>'с мебелью','unfurnished'=>'без мебели','floor'=>'на этаже'];
    $times = ['9-12'=>'09:00–12:00','12-15'=>'12:00–15:00','15-18'=>'15:00–18:00'];
    $programs = ['family'=>'Семейная ипотека','regional'=>'Льготная ипотека','custom'=>'Индивидуальный расчёт'];
    $lines = ['Новая заявка с сайта ЖК «Дом у моря»', 'Дата и время: '.$date->format('d.m.Y, H:i:s').' МСК',
        '', 'КОНТАКТЫ', 'Имя: '.$v['name'], 'Телефон: '.$v['phone']];
    if ($v['email'] !== '') $lines[] = 'E-mail: '.$v['email'];
    if ($v['channel'] !== '') $lines[] = 'Способ связи: '.$v['channel'];
    if ($v['callTime'] !== '') $lines[] = 'Удобное время: '.$times[$v['callTime']];
    if ($v['requestKind'] === 'full') array_push($lines, '', 'ЗАПРОС', 'Полная оплата: актуальный прайс и условия.');
    if ($v['lot']) {
        $lot = $v['lot'];
        array_push($lines, '', 'КВАРТИРА', 'Категория: '.$categories[$v['category']],
            'Квартира № '.$lot['number'].' (лот '.$lot['id'].')', 'Этаж: '.$lot['floor'],
            'Площадь: '.$number($lot['area_m2']).' м²', 'Стоимость по каталогу: '.$money($lot['price_rub']));
        if ($v['planView'] !== '') $lines[] = 'Вид планировки: '.$views[$v['planView']];
    } elseif ($v['category'] !== '' || $v['planView'] !== '') {
        array_push($lines, '', 'ПРЕДПОЧТЕНИЯ');
        if ($v['category'] !== '') $lines[] = 'Интересующая категория: '.$categories[$v['category']];
        if ($v['planView'] !== '') $lines[] = 'Вид планировки: '.$views[$v['planView']];
    }
    if ($v['calculation']) {
        $c = $v['calculation'];
        $term = $c['term'];
        $years = $term % 100 >= 11 && $term % 100 <= 14 ? 'лет' : match ($term % 10) { 1=>'год', 2,3,4=>'года', default=>'лет' };
        array_push($lines, '', 'ИПОТЕЧНЫЙ РАСЧЁТ', 'Стоимость для расчёта: '.$money($c['price']),
            'Первоначальный взнос: '.$c['downPct'].'%', 'Срок: '.$term.' '.$years,
            'Ставка: '.$number($c['rate']).'%', 'Программа: '.$programs[$c['program']],
            '', 'Расчёт предварительный и не является предложением банка.');
    }
    if ($v['lot']) array_push($lines, '', 'Стоимость и наличие квартиры требуют подтверждения агентством.');
    array_push($lines, '', 'СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ',
        'Отдельная галочка: подтверждена.', 'Редакция согласия: '.CONSENT_VERSION,
        'Дата и время подтверждения: '.$date->format('d.m.Y, H:i:s').' МСК',
        'Способ: отметка согласия и отправка формы на zhk-dom-umorya.ru.');
    return ['subject'=>'ЖК «Дом у моря» — новая заявка',
        'body'=>implode("\r\n", $lines), 'id'=>$id, 'replyTo'=>$v['email']];
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
    $existed = is_file($path);
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
        if ($raw === '' && $existed) reject(503, 'unavailable'); // Never reset truncated delivery history.
        $s = $raw === '' ? ['items'=>[], 'rates'=>[]] : json_decode($raw, true, 12, JSON_THROW_ON_ERROR);
        if (!is_array($s['items'] ?? null) || !is_array($s['rates'] ?? null)) reject(503, 'unavailable');
        $save = static function () use ($handle, &$s): void {
            $data = json_encode($s, JSON_THROW_ON_ERROR);
            rewind($handle);
            if (!ftruncate($handle, 0) || fwrite($handle, $data) !== strlen($data) || !fflush($handle)) reject(503, 'unavailable');
            if (function_exists('fsync') && !fsync($handle)) reject(503, 'unavailable');
        };
        $count = count($s['items']) + count($s['rates']);
        foreach ($s['items'] as $k=>$item) if ($item['expires'] <= $now) unset($s['items'][$k]);
        foreach ($s['rates'] as $k=>$rate) if ($rate['until'] <= $now) unset($s['rates'][$k]);
        if (count($s['items']) + count($s['rates']) !== $count) $save();
        $hash = fn(string $value): string => hash_hmac('sha256', $value, $secret);
        $k = $hash('key:'.$key);
        $fingerprint = $hash('body:'.$cfg['MAIL_TO'].':'.$cfg['MAIL_BCC'].':'.json_encode($v, JSON_THROW_ON_ERROR));
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
        $s['items'][$k] = ['id'=>$id,'fingerprint'=>$fingerprint,'created'=>$now,'expires'=>$now+604800,'status'=>'pending','consentVersion'=>CONSENT_VERSION];
        $save(); // A crash or timeout leaves pending: never silently retry an uncertain mail.
        $sent = $mailer(message($v, $id, $now));
        $s['items'][$k]['status'] = $sent === true ? 'accepted' : 'failed';
        if ($sent === true) $s['items'][$k]['expires'] = $now + 86400;
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
        require_once __DIR__.'/lead-smtp.php';
        $cfg = config();
        if ($statusOnly) {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') reject(405, 'method_not_allowed');
            $ready = stateReady($cfg) && smtpReady($cfg);
            response(200, ['enabled'=>enabled($cfg) && $ready, 'ready'=>$ready, 'consentVersion'=>CONSENT_VERSION]);
        }
        if (enabled($cfg) && !smtpReady($cfg)) reject(503, 'unavailable');
        $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
        $result = handle($_SERVER, $raw === false ? '' : $raw, $cfg, static fn(array $m): bool => smtpTransport($m, $cfg));
        response(202, ['ok'=>true] + $result);
    } catch (Rejection $e) { response($e->status, ['ok'=>false,'error'=>$e->reason]); }
    catch (\Throwable) { response(503, ['ok'=>false,'error'=>'unavailable']); }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) response(404, ['ok'=>false,'error'=>'not_found']);
