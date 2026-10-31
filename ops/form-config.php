<?php
// CLI only. Secrets travel exclusively between private 0600 files, never stdout/argv.
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || count($argv) !== 5) exit(1);
try {
    [, $source, $target, $phase, $runtime] = $argv;
    if (!in_array($phase, ['prepare','enable','disable'], true) || is_link($source)
        || (fileperms($source)&0777)!==0600 || (fileperms(dirname($source))&0777)!==0700
        || file_exists($target) || is_link($target) || (fileperms(dirname($target))&0777)!==0700) throw new RuntimeException();
    $c = require $source;
    if (!is_array($c)) throw new RuntimeException();
    if ($phase !== 'disable' && (strlen($c['HMAC_SECRET']??'')<32 || !is_dir($c['STATE_DIR']??'')
        || ($c['FORM_ENABLED']??null)!==false)) throw new RuntimeException();
    $preserved = $c;
    if ($phase !== 'disable') {
        if (($c['SMTP_HOST']??'')!=='smtp.jino.ru' || ($c['SMTP_PORT']??0)!==587
            || ($c['SMTP_SECURITY']??'')!=='starttls' || ($c['SMTP_USERNAME']??'')!=='sales@zhk-dom-umorya.ru'
            || ($c['SMTP_RUNTIME']??'')!==$runtime
            || !is_string($c['SMTP_PASSWORD']??null) || $c['SMTP_PASSWORD']==='') throw new RuntimeException();
        $c = array_replace($c, [
            'FORM_ENABLED'=>false, 'DELIVERY_VERIFIED'=>false, 'DELIVERY_VERIFIED_TO'=>'',
            'MAIN_DELIVERY_VERIFIED'=>false, 'SMTP_TRANSPORT_VERIFIED'=>false,
            'CONTROL_MAILBOX_VERIFIED'=>'', 'OWNER_CONFIRMED_TO'=>'', 'ACCEPT_UNTESTED_MAIN'=>false,
            'LEGAL_APPROVED'=>'', 'LEGAL_MAIL_TO'=>'', 'LEGAL_MAIL_BCC'=>'',
            'MAIL_FROM'=>'sales@zhk-dom-umorya.ru', 'MAIL_TO'=>'info@anyara.ru', 'MAIL_BCC'=>'azm1982@yandex.ru',
            'SMTP_RUNTIME'=>$runtime,
        ]);
        if ($phase==='enable') $c=array_replace($c,[
            'FORM_ENABLED'=>true, 'SMTP_TRANSPORT_VERIFIED'=>true,
            'CONTROL_MAILBOX_VERIFIED'=>'azm1982@yandex.ru','OWNER_CONFIRMED_TO'=>'info@anyara.ru',
            'ACCEPT_UNTESTED_MAIN'=>true,'LEGAL_APPROVED'=>'2026-10-31',
            'LEGAL_MAIL_TO'=>'info@anyara.ru','LEGAL_MAIL_BCC'=>'azm1982@yandex.ru',
        ]);
    } else $c['FORM_ENABLED']=false;
    foreach (['HMAC_SECRET','STATE_DIR','SMTP_PASSWORD','SMTP_USERNAME','SMTP_HOST','SMTP_PORT','SMTP_SECURITY'] as $key)
        if (($c[$key]??null)!==($preserved[$key]??null)) throw new RuntimeException();
    $f=fopen($target,'x');if (!$f) throw new RuntimeException();
    chmod($target,0600);$bytes="<?php\nreturn ".var_export($c,true).";\n";
    if (fwrite($f,$bytes)!==strlen($bytes) || !fflush($f)) throw new RuntimeException();
    if (function_exists('fsync') && !fsync($f)) throw new RuntimeException();
    fclose($f);
} catch (Throwable) { fwrite(STDERR,"Private configuration validation failed\n"); exit(1); }
