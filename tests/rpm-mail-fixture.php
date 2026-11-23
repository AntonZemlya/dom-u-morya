<?php
declare(strict_types=1);

// CLI fixture configuration uses only fake credentials and the loopback TLS sink.
if (PHP_SAPI !== 'cli' || PHP_VERSION_ID < 80400 || PHP_VERSION_ID >= 80500) exit(2);
require __DIR__.'/../scripts/rpm-mail.php';
require __DIR__.'/../api/lead-core.php';
require __DIR__.'/../api/lead-smtp.php';
umask(0077);
try {
    $request = RpmMail\parse(stream_get_contents(STDIN, RpmMail\MAX_REQUEST + 1));
    $reply = RpmMail\receive($request, $argv[1], static function (array $message, callable $beforeData) use ($argv): bool {
        putenv('LEAD_SMTP_TEST=1');
        $cfg = [
            'FORM_ENABLED'=>true, 'SMTP_TRANSPORT_VERIFIED'=>true,
            'CONTROL_MAILBOX_VERIFIED'=>DomLead\MAIL_BCC, 'OWNER_CONFIRMED_TO'=>DomLead\MAIL_TO,
            'ACCEPT_UNTESTED_MAIN'=>true, 'LEGAL_APPROVED'=>DomLead\CONSENT_VERSION,
            'MAIL_TO'=>DomLead\MAIL_TO, 'MAIL_BCC'=>DomLead\MAIL_BCC, 'MAIL_FROM'=>DomLead\MAIL_FROM,
            'LEGAL_MAIL_TO'=>DomLead\MAIL_TO, 'LEGAL_MAIL_BCC'=>DomLead\MAIL_BCC,
            'SMTP_HOST'=>'127.0.0.1', 'SMTP_PORT'=>(int)$argv[2], 'SMTP_SECURITY'=>'starttls',
            'SMTP_USERNAME'=>'fixture-user', 'SMTP_PASSWORD'=>'fixture-password',
            'SMTP_TEST_CA'=>$argv[3], 'SMTP_RUNTIME'=>$argv[4],
        ];
        return DomLead\smtpTransport($message, $cfg, true, $beforeData);
    });
    echo json_encode($reply, JSON_THROW_ON_ERROR)."\n";
} catch (Throwable) {
    exit(2);
}
