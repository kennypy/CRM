<?php
/**
 * NexCRM Demo Request Handler
 * Receives form POST, validates, and sends email via msmtp (Gmail SMTP)
 */

// Recipient + secrets live in config.php (not committed to git)
$config = require __DIR__ . '/config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://nexcrm.io');
header('X-Content-Type-Options: nosniff');

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

// --- Simple IP-based rate limit: 1 submission per 60 seconds per IP ---
$ip       = preg_replace('/[^a-f0-9:.]/', '', $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$rateFile = '/tmp/nexcrm_rl_' . md5($ip);
if (file_exists($rateFile) && (time() - filemtime($rateFile)) < 60) {
    http_response_code(429);
    echo json_encode(['ok' => false, 'error' => 'Too many requests. Please wait a moment.']);
    exit;
}
touch($rateFile);

// --- Honeypot: bots fill hidden "website" field; humans don't see it ---
if (!empty($_POST['website'])) {
    // Silently succeed so bots don't retry
    echo json_encode(['ok' => true]);
    exit;
}

// --- Sanitise inputs ---
function clean(string $str): string {
    return htmlspecialchars(strip_tags(trim($str)), ENT_QUOTES, 'UTF-8');
}

$firstName = clean($_POST['firstName'] ?? '');
$lastName  = clean($_POST['lastName']  ?? '');
$company   = clean($_POST['company']   ?? '');
$rawEmail  = trim($_POST['email']      ?? '');
$phone     = clean($_POST['phone']     ?? '');

$email = filter_var($rawEmail, FILTER_VALIDATE_EMAIL);

// --- Validate required fields ---
if (!$firstName || !$lastName || !$company || !$email) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Please complete all required fields.']);
    exit;
}

// --- Build email ---
$to      = $config['to'];
$subject = '=?UTF-8?B?' . base64_encode('NexCRM Demo Request') . '?=';

$body = "New demo request received via nexcrm.io\n"
      . str_repeat('-', 40) . "\n"
      . "First name : $firstName\n"
      . "Last name  : $lastName\n"
      . "Company    : $company\n"
      . "Email      : $email\n"
      . "Phone      : " . ($phone ?: '(not provided)') . "\n"
      . str_repeat('-', 40) . "\n"
      . "Submitted  : " . date('Y-m-d H:i:s T') . "\n"
      . "IP         : $ip\n";

$headers = implode("\r\n", [
    "From: NexCRM Website <noreply@nexcrm.io>",
    "Reply-To: $firstName $lastName <$email>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "X-Mailer: NexCRM/1.0",
]);

// --- Send ---
if (mail($to, $subject, $body, $headers)) {
    echo json_encode(['ok' => true]);
} else {
    error_log('NexCRM: mail() failed for submission from ' . $ip);
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not send email. Please try again later.']);
}
