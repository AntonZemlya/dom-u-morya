<?php
declare(strict_types=1);

namespace RpmMail;

const COMMAND = 'rpm-mail-v1';
const MAX_REQUEST = 96 * 1024;
const TOKEN = '/\A[a-f0-9]{32}\z/D';
const CODE = '/\A[a-z0-9][a-z0-9-]{0,63}\z/D';

function valid(mixed $value, string $pattern): bool {
    return is_string($value) && preg_match($pattern, $value) === 1;
}

function keys(array $value, array $expected): bool {
    return count($value) === count($expected) && array_diff_key(array_flip($expected), $value) === [];
}

function privatePath(string $path, int $typeAndMode): bool {
    clearstatcache(true, $path);
    $stat = @lstat($path);
    return $stat !== false && ($stat['mode'] & 0177777) === $typeAndMode
        && $stat['uid'] === fileowner(__FILE__)
        && ($typeAndMode !== 0100600 || $stat['nlink'] === 1);
}

function database(string $directory): \PDO {
    $file = $directory.'/ledger.sqlite';
    if (!privatePath($file, 0100600)) throw new \RuntimeException('ledger_unavailable');
    $db = new \PDO('sqlite:'.$file, null, null, [\PDO::ATTR_TIMEOUT => 2]);
    $db->exec('PRAGMA synchronous=FULL');
    return $db;
}

function initialize(string $directory): string {
    $file = $directory.'/ledger.sqlite';
    $created = @fopen($file, 'x');
    if (!$created) throw new \RuntimeException('ledger_already_exists');
    fclose($created);
    $db = database($directory);
    $ledger = bin2hex(random_bytes(16));
    $db->beginTransaction();
    $db->exec('CREATE TABLE identity (id TEXT PRIMARY KEY);
        CREATE TABLE mail (id TEXT PRIMARY KEY, hash TEXT NOT NULL,
          state TEXT NOT NULL, accepted_at INTEGER)');
    $db->prepare('INSERT INTO identity VALUES (?)')->execute([$ledger]);
    $db->commit();
    return $ledger;
}

function parse(string $raw): array {
    if (strlen($raw) > MAX_REQUEST) throw new \InvalidArgumentException('oversized_request');
    $request = json_decode($raw, true, 5, JSON_THROW_ON_ERROR);
    if (!is_array($request) || !keys($request, ['op','id','kind','projects','subject','body','ledger'])
        || !in_array($request['op'], ['send', 'status'], true)
        || !in_array($request['kind'], ['daily', 'incident', 'test'], true)
        || !valid($request['ledger'], TOKEN)
        || !is_array($request['projects']) || !array_is_list($request['projects'])
        || count($request['projects']) < 1 || count($request['projects']) > 100
        || !is_string($request['body']) || strlen($request['body']) > 32768 || trim($request['body']) === ''
        || preg_match('/[\x00-\x08\x0b-\x1f\x7f]/', $request['body'])) {
        throw new \InvalidArgumentException('invalid_request');
    }
    $canonical = $request;
    ksort($canonical);
    $flags = JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS;
    if (rtrim($raw, "\n") !== json_encode($canonical, $flags)) throw new \InvalidArgumentException('noncanonical_request');
    $id = $request['id'];
    $subject = $request['subject'];
    $legacySubject = null;
    $stamp = '([0-9]{4})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])-([01][0-9]|2[0-3])([0-5][0-9])';
    switch ($request['kind']) {
        case 'daily':
            if (!valid($id, '/\Arpm-daily-'.$stamp.'\z/D')) throw new \InvalidArgumentException('invalid_id');
            preg_match('/\Arpm-daily-'.$stamp.'\z/D', $id, $p);
            $expected = 'Realty Price Manager · Отчёт по всем ЖК';
            // Already queued reports and receipt probes must retain their exact original subject.
            $legacySubject = "$expected · $p[3].$p[2] · $p[4]:$p[5]";
            if (!checkdate((int)$p[2], (int)$p[3], (int)$p[1])
                || !in_array($p[4].$p[5], ['0900','1600'], true)) throw new \InvalidArgumentException('invalid_slot');
            break;
        case 'incident':
            if (!valid($id, '/\Arpm-incident-'.$stamp.'-[a-f0-9]{32}\z/D')) {
                throw new \InvalidArgumentException('invalid_id');
            }
            preg_match('/\Arpm-incident-'.$stamp.'-[a-f0-9]{32}\z/D', $id, $p);
            if (!checkdate((int)$p[2], (int)$p[3], (int)$p[1])) throw new \InvalidArgumentException('invalid_date');
            $expected = "Realty Price Manager · Требуется внимание · $p[3].$p[2] · $p[4]:$p[5]";
            break;
        case 'test':
            if (!valid($id, '/\Arpm-test-[a-f0-9]{32}\z/D')
                || $request['body'] !== 'Проверка отправки, согласованная владельцем.') {
                throw new \InvalidArgumentException('invalid_test');
            }
            $expected = 'Realty Price Manager · Проверка почты';
            break;
        default:
            throw new \InvalidArgumentException('invalid_kind');
    }
    if ($subject !== $expected && ($legacySubject === null || $subject !== $legacySubject)) {
        throw new \InvalidArgumentException('invalid_subject');
    }
    $copy = [];
    foreach ($request['projects'] as $code) {
        if (!valid($code, CODE) || isset($copy[$code])) throw new \InvalidArgumentException('invalid_projects');
        $copy[$code] = true;
    }
    return $request;
}

function settings(string $directory): array {
    $file = $directory.'/config.json';
    if (!privatePath($file, 0100600)) throw new \RuntimeException('config_unavailable');
    $cfg = json_decode(file_get_contents($file, false, null, 0, 8193), true, 4, JSON_THROW_ON_ERROR);
    if (!is_array($cfg) || !keys($cfg, ['enabled','projects']) || !is_bool($cfg['enabled'])
        || !is_array($cfg['projects']) || !array_is_list($cfg['projects'])
        || !$cfg['projects'] || count($cfg['projects']) > 100) throw new \RuntimeException('invalid_config');
    foreach ($cfg['projects'] as $code) {
        if (!valid($code, CODE)) throw new \RuntimeException('invalid_config');
    }
    return $cfg;
}

function receipt(\PDO $db, string $id): ?array {
    $query = $db->prepare('SELECT hash,state,accepted_at FROM mail WHERE id=?');
    $query->execute([$id]);
    return $query->fetch(\PDO::FETCH_ASSOC) ?: null;
}

function receive(array $request, string $directory, callable $transport): array {
    $reply = ['id' => $request['id'], 'ledger' => $request['ledger']];
    $id = $request['id'];
    $lockPath = $directory.'/ledger.lock';
    $lock = @fopen($lockPath, 'c');
    if (!$lock) return $reply + ['state'=>'unavailable'];
    try {
        if (!privatePath($lockPath, 0100600)) return $reply + ['state'=>'unavailable'];
        if (!flock($lock, LOCK_EX | LOCK_NB)) return $reply + ['state'=>'busy'];
        $db = database($directory);
        $ledger = $db->query('SELECT id FROM identity')->fetchColumn();
        if ($ledger !== $request['ledger']) return $reply + ['state'=>'ledger_mismatch'];
        $hash = hash('sha256', json_encode(
            [$request['kind'], $request['projects'], $request['subject'], $request['body']], JSON_THROW_ON_ERROR));
        $record = receipt($db, $id);
        if ($record && !hash_equals($record['hash'], $hash)) return $reply + ['state'=>'conflict'];
        if ($record && $record['state'] === 'accepted') {
            return $reply + ['state'=>'accepted', 'accepted_at'=>(int)$record['accepted_at']];
        }
        if ($record && $record['state'] === 'uncertain') return $reply + ['state'=>'uncertain'];
        if ($record && $record['state'] !== 'retry') return $reply + ['state'=>'unavailable'];
        if ($request['op'] === 'status') return $reply + ['state'=>$record ? 'retry' : 'absent'];
        $cfg = settings($directory);
        if (array_diff($request['projects'], $cfg['projects'])) return $reply + ['state'=>'invalid'];
        if (!$cfg['enabled']) return $reply + ['state'=>'retry'];
        // These autocommit writes use SQLite synchronous=FULL. The lock spans the SMTP exchange.
        if (!$record) $db->prepare("INSERT INTO mail VALUES (?,?,'retry',NULL)")->execute([$id, $hash]);
        $beforeData = static function () use ($db, $id): void {
            $update = $db->prepare("UPDATE mail SET state='uncertain' WHERE id=? AND state='retry'");
            $update->execute([$id]);
            if ($update->rowCount() !== 1) throw new \RuntimeException('invalid_data_transition');
        };
        $accepted = $transport(['id'=>$id, 'subject'=>$request['subject'], 'body'=>$request['body'], 'replyTo'=>''],
                               $beforeData);
        if (!$accepted) return $reply + ['state'=>receipt($db, $id)['state']];
        $at = time();
        $stmt = $db->prepare("UPDATE mail SET state='accepted',accepted_at=? WHERE id=? AND state='uncertain'");
        $stmt->execute([$at, $id]);
        if ($stmt->rowCount() !== 1) {
            $db->prepare("UPDATE mail SET state='uncertain' WHERE id=? AND state='retry'")->execute([$id]);
            return $reply + ['state'=>'uncertain'];
        }
        return $reply + ['state'=>'accepted', 'accepted_at'=>$at];
    } catch (\Throwable) {
        return $reply + ['state'=>'unavailable'];
    } finally {
        fclose($lock);
    }
}

function main(array $argv): int {
    if (PHP_SAPI !== 'cli' || count($argv) !== 4 || PHP_VERSION_ID < 80400 || PHP_VERSION_ID >= 80500) return 2;
    umask(0077);
    [$script, $action, $doc, $directory] = $argv;
    if (!in_array($action, ['init','receive'], true) || !str_ends_with($doc, '/domains/zhk-dom-umorya.ru')
        || realpath($doc) !== $doc || realpath($directory) !== $directory
        || str_starts_with($directory.'/', $doc.'/') || str_starts_with(__FILE__, $doc.'/')
        || !privatePath($directory, 0040700)) return 2;
    try {
        if ($action === 'init') {
            if (getenv('SSH_ORIGINAL_COMMAND') !== false) return 2;
            settings($directory);
            echo json_encode(['ledger'=>initialize($directory)], JSON_THROW_ON_ERROR)."\n";
            return 0;
        }
        if (getenv('SSH_ORIGINAL_COMMAND') !== COMMAND) return 2;
        putenv('LEAD_CONFIG');
        putenv('LEAD_SMTP_TEST');
        require $doc.'/api/lead-core.php';
        require $doc.'/api/lead-smtp.php';
        $request = parse(stream_get_contents(STDIN, MAX_REQUEST + 1));
        $reply = receive($request, $directory, static function (array $message, callable $beforeData): bool {
            // The older three-argument transport ignores an extra argument in PHP.
            // Fail closed if the approved SMTP helper was rolled back independently.
            $transport = new \ReflectionFunction('DomLead\smtpTransport');
            $params = $transport->getParameters();
            if (!isset($params[3]) || $params[3]->getName() !== 'beforeData') return false;
            $cfg = \DomLead\config();
            return \DomLead\enabled($cfg) && \DomLead\smtpTransport($message, $cfg, true, $beforeData);
        });
        echo json_encode($reply, JSON_THROW_ON_ERROR)."\n";
        return 0;
    } catch (\Throwable) {
        fwrite(STDERR, "rpm-mail: invalid request or private configuration\n");
        return 2;
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
    exit(main($argv));
}
