<?php
// Install only in /home/users/j/j84938826/.dom-u-morya/config.php (0600).
// Create state/ alongside it (0700). Never copy this directory to the docroot.
return [
    'FORM_ENABLED' => false,
    'DELIVERY_VERIFIED' => false,
    'LEGAL_APPROVED' => '', // After owner approval: 2026-10-30
    'MAIL_FROM' => 'sales@zhk-dom-umorya.ru',
    'MAIL_TO' => 'azm1982@yandex.ru', // Later: info@anyara.ru; requires separate receipt/legal approval.
    'DELIVERY_VERIFIED_TO' => '', // Exact MAIL_TO whose delivery was checked.
    'LEGAL_MAIL_TO' => '', // Exact MAIL_TO covered by the approved published legal text.
    'SMTP_HOST' => 'smtp.jino.ru',
    'SMTP_PORT' => 587,
    'SMTP_SECURITY' => 'starttls', // Explicit 465 + smtps only after approval; never automatic.
    'SMTP_USERNAME' => '', // Full domain mailbox, entered privately. Never paste into chat.
    'SMTP_PASSWORD' => '', // Enter directly into private config; never reset the mailbox.
    'SMTP_RUNTIME' => __DIR__ . '/smtp-runtime/REPLACE_WITH_REVIEWED_IDENTITY',
    'HMAC_SECRET' => '', // Generate 32 random bytes, hex encoded, outside Git.
    'STATE_DIR' => __DIR__ . '/state',
];
