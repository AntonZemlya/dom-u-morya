<?php
declare(strict_types=1);
require_once __DIR__.'/../api/analytics-core.php';
if(($argv[1]??'')==='--worker'){echo json_encode(analytics_store($argv[2],json_decode($argv[3],true),(int)$argv[4]));exit;}
$n=0;function check(bool $ok,string $why):void {global $n;$n++;if(!$ok)throw new RuntimeException($why);}
function reject(callable $f,string $why):void {try{$f();}catch(Throwable){check(true,$why);return;}check(false,$why);}
$base=realpath(sys_get_temp_dir()).'/dom-analytics-'.bin2hex(random_bytes(6));mkdir($base,0700);
$dir=$base.'/state';mkdir($dir,0700);$now=(int)round(microtime(true)*1000);
$payload=['action'=>'allow','clientTime'=>$now,'token'=>str_repeat('a',64),'consentVersion'=>ANALYTICS_VERSION,'purpose'=>ANALYTICS_PURPOSE];
try{
 check(!analytics_valid($payload+['email'=>'PRIVATE_EMAIL'],$now),'Extra fields');
 check(!analytics_valid(array_replace($payload,['action'=>'deny']),$now),'Initial deny not registered');
 reject(fn()=>analytics_store($dir,array_replace($payload,['action'=>'deny']),$now),'No deny write');
 check(!file_exists($dir.'/metrica-consent.sqlite3'),'No database on refusal');
 $r=analytics_store($dir,$payload,$now);$db=analytics_db($dir);
 check($db->querySingle('SELECT COUNT(*) FROM analytics_receipts')===1,'Single grant');
 check((fileperms($dir.'/metrica-consent.sqlite3')&0077)===0,'Owner only');
 check($r['documentSha256']===hash_file('sha256',__DIR__.'/../ops/analytics/consent-analytics-2026-11-02-v1.txt'),'Immutable text SHA');
 check($r===analytics_store($dir,$payload,$now+1),'Idempotent double allow');
 $validate=$payload;unset($validate['clientTime']);$validate['action']='validate';
 foreach([25,48] as $hour){$v=analytics_store($dir,$validate,$now+$hour*3600000);check($v['receivedAt']===$now&&$v['expiresAt']===$now+ANALYTICS_TTL,'25/48h original date');}
 check($db->querySingle('SELECT COUNT(*) FROM analytics_receipts')===1,'No duplicate validates');
 reject(fn()=>analytics_store($dir,$validate,$now+ANALYTICS_TTL),'Exact expiry');
 reject(fn()=>analytics_store($dir,$validate+['expiresAt'=>$now+999999999999],$now),'Client cannot extend');
 reject(fn()=>analytics_store($dir,array_replace($validate,['token'=>str_repeat('b',64)]),$now),'Unknown token');
 reject(fn()=>analytics_store($dir,array_replace($validate,['consentVersion'=>'wrong']),$now),'Wrong version');
 reject(fn()=>analytics_store($dir,array_replace($validate,['purpose'=>'lead']),$now),'Wrong purpose');
 $withdraw=array_replace($validate,['action'=>'withdraw']);analytics_store($dir,$withdraw,$now+2000);analytics_store($dir,$withdraw,$now+3000);
 check($db->querySingle('SELECT withdrawn_at_ms FROM analytics_receipts')===$now+2000,'Idempotent linked withdrawal');
 reject(fn()=>analytics_store($dir,$validate,$now+4000),'Withdrawn invalid');
 reject(fn()=>analytics_store($dir,array_replace($payload,['clientTime'=>$now+4000]),$now+4000),'Allow cannot revive token');
 check($db->querySingle('SELECT COUNT(*) FROM analytics_receipts')===1,'No withdrawal duplicate');
 $tomb=array_replace($withdraw,['token'=>str_repeat('c',64)]);analytics_store($dir,$tomb,$now);
 reject(fn()=>analytics_store($dir,array_replace($payload,['token'=>str_repeat('c',64)]),$now),'Withdraw before late allow');
 check($db->querySingle("SELECT COUNT(*) FROM analytics_receipts WHERE granted_at_ms IS NULL")===1,'Withdrawal tombstone does not invent grant');
 $columns=[];$rows=$db->query('PRAGMA table_info(analytics_receipts)');while($x=$rows->fetchArray(SQLITE3_ASSOC))$columns[]=$x['name'];
 check(!array_intersect($columns,['ip','user_agent','name','email','phone','token']),'Minimal hashed capability schema');
 $db->exec('BEGIN IMMEDIATE');reject(fn()=>analytics_store($dir,array_replace($payload,['token'=>str_repeat('d',64)]),$now),'SQLite busy fail closed');$db->exec('ROLLBACK');$db->close();
 chmod($dir.'/metrica-consent.sqlite3',0644);clearstatcache();reject(fn()=>analytics_db($dir),'Unsafe file permission');chmod($dir.'/metrica-consent.sqlite3',0600);clearstatcache();
 $bad=$base.'/bad';mkdir($bad,0700);file_put_contents($bad.'/metrica-consent.sqlite3','corrupt');chmod($bad.'/metrica-consent.sqlite3',0600);
 reject(fn()=>analytics_store($bad,$payload,$now),'Corrupt SQLite');
 $link=$base.'/link';symlink($dir,$link);reject(fn()=>analytics_db($link),'Symlink directory');
 $other=$base.'/other';mkdir($other,0700);symlink($dir.'/metrica-consent.sqlite3',$other.'/metrica-consent.sqlite3');reject(fn()=>analytics_db($other),'Symlink database');
 chmod($dir,0755);clearstatcache();reject(fn()=>analytics_db($dir),'Unsafe dir');chmod($dir,0700);clearstatcache();
 // Concurrent duplicate grants share one committed row and original receipt.
 $parallel=$base.'/parallel';mkdir($parallel,0700);$workers=[];
 for($i=0;$i<2;$i++){$pipes=[];$process=proc_open([PHP_BINARY,'-n',__FILE__,'--worker',$parallel,json_encode($payload),(string)$now],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$workers[]=[$process,$pipes];}
 $responses=[];foreach($workers as [$process,$pipes]){$responses[]=json_decode(stream_get_contents($pipes[1]),true);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);check(proc_close($process)===0,'Concurrent worker success');}
 check($responses[0]===$responses[1],'Concurrent grant receipt idempotency');$parallelDb=analytics_db($parallel);check($parallelDb->querySingle('SELECT COUNT(*) FROM analytics_receipts')===1,'Concurrent single row');$parallelDb->close();
 // Real standalone CLI in a temporary deployment layout, preserving unexpired rows.
 $runtime=$base.'/runtime';mkdir($runtime,0700);mkdir($runtime.'/api',0700);mkdir($runtime.'/state',0700);
 copy(__DIR__.'/../ops/analytics/expire.php',$runtime.'/expire.php');
 foreach(['analytics-core.php','analytics-document.php'] as $file)copy(__DIR__.'/../api/'.$file,$runtime.'/api/'.$file);
 analytics_store($runtime.'/state',$payload,$now);$d=analytics_db($runtime.'/state');
 $d->exec('UPDATE analytics_receipts SET purge_at_ms=1');$d->close();
 $new=array_replace($payload,['token'=>str_repeat('e',64)]);analytics_store($runtime.'/state',$new,$now);
 // Insert one expired fixture after the write cleanup; the CLI must actually delete it.
 $d=analytics_db($runtime.'/state');$d->exec("INSERT INTO analytics_receipts SELECT 'expired','expired',0,0,0,consent_version,document_sha256,purpose,NULL,1 FROM analytics_receipts LIMIT 1");$d->close();
 exec(escapeshellarg(PHP_BINARY).' -n '.escapeshellarg($runtime.'/expire.php').' --expire',$output,$code);check($code===0,'CLI exit');
 $d=analytics_db($runtime.'/state');check($d->querySingle('SELECT COUNT(*) FROM analytics_receipts')===1,'CLI expires only old');$d->close();
 echo "PASS PHP SQLite $n assertions (25h/48h/expiry, idempotency, withdrawal races, private storage, busy/corrupt, real CLI)\n";
}finally{
 $it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
 foreach($it as $p){if($p->isDir()&&!$p->isLink())rmdir($p->getPathname());else unlink($p->getPathname());}rmdir($base);
}
