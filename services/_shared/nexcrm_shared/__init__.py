"""
nexcrm_shared — code shared by the Python services (ai-engine, ingestion).

Not pip-installed: each service's Dockerfile copies this package next to its
`src/` directory (COPY services/_shared/nexcrm_shared ./nexcrm_shared), and each
service's conftest.py puts services/_shared on sys.path for local test runs.
"""
