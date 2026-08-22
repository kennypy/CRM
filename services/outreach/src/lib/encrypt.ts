/**
 * Secret encryption for the outreach service — delegates to the shared
 * implementation so all services read/write one wire format (the shared
 * decrypt still accepts rows written in this service's legacy
 * base64(iv‖ct‖tag) format).
 */

export {
  encryptSecret as encrypt,
  decryptSecret as decrypt,
} from "@nexcrm/service-common/secret-crypto";
