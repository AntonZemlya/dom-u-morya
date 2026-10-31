<?php
// Install only in /home/users/j/j84938826/.dom-u-morya/config.php (0600).
// Create state/ alongside it (0700). Never copy this directory to the docroot.
return [
    'FORM_ENABLED' => false,
    // Historical flags are retained false; no claim of receipt at the primary mailbox.
    'DELIVERY_VERIFIED' => false,
    'DELIVERY_VERIFIED_TO' => '',
    'MAIN_DELIVERY_VERIFIED' => false,
    'SMTP_TRANSPORT_VERIFIED' => false, // Prior accepted GO A, never inferred from readiness.
    'CONTROL_MAILBOX_VERIFIED' => '', // azm1982@yandex.ru, prior actual Inbox receipt.
    'OWNER_CONFIRMED_TO' => '',
    'ACCEPT_UNTESTED_MAIN' => false, // Only the exact future owner GO accepts this risk.
    'LEGAL_APPROVED' => '', // After approval: 2026-10-31
    'MAIL_FROM' => 'sales@zhk-dom-umorya.ru',
    'MAIL_TO' => 'info@anyara.ru',
    'MAIL_BCC' => 'azm1982@yandex.ru',
    'LEGAL_MAIL_TO' => '',
    'LEGAL_MAIL_BCC' => '',
    'SMTP_HOST' => 'smtp.jino.ru',
    'SMTP_PORT' => 587,
    'SMTP_SECURITY' => 'starttls', // Explicit 465 + smtps only after approval; never automatic.
    'SMTP_USERNAME' => '', // Full domain mailbox, entered privately. Never paste into chat.
    'SMTP_PASSWORD' => '', // Enter directly into private config; never reset the mailbox.
    'SMTP_RUNTIME' => __DIR__ . '/smtp-runtime/REPLACE_WITH_REVIEWED_IDENTITY',
    'HMAC_SECRET' => '', // Generate 32 random bytes, hex encoded, outside Git.
    'STATE_DIR' => __DIR__ . '/state',
];
