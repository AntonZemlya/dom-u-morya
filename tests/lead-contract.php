<?php
declare(strict_types=1);
require dirname(__DIR__).'/api/lead-core.php';
use function DomLead\handle;
use function DomLead\config;
use DomLead\Rejection;

if (PHP_VERSION_ID < 80400 || PHP_VERSION_ID >= 80500) throw new RuntimeException('Run on PHP 8.4');
$dir = sys_get_temp_dir().'/dom-lead-contract-'.bin2hex(random_bytes(6));
mkdir($dir, 0700);
$cfg = ['FORM_ENABLED'=>true,'SMTP_TRANSPORT_VERIFIED'=>true,'CONTROL_MAILBOX_VERIFIED'=>'azm1982@yandex.ru','OWNER_CONFIRMED_TO'=>'info@anyara.ru','ACCEPT_UNTESTED_MAIN'=>true,'LEGAL_MAIL_BCC'=>'azm1982@yandex.ru','LEGAL_APPROVED'=>'2026-10-31','HMAC_SECRET'=>str_repeat('fixture-only-',4),'STATE_DIR'=>$dir,
    'MAIL_TO'=>'info@anyara.ru','MAIL_BCC'=>'azm1982@yandex.ru','LEGAL_MAIL_TO'=>'info@anyara.ru'];
$server = ['REQUEST_METHOD'=>'POST','CONTENT_TYPE'=>'application/json','HTTP_ORIGIN'=>DomLead\ORIGIN,'HTTP_X_LEAD_REQUEST'=>'1','HTTP_IDEMPOTENCY_KEY'=>str_repeat('a',32),'REMOTE_ADDR'=>'192.0.2.1'];
$payload = ['name'=>'Синтетический тест','phone'=>'+70000000000','consent'=>true,'consentVersion'=>'2026-10-31','lotId'=>'22825','category'=>'studio'];
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
    check(str_contains($mails[0]['body'],'6 978 183 ₽')); check(str_contains($mails[0]['body'],'Редакция согласия: 2026-10-31'));
    check($mails[0]['subject']==='ЖК «Дом у моря» — новая заявка'); check(!str_contains($mails[0]['body'],$one['id']));
    $audit=array_values(json_decode(file_get_contents($dir.'/state.json'),true)['items'])[0];
    check($audit['created']===$now && $audit['consentVersion']===DomLead\CONSENT_VERSION && $audit['id']===$one['id']);
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
    check(str_contains($mails[1]['body'],'не является предложением банка'));
    foreach (['CONTROL_MAILBOX_VERIFIED','OWNER_CONFIRMED_TO','LEGAL_MAIL_BCC','MAIL_BCC'] as $flag) error(503,fn()=>request([],[],array_replace($cfg,[$flag=>''])));
    error(503,fn()=>request([],[],array_replace($cfg,['ACCEPT_UNTESTED_MAIN'=>false])));
    error(503,fn()=>request([],[],[]));
    error(503,fn()=>request([],[],array_replace($cfg,['FORM_ENABLED'=>false])));
    error(503,fn()=>request([],[],array_replace($cfg,['SMTP_TRANSPORT_VERIFIED'=>false])));
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
    error(503,fn()=>request([],[],array_replace($cfg,['MAIL_TO'=>'intruder@example.invalid'])));
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
    // Formatting is independent of the process/system timezone and keeps audit/header identifiers intact.
    $stamp=(new DateTimeImmutable('2026-10-31T11:33:57+00:00'))->getTimestamp();
    $full=array_replace($payload,['name'=>'Синтетический SMTP E2E','email'=>'synthetic@example.invalid','channel'=>'Telegram','callTime'=>'12-15',
        'planView'=>'furnished','requestKind'=>'calc','calculation'=>$calc]);
    $validated=DomLead\validate(json_encode($full,JSON_THROW_ON_ERROR));
    $previousTZ=date_default_timezone_get();date_default_timezone_set('America/Los_Angeles');
    $formatted=DomLead\message($validated,'20261031-0123456789abcdef',$stamp);
    check(date_default_timezone_get()==='America/Los_Angeles');date_default_timezone_set($previousTZ);
    $expected=<<<'BODY'
Новая заявка с сайта ЖК «Дом у моря»
Дата и время: 31.10.2026, 14:33:57 МСК

КОНТАКТЫ
Имя: Синтетический SMTP E2E
Телефон: +70000000000
E-mail: synthetic@example.invalid
Способ связи: Telegram
Удобное время: 12:00–15:00

КВАРТИРА
Категория: Студия
Квартира № 6 (лот 22825)
Этаж: 2
Площадь: 29 м²
Стоимость по каталогу: 6 978 183 ₽
Вид планировки: с мебелью

ИПОТЕЧНЫЙ РАСЧЁТ
Стоимость для расчёта: 6 978 183 ₽
Первоначальный взнос: 20%
Срок: 20 лет
Ставка: 6%
Программа: Семейная ипотека

Расчёт предварительный и не является предложением банка.

Стоимость и наличие квартиры требуют подтверждения агентством.

СОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ
Отдельная галочка: подтверждена.
Редакция согласия: 2026-10-31
Дата и время подтверждения: 31.10.2026, 14:33:57 МСК
Способ: отметка согласия и отправка формы на zhk-dom-umorya.ru.
BODY;
    check(str_replace("\r\n","\n",$formatted['body'])===$expected);
    check($formatted['subject']==='ЖК «Дом у моря» — новая заявка' && $formatted['id']==='20261031-0123456789abcdef' && $formatted['replyTo']===$full['email']);
    foreach (['20261031-0123456789abcdef','Оператор:','UTC','consent-personal-data.html','/#contact','family'] as $technical) check(!str_contains($formatted['subject'].' '.$formatted['body'],$technical));
    $minimal=DomLead\validate(json_encode(['name'=>$payload['name'],'phone'=>$payload['phone'],'consent'=>true,'consentVersion'=>DomLead\CONSENT_VERSION],JSON_THROW_ON_ERROR));
    $simple=DomLead\message($minimal,'20261031-0000000000000000',$stamp);
    check($simple['body']==="Новая заявка с сайта ЖК «Дом у моря»\r\nДата и время: 31.10.2026, 14:33:57 МСК\r\n\r\nКОНТАКТЫ\r\nИмя: Синтетический тест\r\nТелефон: +70000000000\r\n\r\nСОГЛАСИЕ НА ОБРАБОТКУ ПЕРСОНАЛЬНЫХ ДАННЫХ\r\nОтдельная галочка: подтверждена.\r\nРедакция согласия: 2026-10-31\r\nДата и время подтверждения: 31.10.2026, 14:33:57 МСК\r\nСпособ: отметка согласия и отправка формы на zhk-dom-umorya.ru.");
    check($simple['replyTo']==='');
    $rollover=DomLead\message($minimal,'20261031-0000000000000000',(new DateTimeImmutable('2026-10-30T22:01:02+00:00'))->getTimestamp());
    check(str_contains($rollover['body'],'31.10.2026, 01:01:02 МСК'));
    $manual=$minimal;$manual['calculation']=array_replace($calc,['term'=>21,'rate'=>7.5,'program'=>'custom']);
    $manualMail=DomLead\message($manual,'20261031-0000000000000000',$stamp);
    check(str_contains($manualMail['body'],'Срок: 21 год') && str_contains($manualMail['body'],'Ставка: 7,5%') && str_contains($manualMail['body'],'Программа: Индивидуальный расчёт'));
    check(!str_contains($manualMail['body'],'КВАРТИРА'));
    $preference=$minimal;$preference['category']='2k';$preference['requestKind']='full';
    $preferenceMail=DomLead\message($preference,'20261031-0000000000000000',$stamp);
    check(str_contains($preferenceMail['body'],'Интересующая категория: 2 спальни') && str_contains($preferenceMail['body'],'Полная оплата: актуальный прайс и условия.') && !str_contains($preferenceMail['body'],'КВАРТИРА'));
    $otherLot=DomLead\validate(json_encode(array_replace($payload,['lotId'=>'22936']),JSON_THROW_ON_ERROR));
    check(str_contains(DomLead\message($otherLot,'20261031-0000000000000000',$stamp)['body'],'Площадь: 28,9 м²'));
    echo 'PASS PHP '.PHP_VERSION.'; '.$checks.' contract assertions; fake mail only; no visitor data logged'.PHP_EOL;
} finally { foreach (glob($dir.'/*') as $file) unlink($file); rmdir($dir); }
