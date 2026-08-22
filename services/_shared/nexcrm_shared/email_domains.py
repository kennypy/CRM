"""Free/consumer email providers — domains that never represent a company."""

FREE_EMAIL_PROVIDERS = frozenset([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "protonmail.com", "aol.com", "mail.com", "zoho.com", "yandex.com",
])


def is_free_email_provider(domain: str) -> bool:
    return domain.lower() in FREE_EMAIL_PROVIDERS
