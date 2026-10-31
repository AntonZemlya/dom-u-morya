<?php
declare(strict_types=1);
// Test harness is never in RELEASE_FILES. It cannot use the real mail transport.
if (PHP_SAPI !== 'cli-server' || ($_SERVER['REMOTE_ADDR'] ?? '') !== '127.0.0.1') { http_response_code(403); exit; }
$url=parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($url !== '/api/lead.php') return false;
require dirname(__DIR__).'/api/lead-core.php';
try {
    $cfg=DomLead\config();
    $raw=file_get_contents('php://input',false,null,0,8193);
    $result=DomLead\handle($_SERVER,$raw,$cfg,function(array $m) use ($cfg): bool {
        $path=dirname($cfg['STATE_DIR']).'/fake-mail.json';
        $data=is_file($path)?json_decode(file_get_contents($path),true):[];
        $data[]=$m;
        file_put_contents($path,json_encode($data,JSON_THROW_ON_ERROR));chmod($path,0600);
        return !($cfg['FAKE_MAIL_FAIL']??false);
    });
    DomLead\response(202,['ok'=>true]+$result);
} catch (DomLead\Rejection $e) { DomLead\response($e->status,['ok'=>false,'error'=>$e->reason]); }
catch (Throwable) { DomLead\response(503,['ok'=>false,'error'=>'unavailable']); }
