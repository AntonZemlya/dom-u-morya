<?php
declare(strict_types=1);
ini_set('display_errors','0');
define('DOM_ANALYTICS_INTERNAL',true);
require_once __DIR__.'/analytics-core.php';
// Fixed sibling namespace; never accept a request/config-provided database path.
$home=dirname(__DIR__,3);
analytics_http($home.'/.dom-u-morya/analytics/state');
