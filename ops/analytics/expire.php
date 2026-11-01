<?php
declare(strict_types=1);
// Install this CLI entry together with matching api modules in the private runtime.
if(PHP_SAPI!=='cli'||($argv[1]??'')!=='--expire')exit(2);
require_once __DIR__.'/api/analytics-core.php';
try{
    $db=analytics_db(__DIR__.'/state'); // Existing database only. No mkdir/init on cleanup.
    $db->exec('BEGIN IMMEDIATE');analytics_cleanup($db,(int)round(microtime(true)*1000));$db->exec('COMMIT');$db->close();exit(0);
}catch(Throwable){exit(2);}
