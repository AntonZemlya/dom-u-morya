<?php
declare(strict_types=1);
require dirname(__DIR__).'/api/lead-core.php';
use function DomLead\handle;
use function DomLead\config;
use DomLead\Rejection;

if (PHP_VERSION_ID < 80400 || PHP_VERSION_ID >= 80500) throw new RuntimeException('Run on PHP 8.4');
$dir = sys_get_temp_dir().'/dom-lead-contract-'.bin2hex(random_bytes(6));
mkdir($dir, 0700);
$cfg = ['FORM_ENABLED'=>true,'DELIVERY_VERIFIED'=>true,'LEGAL_APPROVED'=>'2026-10-30','HMAC_SECRET'=>str_repeat('fixture-only-',4),'STATE_DIR'=>$dir,
    'MAIL_TO'=>'azm1982@yandex.ru','DELIVERY_VERIFIED_TO'=>'azm1982@yandex.ru','LEGAL_MAIL_TO'=>'azm1982@yandex.ru'];
$server = ['REQUEST_METHOD'=>'POST','CONTENT_TYPE'=>'application/json','HTTP_ORIGIN'=>DomLead\ORIGIN,'HTTP_X_LEAD_REQUEST'=>'1','HTTP_IDEMPOTENCY_KEY'=>str_repeat('a',32),'REMOTE_ADDR'=>'192.0.2.1'];
$payload = ['name'=>'Синтетический тест','phone'=>'+70000000000','consent'=>true,'consentVersion'=>'2026-10-30','lotId'=>'22825','category'=>'studio'];
$mails = []; $now = 1800000000; $checks = 0;
$fake = function ($m) use (&$mails) { $mails[] = $m; return true; };
function check(bool $ok): void { global $checks; $checks++; if (!$ok) throw new RuntimeException('Contract failed at check '.$checks); }
function request(array $p, array $s = [], ?array $c = null, ?callable $transport = null, ?int $time = null): array {
    global $payload,$server,$cfg,$fake,$now;
    return handle(array_replace($server,$s), json_encode(array_replace($payload,$p), JSON_THROW_ON_ERROR), $c ?? $cfg, $transport ?? $fake, $time ?? $now);
}
function error(int $code, callable $fn): void {
    try { $fn(); } catch (Rejection $e) { check($e->status === $code); return; }
    throw new RuntimeException('Expected rejection '.$code);
}
try {
    $one=request([]); check(count($mails)===1); check(!isset($mails[0]['to']));
    check(str_contains($mails[0]['body'],'6978183')); check(str_contains($mails[0]['body'],'2026-10-30'));
    check(!str_contains($mails[0]['subject'],$payload['name'])); check(str_ends_with($mails[0]['subject'],$one['id']));
    check(request([])===$one); check(count($mails)===1);
    $state=json_decode(file_get_contents($dir.'/state.json'),true);
    $state['items']['expired']=['expires'=>$now-1];
    file_put_contents($dir.'/state.json',json_encode($state));
    request([]);check(!isset(json_decode(file_get_contents($dir.'/state.json'),true)['items']['expired']));
    check(request([],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('b',32)])===$one); check(count($mails)===1);
    error(409,fn()=>request(['name'=>'Другое имя']));
    error(422,fn()=>request(['consent'=>false])); error(422,fn()=>request(['consent'=>'true']));
    error(422,fn()=>request(['consentVersion'=>'2026-10-27']));
    error(400,fn()=>handle($server,'{broken',$cfg,$fake,$now));
    error(400,fn()=>handle($server,'[]',$cfg,$fake,$now));
    error(422,fn()=>request(['phone'=>'+7123'])); error(422,fn()=>request(['phone'=>123]));
    error(413,fn()=>handle($server,str_repeat('x',8193),$cfg,$fake,$now));
    error(413,fn()=>request([],['CONTENT_LENGTH'=>8193]));
    error(405,fn()=>request([],['REQUEST_METHOD'=>'GET'])); error(415,fn()=>request([],['CONTENT_TYPE'=>'text/plain']));
    error(403,fn()=>request([],['HTTP_ORIGIN'=>'https://attacker.invalid']));
    error(403,fn()=>request([],['HTTP_ORIGIN'=>''])); error(403,fn()=>request([],['HTTP_X_LEAD_REQUEST'=>'']));
    error(403,fn()=>request([],['HTTP_SEC_FETCH_SITE'=>'cross-site']));
    foreach (["Тест\r\nBcc: test@example.invalid",'<script>x</script>',"Имя\u{202E}",str_repeat('я',81)] as $bad) error(422,fn()=>request(['name'=>$bad]));
    error(422,fn()=>request(['email'=>"test@example.invalid\r\nBcc:x@example.invalid"]));
    error(422,fn()=>request(['website'=>'bot'])); error(422,fn()=>request(['price'=>1]));
    error(422,fn()=>request(['lotId'=>'unknown'])); error(422,fn()=>request(['category'=>'3k']));
    error(422,fn()=>request(['planView'=>'other'])); error(422,fn()=>request(['requestKind'=>'other']));
    error(400,fn()=>request([],['HTTP_IDEMPOTENCY_KEY'=>'']));
    $calc=['price'=>6978183,'downPct'=>20,'term'=>20,'rate'=>6,'program'=>'family'];
    error(422,fn()=>request(['calculation'=>array_replace($calc,['price'=>1])]));
    error(422,fn()=>request(['calculation'=>array_replace($calc,['price'=>7000000])]));
    error(422,fn()=>request(['calculation'=>array_replace($calc,['term'=>'20'])]));
    request(['calculation'=>$calc],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('c',32)]); check(count($mails)===2);
    check(str_contains($mails[1]['body'],'введены пользователем'));
    error(503,fn()=>request([],[],[]));
    error(503,fn()=>request([],[],array_replace($cfg,['FORM_ENABLED'=>false])));
    error(503,fn()=>request([],[],array_replace($cfg,['DELIVERY_VERIFIED'=>false])));
    error(503,fn()=>request([],[],array_replace($cfg,['LEGAL_APPROVED'=>''])));
    error(502,fn()=>request(['name'=>'Сбой транспорта'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('d',32)],null,fn($m)=>false));
    error(409,fn()=>request(['name'=>'Сбой транспорта'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('d',32)]));
    error(429,fn()=>request(['name'=>'Четвёртая'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('e',32)]));
    // Client supplied proxy headers must not evade a per-address limit.
    error(429,fn()=>request(['name'=>'Пятая'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('f',32),'HTTP_X_FORWARDED_FOR'=>'192.0.2.8']));
    request(['name'=>'После TTL'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('e',32)],null,null,$now+86401);
    $state=file_get_contents($dir.'/state.json');
    foreach ([$payload['name'],$payload['phone'],$server['REMOTE_ADDR'],'example.invalid'] as $pii) check(!str_contains($state,$pii));
    check((fileperms($dir.'/state.json')&0777)===0600);
    $s=json_decode($state,true); check(count($s['items'])===2); // Uncertain delivery stays blocked for seven days.
    error(409,fn()=>request(['name'=>'Сбой транспорта'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('d',32)],null,null,$now+86401));
    error(503,fn()=>request([],[],array_replace($cfg,['MAIL_TO'=>'info@anyara.ru'])));
    error(503,fn()=>request([],[],array_replace($cfg,['HMAC_SECRET'=>''])));
    chmod($dir,0755);error(503,fn()=>request([]));chmod($dir,0700);
    check(DomLead\validate(json_encode(array_replace($payload,['calculation'=>array_replace($calc,['program'=>null,'rate'=>6.5])]),JSON_THROW_ON_ERROR))['calculation']['program']==='custom');
    try {
        request(['name'=>'Прерванный транспорт'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('8',32)],null,
            static function (): bool { throw new RuntimeException('synthetic transport crash'); },$now+86401);
        check(false);
    } catch (RuntimeException $e) { check($e->getMessage()==='synthetic transport crash'); }
    error(409,fn()=>request(['name'=>'Прерванный транспорт'],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('8',32)],null,null,$now+86401));
    $lock=fopen($dir.'/state.json','r+');flock($lock,LOCK_EX);
    error(503,fn()=>request([],['HTTP_IDEMPOTENCY_KEY'=>str_repeat('9',32)]));flock($lock,LOCK_UN);fclose($lock);
    file_put_contents($dir.'/state.json','');error(503,fn()=>request([]));
    file_put_contents($dir.'/state.json','broken');error(503,function() use ($server,$cfg,$fake,$now){try {handle($server,json_encode($GLOBALS['payload']),$cfg,$fake,$now);}catch(JsonException){DomLead\reject(503,'unavailable');}});
    echo 'PASS PHP '.PHP_VERSION.'; '.$checks.' contract assertions; fake mail only; no visitor data logged'.PHP_EOL;
} finally { foreach (glob($dir.'/*') as $file) unlink($file); rmdir($dir); }
