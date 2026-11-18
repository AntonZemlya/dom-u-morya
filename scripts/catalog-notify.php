<?php
declare(strict_types=1);

// The private installer places this command outside the document root.
if (PHP_SAPI !== 'cli' || count($argv) !== 2) exit(2);
$doc = $argv[1];
if (!str_ends_with($doc, '/domains/zhk-dom-umorya.ru') || realpath($doc) !== $doc) exit(2);
require $doc.'/api/lead-core.php';
try {
    $event = json_decode(stream_get_contents(STDIN, 256 * 1024), true, 8, JSON_THROW_ON_ERROR);
    if (!preg_match('/\Acatalog-[a-f0-9]{32}\z/D', $event['id']) || !is_string($event['subject'])
        || preg_match('/[\r\n]/', $event['subject']) || !is_string($event['body'])) exit(2);
    $event['replyTo'] = '';
    $config = DomLead\config();
    if (!DomLead\enabled($config) || !DomLead\smtpTransport($event, $config, true)) exit(3);
} catch (Throwable) {
    exit(3);
}
