# nexcrm.io production site

Static marketing site served at https://nexcrm.io.

## Deployment

- Host: Proxmox LXC **CT 130 (nexcrm-web)**, Debian, unprivileged
- Web root: `/var/www/nexcrm/`
- Stack: nginx + php-fpm, exposed via Cloudflare Tunnel
- Form handler: `submit.php` sends demo requests via msmtp (Gmail SMTP)

## Files

- `index.html` - landing page (includes Try Demo / Start Free Trial buttons from `../demo/nexcrm-io-buttons.html`)
- `submit.php` - demo request form handler (rate-limited, honeypot-protected)
- `config.example.php` - template for `config.php` (holds the delivery address; `config.php` is gitignored and lives only on the server)

To deploy changes, copy files to `/var/www/nexcrm/` on CT 130 and ensure ownership is `www-data:www-data`.
