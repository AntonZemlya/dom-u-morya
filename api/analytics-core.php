<?php
declare(strict_types=1);
// Adapted from Rehab Profi ab3e365 web/server/metrica-receipt.php.
if (!defined('DOM_ANALYTICS_INTERNAL') && PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__.'/analytics-document.php';
const ANALYTICS_ORIGIN = 'https://zhk-dom-umorya.ru';
const ANALYTICS_PURPOSE = 'site_usage_analytics';
const ANALYTICS_TTL = 180 * 86400000;
const ANALYTICS_EVIDENCE_TTL = 30 * 86400000; // Proposed operator policy, pending approval.

function analytics_valid(array $body, int $now): bool {
    $action=$body['action']??null;
    $keys=array_keys($body);sort($keys);
    $expected=$action==='allow'?['action','clientTime','consentVersion','purpose','token']:['action','consentVersion','purpose','token'];
    return in_array($action,['allow','validate','withdraw'],true) && $keys===$expected
        && ($body['purpose']??null)===ANALYTICS_PURPOSE && ($body['consentVersion']??null)===ANALYTICS_VERSION
        && is_string($body['token']??null) && preg_match('/\A[a-f0-9]{64}\z/D',$body['token'])===1
        && ($action!=='allow'||(is_int($body['clientTime']??null)&&abs($now-$body['clientTime'])<=300000));
}
function analytics_dir(string $dir): void {
    if (is_link($dir)||!is_dir($dir)||realpath($dir)!==$dir||(fileperms($dir)&0077)!==0
        ||fileowner($dir)!==(function_exists('posix_geteuid')?posix_geteuid():getmyuid())) throw new RuntimeException('Storage unavailable');
    // Reject symlinks in any ancestor, including the fixed private namespace.
    for($p=$dir;$p!=='/'&&$p!=='.';$p=dirname($p))if(is_link($p))throw new RuntimeException('Storage unavailable');
}
function analytics_db(string $dir, bool $create=false): SQLite3 {
    analytics_dir($dir);if(basename(dirname($dir))==='analytics'){analytics_dir(dirname($dir));analytics_dir(dirname($dir,2));}$path=$dir.'/metrica-consent.sqlite3';
    foreach(['','-journal','-wal','-shm'] as $suffix){$f=$path.$suffix;
        if(is_link($f)||(file_exists($f)&&(!is_file($f)||stat($f)['nlink']!==1||realpath($f)!==$f||(fileperms($f)&0077)!==0||fileowner($f)!==(function_exists('posix_geteuid')?posix_geteuid():getmyuid()))))throw new RuntimeException('Storage unavailable');
    }
    if(!$create&&!is_file($path))throw new RuntimeException('Storage unavailable');
    $old=umask(0077);
    try{$db=new SQLite3($path,SQLITE3_OPEN_READWRITE|($create?SQLITE3_OPEN_CREATE:0));}finally{umask($old);}
    $db->enableExceptions(true);$db->busyTimeout(1800);$db->exec('PRAGMA foreign_keys=ON');
    if($create){
        $db->exec('CREATE TABLE IF NOT EXISTS analytics_receipts (
          token_hash TEXT PRIMARY KEY, receipt_id TEXT NOT NULL UNIQUE,
          created_at_ms INTEGER NOT NULL, granted_at_ms INTEGER, expires_at_ms INTEGER NOT NULL,
          consent_version TEXT NOT NULL, document_sha256 TEXT NOT NULL,
          purpose TEXT NOT NULL, withdrawn_at_ms INTEGER, purge_at_ms INTEGER NOT NULL)');
        $db->exec('CREATE INDEX IF NOT EXISTS analytics_receipts_purge ON analytics_receipts(purge_at_ms)');
        $db->exec('CREATE INDEX IF NOT EXISTS analytics_receipts_age ON analytics_receipts(created_at_ms)');
    }
    return $db;
}
function analytics_statement(SQLite3 $db,string $sql,array $values): SQLite3Result {
    $stmt=$db->prepare($sql);
    foreach($values as $key=>$value)$stmt->bindValue(':'.$key,$value,is_int($value)?SQLITE3_INTEGER:($value===null?SQLITE3_NULL:SQLITE3_TEXT));
    return $stmt->execute();
}
function analytics_cleanup(SQLite3 $db,int $now): void {
    analytics_statement($db,'DELETE FROM analytics_receipts WHERE purge_at_ms<=:now',['now'=>$now]);
}
function analytics_store(string $dir,array $body,int $now): array {
    if(!analytics_valid($body,$now))throw new InvalidArgumentException('Invalid consent');
    $action=$body['action'];$db=analytics_db($dir,$action!=='validate');
    try{
        $db->exec('BEGIN IMMEDIATE');analytics_cleanup($db,$now);
        $hash=hash('sha256',$body['token']);
        $row=analytics_statement($db,'SELECT * FROM analytics_receipts WHERE token_hash=:hash',['hash'=>$hash])->fetchArray(SQLITE3_ASSOC);
        if(!$row&&$action!=='validate'){
            $n=analytics_statement($db,'SELECT COUNT(*) AS n FROM analytics_receipts WHERE created_at_ms>=:since',['since'=>$now-3600000])->fetchArray(SQLITE3_ASSOC);
            if($n['n']>=1000)throw new RuntimeException('Service busy');
            // A withdrawal tombstone also wins if the original allow arrives later.
            analytics_statement($db,'INSERT INTO analytics_receipts VALUES (:hash,:id,:at,:grant,:expires,:version,:doc,:purpose,:withdraw,:purge)',[
                'hash'=>$hash,'id'=>bin2hex(random_bytes(16)),'at'=>$now,'grant'=>$action==='withdraw'?null:$now,'expires'=>$now+ANALYTICS_TTL,
                'version'=>ANALYTICS_VERSION,'doc'=>hash('sha256',ANALYTICS_TEXT),'purpose'=>ANALYTICS_PURPOSE,
                'withdraw'=>$action==='withdraw'?$now:null,'purge'=>$now+($action==='withdraw'?ANALYTICS_EVIDENCE_TTL:ANALYTICS_TTL+ANALYTICS_EVIDENCE_TTL)]);
            $row=analytics_statement($db,'SELECT * FROM analytics_receipts WHERE token_hash=:hash',['hash'=>$hash])->fetchArray(SQLITE3_ASSOC);
        }
        if(!$row)throw new InvalidArgumentException('Receipt unavailable');
        if($action==='withdraw'){
            if($row['withdrawn_at_ms']===null)analytics_statement($db,'UPDATE analytics_receipts SET withdrawn_at_ms=:at,purge_at_ms=:purge WHERE token_hash=:hash',[
                'hash'=>$hash,'at'=>$now,'purge'=>$now+ANALYTICS_EVIDENCE_TTL]);
        }elseif($row['granted_at_ms']===null||$row['withdrawn_at_ms']!==null||$row['expires_at_ms']<=$now||$row['consent_version']!==ANALYTICS_VERSION
            ||$row['document_sha256']!==hash('sha256',ANALYTICS_TEXT)||$row['purpose']!==ANALYTICS_PURPOSE)throw new InvalidArgumentException('Receipt unavailable');
        $db->exec('COMMIT');
        $result=['schemaVersion'=>1,'action'=>$action,'purpose'=>ANALYTICS_PURPOSE,'consentVersion'=>ANALYTICS_VERSION];
        if($action!=='withdraw')$result+=['receiptId'=>$row['receipt_id'],'receivedAt'=>$row['granted_at_ms'],
            'expiresAt'=>$row['expires_at_ms'],'documentSha256'=>$row['document_sha256']];
        return $result;
    }catch(Throwable $e){try{$db->exec('ROLLBACK');}catch(Throwable){}throw $e;}finally{$db->close();}
}
function analytics_json(int $status,array $body): void {
    http_response_code($status);header('Content-Type: application/json; charset=UTF-8');header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');header('X-Content-Type-Options: nosniff');header('X-Robots-Tag: noindex, nofollow');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");echo json_encode($body,JSON_UNESCAPED_UNICODE);
}
function analytics_http(string $dir,string $origin=ANALYTICS_ORIGIN): void {
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'){header('Allow: POST');analytics_json(405,['ok'=>false]);return;}
    if(($_SERVER['HTTP_HOST']??'')!==parse_url($origin,PHP_URL_HOST)||($_SERVER['HTTP_ORIGIN']??'')!==$origin
      ||($_SERVER['HTTP_X_FORWARDED_PROTOCOL']??'')!=='https'
      ||(isset($_SERVER['HTTP_SEC_FETCH_SITE'])&&$_SERVER['HTTP_SEC_FETCH_SITE']!=='same-origin')
      ||!preg_match('~^application/json(?:\s*;\s*charset=utf-8)?$~i',trim($_SERVER['CONTENT_TYPE']??''))){analytics_json(403,['ok'=>false]);return;}
    $length=(int)($_SERVER['CONTENT_LENGTH']??0);
    if($length<10||$length>512){analytics_json(400,['ok'=>false]);return;}
    $raw=file_get_contents('php://input',false,null,0,513);$body=is_string($raw)?json_decode($raw,true):null;
    $now=(int)round(microtime(true)*1000);
    if(!is_array($body)||strlen($raw)!==$length||!analytics_valid($body,$now)){analytics_json(422,['ok'=>false]);return;}
    try{analytics_json(200,analytics_store($dir,$body,$now));}
    catch(InvalidArgumentException){analytics_json(422,['ok'=>false]);}
    catch(Throwable){analytics_json(503,['ok'=>false]);}
}
