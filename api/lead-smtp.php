<?php
declare(strict_types=1);
namespace DomLead;

/** Loopback fixture requires an explicit process flag and can never run in web PHP. */
function smtpTest(array $cfg): bool {
    return localTest() && getenv('LEAD_SMTP_TEST') === '1' && ($cfg['SMTP_HOST'] ?? '') === '127.0.0.1';
}

function smtpSettings(array $cfg): array {
    $test = smtpTest($cfg);
    $host = $cfg['SMTP_HOST'] ?? 'smtp.jino.ru';
    $port = $cfg['SMTP_PORT'] ?? 587;
    $tls = $cfg['SMTP_SECURITY'] ?? 'starttls';
    if ((!$test && ($host !== 'smtp.jino.ru' || !in_array([$port, $tls], [[587,'starttls'],[465,'smtps']], true)))
        || ($test && (!is_int($port) || $port < 1024 || $port > 65535 || !in_array($tls, ['starttls','smtps'], true)))
        || ($cfg['MAIL_FROM'] ?? '') !== MAIL_FROM
        || ($cfg['MAIL_TO'] ?? '') !== MAIL_TO || ($cfg['MAIL_BCC'] ?? '') !== MAIL_BCC
        || !is_string($cfg['SMTP_USERNAME'] ?? null) || (!$test && $cfg['SMTP_USERNAME'] !== MAIL_FROM)
        || !is_string($cfg['SMTP_PASSWORD'] ?? null) || $cfg['SMTP_PASSWORD'] === '') reject(503, 'unavailable');
    return [$host, $port, $tls];
}

function smtpRuntime(array $cfg): void {
    $manifest = require __DIR__.'/smtp-manifest.php';
    $dir = $cfg['SMTP_RUNTIME'] ?? '';
    $real = is_string($dir) ? realpath($dir) : false;
    $root = realpath(dirname(__DIR__));
    if (PHP_VERSION_ID < 80400 || PHP_VERSION_ID >= 80500 || !extension_loaded('openssl')
        || !extension_loaded('ctype') || !$real || is_link($dir)
        || str_starts_with($real.'/', $root.'/') || (fileperms($real) & 0077)
        || basename($real) !== $manifest['identity']) reject(503, 'unavailable');
    foreach ($manifest['files'] as $file=>$sha) {
        $path = $real.'/'.$file;
        if (!is_file($path) || is_link($path) || !str_starts_with(realpath($path), $real.'/')
            || !hash_equals($sha, hash_file('sha256', $path))) reject(503, 'unavailable');
    }
    foreach (['Exception','SMTP','PHPMailer'] as $class) require_once $real.'/src/'.$class.'.php';
}

function smtpReady(array $cfg): bool {
    try { smtpSettings($cfg); smtpRuntime($cfg); return true; }
    catch (\Throwable) { return false; }
}

/** Only final SMTP DATA acknowledgement is success. Exceptions are deliberately opaque. */
function smtpTransport(array $m, array $cfg): bool {
    $mail = null;
    try {
        [$host, $port, $tls] = smtpSettings($cfg);
        smtpRuntime($cfg);
        $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
        // PHPMailer normally sends DATA to accepted recipients even if another RCPT fails.
        // Abort that transaction before DATA; never deliver a partial To/BCC envelope.
        $mail->setSMTPInstance(new class extends \PHPMailer\PHPMailer\SMTP {
            public function recipient($address, $dsn = '') {
                if (!parent::recipient($address, $dsn)) {
                    $this->reset();
                    throw new \PHPMailer\PHPMailer\Exception('Recipient rejected');
                }
                return true;
            }
        });
        $mail->isSMTP();
        $mail->Host = $host;
        $mail->Port = $port;
        $mail->SMTPSecure = $tls === 'starttls' ? 'tls' : 'ssl';
        $mail->SMTPAutoTLS = false; // Explicit mandatory TLS, no downgrade or retry host.
        $mail->SMTPAuth = true;
        $mail->AuthType = 'LOGIN';
        $mail->Username = $cfg['SMTP_USERNAME'];
        $mail->Password = $cfg['SMTP_PASSWORD'];
        $ssl = ['verify_peer'=>true,'verify_peer_name'=>true,'allow_self_signed'=>false,'peer_name'=>$host];
        if (smtpTest($cfg) && isset($cfg['SMTP_TEST_CA'])) $ssl['cafile'] = $cfg['SMTP_TEST_CA'];
        $mail->SMTPOptions = ['ssl'=>$ssl];
        $mail->Timeout = 3;
        $mail->getSMTPInstance()->Timelimit = 4;
        $mail->SMTPDebug = 0;
        $mail->Debugoutput = static function (): void {}; // No SMTP dialogue/credentials in logs.
        $mail->SMTPKeepAlive = false;
        $mail->CharSet = 'UTF-8';
        $mail->Encoding = 'base64';
        $mail->XMailer = '';
        $mail->Hostname = 'zhk-dom-umorya.ru';
        $mail->setFrom(MAIL_FROM, 'ЖК Дом у моря');
        $mail->Sender = MAIL_FROM;
        $mail->addAddress($cfg['MAIL_TO']);
        $mail->addBCC($cfg['MAIL_BCC']);
        if ($m['replyTo'] !== '') $mail->addReplyTo($m['replyTo']);
        $mail->Subject = $m['subject'];
        $mail->Body = $m['body'];
        $mail->MessageID = '<'.$m['id'].'@zhk-dom-umorya.ru>';
        return $mail->send();
    } catch (\Throwable) { return false; }
    finally { if ($mail) $mail->smtpClose(); }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }
