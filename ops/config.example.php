<?php
// Install only in /home/users/j/j84938826/.dom-u-morya/config.php (0600).
// Create state/ alongside it (0700). Never copy this directory to the docroot.
return [
    'FORM_ENABLED' => false,
    'DELIVERY_VERIFIED' => false,
    'LEGAL_APPROVED' => '', // After owner approval: 2026-10-30
    'HMAC_SECRET' => '', // Generate 32 random bytes, hex encoded, outside Git.
    'STATE_DIR' => __DIR__ . '/state',
];
