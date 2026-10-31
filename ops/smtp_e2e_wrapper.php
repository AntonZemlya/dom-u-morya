<?php
declare(strict_types=1);
// Rendered verbatim by smtp_e2e_remote.py. This file is NEVER in RELEASE_FILES.
ini_set('display_errors', '0');
ini_set('log_errors', '0');
ignore_user_abort(true);
set_time_limit(15);
umask(0077);
ob_start();

function finishE2E(int $code, array $data = ['ok'=>false]): never {
    while (ob_get_level()) ob_end_clean();
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    echo json_encode($data, JSON_THROW_ON_ERROR);
    exit;
}

function safeFileE2E(string $path, int $mode): void {
    if (!is_file($path) || is_link($path) || realpath($path) !== $path
        || (fileperms($path) & 0777) !== $mode) throw new RuntimeException();
}

function markerE2E(string $path, array $data, bool $exclusive = false): void {
    $f = fopen($path, $exclusive ? 'x' : 'r+');
    if (!$f && $exclusive) finishE2E(409);
    if (!$f) throw new RuntimeException();
    try {
        chmod($path, 0600);
        if (!flock($f, LOCK_EX)) throw new RuntimeException();
        $raw = json_encode($data, JSON_THROW_ON_ERROR);
        if (!ftruncate($f, 0) || fwrite($f, $raw) !== strlen($raw) || !fflush($f) || !fsync($f)) throw new RuntimeException();
    } finally { fclose($f); }
}

try {
    $s = json_decode(base64_decode('__E2E_SETTINGS_BASE64__', true), true, 16, JSON_THROW_ON_ERROR);
    $token = $_SERVER['HTTP_X_LEAD_E2E_TOKEN'] ?? '';
    $action = $_SERVER['HTTP_X_LEAD_E2E_ACTION'] ?? '';
    $host = parse_url($s['origin'], PHP_URL_HOST);
    $port = parse_url($s['origin'], PHP_URL_PORT);
    $expectedHost = $host.($port ? ':'.$port : '');
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || time() < $s['created'] || time() >= $s['expires']
        || $s['expires'] - $s['created'] !== 120 || !preg_match('/^[a-f0-9]{64}$/D', $token)
        || !hash_equals($s['token_hash'], hash('sha256', $token))
        || ($_SERVER['HTTP_ORIGIN'] ?? '') !== $s['origin'] || ($_SERVER['HTTP_HOST'] ?? '') !== $expectedHost
        || (($_SERVER['HTTPS'] ?? '') !== 'on' && ($_SERVER['HTTP_X_FORWARDED_PROTOCOL'] ?? '') !== 'https')
        || !in_array($action, ['preflight','attempt'], true) || file_get_contents('php://input', false, null, 0, 1) !== '') finishE2E(404);
    if ($s['local_fixture']) {
        if ($host !== '127.0.0.1' || !str_starts_with($s['home'], '/private/tmp/dom-smtp-e2e-test-')) throw new RuntimeException();
    } elseif ($s['home'] !== '/home/users/j/j84938826' || $s['origin'] !== 'https://zhk-dom-umorya.ru'
        || in_array(PHP_SAPI, ['cli','cli-server'], true)) throw new RuntimeException();
    if (PHP_VERSION_ID < 80400 || PHP_VERSION_ID >= 80500) throw new RuntimeException();
    foreach (['openssl','ctype','filter'] as $extension) if (!extension_loaded($extension)) throw new RuntimeException();
    $run = $s['home'].'/.dom-u-morya/e2e/'.$s['run_id'];
    if (realpath($run) !== $run || (fileperms($run) & 0777) !== 0700) throw new RuntimeException();
    $attempt = $run.'/attempt.json';
    if (file_exists($attempt) || is_link($attempt)) finishE2E(409);
    $approval = $s['home'].'/.dom-u-morya/e2e/approvals/'.$s['approval_id'].'.json';
    safeFileE2E($approval, 0600);
    $grant = json_decode(file_get_contents($approval), true, 8, JSON_THROW_ON_ERROR);
    if ($grant['run_id'] !== $s['run_id'] || $grant['mode'] !== $s['mode'] || $grant['package_sha256'] !== $s['package_sha256']) throw new RuntimeException();
    $config = $s['home'].'/.dom-u-morya/config.php';
    safeFileE2E($config, 0600);
    if ((fileperms(dirname($config)) & 0777) !== 0700 || !hash_equals($s['config_sha256'], hash_file('sha256', $config))) throw new RuntimeException();
    $cfg = require $config;
    if (!is_array($cfg) || ($cfg['FORM_ENABLED'] ?? null) !== false || ($cfg['DELIVERY_VERIFIED'] ?? null) !== false
        || ($cfg['LEGAL_APPROVED'] ?? null) !== '' || ($cfg['DELIVERY_VERIFIED_TO'] ?? '') !== '' || ($cfg['LEGAL_MAIL_TO'] ?? '') !== ''
        || ($cfg['MAIL_TO'] ?? '') !== 'azm1982@yandex.ru') throw new RuntimeException();
    $candidate = $s['home'].'/.dom-u-morya/candidates/'.$s['package_sha256'];
    foreach ($s['candidate_files'] as $file=>$sha) {
        safeFileE2E($candidate.'/'.$file, 0600);
        if (!hash_equals($sha, hash_file('sha256', $candidate.'/'.$file))) throw new RuntimeException();
    }
    require $candidate.'/api/lead-core.php';
    require $candidate.'/api/lead-smtp.php';
    if (($cfg['SMTP_RUNTIME'] ?? '') !== $s['home'].'/.dom-u-morya/smtp-runtime/'.$s['runtime_identity']
        || !DomLead\smtpReady($cfg) || !is_string($cfg['HMAC_SECRET'] ?? null) || strlen($cfg['HMAC_SECRET']) < 32) throw new RuntimeException();
    $locations = openssl_get_cert_locations();
    $trust = false;
    foreach ([ini_get('openssl.cafile'), $locations['default_cert_file'] ?? '', $locations['ini_cafile'] ?? '', getenv('SSL_CERT_FILE')] as $file) {
        if (is_string($file) && $file !== '' && is_readable($file) && is_file($file)) $trust = true;
    }
    foreach ([ini_get('openssl.capath'), $locations['default_cert_dir'] ?? '', getenv('SSL_CERT_DIR')] as $dir) {
        if (is_string($dir) && $dir !== '' && is_dir($dir) && glob($dir.'/*')) $trust = true;
    }
    if (!$trust) throw new RuntimeException();
    if ($action === 'preflight') finishE2E(200, ['ok'=>true,'php_version'=>PHP_VERSION,'sapi'=>PHP_SAPI,
        'runtime_verified'=>true,'trust_store_present'=>true,'form_enabled'=>false,'smtp_invoked'=>false]);
    $metadata = ['run_id'=>$s['run_id'],'commit'=>$s['commit'],'package_sha256'=>$s['package_sha256'],
        'mode'=>$s['mode'],'status'=>'pending','time'=>gmdate('c')];
    markerE2E($attempt, $metadata, true); // Durable one-shot BEFORE validation/transport; never removed by cleanup.
    $fixture = ['name'=>'Синтетический SMTP E2E','phone'=>'+70000000000','email'=>'synthetic@example.invalid',
        'consent'=>true,'consentVersion'=>'2026-10-30','lotId'=>'22825','category'=>'studio','planView'=>'furnished',
        'requestKind'=>'calc','channel'=>'Telegram','callTime'=>'12-15',
        'calculation'=>['price'=>6978183,'downPct'=>20,'term'=>20,'rate'=>6,'program'=>'family']];
    $v = DomLead\validate(json_encode($fixture, JSON_THROW_ON_ERROR));
    $cfg['STATE_DIR'] = $run.'/state'; // Isolated state; persisted production config/state remain untouched.
    $result = DomLead\accept($v, $s['run_id'].str_repeat('0', 8), 'synthetic-e2e', $cfg,
        static function (array $m) use ($cfg, $s, $run): bool {
            markerE2E($run.'/invocation.json', ['id'=>$m['id'],'time'=>gmdate('c'),'mode'=>$s['mode']], true);
            if ($s['mode'] === 'no-send') return true; // No socket, DNS lookup, mail(), or SMTP call in dry-run.
            if ($s['mode'] !== 'send-once') throw new RuntimeException();
            return DomLead\smtpTransport($m, $cfg);
        }, time());
    $metadata['status'] = $s['mode'] === 'no-send' ? 'dry_run' : 'smtp_accepted';
    $metadata['id'] = $result['id'];
    markerE2E($attempt, $metadata);
    finishE2E(200, ['ok'=>true,'status'=>$metadata['status'],'id'=>$result['id'],'form_enabled'=>false,
        'smtp_invoked'=>$s['mode'] === 'send-once','delivery_confirmed'=>false]);
} catch (Throwable) {
    // Pending/partial marker is deliberately retained: any failure may have followed DATA acceptance.
    finishE2E(503);
}
